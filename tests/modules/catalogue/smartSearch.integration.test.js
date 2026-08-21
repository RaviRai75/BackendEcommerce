import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../src/app.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import { promoteToAdmin, registerUser } from "../../helpers/auth.js";
import { useTestDatabase } from "../../helpers/database.js";

useTestDatabase();
afterEach(() => resetAllRateLimits());

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
let sequence = 0;
let fixture;

async function adminAccount() {
  const account = await registerUser(app);
  await promoteToAdmin(account.registration.email);
  return account;
}

async function setStatus(admin, resource, id, status = "PUBLISHED") {
  const response = await request(app)
    .patch(`/api/admin/${resource}/${id}/status`)
    .set(bearer(admin.accessToken))
    .send({ status });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

async function category(admin, name, slug, published = true) {
  const response = await request(app)
    .post("/api/admin/categories")
    .set(bearer(admin.accessToken))
    .send({ name, slug });
  expect(response.status).toBe(201);
  if (published) await setStatus(admin, "categories", response.body.data.id);
  return response.body.data;
}

async function collection(admin) {
  const response = await request(app)
    .post("/api/admin/collections")
    .set(bearer(admin.accessToken))
    .send({ name: "Search Edit", slug: "search-edit" });
  expect(response.status).toBe(201);
  await setStatus(admin, "collections", response.body.data.id);
  return response.body.data;
}

async function product(admin, taxonomy, options, published = true) {
  sequence += 1;
  const response = await request(app)
    .post("/api/admin/products")
    .set(bearer(admin.accessToken))
    .send({
      name: options.name,
      slug: options.slug,
      description: options.description ?? options.name,
      categoryId: taxonomy.category.id,
      collectionIds: [taxonomy.collection.id],
      basePriceRupees: options.price,
      compareAtPriceRupees: null,
      fabric: options.fabric,
      occasions: options.occasions ?? [],
      variants: [
        {
          sku: `SEARCH-SKU-${sequence}`,
          size: options.size ?? "M",
          colour: options.colour,
          stock: 5,
          lowStockThreshold: 2,
        },
      ],
      media: [],
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  if (published) await setStatus(admin, "products", response.body.data.id);
  return response.body.data;
}

async function setupSearchCatalogue() {
  const admin = await adminAccount();
  const searchCollection = await collection(admin);
  const girls = await category(admin, "Girls", "girls");
  const women = await category(admin, "Women", "women");
  const secret = await category(
    admin,
    "Secret Preview",
    "secret-preview",
    false,
  );

  await product(
    admin,
    { category: girls, collection: searchCollection },
    {
      name: "Green Cotton Dress",
      slug: "green-cotton-search-dress",
      price: 1200,
      fabric: "Cotton",
      occasions: ["Party"],
      colour: "Green",
    },
  );
  await product(
    admin,
    { category: girls, collection: searchCollection },
    {
      name: "Budget Girls Dress",
      slug: "budget-girls-search-dress",
      price: 900,
      fabric: "Cotton",
      occasions: ["Casual"],
      colour: "Blue",
      size: "S",
    },
  );
  await product(
    admin,
    { category: women, collection: searchCollection },
    {
      name: "Traditional Wedding Dress",
      slug: "traditional-wedding-search-dress",
      price: 1400,
      fabric: "Silk",
      occasions: ["Wedding"],
      colour: "Red",
    },
  );
  await product(
    admin,
    { category: women, collection: searchCollection },
    {
      name: "Red Everyday Dress",
      slug: "red-everyday-search-dress",
      price: 1100,
      fabric: "Rayon",
      occasions: ["Casual"],
      colour: "Red",
    },
  );
  await product(
    admin,
    { category: women, collection: searchCollection },
    {
      name: "One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve",
      slug: "twelve-term-search-sample",
      description:
        "One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve",
      price: 1300,
      fabric: "Wool",
      occasions: ["Office"],
      colour: "Black",
    },
  );
  await product(
    admin,
    { category: secret, collection: searchCollection },
    {
      name: "Secret Preview Dress",
      slug: "secret-preview-search-dress",
      price: 700,
      fabric: "Linen",
      occasions: ["Preview"],
      colour: "Gold",
    },
    false,
  );

  return { admin, girls, women, secret };
}

beforeEach(async () => {
  fixture = await setupSearchCatalogue();
});

async function search(query) {
  return request(app).get("/api/products").query(query);
}

const slugs = (response) => response.body.data.map((entry) => entry.slug);

describe("smart product search API", () => {
  it("supports every required representative phrase", async () => {
    const green = await search({ q: "green dress" });
    const greenBudget = await search({ q: "green dress under 1500" });
    const punctuated = await search({ q: "green dress under 1500." });
    const wedding = await search({ q: "traditional dress for wedding" });
    const girlsBudget = await search({ q: "girls dress under 1000" });
    const cotton = await search({ q: "cotton dress", sort: "price-asc" });

    expect(slugs(green)).toEqual(["green-cotton-search-dress"]);
    expect(slugs(greenBudget)).toEqual(["green-cotton-search-dress"]);
    expect(slugs(punctuated)).toEqual(["green-cotton-search-dress"]);
    expect(slugs(wedding)).toEqual(["traditional-wedding-search-dress"]);
    expect(slugs(girlsBudget)).toEqual(["budget-girls-search-dress"]);
    expect(slugs(cotton)).toEqual([
      "budget-girls-search-dress",
      "green-cotton-search-dress",
    ]);
    expect(greenBudget.body.meta).toMatchObject({
      filters: {
        q: "dress",
        colour: "green",
        maxPricePaise: 150000,
      },
      search: {
        query: "green dress under 1500",
        keyword: "dress",
        inferredFilters: {
          colour: "green",
          maxPricePaise: 150000,
        },
      },
    });
  });

  it("lets explicit controls override inferred dimensions and keeps pagination deterministic", async () => {
    const response = await search({
      q: "green dress under 1000",
      colour: "red",
      maxPrice: 2000,
      sort: "price-asc",
      page: 2,
      limit: 1,
    });

    expect(slugs(response)).toEqual(["traditional-wedding-search-dress"]);
    expect(response.body.meta).toMatchObject({
      page: 2,
      limit: 1,
      total: 2,
      sort: "price-asc",
      filters: {
        q: "dress",
        colour: "red",
        maxPricePaise: 200000,
      },
      search: {
        inferredFilters: {
          colour: "green",
          maxPricePaise: 100000,
        },
      },
    });
  });

  it("requires every accepted residual term, including the thirteenth", async () => {
    const response = await search({
      q: "one two three four five six seven eight nine ten eleven twelve thirteen",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(0);
    expect(response.body.meta.search.keyword).toContain("thirteen");
  });

  it("does not infer or expose draft taxonomy and products", async () => {
    const response = await search({ q: "secret preview dress under 1000" });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(0);
    expect(response.body.meta.search).toMatchObject({
      keyword: "secret preview dress",
      inferredFilters: { category: null, maxPricePaise: 100000 },
    });
    expect(response.body.meta.filters.category).toBeNull();
    expect(response.body.meta).not.toEqual(
      expect.objectContaining({ categoryId: fixture.secret.id }),
    );
  });
});
