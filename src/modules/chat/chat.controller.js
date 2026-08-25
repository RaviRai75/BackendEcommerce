import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/response.js";
import { chatService } from "./chat.service.js";

export const createChatResponse = asyncHandler(async (req, res) => {
  const response = await chatService.respond(req.body);
  sendSuccess(res, response);
});
