import { describe, expect, it } from "vitest";
import {
  interpretProductSearch,
  normalizeSearchVocabulary,
} from "../../../src/modules/products/productSearch.service.js";

const vocabulary = {
  categories: [
    { name: "Girls", slug: "girls" },
    { name: "Ethnic Wear", slug: "ethnic-wear" },
  ],
  colours: ["green", "red"],
  sizes: ["M", "XL"],
  occasions: ["wedding", "festive"],
  fabrics: ["cotton", "silk"],
};

describe("deterministic product search interpreter", () => {
  it.each([
    ["green dress", { keyword: "dress", inferred: { colour: "green" } }],
    [
      "green dress under 1500",
      {
        keyword: "dress",
        inferred: { colour: "green", maxPrice: 150000 },
      },
    ],
    [
      "traditional dress for wedding",
      {
        keyword: "traditional dress",
        inferred: { occasion: "wedding" },
      },
    ],
    [
      "girls dress under 1000",
      {
        keyword: "dress",
        inferred: { category: "girls", maxPrice: 100000 },
      },
    ],
    ["cotton dress", { keyword: "dress", inferred: { fabric: "cotton" } }],
  ])("interprets required phrase %s", (query, expected) => {
    expect(interpretProductSearch(query, vocabulary)).toMatchObject(expected);
  });

  it("normalizes currency, commas, case, size cues, and whitespace", () => {
    expect(
      interpretProductSearch(
        "  GREEN   dress size m up to ₹1,499.50  ",
        vocabulary,
      ),
    ).toEqual({
      originalQuery: "GREEN   dress size m up to ₹1,499.50",
      keyword: "dress",
      inferred: {
        maxPrice: 149950,
        size: "M",
        colour: "green",
      },
    });
  });

  it("normalizes sentence punctuation without losing decimal prices", () => {
    expect(
      interpretProductSearch("green dress under 1500.", vocabulary),
    ).toMatchObject({
      keyword: "dress",
      inferred: { colour: "green", maxPrice: 150000 },
    });
    expect(interpretProductSearch("green dress.", vocabulary)).toMatchObject({
      keyword: "dress",
      inferred: { colour: "green" },
    });
  });

  it("selects a stable bounded vocabulary regardless of source order", () => {
    const values = Array.from(
      { length: 250 },
      (_, index) => `fabric-${String(index).padStart(3, "0")}`,
    );
    const forward = normalizeSearchVocabulary(values);
    const reversed = normalizeSearchVocabulary([...values].reverse());

    expect(forward).toEqual(reversed);
    expect(forward).toHaveLength(200);
    expect(forward).toContain("fabric 199");
    expect(forward).not.toContain("fabric 200");
  });

  it("supports deterministic minimum and range price language", () => {
    expect(
      interpretProductSearch("silk dress above rs. 900", vocabulary),
    ).toMatchObject({
      keyword: "dress",
      inferred: { fabric: "silk", minPrice: 90000 },
    });
    expect(
      interpretProductSearch("dress between 800 and 1,200", vocabulary),
    ).toMatchObject({
      keyword: "dress",
      inferred: { minPrice: 80000, maxPrice: 120000 },
    });
  });

  it("uses whole phrases and leaves unknown or implausible terms as keywords", () => {
    expect(interpretProductSearch("small dress", vocabulary)).toMatchObject({
      keyword: "small dress",
      inferred: {},
    });
    expect(
      interpretProductSearch("dress under 10000001", vocabulary),
    ).toMatchObject({
      keyword: "dress under 10000001",
      inferred: {},
    });
  });

  it("maps multi-word public category names to their canonical slug", () => {
    expect(
      interpretProductSearch("ethnic wear dress", vocabulary),
    ).toMatchObject({
      keyword: "dress",
      inferred: { category: "ethnic-wear" },
    });
  });
});
