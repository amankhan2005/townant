// Explains which MongoDB target the API and the dev seed will use, without printing secrets.
//   npm run env:check -w @townant/api              # static checks only
//   npm run env:check -w @townant/api -- --ping    # also tries a read-only connection (no writes)
//
// Node's precedence (same for the API and seed scripts): a variable exported in the shell wins
// over every --env-file; among env files, a later file wins over an earlier one. The API loads
// .env; seed:dev loads .env, then .env.seed.
//
// Never printed: URIs, user names, passwords, full host names. Credentials are only compared
// between sources (same / different).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { parseArgs, parseEnv } from 'node:util';
import { classifyMongoError, describeMongoUri } from '../src/lib/mongoUri.js';

const { values } = parseArgs({ options: { ping: { type: 'boolean', default: false } } });
const dir = new URL('../', import.meta.url);
const file = (name) => new URL(name, dir);

const sources = {};
for (const name of ['.env', '.env.seed']) {
  if (!existsSync(file(name))) continue;
  const raw = readFileSync(file(name), 'utf8');
  sources[name] = { env: parseEnv(raw), declarations: (raw.match(/^\s*(export\s+)?MONGODB_URI\s*=/gm) ?? []).length };
}
const shell = process.env.MONGODB_URI;

const resolve = (files) => {
  if (shell) return { from: 'shell (exported variable — overrides every env file)', uri: shell };
  for (const name of [...files].reverse()) if (sources[name]?.env.MONGODB_URI) return { from: `apps/api/${name}`, uri: sources[name].env.MONGODB_URI };
  return { from: 'not set', uri: undefined };
};

const problems = [];
const line = (label, value) => console.log(`  ${label.padEnd(22)} ${value}`);

console.log('Env files in apps/api');
for (const name of readdirSync(dir).filter((n) => n.startsWith('.env')).sort()) {
  const known = ['.env', '.env.seed', '.env.example'].includes(name);
  line(name, known ? (sources[name] ? `${sources[name].declarations} MONGODB_URI declaration(s)` : 'template') : 'NOT loaded by any script (editor backup or leftover?)');
  if (!known) problems.push(`apps/api/${name} is not used by anything. If it is an editor backup (nano writes .save files when a save fails), copy what you need into the right file and delete it — it may hold secrets.`);
  if (sources[name]?.declarations > 1) problems.push(`apps/api/${name} declares MONGODB_URI ${sources[name].declarations} times; only the last one counts. Keep one.`);
}
line('shell MONGODB_URI', shell ? 'SET — overrides .env and .env.seed' : 'not set (good)');

const targets = { API: resolve(['.env']), 'Seed (seed:dev)': resolve(['.env', '.env.seed']) };
const described = {};
for (const [label, t] of Object.entries(targets)) {
  console.log(`\n${label}`);
  line('MONGODB_URI from', t.from);
  if (!t.uri) {
    problems.push(`${label}: MONGODB_URI is not set.`);
    continue;
  }
  const d = describeMongoUri(t.uri);
  described[label] = d;
  line('scheme', d.scheme ?? 'INVALID');
  line('host', d.hostLabel ?? '—');
  line('database', d.database ? `"${d.database}"` : 'none in the URI → MongoDB uses "test"');
  line('user / password', `${d.hasUser ? 'present' : 'MISSING'} / ${d.hasPassword ? 'present' : 'MISSING'}`);
  if (d.options.length) line('options', d.options.join(', '));
  for (const issue of d.issues) problems.push(`${label}: ${issue}`);
  if (d.database !== 'townant_dev_seed') problems.push(`${label}: database is ${d.database ? `"${d.database}"` : 'not named (→ "test")'}, expected "townant_dev_seed".`);
}

const api = described.API;
const seed = described['Seed (seed:dev)'];
if (api && seed) {
  console.log('\nAPI vs seed');
  const same = (k) => (api[k] === seed[k] ? 'same' : 'DIFFERENT');
  line('host', same('hostKey'));
  line('database', same('database'));
  line('user name', same('userKey'));
  line('password', same('passwordKey'));
  if (api.hostKey !== seed.hostKey || api.database !== seed.database) problems.push('The API and seed:dev use different databases or servers, so seeded accounts will not exist for the API.');
  if (api.hostKey === seed.hostKey && (api.userKey !== seed.userKey || api.passwordKey !== seed.passwordKey)) {
    problems.push('The API and seed:dev reach the same cluster with different credentials. If one of them fails with "bad auth", copy the working user name and password (URL-encoded) into the other.');
  }
}

if (values.ping) {
  const { default: mongoose } = await import('mongoose');
  const tried = new Map();
  for (const [label, t] of Object.entries(targets)) {
    if (!t.uri || !described[label]?.scheme) continue;
    const key = t.uri;
    if (!tried.has(key)) {
      // Read-only: ping plus the user's roles. autoIndex/autoCreate off, so nothing is written.
      const conn = mongoose.createConnection(t.uri, { serverSelectionTimeoutMS: 12000, autoIndex: false, autoCreate: false });
      try {
        await conn.asPromise();
        const status = await conn.db.admin().command({ connectionStatus: 1 });
        const roles = status.authInfo.authenticatedUserRoles.map((r) => `${r.role}@${r.db}`);
        const canWrite = roles.some((r) => /^(readWrite|dbOwner|readWriteAnyDatabase|atlasAdmin|dbAdmin)@/.test(r) && (r.endsWith('@townant_dev_seed') || r.endsWith('@admin')));
        tried.set(key, { ok: true, database: conn.db.databaseName, roles, canWrite, replicaSet: Boolean((await conn.db.admin().command({ hello: 1 })).setName) });
      } catch (err) {
        tried.set(key, { ok: false, category: classifyMongoError(err) });
      } finally {
        await conn.close().catch(() => {});
      }
    }
    const r = tried.get(key);
    console.log(`\nConnection test — ${label}`);
    if (r.ok) {
      line('result', `connected to "${r.database}"`);
      line('replica set', r.replicaSet ? 'yes (transactions available)' : 'NO — bookings need a replica set');
      line('user roles', r.roles.join(', ') || '(none reported)');
      if (!r.canWrite) problems.push(`${label}: the database user has no role that can write to townant_dev_seed (needs readWrite@townant_dev_seed, or an admin-wide role).`);
    } else {
      line('result', `FAILED — ${r.category.code}`);
      line('meaning', r.category.hint);
      problems.push(`${label}: ${r.category.hint}`);
    }
  }
}

console.log(problems.length ? `\nProblems found:\n${problems.map((p) => `  - ${p}`).join('\n')}` : '\nNo problems found.');
process.exitCode = problems.length ? 1 : 0;
