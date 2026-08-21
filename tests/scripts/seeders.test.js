/**
 * Seed harness behaviour.
 *
 * The properties that matter: seeders are idempotent (so re-running is safe),
 * reference data is factual and never marked as demo data, and the registry
 * filters correctly by mode and name.
 */
import { describe, expect, it } from 'vitest';
import { Pincode } from '../../src/modules/shipping/pincode.model.js';
import { SeedRun } from '../../src/modules/system/seedRun.model.js';
import { pincodesSeeder } from '../../scripts/seeders/pincodes.seeder.js';
import { seeders, selectSeeders } from '../../scripts/seeders/index.js';
import { useTestDatabase } from '../helpers/database.js';

useTestDatabase();

describe('seeder registry', () => {
  it('declares a name, kind and run function for every seeder', () => {
    for (const seeder of seeders) {
      expect(seeder.name).toBeTypeOf('string');
      expect(['reference', 'demo']).toContain(seeder.kind);
      expect(seeder.run).toBeTypeOf('function');
    }
  });

  it('has no duplicate seeder names', () => {
    const names = seeders.map((seeder) => seeder.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('filters by kind', () => {
    const reference = selectSeeders({ mode: 'reference' });
    expect(reference.every((seeder) => seeder.kind === 'reference')).toBe(true);

    const demo = selectSeeders({ mode: 'demo' });
    expect(demo.every((seeder) => seeder.kind === 'demo')).toBe(true);
  });

  it('filters by name', () => {
    expect(selectSeeders({ only: ['pincodes'] }).map((s) => s.name)).toEqual([
      'pincodes',
    ]);
    expect(selectSeeders({ only: ['does-not-exist'] })).toEqual([]);
  });
});

describe('pincodes seeder', () => {
  it('inserts Karnataka district reference data', async () => {
    const result = await pincodesSeeder.run();

    expect(result.created).toBeGreaterThan(0);
    expect(await Pincode.countDocuments()).toBe(result.created);

    const bengaluru = await Pincode.findOne({ pincode: '560001' }).lean();
    expect(bengaluru).toMatchObject({
      city: 'Bengaluru',
      district: 'Bengaluru Urban',
      state: 'Karnataka',
    });
  });

  it('is idempotent: a second run creates nothing new', async () => {
    const first = await pincodesSeeder.run();
    const countAfterFirst = await Pincode.countDocuments();

    const second = await pincodesSeeder.run();

    expect(second.created).toBe(0);
    expect(second.unchanged).toBe(first.created);
    expect(await Pincode.countDocuments()).toBe(countAfterFirst);
  });

  it('records the provenance of every row, so a starter set can be re-verified', async () => {
    await pincodesSeeder.run();

    const rows = await Pincode.find().lean();
    expect(rows.every((row) => row.source.startsWith('starter-set:'))).toBe(true);
  });

  it('leaves reference data alone when purging', async () => {
    await pincodesSeeder.run();

    const purge = await pincodesSeeder.purge();

    expect(purge.removed).toBe(0);
    expect(await Pincode.countDocuments()).toBeGreaterThan(0);
  });

  it('rejects a pincode that is not six digits', async () => {
    await expect(
      Pincode.create({
        pincode: '56001',
        city: 'Nowhere',
        district: 'Nowhere',
        state: 'Karnataka',
        source: 'test',
      }),
    ).rejects.toThrow(/valid 6-digit pincode/);
  });

  it('refuses a duplicate pincode', async () => {
    const row = {
      pincode: '560002',
      city: 'Bengaluru',
      district: 'Bengaluru Urban',
      state: 'Karnataka',
      source: 'test',
    };
    await Pincode.create(row);

    await expect(Pincode.create(row)).rejects.toThrow();
  });
});

describe('seed run bookkeeping', () => {
  it('records what a run did, so an environment discloses its demo data', async () => {
    const startedAt = new Date();

    await SeedRun.create({
      startedAt,
      finishedAt: new Date(),
      durationMs: 12,
      mode: 'all',
      fresh: false,
      succeeded: true,
      environment: 'test',
      results: [{ seeder: 'pincodes', kind: 'reference', created: 26 }],
    });

    const run = await SeedRun.findOne().lean();

    expect(run.succeeded).toBe(true);
    expect(run.mode).toBe('all');
    expect(run.results[0]).toMatchObject({
      seeder: 'pincodes',
      kind: 'reference',
      created: 26,
    });
  });

  it('rejects an unknown seeder kind', async () => {
    await expect(
      SeedRun.create({
        startedAt: new Date(),
        mode: 'all',
        environment: 'test',
        results: [{ seeder: 'x', kind: 'not-a-kind' }],
      }),
    ).rejects.toThrow();
  });
});
