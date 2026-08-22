import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { productSlugParamSchema } from "../products/product.validator.js";
import { getProductSharePreview } from "./socialShare.controller.js";

export const socialShareRoutes = Router();

function preventPreviewCaching(_req, res, next) {
  res.set({
    "Cache-Control": "no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
  next();
}

socialShareRoutes.get(
  "/share/products/:slug",
  preventPreviewCaching,
  validate({ params: productSlugParamSchema }),
  getProductSharePreview,
);
