import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../../src/app.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import {
  Category,
  CategoryStatus,
} from "../../../src/modules/categories/category.model.js";
import {
  Collection,
  CollectionStatus,
} from "../../../src/modules/collections/collection.model.js";
import {
  Product,
  ProductStatus,
} from "../../../src/modules/products/product.model.js";
import { useTestDatabase } from "../../helpers/database.js";

useTestDatabase();
afterEach(() => {
  vi.restoreAllMocks();
  resetAllRateLimits();
});

let sequence = 0;

async function category(status = CategoryStatus.PUBLISHED) {
  sequence += 1;
  return Category.create({
    name: `Related Category ${sequence}`,
    slug: `related-category-${sequence}`,
    status,
  });
}

async function collection(status = CollectionStatus.PUBLISHED) {
  sequence += 1;
  return Collection.create({
    name: `Related Collection ${sequence}`,
    slug: `related-collection-${sequence}`,
    status,
  });
}

function productFields(overrides = {}) {
  sequence += 1;
  return {
    name: `Related Product ${sequence}`,
    slug: `related-product-${sequence}`,
    shortDescription: "Public recommendation fixture.",
    category: overrides.category,
    collections: overrides.collections ?? [],
    basePricePaise: overrides.basePricePaise ?? 150_000,
    fabric: overrides.fabric ?? "cotton",
    occasions: overrides.occasions ?? ["wedding"],
    variants: [
      {
        sku: `RELATED-SKU-${sequence}`,
        size: "M",
        colour: overrides.colour ?? "green",
        stock: 4,
        lowStockThreshold: 2,
      },
    ],
    status: overrides.status ?? ProductStatus.PUBLISHED,
    isBestseller: overrides.isBestseller ?? false,
    isNewArrival: overrides.isNewArrival ?? false,
    merchandisingRank: overrides.merchandisingRank ?? 0,
  };
}

async function product(overrides = {}) {
  return Product.create(productFields(overrides));
}

describe("GET /api/products/:slug/related", () => {
  it("excludes the source and deterministically ranks rule-relevant candidates", async () => {
    const sourceCategory = await category();
    const otherCategory = await category();
    const sharedCollection = await collection();
    const source = await product({
      category: sourceCategory._id,
      collections: [sharedCollection._id],
    });
    const relevant = await product({
      category: sourceCategory._id,
      collections: [sharedCollection._id],
      basePricePaise: 155_000,
      merchandisingRank: 1,
    });
    const merchandisedButUnrelated = await product({
      category: otherCategory._id,
      collections: [],
      basePricePaise: 500_000,
      fabric: "silk",
      occasions: ["casual"],
      colour: "blue",
      isBestseller: true,
      isNewArrival: true,
      merchandisingRank: 1_000_000,
    });

    const first = await request(app).get(
      `/api/products/${source.slug}/related?limit=2`,
    );
    const second = await request(app).get(
      `/api/products/${source.slug}/related?limit=2`,
    );

    expect(first.status).toBe(200);
    expect(first.body.data.map((item) => item.id)).toEqual([
      relevant.id,
      merchandisedButUnrelated.id,
    ]);
    expect(first.body.data.map((item) => item.id)).not.toContain(source.id);
    expect(second.body.data).toEqual(first.body.data);
  });

  it("returns only publicly eligible products and does not leak management fields", async () => {
    const publicCategory = await category();
    const privateCategory = await category(CategoryStatus.DRAFT);
    const publicCollection = await collection();
    const privateCollection = await collection(CollectionStatus.DRAFT);
    const source = await product({
      category: publicCategory._id,
      collections: [publicCollection._id],
    });
    const visible = await product({
      category: publicCategory._id,
      collections: [publicCollection._id],
      isBestseller: true,
      merchandisingRank: 999,
    });
    const draft = await product({
      category: publicCategory._id,
      status: ProductStatus.DRAFT,
    });
    const hiddenByCategory = await product({ category: privateCategory._id });
    const hiddenByCollection = await product({
      category: publicCategory._id,
      collections: [privateCollection._id],
    });

    const response = await request(app).get(
      `/api/products/${source.slug}/related`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: visible.id,
      slug: visible.slug,
      category: {
        id: publicCategory.id,
        slug: publicCategory.slug,
        name: publicCategory.name,
      },
      pricePaise: 150_000,
      availability: { inStock: true, totalStock: 4, lowStock: false },
    });
    expect(response.body.data.map((item) => item.id)).not.toEqual(
      expect.arrayContaining([
        draft.id,
        hiddenByCategory.id,
        hiddenByCollection.id,
      ]),
    );
    for (const privateField of [
      "status",
      "merchandisingRank",
      "collections",
      "fabric",
      "occasions",
      "variants",
      "createdAt",
      "updatedAt",
      "isDemoData",
    ]) {
      expect(response.body.data[0]).not.toHaveProperty(privateField);
    }
  });

  it("requires a publicly eligible source and enforces the default and bounded limit", async () => {
    const publicCategory = await category();
    const privateCategory = await category(CategoryStatus.DRAFT);
    const privateCollection = await collection(CollectionStatus.DRAFT);
    const source = await product({ category: publicCategory._id });
    const draftSource = await product({
      category: publicCategory._id,
      status: ProductStatus.DRAFT,
    });
    const privateCategorySource = await product({
      category: privateCategory._id,
    });
    const privateCollectionSource = await product({
      category: publicCategory._id,
      collections: [privateCollection._id],
    });
    await Promise.all(
      Array.from({ length: 6 }, () =>
        product({ category: publicCategory._id }),
      ),
    );

    const defaultLimit = await request(app).get(
      `/api/products/${source.slug}/related`,
    );
    const explicitLimit = await request(app).get(
      `/api/products/${source.slug}/related?limit=2`,
    );
    const tooLow = await request(app).get(
      `/api/products/${source.slug}/related?limit=0`,
    );
    const tooHigh = await request(app).get(
      `/api/products/${source.slug}/related?limit=13`,
    );
    const unknownQuery = await request(app).get(
      `/api/products/${source.slug}/related?limit=2&status=DRAFT`,
    );
    const privateSources = await Promise.all(
      [draftSource, privateCategorySource, privateCollectionSource].map(
        (privateSource) =>
          request(app).get(`/api/products/${privateSource.slug}/related`),
      ),
    );

    expect(defaultLimit.status).toBe(200);
    expect(defaultLimit.body.data).toHaveLength(4);
    expect(explicitLimit.body.data).toHaveLength(2);
    expect(tooLow.status).toBe(422);
    expect(tooHigh.status).toBe(422);
    expect(unknownQuery.status).toBe(422);
    expect(privateSources.map((response) => response.status)).toEqual([
      404, 404, 404,
    ]);
  });

  it("uses bounded relation-first scoring despite many merchandised distractors", async () => {
    const sourceCategory = await category();
    const otherCategory = await category();
    const sharedCollection = await collection();
    const source = await product({
      category: sourceCategory._id,
      collections: [sharedCollection._id],
    });
    const relevant = await product({
      category: sourceCategory._id,
      collections: [sharedCollection._id],
      merchandisingRank: 0,
    });

    await Product.insertMany(
      Array.from({ length: 205 }, () =>
        productFields({
          category: otherCategory._id,
          basePricePaise: 800_000,
          fabric: "silk",
          occasions: ["casual"],
          colour: "blue",
          isBestseller: true,
          isNewArrival: true,
          merchandisingRank: 1_000_000,
        }),
      ),
    );
    const aggregateSpy = vi.spyOn(Product, "aggregate");

    const response = await request(app).get(
      `/api/products/${source.slug}/related?limit=1`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(relevant.id);

    const rankingPipeline = aggregateSpy.mock.calls.find(([pipeline]) =>
      pipeline.some((stage) => stage.$set?._recommendationScore),
    )?.[0];
    const scoreStageIndex = rankingPipeline.findIndex(
      (stage) => stage.$set?._recommendationScore,
    );
    const scoringIds = rankingPipeline[scoreStageIndex - 1].$match._id.$in;
    expect(scoreStageIndex).toBeGreaterThan(0);
    expect(scoringIds).toHaveLength(200);
    expect(scoringIds.map(String)).toContain(relevant.id);
  });
});
