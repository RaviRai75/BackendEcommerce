import { asyncHandler } from "../../utils/asyncHandler.js";
import { socialShareService } from "./socialShare.service.js";

export const getProductSharePreview = asyncHandler(async (req, res) => {
  const html = await socialShareService.productPreview(req.params.slug);
  res.status(200).set("Content-Type", "text/html; charset=utf-8").send(html);
});
