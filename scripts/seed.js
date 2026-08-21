#!/usr/bin/env node
/**
 * Seed harness.
 *
 * Usage:
 *   npm run seed                      # every seeder, idempotent
 *   npm run seed -- --mode=reference  # factual reference data only
 *   npm run seed -- --mode=demo       # development placeholder data only
 *   npm run seed -- --only=pincodes   # a single seeder
 *   npm run seed -- --fresh           # purge demo data first, then re-seed
 *
 * Guarantees:
 *   - Every seeder is idempotent, so running it twice is harmless.
 *   - Demo data is flagged as demo data (§69) and `--fresh` removes only that.
 *   - Demo data is refused outright in production.
 *   - Each run is recorded in `seedRuns`, so it is clear what an environment
 *     contains and when it was loaded.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { env, isProduction } from '../src/config/env.js';
import { SeedRun } from '../src/modules/system/seedRun.model.js';
import { selectSeeders } from './seeders/index.js';

/**
 * @param {string[]} argv
 * @returns {{ mode: 'reference'|'demo'|'all', only: string[], fresh: boolean }}
 */
function parseArguments(argv) {
  const options = { mode: 'all', only: [], fresh: false };

  for (const argument of argv) {
    if (argument === '--fresh') {
      options.fresh = true;
      continue;
    }
    const [flag, value] = argument.split('=');
    if (flag === '--mode') {
      if (!['reference', 'demo', 'all'].includes(value)) {
        throw new Error(`--mode must be reference, demo or all (received "${value}")`);
      }
      options.mode = value;
    } else if (flag === '--only') {
      options.only = (value ?? '').split(',').map((name) => name.trim()).filter(Boolean);
    } else if (argument.startsWith('--')) {
      throw new Error(`Unknown option "${argument}"`);
    }
  }

  return options;
}

/** Right-pads for a readable summary table without pulling in a dependency. */
const pad = (value, width) => String(value).padEnd(width);

function printSummary(results) {
  const nameWidth = Math.max(8, ...results.map((r) => r.seeder.length)) + 2;

  console.log('');
  console.log(
    `  ${pad('SEEDER', nameWidth)}${pad('KIND', 12)}${pad('CREATED', 9)}${pad('UPDATED', 9)}${pad('UNCHANGED', 11)}${pad('REMOVED', 9)}STATUS`,
  );
  console.log(`  ${'-'.repeat(nameWidth + 50 + 6)}`);

  for (const result of results) {
    console.log(
      `  ${pad(result.seeder, nameWidth)}${pad(result.kind, 12)}${pad(result.created, 9)}${pad(result.updated, 9)}${pad(result.unchanged, 11)}${pad(result.removed, 9)}${result.error ? `failed — ${result.error}` : 'ok'}`,
    );
  }
  console.log('');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  // Placeholder data must never reach a real storefront (§69).
  if (isProduction && (options.mode === 'demo' || options.mode === 'all')) {
    if (options.mode === 'demo') {
      throw new Error('Refusing to seed demo data in production.');
    }
    console.warn('  Production detected — demo seeders will be skipped.');
    options.mode = 'reference';
  }

  const selected = selectSeeders(options);

  if (selected.length === 0) {
    console.log('  No seeders matched. Nothing to do.');
    return;
  }

  console.log(`  Connecting to database "${env.MONGODB_DB_NAME}" …`);
  await connectDatabase();

  const startedAt = new Date();
  const results = [];
  let succeeded = true;

  for (const seeder of selected) {
    const result = {
      seeder: seeder.name,
      kind: seeder.kind,
      created: 0,
      updated: 0,
      unchanged: 0,
      removed: 0,
    };

    try {
      if (options.fresh) {
        const purge = (await seeder.purge?.()) ?? { removed: 0 };
        result.removed = purge.removed ?? 0;
      }

      const outcome = (await seeder.run()) ?? {};
      Object.assign(result, {
        created: outcome.created ?? 0,
        updated: outcome.updated ?? 0,
        unchanged: outcome.unchanged ?? 0,
      });
    } catch (error) {
      succeeded = false;
      // Truncated: the summary is a console table, and the full error is thrown
      // below for anything unexpected.
      result.error = String(error.message).slice(0, 400);
      console.error(`  Seeder "${seeder.name}" failed:`, error);
    }

    results.push(result);
  }

  const finishedAt = new Date();

  await SeedRun.create({
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    mode: options.mode,
    fresh: options.fresh,
    succeeded,
    environment: env.NODE_ENV,
    results,
  });

  printSummary(results);

  // Report the resulting size of every collection, which is the quickest way to
  // confirm a seed actually landed.
  const collections = await mongoose.connection.db.collections();
  const counts = await Promise.all(
    collections.map(async (collection) => ({
      name: collection.collectionName,
      count: await collection.countDocuments(),
    })),
  );

  console.log('  Collection counts:');
  for (const { name, count } of counts.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`    ${pad(name, 24)}${count}`);
  }
  console.log('');

  if (!succeeded) {
    throw new Error('One or more seeders failed. See the summary above.');
  }
  console.log('  Seed complete.');
}

main()
  .then(async () => {
    await disconnectDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('  Seed failed:', error.message);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
