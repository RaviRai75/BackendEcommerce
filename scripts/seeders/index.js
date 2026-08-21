/**
 * Seeder registry.
 *
 * Order matters: seeders run top to bottom, so anything that references another
 * collection is listed after it.
 *
 * Each seeder is an object:
 *   {
 *     name:        unique identifier, used by `--only`
 *     kind:        'reference' (factual, safe in production)
 *                  | 'demo'   (placeholder, development only, §69)
 *     description: shown in the run summary
 *     run():       idempotent; returns { created?, updated?, unchanged? }
 *     purge():     removes only what this seeder created; returns { removed }
 *   }
 */
import { pincodesSeeder } from './pincodes.seeder.js';

/** @type {Array<import('./pincodes.seeder.js').pincodesSeeder>} */
export const seeders = [pincodesSeeder];

/**
 * @param {object} [filter]
 * @param {'reference'|'demo'|'all'} [filter.mode='all']
 * @param {string[]} [filter.only] seeder names to include
 * @returns {typeof seeders}
 */
export function selectSeeders({ mode = 'all', only } = {}) {
  return seeders.filter((seeder) => {
    if (only?.length && !only.includes(seeder.name)) return false;
    if (mode === 'all') return true;
    return seeder.kind === mode;
  });
}
