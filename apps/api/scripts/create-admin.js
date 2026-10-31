// Bootstraps a Super Admin. Run on a trusted machine with production env loaded:
//   npm run admin:create -w @townant/api -- --email ops@example.com
// Prints a single-use setup link (valid 72 hours). No password is generated or emailed.
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { getEnv } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/db.js';
import { User } from '../src/models/index.js';
import { createActionToken } from '../src/services/onboarding.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
const email = z.email().safeParse((values.email ?? '').trim().toLowerCase());
if (!email.success) {
  console.error('Usage: npm run admin:create -- --email you@example.com [--name "Ops Lead"]');
  process.exit(1);
}

const env = getEnv();
await connectDb(env.MONGODB_URI);
let user = await User.findOne({ accountType: 'staff', email: email.data });
if (user && user.role !== 'super_admin') {
  console.error('That email already belongs to a vendor account. Use a different address.');
  await disconnectDb();
  process.exit(1);
}
if (user?.status === 'active') {
  console.error('A Super Admin with this email is already active. Use the password reset flow instead.');
  await disconnectDb();
  process.exit(1);
}
user ??= await User.create({ accountType: 'staff', role: 'super_admin', status: 'invited', email: email.data, displayName: values.name });
const token = await createActionToken({ userId: user._id, purpose: 'staff_invite', ttlHours: 72 });
console.log(`Super Admin invited: ${email.data}`);
console.log(`Open this link within 72 hours to set a password (single use):\n  ${new URL(`/admin/setup?token=${encodeURIComponent(token)}`, env.APP_BASE_URL)}`);
await disconnectDb();
