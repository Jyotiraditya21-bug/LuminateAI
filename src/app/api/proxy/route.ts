import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url, method, headers, body: reqBody } = body;

    if (!url) {
      return NextResponse.json({ error: 'Missing target URL' }, { status: 400 });
    }

    const res = await fetch(url, {
      method: method || 'POST',
      headers: headers || {},
      body: reqBody ? JSON.stringify(reqBody) : undefined
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } else {
      const text = await res.text();
      return new NextResponse(text, {
        status: res.status,
        headers: { 'Content-Type': contentType }
      });
    }
  } catch (error: any) {
    console.error('Error in proxy route:', error);
    return NextResponse.json({ error: error.message || 'Internal proxy error' }, { status: 500 });
  }
}
