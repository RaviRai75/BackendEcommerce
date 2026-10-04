import { describe, expect, it, vi } from "vitest";
import { geminiService } from "../../src/services/ai/gemini.service.js";

describe("geminiService", () => {
  it("exports generateStylistAdvice and geminiService", () => {
    expect(geminiService.generateStylistAdvice).toBeTypeOf("function");
  });

  it("returns stylist advice when Gemini API returns 200", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "For a reception, royal purple Mysore silk looks majestic." }],
            },
          },
        ],
      }),
    });

    try {
      const advice = await geminiService.generateStylistAdvice({
        message: "What should I wear for a reception?",
      });
      expect(advice).toContain("royal purple Mysore silk");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles API failure gracefully without throwing", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network timeout"));

    try {
      const advice = await geminiService.generateStylistAdvice({
        message: "What should I wear?",
      });
      expect(advice).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
