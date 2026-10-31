import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createCloudinary } from '../src/providers/media.js';

// A local stand-in for Cloudinary's upload endpoint. It only accepts bodies sent after a
// "100 Continue" (the handshake Cloudinary's edge needs) and can reset the first N connections.
function standIn({ resets = 0, status = 200 } = {}) {
  const seen = [];
  let remaining = resets;
  const server = http.createServer();
  server.on('checkContinue', (req, res) => {
    // A dual-stack server reports IPv4 clients as IPv4-mapped IPv6 (::ffff:127.0.0.1).
    seen.push({ expect: req.headers.expect, family: req.socket.remoteAddress.startsWith('::ffff:') ? 'IPv4' : req.socket.remoteFamily });
    if (remaining > 0) {
      remaining -= 1;
      req.socket.destroy();
      return;
    }
    res.writeContinue();
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      const publicId = body.match(/name="public_id"\r\n\r\n([^\r]+)/)?.[1];
      const folder = body.match(/name="folder"\r\n\r\n([^\r]+)/)?.[1];
      seen.at(-1).publicId = publicId;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? { public_id: `${folder}/${publicId}`, secure_url: `https://res.cloudinary.com/x/${publicId}.jpg`, width: 10, height: 10, bytes: 1, format: 'jpg' } : { error: { message: 'Invalid image file' } }));
    });
  });
  // A request without Expect is refused the way the real edge drops it.
  server.on('request', (req) => req.socket.destroy());
  // Dual-stack, reached as "localhost", so the client can choose IPv6 (::1) or IPv4 (127.0.0.1).
  return new Promise((resolve) => server.listen({ port: 0, host: '::', ipv6Only: false }, () => resolve({ server, seen, url: `http://localhost:${server.address().port}` })));
}

let current;
afterEach(() => current?.server.close());

const upload = (url, opts = {}) =>
  createCloudinary({ cloudName: 'demo', apiKey: 'k', apiSecret: 's' }, { baseUrl: url, ...opts }).upload({ buffer: Buffer.alloc(2048, 1), mimeType: 'image/jpeg', folder: 'townant/platform/site/hero', publicId: 'fixedid123' });

describe('Cloudinary upload transport', () => {
  it('prefers IPv6 and sends the image only after a 100-continue handshake', async () => {
    current = await standIn();
    const result = await upload(current.url);
    expect(result.publicId).toBe('townant/platform/site/hero/fixedid123');
    expect(current.seen).toEqual([{ expect: '100-continue', family: 'IPv6', publicId: 'fixedid123' }]);
  });

  it('retries a reset connection once, on the other address family, with the same public ID', async () => {
    current = await standIn({ resets: 1 });
    const attempts = [];
    const result = await upload(current.url, { onAttempt: (a) => attempts.push(a) });
    expect(result.publicId).toBe('townant/platform/site/hero/fixedid123');
    expect(current.seen.map((s) => s.family)).toEqual(['IPv6', 'IPv4']);
    expect(current.seen.at(-1).publicId).toBe('fixedid123');
    expect(attempts).toEqual([
      { attempt: 1, family: 'IPv6', error: expect.stringMatching(/ECONNRESET|EPIPE/) },
      { attempt: 2, family: 'IPv4', status: 200 },
    ]);
  });

  it('gives up after one retry with a retryable provider error naming both attempts', async () => {
    current = await standIn({ resets: 10 });
    const err = await upload(current.url).catch((e) => e);
    expect(err).toMatchObject({ name: 'ProviderError', provider: 'cloudinary', retryable: true });
    expect(err.message).toMatch(/on IPv6, then .* on IPv4/);
    expect(current.seen).toHaveLength(2);
  });

  it('does not retry a rejected image', async () => {
    current = await standIn({ status: 400 });
    await expect(upload(current.url)).rejects.toMatchObject({ status: 400, retryable: false });
    expect(current.seen).toHaveLength(1);
  });
});
