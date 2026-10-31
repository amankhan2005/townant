import { describe, expect, it } from 'vitest';
import { classifyMongoError, describeMongoUri, envOverrideWarning } from '../src/lib/mongoUri.js';

// All credentials and hosts below are made up.
const SRV = 'mongodb+srv://seed-user:Corr3ct-Horse@cluster0.abcde.mongodb.net';
const secretsIn = (d) => JSON.stringify(d);

describe('describeMongoUri', () => {
  it('describes an Atlas SRV string without exposing credentials or the full host', () => {
    const d = describeMongoUri(`${SRV}/townant_dev_seed?retryWrites=true&w=majority&appName=Cluster0`);
    expect(d).toMatchObject({ scheme: 'mongodb+srv', atlas: true, database: 'townant_dev_seed', hostLabel: 'cluster0.…mongodb.net (Atlas)', hasUser: true, hasPassword: true, issues: [] });
    expect(d.options).toEqual(['retryWrites=true', 'w=majority', 'appName=Cluster0']);
    expect(secretsIn(d)).not.toMatch(/seed-user|Corr3ct|abcde/);
  });

  it('describes a local replica set', () => {
    expect(describeMongoUri('mongodb://127.0.0.1:27018/townant?replicaSet=rs0')).toMatchObject({ scheme: 'mongodb', atlas: false, database: 'townant', hostLabel: '127.0.0.1:27018', issues: [] });
  });

  it('compares credentials and hosts only through hashes', () => {
    const a = describeMongoUri(`${SRV}/townant_dev_seed`);
    const b = describeMongoUri('mongodb+srv://seed-user:Other-Pass1@cluster0.abcde.mongodb.net/townant_dev_seed?appName=x');
    expect(a.hostKey).toBe(b.hostKey);
    expect(a.userKey).toBe(b.userKey);
    expect(a.passwordKey).not.toBe(b.passwordKey);
  });

  it.each([
    ['the Atlas password placeholder', 'mongodb+srv://seed-user:<db_password>@cluster0.abcde.mongodb.net/townant_dev_seed', /placeholder/],
    ['a password kept inside angle brackets', 'mongodb+srv://seed-user:<Corr3ct-Horse>@cluster0.abcde.mongodb.net/townant_dev_seed', /placeholder/],
    ['a raw "@" in the password', 'mongodb+srv://seed-user:pa@ss@cluster0.abcde.mongodb.net/townant_dev_seed', /raw "@"/],
    ['a raw ":" in the password', 'mongodb+srv://seed-user:pa:ss@cluster0.abcde.mongodb.net/townant_dev_seed', /must be URL-encoded/],
    ['a stray "%"', 'mongodb+srv://seed-user:100%sure@cluster0.abcde.mongodb.net/townant_dev_seed', /"%"/],
    ['whitespace', 'mongodb+srv://seed-user:pass word@cluster0.abcde.mongodb.net/townant_dev_seed', /whitespace/],
    ['a path with a slash', `${SRV}/townant_dev_seed/?retryWrites=true`, /contains "\/"/],
    ['authSource other than admin on Atlas', `${SRV}/townant_dev_seed?authSource=townant_dev_seed`, /authSource=admin/],
    ['a standard Atlas string naming a database without authSource', 'mongodb://u:p@ac-x-shard-00-00.abcde.mongodb.net:27017,ac-x-shard-00-01.abcde.mongodb.net:27017/townant_dev_seed?ssl=true', /bad auth/],
    ['no credentials on SRV', 'mongodb+srv://cluster0.abcde.mongodb.net/townant_dev_seed', /No user name and password/],
    ['another scheme', 'postgres://localhost/townant', /must start with/],
  ])('flags %s', (_label, uri, issue) => {
    const d = describeMongoUri(uri);
    expect(d.issues.join(' ')).toMatch(issue);
    expect(d.issues.join(' ')).not.toMatch(/Corr3ct|seed-user|abcde/);
  });

  it('reports a missing database name as empty (the driver then uses "test")', () => {
    expect(describeMongoUri(`${SRV}/?retryWrites=true`).database).toBe('');
    expect(describeMongoUri(SRV).database).toBe('');
  });

  it('accepts a standard Atlas string that names authSource=admin', () => {
    expect(describeMongoUri('mongodb://u:p@ac-x-shard-00-00.abcde.mongodb.net:27017/townant_dev_seed?ssl=true&authSource=admin').issues).toEqual([]);
  });
});

describe('classifyMongoError', () => {
  it.each([
    [Object.assign(new Error('bad auth : authentication failed'), { name: 'MongoServerError', code: 8000 }), 'AUTH_FAILED'],
    [Object.assign(new Error('Authentication failed.'), { name: 'MongoServerError', code: 18 }), 'AUTH_FAILED'],
    [Object.assign(new Error('Password contains unescaped characters'), { name: 'MongoParseError' }), 'URI_INVALID'],
    [Object.assign(new Error('querySrv ENOTFOUND _mongodb._tcp.cluster0.abcde.mongodb.net'), { name: 'MongoServerSelectionError' }), 'DNS_FAILED'],
    [Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:27018'), { name: 'MongoServerSelectionError' }), 'CONNECTION_REFUSED'],
    [Object.assign(new Error('Server selection timed out after 10000 ms'), { name: 'MongoServerSelectionError' }), 'UNREACHABLE'],
  ])('%#: classifies as %s with a hint that does not repeat the driver message', (err, code) => {
    const result = classifyMongoError(err);
    expect(result.code).toBe(code);
    expect(result.hint).not.toMatch(/abcde|127\.0\.0\.1:27018|_mongodb\._tcp/);
  });
});

describe('envOverrideWarning (regression: a shell MONGODB_URI kept the API on another database)', () => {
  const atlas = `${SRV}/townant_dev_seed?retryWrites=true`;
  const local = 'mongodb://127.0.0.1:27018/townant?replicaSet=rs0';

  it('warns when the shell points the API at a different database than apps/api/.env, naming databases only', () => {
    const warning = envOverrideWarning(local, atlas);
    expect(warning).toMatch(/using "townant" on 127\.0\.0\.1:27018, but \.env declares "townant_dev_seed" on cluster0\.…mongodb\.net/);
    expect(warning).not.toMatch(/Corr3ct|seed-user|abcde/);
  });

  it('stays quiet when there is no override or it targets the same database', () => {
    expect(envOverrideWarning(atlas, atlas)).toBeNull();
    expect(envOverrideWarning(atlas, undefined)).toBeNull();
    expect(envOverrideWarning(`${SRV}/townant_dev_seed?appName=other`, atlas)).toBeNull();
  });
});
