import crypto from 'node:crypto';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { ProviderError, requestJson } from './http.js';

function sign(params, secret) {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + secret).digest('hex');
}

// Connection-level failures (reset or closed while the body was being sent, or never connected).
// HTTP error responses are not connection failures and are handled separately.
const CONNECTION_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UPLOAD_TIMEOUT']);

// Address selection (the root cause of the hero upload 500/502, see docs/DECISIONS.md "Image
// uploads"): on networks where one address family is unreliable (measured: an IPv4 path that reset
// about half of all large uploads to any host, while IPv6 succeeded every time), connecting to
// whichever address the OS lists first fails at random. Like browsers and curl (RFC 8305), the first
// attempt prefers IPv6 and falls back to IPv4 if IPv6 doesn't connect within 2 s; IPv4-only hosts
// simply get IPv4. If that connection then dies mid-upload, the single retry uses the other family.
const ipv6FirstLookup = (hostname, options, callback) => dns.lookup(hostname, { ...options, all: true, order: 'ipv6first' }, callback);
const otherFamily = (family) => (family === 'IPv6' ? 4 : 6);

function multipart(fields, file) {
  const boundary = `----townant${crypto.randomBytes(12).toString('hex')}`;
  const parts = Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload"\r\nContent-Type: ${file.mimeType}\r\n\r\n`), file.buffer, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat(parts) };
}

// POSTs the multipart body with `Expect: 100-continue`, sending the bytes only after the server
// answers "100 Continue" (an early 4xx, e.g. a bad signature, then costs no upload). Resolves with
// the response; rejects with the connection error, tagged with the address family that was used.
function postUpload(url, { contentType, body }, { timeoutMs, family }) {
  return new Promise((resolve, reject) => {
    let usedFamily = null;
    const network = family ? { family } : { lookup: ipv6FirstLookup, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 2000 };
    const req = (url.startsWith('http:') ? http : https).request(url, { method: 'POST', agent: false, ...network, headers: { 'Content-Type': contentType, 'Content-Length': body.length, Expect: '100-continue' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json;
        try {
          json = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          json = {};
        }
        resolve({ status: res.statusCode, json, family: usedFamily });
      });
      res.on('error', (err) => reject(Object.assign(err, { family: usedFamily })));
    });
    req.on('socket', (socket) => socket.once('connect', () => (usedFamily = socket.remoteFamily ?? null)));
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('upload timed out'), { code: 'UPLOAD_TIMEOUT' })));
    req.on('continue', () => req.end(body));
    req.on('error', (err) => reject(Object.assign(err, { family: usedFamily })));
  });
}

// Uploads happen server-side after the API has validated the bytes, so clients never hold
// Cloudinary credentials or signatures and cannot choose folders or public IDs.
// `baseUrl` exists for tests (a local stand-in server); production always uses api.cloudinary.com.
export function createCloudinary({ cloudName, apiKey, apiSecret }, { timeoutMs = 45000, baseUrl = 'https://api.cloudinary.com', onAttempt } = {}) {
  const base = `${baseUrl}/v1_1/${cloudName}/image`;
  const send = (fields, file, family) => postUpload(`${base}/upload`, multipart(fields, file), { timeoutMs, family });
  return {
    name: 'cloudinary',
    async upload({ buffer, mimeType, folder, publicId }) {
      const params = { allowed_formats: 'jpg,png,webp', folder, overwrite: 'false', public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
      const fields = { ...params, api_key: apiKey, signature: sign(params, apiSecret) };
      let res;
      try {
        res = await send(fields, { buffer, mimeType });
        onAttempt?.({ attempt: 1, family: res.family, status: res.status });
      } catch (err) {
        onAttempt?.({ attempt: 1, family: err.family, error: err.code ?? err.name });
        if (!CONNECTION_CODES.has(err.code)) throw new ProviderError('cloudinary', `upload failed (${err.code ?? err.name})`, { retryable: false, code: err.code ?? err.name });
        // One retry on the other address family. The public ID is the same and overwrite is off, so
        // if the first attempt stored the image before its response was lost, Cloudinary returns that
        // asset instead of creating a second one.
        const family = err.family ? otherFamily(err.family) : 6;
        try {
          res = await send(fields, { buffer, mimeType }, family);
          onAttempt?.({ attempt: 2, family: res.family, status: res.status });
        } catch (retryErr) {
          onAttempt?.({ attempt: 2, family: retryErr.family, error: retryErr.code ?? retryErr.name });
          throw new ProviderError('cloudinary', `upload connection failed (${err.code} on ${err.family ?? 'unknown family'}, then ${retryErr.code ?? retryErr.name} on ${retryErr.family ?? `IPv${family}`})`, { retryable: true, code: retryErr.code ?? retryErr.name });
        }
      }
      if (res.status >= 200 && res.status < 300) {
        const json = res.json;
        return { publicId: json.public_id, url: json.secure_url, width: json.width, height: json.height, bytes: json.bytes, format: json.format };
      }
      // HTTP errors (bad image, credentials, plan limits, provider outage) are not retried here. The
      // provider's message goes to the server log only; clients get a generic message.
      throw new ProviderError('cloudinary', `HTTP ${res.status}`, { status: res.status, retryable: res.status === 429 || res.status >= 500, code: String(res.json?.error?.message ?? '').slice(0, 160) || undefined });
    },
    async destroy(publicId) {
      // invalidate=true also purges CDN copies, so a removed image stops being served promptly.
      const params = { invalidate: 'true', public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
      const form = new FormData();
      for (const [k, v] of Object.entries(params)) form.append(k, String(v));
      form.append('api_key', apiKey);
      form.append('signature', sign(params, apiSecret));
      await requestJson('cloudinary', `${base}/destroy`, { form });
    },
  };
}
