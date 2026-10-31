import { createHash } from 'node:crypto';

// Safe descriptions of a MongoDB connection string for logs and diagnostics. Nothing returned
// here contains the URI, user name, password or a full host name: credentials and hosts are
// reduced to hashes that are only ever compared, never printed.

const hash = (v) => createHash('sha256').update(String(v)).digest('hex');
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const ATLAS = /\.mongodb\.net$/i;

function maskHost(host) {
  const name = host.split(':')[0].toLowerCase();
  if (LOCAL.has(name)) return host;
  if (ATLAS.test(name)) return `${name.split('.')[0]}.…mongodb.net (Atlas)`;
  return 'remote host (hidden)';
}

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

export function describeMongoUri(raw) {
  const uri = String(raw ?? '');
  const issues = [];
  const scheme = uri.startsWith('mongodb+srv://') ? 'mongodb+srv' : uri.startsWith('mongodb://') ? 'mongodb' : null;
  if (!scheme) return { scheme: null, issues: ['MONGODB_URI must start with mongodb:// or mongodb+srv://.'], options: [], database: '' };
  if (/\s/.test(uri)) issues.push('MONGODB_URI contains whitespace (a stray space or line break).');

  const rest = uri.slice(scheme.length + 3);
  const q = rest.indexOf('?');
  const beforeQuery = q === -1 ? rest : rest.slice(0, q);
  const query = q === -1 ? '' : rest.slice(q + 1);
  // The last "@" before the query ends the credentials; an earlier one is an unescaped "@".
  const at = beforeQuery.lastIndexOf('@');
  const userinfo = at === -1 ? '' : beforeQuery.slice(0, at);
  const afterAt = at === -1 ? beforeQuery : beforeQuery.slice(at + 1);
  const slash = afterAt.indexOf('/');
  const hostList = slash === -1 ? afterAt : afterAt.slice(0, slash);
  const path = slash === -1 ? '' : afterAt.slice(slash + 1);

  const colon = userinfo.indexOf(':');
  const rawUser = colon === -1 ? userinfo : userinfo.slice(0, colon);
  const rawPassword = colon === -1 ? '' : userinfo.slice(colon + 1);
  if (userinfo.includes('@')) issues.push('The user name or password contains a raw "@". Write it as %40.');
  if (/[:/?#[\]]/.test(rawPassword)) issues.push('The password contains a character that must be URL-encoded (: / ? # [ ]). Encode it, e.g. ":" → %3A, "/" → %2F, "#" → %23.');
  if (/[:/?#[\]]/.test(rawUser)) issues.push('The user name contains a character that must be URL-encoded.');
  if (/%(?![0-9a-f]{2})/i.test(userinfo)) issues.push('The user name or password contains a "%" that is not part of an encoding. Write a literal % as %25.');
  if (/[<>]/.test(userinfo) || /<db_password>|<password>/i.test(uri)) issues.push('The URI still contains a placeholder such as <db_password>. Replace it with the real (URL-encoded) password.');
  const user = safeDecode(rawUser);
  const password = safeDecode(rawPassword);
  if (userinfo && (user === null || password === null)) issues.push('The user name or password has an invalid %-encoding.');
  if (!userinfo && scheme === 'mongodb+srv') issues.push('No user name and password in the URI (Atlas requires them).');

  const hosts = hostList.split(',').filter(Boolean);
  if (!hosts.length) issues.push('No host in the URI.');
  const atlas = hosts.length > 0 && hosts.every((h) => ATLAS.test(h.split(':')[0]));

  const database = safeDecode(path) ?? '';
  if (path.includes('/')) issues.push(`The path "${database}" contains "/". Use exactly /townant_dev_seed before the "?".`);

  const params = new URLSearchParams(query);
  const options = [...params.keys()].map((k) => (/^(authSource|authMechanism|replicaSet|tls|ssl|retryWrites|w|appName|directConnection)$/i.test(k) ? `${k}=${params.get(k)}` : k));
  const authSource = [...params.entries()].find(([k]) => k.toLowerCase() === 'authsource')?.[1];
  // Atlas database users live in "admin". mongodb+srv:// gets authSource=admin from DNS; a standard
  // mongodb:// string authenticates against the path database unless authSource says otherwise.
  if (atlas && authSource && authSource !== 'admin') issues.push(`authSource=${authSource}: Atlas users authenticate against "admin". Use authSource=admin.`);
  if (atlas && scheme === 'mongodb' && database && !authSource) issues.push(`This standard (non-SRV) Atlas URI names the database "${database}" without authSource, so the driver authenticates against "${database}" instead of "admin" and Atlas answers "bad auth". Add authSource=admin to the query string.`);

  return {
    scheme,
    atlas,
    database,
    hostLabel: hosts.map(maskHost).join(', '),
    hostKey: hash(hosts.map((h) => h.toLowerCase()).sort().join(',')),
    hasUser: Boolean(user),
    hasPassword: Boolean(password),
    userKey: user === null ? null : hash(`u:${user}`),
    passwordKey: password === null ? null : hash(`p:${password}`),
    options,
    issues,
  };
}

// The database named in a connection string's path ('' when it names none).
export const uriDatabaseName = (uri) => describeMongoUri(uri).database ?? '';

// Turns a driver error into a category and an action, without the driver's message (which can
// contain host names).
export function classifyMongoError(err) {
  const text = `${err?.name ?? ''} ${err?.message ?? ''} ${err?.cause?.message ?? ''} ${err?.reason?.message ?? ''}`;
  if (err?.code === 18 || err?.code === 8000 || /bad auth|authentication failed/i.test(text)) {
    return { code: 'AUTH_FAILED', hint: 'MongoDB rejected the credentials. Check the database user name and password in the URI (URL-encoded), that the user exists in Atlas → Database Access, and that authentication uses "admin" (authSource).' };
  }
  if (err?.name === 'MongoParseError' || /URI|unescaped|Invalid scheme|must be|parse/i.test(err?.name === 'MongoParseError' ? text : '')) {
    return { code: 'URI_INVALID', hint: 'The connection string cannot be parsed. Usually an unescaped character in the user name or password (encode @ : / ? # [ ] %).' };
  }
  if (/querySrv|ENOTFOUND|EAI_AGAIN|ENODATA|ESERVFAIL/i.test(text)) {
    return { code: 'DNS_FAILED', hint: 'The cluster host name did not resolve. Check the host in the URI (copy it again from Atlas → Connect) and your DNS/network.' };
  }
  if (/SSL|TLS|certificate/i.test(text)) return { code: 'TLS_FAILED', hint: 'The TLS handshake failed. Check the system clock, proxies or VPNs that intercept TLS.' };
  if (/ECONNREFUSED/i.test(text)) return { code: 'CONNECTION_REFUSED', hint: 'Nothing is listening at that address. For local development start it with `npm run db:dev -w @townant/api`.' };
  if (err?.name === 'MongoServerSelectionError' || /timed out|ETIMEDOUT|Server selection/i.test(text)) {
    return { code: 'UNREACHABLE', hint: 'No server answered in time. For Atlas, add your current IP in Atlas → Network Access; also check VPN/firewall and that the cluster is not paused.' };
  }
  return { code: err?.name || 'UNKNOWN', hint: 'Unexpected connection error.' };
}

// A MONGODB_URI exported in the shell silently wins over apps/api/.env (Node's --env-file never
// overrides an existing variable). Returns a warning naming both databases (never the URIs) when
// the process is using a different target than the file declares, otherwise null.
export function envOverrideWarning(effectiveUri, fileUri) {
  if (!effectiveUri || !fileUri || effectiveUri === fileUri) return null;
  const used = describeMongoUri(effectiveUri);
  const file = describeMongoUri(fileUri);
  if (used.hostKey === file.hostKey && used.database === file.database) return null;
  const name = (d) => `"${d.database || 'test'}" on ${d.hostLabel || 'an unknown host'}`;
  return `MONGODB_URI from the shell environment overrides apps/api/.env: using ${name(used)}, but .env declares ${name(file)}. Unset it (unset MONGODB_URI) and restart if that is not intended.`;
}
