import { requestJson } from './http.js';

export function createResendEmail({ apiKey, from }) {
  return {
    name: 'resend',
    async send({ to, subject, html, text, idempotencyKey }) {
      const json = await requestJson('resend', 'https://api.resend.com/emails', {
        headers: { Authorization: `Bearer ${apiKey}`, ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey.slice(0, 256) } : {}) },
        body: { from, to: [to], subject, html, text },
      });
      return { id: json.id };
    },
  };
}
