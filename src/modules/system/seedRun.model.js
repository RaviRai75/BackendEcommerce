/**
 * Seed run bookkeeping.
 *
 * Records what the seed harness did and when. Two reasons this exists rather
 * than the seeder just printing to a terminal:
 *
 *   1. It tells the business which environment has demo data in it — important,
 *      because structure.md §69 forbids passing placeholder data off as real.
 *   2. It gives `npm run seed -- --fresh` an accurate record of what to remove.
 */
import { createSchema, registerModel, shortText } from '../../utils/schema.js';

const seedResultSchema = createSchema(
  {
    seeder: shortText({ required: true, max: 80 }),
    kind: { type: String, required: true, enum: ['reference', 'demo'] },
    created: { type: Number, default: 0, min: 0 },
    updated: { type: Number, default: 0, min: 0 },
    removed: { type: Number, default: 0, min: 0 },
    unchanged: { type: Number, default: 0, min: 0 },
    error: shortText({ max: 500 }),
  },
  { timestamps: false, schemaOptions: { _id: false } },
);

const seedRunSchema = createSchema(
  {
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date },
    durationMs: { type: Number, min: 0 },
    /** 'reference' data only, 'demo' data only, or both. */
    mode: { type: String, required: true, enum: ['reference', 'demo', 'all'] },
    fresh: { type: Boolean, default: false },
    succeeded: { type: Boolean, default: false },
    environment: shortText({ required: true, max: 20 }),
    results: { type: [seedResultSchema], default: [] },
  },
  { collection: 'seedRuns' },
);

seedRunSchema.index({ startedAt: -1 });

export const SeedRun = registerModel('SeedRun', seedRunSchema);
