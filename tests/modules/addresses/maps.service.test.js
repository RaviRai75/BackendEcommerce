import { describe, expect, it } from "vitest";
import { parseGoogleAddressComponents } from "../../../src/modules/addresses/maps.service.js";

describe("parseGoogleAddressComponents", () => {
  it("extracts street, sublocalities, and 6-digit postal code cleanly", () => {
    const components = [
      { long_name: "42", short_name: "42", types: ["street_number"] },
      { long_name: "Mahatma Gandhi Road", short_name: "MG Rd", types: ["route"] },
      { long_name: "Shanthala Nagar", short_name: "Shanthala Nagar", types: ["sublocality_level_2"] },
      { long_name: "Ashok Nagar", short_name: "Ashok Nagar", types: ["sublocality_level_1"] },
      { long_name: "Bengaluru", short_name: "Bengaluru", types: ["locality"] },
      { long_name: "Karnataka", short_name: "KA", types: ["administrative_area_level_1"] },
      { long_name: "560001", short_name: "560001", types: ["postal_code"] },
    ];
    const formatted = "42, MG Rd, Shanthala Nagar, Ashok Nagar, Bengaluru, Karnataka 560001, India";

    const parsed = parseGoogleAddressComponents(components, formatted, "Prestige Towers");

    expect(parsed.addressLine1).toContain("42 Mahatma Gandhi Road");
    expect(parsed.pincode).toBe("560001");
    expect(parsed.city).toBe("Bengaluru");
    expect(parsed.state).toBe("Karnataka");
    expect(parsed.addressLine2).toContain("Shanthala Nagar");
  });

  it("handles places without street numbers and cleans plus codes", () => {
    const components = [
      { long_name: "XJFC+F29", short_name: "XJFC+F29", types: ["plus_code"] },
      { long_name: "Someshwarpura", short_name: "Someshwarpura", types: ["sublocality_level_2"] },
      { long_name: "Halasuru", short_name: "Halasuru", types: ["neighborhood"] },
      { long_name: "560008", short_name: "560008", types: ["postal_code"] },
    ];
    const formatted = "XJFC+F29, Halasuru, Someshwarpura, Bengaluru, Karnataka 560008, India";

    const parsed = parseGoogleAddressComponents(components, formatted, "Mg road");
    expect(parsed.addressLine1).not.toContain("XJFC+F29");
    expect(parsed.pincode).toBe("560008");
  });
});
