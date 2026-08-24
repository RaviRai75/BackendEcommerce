import { Router } from "express";
import { getSitemap } from "./seo.controller.js";

export const seoRoutes = Router();

seoRoutes.get("/sitemap.xml", getSitemap);
