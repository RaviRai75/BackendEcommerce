import { Router } from "express";
import { privateNoStore } from "../../middleware/cachePolicy.js";
import { chatbotLimiter } from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import { createChatResponse } from "./chat.controller.js";
import { chatRequestSchema } from "./chat.validator.js";

export const chatRoutes = Router();

// PUBLIC — stateless, read-only, and intentionally independent of account data.
chatRoutes.post(
  "/chat",
  privateNoStore,
  chatbotLimiter,
  validate({ body: chatRequestSchema }),
  createChatResponse,
);
