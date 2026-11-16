import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ALLOWED_HOSTS = new Set([
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'api.groq.com',
  'api.anthropic.com',
  'export.arxiv.org',
]);

const MAX_BODY_BYTES = 512 * 1024; // 512 KB
const TIMEOUT_MS = 25000;          // 25s upstream timeout

// In-memory sliding window rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX = 60;          // 60 requests/min per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown-ip';
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower === '0.0.0.0'
  ) {
    return true;
  }
  // IPv4 private ranges check
  const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const b0 = parseInt(ipv4Match[1], 10);
    const b1 = parseInt(ipv4Match[2], 10);
    if (b0 === 10) return true; // 10.0.0.0/8
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true; // 172.16.0.0/12
    if (b0 === 192 && b1 === 168) return true; // 192.168.0.0/16
    if (b0 === 169 && b1 === 254) return true; // 169.254.0.0/16 Link-local/cloud metadata
    if (b0 === 127) return true; // Loopback
    if (b0 === 0) return true;
  }
  return false;
}

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  if (isRateLimited(clientIp)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait a minute before making more requests.' },
      { status: 429 }
    );
  }

  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Request body exceeds maximum allowed size (512KB)' }, { status: 413 });
    }

    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { url, method = 'POST', headers = {}, body: reqBody } = parsedBody;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid target URL parameter' }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: 'Malformed target URL' }, { status: 400 });
    }

    // SSRF Enforcements: Protocol must strictly be HTTPS
    if (parsedUrl.protocol !== 'https:') {
      return NextResponse.json(
        { error: 'Forbidden protocol. Only secure HTTPS upstream requests are permitted.' },
        { status: 403 }
      );
    }

    const host = parsedUrl.hostname.toLowerCase();

    // Check host against allowlist
    if (!ALLOWED_HOSTS.has(host) || isPrivateOrLocalHost(host)) {
      return NextResponse.json(
        { error: `Destination host '${host}' is not permitted. Only verified LLM and arXiv providers are allowed.` },
        { status: 403 }
      );
    }

    // Filter and sanitize upstream headers
    const sanitizedHeaders: Record<string, string> = {
      'User-Agent': 'LuminateAI-Proxy/1.0 (+https://luminate-ai-rag.vercel.app)',
      'Accept': 'application/json, text/xml, application/xml, */*'
    };

    const DISALLOWED_HEADERS = new Set([
      'host', 'cookie', 'set-cookie', 'connection', 'keep-alive',
      'transfer-encoding', 'upgrade', 'proxy-connection', 'x-forwarded-for'
    ]);

    if (typeof headers === 'object' && headers !== null) {
      for (const [k, v] of Object.entries(headers as Record<string, string>)) {
        const lowerK = k.toLowerCase();
        if (!DISALLOWED_HEADERS.has(lowerK) && typeof v === 'string') {
          sanitizedHeaders[k] = v;
        }
      }
    }

    // Server-owned key fallback if caller didn't supply key in headers/query
    if (host === 'api.openai.com' && !sanitizedHeaders['authorization'] && !sanitizedHeaders['Authorization']) {
      const serverKey = process.env.OPENAI_API_KEY;
      if (serverKey) sanitizedHeaders['Authorization'] = `Bearer ${serverKey}`;
    } else if (host === 'api.groq.com' && !sanitizedHeaders['authorization'] && !sanitizedHeaders['Authorization']) {
      const serverKey = process.env.GROQ_API_KEY;
      if (serverKey) sanitizedHeaders['Authorization'] = `Bearer ${serverKey}`;
    } else if (host === 'api.anthropic.com' && !sanitizedHeaders['x-api-key'] && !sanitizedHeaders['X-Api-Key']) {
      const serverKey = process.env.ANTHROPIC_API_KEY;
      if (serverKey) sanitizedHeaders['x-api-key'] = serverKey;
    } else if (host === 'generativelanguage.googleapis.com' && !parsedUrl.searchParams.has('key')) {
      const serverKey = process.env.GEMINI_API_KEY;
      if (serverKey) parsedUrl.searchParams.set('key', serverKey);
    }

    const uppercaseMethod = String(method).toUpperCase();
    if (uppercaseMethod !== 'GET' && uppercaseMethod !== 'POST') {
      return NextResponse.json({ error: `Method ${uppercaseMethod} is not permitted.` }, { status: 405 });
    }

    // Execute upstream fetch with timeout and manual redirect rejection
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(parsedUrl.toString(), {
        method: uppercaseMethod,
        headers: sanitizedHeaders,
        body: uppercaseMethod === 'POST' && reqBody !== undefined ? JSON.stringify(reqBody) : undefined,
        redirect: 'manual', // Never follow unexpected redirects (prevents open-redirect to internal IP)
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (res.status >= 300 && res.status < 400) {
      return NextResponse.json(
        { error: 'Upstream redirected unexpectedly. Redirects are blocked for security.' },
        { status: 502 }
      );
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } else {
      const text = await res.text();
      return new NextResponse(text, {
        status: res.status,
        headers: {
          'Content-Type': contentType.includes('xml') ? contentType : 'text/plain; charset=utf-8'
        }
      });
    }

  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === 'AbortError') {
      return NextResponse.json({ error: 'Upstream provider request timed out.' }, { status: 504 });
    }
    return NextResponse.json({ error: 'Proxy request failed.' }, { status: 500 });
  }
}
