/**
 * Pincode reference data.
 *
 * This collection does NOT decide whether we deliver somewhere. Serviceability
 * is rule-driven and configurable (structure.md §15) and lives in the settings
 * module, so adding a state later is a data change rather than a code change.
 *
 * What this collection does is *label* a pincode with its city, district and
 * state, which the admin analytics needs to report sales by district
 * (structure.md §41). A pincode that is not present here is reported as unknown
 * — we never guess a location, because §41 forbids fabricating geographical
 * data.
 */
import { createSchema, registerModel, shortText } from '../../utils/schema.js';

const pincodeSchema = createSchema(
  {
    pincode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^[1-9]\d{5}$/, 'Not a valid 6-digit pincode.'],
    },
    /** Nearest town or city, as used by India Post. */
    city: shortText({ required: true, max: 80 }),
    /** Revenue district — the unit the business reports on. */
    district: shortText({ required: true, max: 80 }),
    state: shortText({ required: true, max: 80 }),
    /**
     * Where this row came from, so a partial starter set can be told apart from
     * an authoritative import and re-verified later.
     */
    source: shortText({ required: true, max: 120 }),
  },
  { collection: 'pincodes' },
);

// Analytics groups by district and by state; both are read far more often than
// written.
pincodeSchema.index({ district: 1 });
pincodeSchema.index({ state: 1, district: 1 });

export const Pincode = registerModel('Pincode', pincodeSchema);
