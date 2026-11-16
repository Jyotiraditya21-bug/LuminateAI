import test from 'node:test';
import assert from 'node:assert';
import { POST as proxyPost } from '../src/app/api/proxy/route';
import { POST as askPost } from '../src/app/api/ask/route';

test('SSRF Protection: Rejects non-HTTPS protocol', async () => {
  const req = new Request('http://localhost:3000/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'http://api.openai.com/v1/chat/completions' })
  });

  const res = await proxyPost(req);
  assert.strictEqual(res.status, 403);
  const data = await res.json();
  assert.match(data.error, /Only secure HTTPS/);
});

test('SSRF Protection: Rejects localhost and loopback targets', async () => {
  const targets = [
    'https://localhost:8000/secret',
    'https://127.0.0.1:8080',
    'https://[::1]:9000',
    'https://0.0.0.0:3000'
  ];

  for (const url of targets) {
    const req = new Request('http://localhost:3000/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const res = await proxyPost(req);
    assert.strictEqual(res.status, 403, `Expected 403 for ${url}`);
  }
});

test('SSRF Protection: Rejects AWS/cloud metadata link-local IP (169.254.169.254)', async () => {
  const req = new Request('http://localhost:3000/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://169.254.169.254/latest/meta-data' })
  });

  const res = await proxyPost(req);
  assert.strictEqual(res.status, 403);
  const data = await res.json();
  assert.match(data.error, /not permitted/);
});

test('SSRF Protection: Rejects private RFC 1918 networks', async () => {
  const privateUrls = [
    'https://10.0.0.1/admin',
    'https://172.16.0.5/internal',
    'https://192.168.1.1/router'
  ];

  for (const url of privateUrls) {
    const req = new Request('http://localhost:3000/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const res = await proxyPost(req);
    assert.strictEqual(res.status, 403);
  }
});

test('SSRF Protection: Rejects unallowed external domains', async () => {
  const req = new Request('http://localhost:3000/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://evil-attacker-site.com/steal-keys' })
  });

  const res = await proxyPost(req);
  assert.strictEqual(res.status, 403);
  const data = await res.json();
  assert.match(data.error, /not permitted/);
});

test('Proxy: Rejects oversized payload (>512KB)', async () => {
  const hugeBody = 'x'.repeat(600 * 1024);
  const req = new Request('http://localhost:3000/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: hugeBody
  });

  const res = await proxyPost(req);
  assert.strictEqual(res.status, 413);
});

test('Ask API: Fails safely with 503 when server OPENAI_API_KEY is not configured', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const req = new Request('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Explain RACES' })
    });

    const res = await askPost(req);
    assert.strictEqual(res.status, 503);
    const data = await res.json();
    assert.match(data.error, /OpenAI API key is not configured/);
  } finally {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  }
});
