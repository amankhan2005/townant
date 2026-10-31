// Seeds the starting category taxonomy (scripts/lib/categories.js). Safe to re-run: upserts by slug.
import { getEnv } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/db.js';
import { seedCategories } from './lib/categories.js';

await connectDb(getEnv().MONGODB_URI);
console.log(`Categories ready: ${await seedCategories()}`);
await disconnectDb();
