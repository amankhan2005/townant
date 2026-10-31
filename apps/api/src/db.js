import mongoose from 'mongoose';
import { logger } from './lib/logger.js';
import { classifyMongoError, describeMongoUri, uriDatabaseName } from './lib/mongoUri.js';

// Drop filter keys that are not in the schema instead of passing them to MongoDB.
// Operator injection is prevented upstream: every route validates input with strict zod
// schemas (scalars only) and Express 5 parses query strings without nested objects.
mongoose.set('strictQuery', true);

// Fails fast: there is no fallback database. Logs only the database name, a masked host and an
// error category — never the URI, credentials or the driver's raw message.
export async function connectDb(uri) {
  const target = describeMongoUri(uri);
  const where = { database: target.database || 'test (none named in MONGODB_URI)', host: target.hostLabel };
  logger.info(where, 'connecting to database');
  for (const issue of target.issues) logger.warn(where, `MONGODB_URI: ${issue}`);
  if (!target.database) logger.warn(where, 'MONGODB_URI names no database, so MongoDB uses its default "test" database. Add /<database> before the "?" in MONGODB_URI.');
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, autoIndex: true });
  } catch (err) {
    const { code, hint } = classifyMongoError(err);
    logger.error({ ...where, category: code }, hint);
    // The driver error is not attached as `cause`: its message can contain host names.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`MongoDB connection failed (${code}). ${hint}`);
  }
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) {
    // Booking integrity relies on multi-document transactions, which need a replica set.
    throw new Error('MongoDB must run as a replica set (transactions are required). See README "Database".');
  }
  // Builds missing indexes; never drops existing ones (index removals are a manual migration).
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  logger.info({ database: mongoose.connection.db.databaseName, host: target.hostLabel }, 'database connected');
}

export { uriDatabaseName };

export async function disconnectDb() {
  await mongoose.disconnect();
}

// Runs fn inside a transaction, retrying on transient errors.
export async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export const isDuplicateKey = (err, keyFragment) =>
  err?.code === 11000 && (!keyFragment || JSON.stringify(err.keyPattern ?? err.keyValue ?? err.message).includes(keyFragment));
