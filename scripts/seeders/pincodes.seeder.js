/**
 * Karnataka district-headquarters pincode reference data.
 *
 * IMPORTANT — this is a *partial starter set*, not the authoritative dataset.
 * It contains the head-post-office pincode for Karnataka district
 * headquarters, which is enough to make district-level analytics and the
 * pincode checker meaningful during development.
 *
 * Before launch, import the full India Post PIN code directory so every
 * serviceable pincode resolves to a real district. Until then, a pincode that
 * is not listed here is reported as unknown rather than guessed: structure.md
 * §41 forbids fabricating geographical data.
 *
 * This is reference data, not demo data — it is factual, so it is not marked
 * with the demo flag and is safe to keep in production.
 */
import { Pincode } from "../../src/modules/shipping/pincode.model.js";

const SOURCE = "starter-set:karnataka-district-headquarters";

/** @type {Array<{ pincode: string, city: string, district: string }>} */
const KARNATAKA_DISTRICT_HEADQUARTERS = [
  { pincode: "560001", city: "Bengaluru", district: "Bengaluru Urban" },
  { pincode: "562101", city: "Chikkaballapura", district: "Chikkaballapura" },
  { pincode: "563101", city: "Kolar", district: "Kolar" },
  { pincode: "570001", city: "Mysuru", district: "Mysuru" },
  { pincode: "571201", city: "Madikeri", district: "Kodagu" },
  { pincode: "571313", city: "Chamarajanagar", district: "Chamarajanagar" },
  { pincode: "571401", city: "Mandya", district: "Mandya" },
  { pincode: "572101", city: "Tumakuru", district: "Tumakuru" },
  { pincode: "573201", city: "Hassan", district: "Hassan" },
  { pincode: "575001", city: "Mangaluru", district: "Dakshina Kannada" },
  { pincode: "576101", city: "Udupi", district: "Udupi" },
  { pincode: "577001", city: "Davanagere", district: "Davanagere" },
  { pincode: "577101", city: "Chikkamagaluru", district: "Chikkamagaluru" },
  { pincode: "577201", city: "Shivamogga", district: "Shivamogga" },
  { pincode: "577501", city: "Chitradurga", district: "Chitradurga" },
  { pincode: "580001", city: "Hubballi", district: "Dharwad" },
  { pincode: "581110", city: "Haveri", district: "Haveri" },
  { pincode: "581301", city: "Karwar", district: "Uttara Kannada" },
  { pincode: "582101", city: "Gadag", district: "Gadag" },
  { pincode: "583101", city: "Ballari", district: "Ballari" },
  { pincode: "584101", city: "Raichur", district: "Raichur" },
  { pincode: "585101", city: "Kalaburagi", district: "Kalaburagi" },
  { pincode: "585401", city: "Bidar", district: "Bidar" },
  { pincode: "586101", city: "Vijayapura", district: "Vijayapura" },
  { pincode: "587101", city: "Bagalkote", district: "Bagalkote" },
  { pincode: "590001", city: "Belagavi", district: "Belagavi" },
];

export const pincodesSeeder = {
  name: "pincodes",
  kind: "reference",
  description: "Karnataka district-headquarters pincodes (partial starter set)",

  /**
   * Idempotent: re-running never duplicates a pincode, and a correction to the
   * list above is applied on the next run.
   *
   * Rows are compared before writing rather than blindly upserted. A blind
   * upsert would bump `updatedAt` on all 26 documents every run, which both
   * wastes writes on a shared free-tier cluster and makes the summary useless —
   * everything would report as "updated" forever.
   */
  async run() {
    const desired = KARNATAKA_DISTRICT_HEADQUARTERS.map((entry) => ({
      ...entry,
      state: "Karnataka",
      source: SOURCE,
    }));

    const existing = await Pincode.find({
      pincode: { $in: desired.map((entry) => entry.pincode) },
    })
      .lean()
      .exec();

    const byPincode = new Map(existing.map((row) => [row.pincode, row]));

    const operations = [];
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const entry of desired) {
      const current = byPincode.get(entry.pincode);

      if (!current) {
        operations.push({ insertOne: { document: entry } });
        created += 1;
        continue;
      }

      const differs = Object.entries(entry).some(
        ([key, value]) => current[key] !== value,
      );
      if (differs) {
        operations.push({
          updateOne: {
            filter: { pincode: entry.pincode },
            update: { $set: entry },
          },
        });
        updated += 1;
      } else {
        unchanged += 1;
      }
    }

    if (operations.length > 0) {
      await Pincode.bulkWrite(operations, { ordered: false });
    }

    return { created, updated, unchanged };
  },

  /** Reference data is factual and is never purged by `--fresh`. */
  async purge() {
    return { removed: 0 };
  },
};
