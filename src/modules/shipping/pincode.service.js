import { Pincode } from "./pincode.model.js";

/**
 * Resolves only geography that is explicitly present in the reference data.
 * A missing row is unknown; this layer never infers a state from a prefix.
 */
export const pincodeService = {
  async findLocation(pincode) {
    return Pincode.findOne({ pincode })
      .select("city district state -_id")
      .lean();
  },
};
