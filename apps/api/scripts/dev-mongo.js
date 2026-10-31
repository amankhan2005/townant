// Starts a local single-node MongoDB replica set for development (transactions need one).
// Data lives in .data/mongo at the repo root. Requires `mongod` and `mongosh` on PATH.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dbPath = fileURLToPath(new URL('../../../.data/mongo', import.meta.url));
const port = process.env.DEV_MONGO_PORT ?? '27018';
mkdirSync(dbPath, { recursive: true });

const mongod = spawn('mongod', ['--replSet', 'rs0', '--dbpath', dbPath, '--port', port, '--bind_ip', '127.0.0.1'], { stdio: ['ignore', 'ignore', 'inherit'] });
mongod.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => mongod.kill('SIGINT'));

const init = `try { rs.status().ok } catch (e) { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:${port}' }] }).ok }`;
for (let i = 0; i < 30; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  const r = spawnSync('mongosh', ['--quiet', '--port', port, '--eval', init], { encoding: 'utf8' });
  if (r.status === 0) {
    console.log(`MongoDB replica set ready: MONGODB_URI=mongodb://127.0.0.1:${port}/townant?replicaSet=rs0`);
    break;
  }
}
