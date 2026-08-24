import { env } from "../../config/env.js";
import { Category, CategoryStatus } from "../categories/category.model.js";
import {
  Collection,
  CollectionStatus,
} from "../collections/collection.model.js";
import { contentService } from "../content/content.service.js";
import {
  CONTENT_PAGE_DEFINITIONS,
  ContentPageKey,
} from "../content/contentPage.model.js";
import { operationalPolicyService } from "../content/operationalPolicy.service.js";
import { Product, ProductStatus } from "../products/product.model.js";
import { productPublicationBoundary } from "../products/product.service.js";
import { SizeGuide } from "../sizeGuides/sizeGuide.model.js";

const ALWAYS_PUBLIC_PATHS = Object.freeze([
  "/",
  "/shop",
  "/collections",
  "/size-guide",
]);

const EDITORIAL_PATH_OVERRIDES = new Map([
  [ContentPageKey.PRIVACY, "/privacy-policy"],
]);

function editorialPath(definition) {
  return EDITORIAL_PATH_OVERRIDES.get(definition.key) ?? `/${definition.slug}`;
}

function escapeXml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character],
  );
}

function publicUrl(path) {
  return new URL(path, `${env.STOREFRONT_URL}/`).href;
}

function lastModified(document) {
  const value = document.updatedAt ?? document.publishedAt;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function urlEntry(path, document) {
  const lastmod = document ? lastModified(document) : null;
  return [
    "  <url>",
    `    <loc>${escapeXml(publicUrl(path))}</loc>`,
    ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
    "  </url>",
  ].join("\n");
}

async function contentBackedPublicEntries() {
  const [editorialResults, delivery, exchange] = await Promise.all([
    Promise.all(
      CONTENT_PAGE_DEFINITIONS.map(async (definition) => ({
        definition,
        result: await contentService.getPublicPage(definition.slug),
      })),
    ),
    operationalPolicyService.getDelivery(),
    operationalPolicyService.getExchange(),
  ]);

  return [
    ...editorialResults
      .filter(({ result }) => result.data.state === "PUBLISHED")
      .map(({ definition, result }) => ({
        path: editorialPath(definition),
        document: result.data,
      })),
    ...(delivery.data.state === "AVAILABLE_CURRENT_POLICY"
      ? [{ path: "/delivery-policy", document: null }]
      : []),
    ...(exchange.data.state === "CURRENT_POLICY_NOT_HISTORICAL_ELIGIBILITY"
      ? [{ path: "/exchange-policy", document: null }]
      : []),
  ];
}

async function dynamicPublicEntries() {
  const productRelations =
    await productPublicationBoundary.publicRelationConstraint();
  const [categories, collections, products, sizeGuides] = await Promise.all([
    Category.find({ status: CategoryStatus.PUBLISHED })
      .select("slug updatedAt publishedAt")
      .sort({ slug: 1 })
      .lean(),
    Collection.find({ status: CollectionStatus.PUBLISHED })
      .select("slug updatedAt publishedAt")
      .sort({ slug: 1 })
      .lean(),
    Product.find({
      status: ProductStatus.PUBLISHED,
      ...productRelations,
    })
      .select("slug updatedAt publishedAt")
      .sort({ slug: 1 })
      .lean(),
    SizeGuide.find({
      published: { $ne: null },
      "published.showOnStandalone": true,
    })
      .select("slug updatedAt publishedAt")
      .sort({ slug: 1 })
      .lean(),
  ]);

  return [
    ...categories.map((document) => ({
      path: `/shop/${encodeURIComponent(document.slug)}`,
      document,
    })),
    ...collections.map((document) => ({
      path: `/collections/${encodeURIComponent(document.slug)}`,
      document,
    })),
    ...products.map((document) => ({
      path: `/products/${encodeURIComponent(document.slug)}`,
      document,
    })),
    ...sizeGuides.map((document) => ({
      path: `/size-guide/${encodeURIComponent(document.slug)}`,
      document,
    })),
  ];
}

export const seoService = {
  async sitemapXml() {
    const [contentBackedEntries, dynamicEntries] = await Promise.all([
      contentBackedPublicEntries(),
      dynamicPublicEntries(),
    ]);
    const entries = [
      ...ALWAYS_PUBLIC_PATHS.map((path) => ({ path, document: null })),
      ...contentBackedEntries,
      ...dynamicEntries,
    ];

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries.map(({ path, document }) => urlEntry(path, document)),
      "</urlset>",
      "",
    ].join("\n");
  },
};
