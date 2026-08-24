import { asyncHandler } from "../../utils/asyncHandler.js";
import { seoService } from "./seo.service.js";

export const getSitemap = asyncHandler(async (_req, res) => {
  const sitemap = await seoService.sitemapXml();
  res.set({
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
  });
  res.status(200).send(sitemap);
});
