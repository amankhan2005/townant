// Development helper: creates customer accounts through the normal passwordless sign-up
// (POST /auth/otp/request + /auth/otp/verify) and adds a second contact the way a customer would
// (POST /me/identifiers/request + /verify). Codes are read from the API's development log
// (development email / WhatsApp providers), so this never bypasses verification and only works
// against a local API. Existing accounts are simply signed in.
//
//   API_LOG=<api log> node customers.mjs <data.json> > customers.json
import { readFileSync } from 'node:fs';

const API = `${process.env.API_URL ?? 'http://localhost:4000'}/api/v1`;
const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, { method = 'GET', token, body } = {}) {
  for (;;) {
    const res = await fetch(`${API}${path}`, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? 60);
      console.error(`  rate limited on ${path}; waiting ${wait}s`);
      await sleep((wait + 2) * 1000);
      continue;
    }
    const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status} ${json.error?.code ?? ''} ${json.error?.message ?? ''}`), { code: json.error?.code });
    return json;
  }
}

// The newest code the development provider logged for this destination after `after`.
async function codeFor(channel, destination, after) {
  for (let i = 0; i < 60; i += 1) {
    for (const line of readFileSync(process.env.API_LOG, 'utf8').trim().split('\n').reverse()) {
      if (!line.includes(channel === 'email' ? '[dev-email]' : '[dev-whatsapp]')) continue;
      const { time, msg, to } = JSON.parse(line);
      if (new Date(time).getTime() < after) break;
      if (channel === 'email' ? to === destination : msg.includes(destination.slice(-4))) {
        const code = channel === 'email' ? msg.match(/\b(\d{6})\b/)?.[1] : msg.match(/: (\d{6})$/)?.[1];
        if (code) return code;
      }
    }
    await sleep(500);
  }
  throw new Error(`No code logged for ${destination}`);
}

const out = [];
for (const c of data.customers) {
  const primary = c.signUpWith === 'whatsapp' ? { channel: 'whatsapp', phone: c.phone } : { channel: 'email', email: c.email };
  const dest = primary.email ?? primary.phone;
  const t0 = Date.now() - 1000;
  const { data: challenge } = await call('/auth/otp/request', { method: 'POST', body: primary });
  const code = await codeFor(primary.channel, dest, t0);
  const { data: session } = await call('/auth/otp/verify', { method: 'POST', body: { ...primary, challengeId: challenge.challengeId, code, transport: 'bearer', displayName: c.name } });
  const token = session.token;
  let user = session.user;
  if (user.displayName !== c.name) user = (await call('/me', { method: 'PATCH', token, body: { displayName: c.name } })).data ?? user;
  // Second contact, verified with its own code.
  const second = primary.channel === 'email' ? { channel: 'whatsapp', phone: c.phone } : { channel: 'email', email: c.email };
  const have = second.channel === 'email' ? user.email : user.phone;
  if (!have) {
    const t1 = Date.now() - 1000;
    const { data: ch } = await call('/me/identifiers/request', { method: 'POST', token, body: second });
    const code2 = await codeFor(second.channel, second.email ?? second.phone, t1);
    await call('/me/identifiers/verify', { method: 'POST', token, body: { ...second, challengeId: ch.challengeId, code: code2 } });
  }
  const me = (await call('/auth/session', { token })).data.user;
  out.push({ name: me.displayName, email: me.email, phone: me.phone, role: me.role, status: me.status ?? 'active', signedUpWith: primary.channel });
  console.error(`✓ ${me.displayName} — ${me.email} / ${me.phone} (${me.role})`);
  await call('/auth/logout', { method: 'POST', token }).catch(() => {});
}
console.log(JSON.stringify(out, null, 1));
