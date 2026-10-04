import { env } from "../../config/env.js";
import { productService } from "../products/product.service.js";

const BRAND_NAME = "Dhanalakshmi Fashion";
const MAX_META_DESCRIPTION_LENGTH = 300;

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function primaryImage(product) {
  const media = product.primaryMedia;
  if (!media) return null;
  if (media.type === "VIDEO") {
    return media.delivery?.posterUrl ?? media.posterUrl ?? null;
  }
  return media.delivery?.optimizedUrl ?? media.url ?? null;
}

function canonicalProductUrl(slug) {
  return new URL(
    `/products/${encodeURIComponent(slug)}`,
    `${env.STOREFRONT_URL}/`,
  ).href;
}

function descriptionFor(product) {
  const price = `₹${(product.pricePaise / 100).toFixed(2)}`;
  const authored =
    product.seo?.description ??
    product.shortDescription ??
    product.description ??
    "";
  const description = authored ? `${price} · ${authored}` : `Price: ${price}`;
  return description.slice(0, MAX_META_DESCRIPTION_LENGTH);
}

function propertyMeta(property, content) {
  if (!content) return "";
  return `    <meta property="${escapeHtml(property)}" content="${escapeHtml(content)}">\n`;
}

function namedMeta(name, content) {
  if (!content) return "";
  return `    <meta name="${escapeHtml(name)}" content="${escapeHtml(content)}">\n`;
}

export function renderProductShareHtml(product) {
  const canonicalUrl = canonicalProductUrl(product.slug);
  const title = `${product.name} | ${BRAND_NAME}`;
  const description = descriptionFor(product);
  const image = primaryImage(product);
  const imageAlt = image ? product.primaryMedia?.altText : null;
  const priceAmount = (product.pricePaise / 100).toFixed(2);

  return `<!doctype html>
<html lang="en-IN" prefix="og: https://ogp.me/ns# product: https://ogp.me/ns/product#">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow, noarchive">
    <meta name="description" content="${escapeHtml(description)}">
    <title>${escapeHtml(title)}</title>
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
    <meta http-equiv="refresh" content="0;url=${escapeHtml(canonicalUrl)}">
${propertyMeta("og:type", "product")}${propertyMeta("og:site_name", BRAND_NAME)}${propertyMeta("og:locale", "en_IN")}${propertyMeta("og:title", title)}${propertyMeta("og:description", description)}${propertyMeta("og:url", canonicalUrl)}${propertyMeta("og:image", image)}${propertyMeta("og:image:alt", imageAlt)}${propertyMeta("product:price:amount", priceAmount)}${propertyMeta("product:price:currency", "INR")}${namedMeta("twitter:card", image ? "summary_large_image" : "summary")}${namedMeta("twitter:title", title)}${namedMeta("twitter:description", description)}${namedMeta("twitter:image", image)}  </head>
  <body>
    <p><a href="${escapeHtml(canonicalUrl)}">View ${escapeHtml(product.name)} on ${BRAND_NAME}</a></p>
  </body>
</html>`;
}

export const socialShareService = {
  async productPreview(slug) {
    return renderProductShareHtml(await productService.getPublicBySlug(slug));
  },
};
