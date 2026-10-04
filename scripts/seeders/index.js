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
import { pincodesSeeder } from "./pincodes.seeder.js";
import { categoriesSeeder } from "./categories.seeder.js";
import { sizeGuidesSeeder } from "./sizeGuides.seeder.js";
import { collectionsSeeder } from "./collections.seeder.js";
import { productsSeeder } from "./products.seeder.js";
import { settingsSeeder } from "./settings.seeder.js";
import { couponsSeeder } from "./coupons.seeder.js";
import { contentSeeder } from "./content.seeder.js";

export const seeders = [
  pincodesSeeder,
  categoriesSeeder,
  sizeGuidesSeeder,
  collectionsSeeder,
  productsSeeder,
  settingsSeeder,
  couponsSeeder,
  contentSeeder,
];

/**
 * @param {object} [filter]
 * @param {'reference'|'demo'|'all'} [filter.mode='all']
 * @param {string[]} [filter.only] seeder names to include
 * @returns {typeof seeders}
 */
export function selectSeeders({ mode = "all", only } = {}) {
  return seeders.filter((seeder) => {
    if (only?.length && !only.includes(seeder.name)) return false;
    if (mode === "all") return true;
    return seeder.kind === mode;
  });
}
