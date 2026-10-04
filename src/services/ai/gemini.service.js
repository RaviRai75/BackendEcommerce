import { env } from "../../config/env.js";

const CANDIDATE_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
];

const STYLIST_SYSTEM_INSTRUCTION = `You are the Dhanalakshmi Fashion Concierge & AI Stylist.
Dhanalakshmi Fashion is a boutique specializing in traditional South Indian kids' & girls' dresses, pure silk pattu pavadas, artisanal velvet & silk lehenga cholis, and custom festive ensembles.

CRITICAL PRODUCT RULES:
1. Dhanalakshmi Fashion DOES NOT sell sarees. NEVER recommend sarees or saree draping tips.
2. The core focus is on children and little ones: starting from infants/newborns (0 to 6 months & below), toddlers, and young girls, up to teens and women aged 30 to 35 years (such as mother-daughter festive twinning sets, birthday frocks, and ceremonial lehengas).
3. The dresses feature pure Karnataka Mysore silk, rich velvet booti cholis, wide authentic zari borders, soft baby-safe cotton inner linings, and generous seam margins for growing children.

Your role:
1. Provide warm, graceful, expert styling advice, color contrast suggestions (e.g. wine velvet choli with golden zari silk skirt), festive occasion dressing (naming ceremonies, birthdays, festivals, weddings), and bespoke fit guidance.
2. Keep answers concise, delightful, and conversational for chat: 2 to 4 sentences (under 120 words).
3. If asked about garment care, advise gentle dry-cleaning and storing in pure cotton/muslin bags away from direct moisture.
4. Maintain customer privacy at all times. Never ask for or store passwords, OTPs, UPI IDs, credit/debit card details, or bank account numbers.
5. If the customer asks to browse or purchase, invite them to explore Dhanalakshmi Fashion's published kids' & festive collections or start a custom order.`;

export async function generateStylistAdvice({ message, productContext = null }) {
  if (!env.GEMINI_API_KEY) {
    return null;
  }

  const promptParts = [];
  if (productContext?.name) {
    promptParts.push(
      `Context: The customer is currently viewing "${productContext.name}" (${productContext.fabric || "Pure Silk"}, ${productContext.colour || ""}).`
    );
  }
  promptParts.push(`Customer query: "${message}"`);

  for (const model of CANDIDATE_MODELS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: promptParts.join("\n\n") }],
            },
          ],
          systemInstruction: {
            parts: [{ text: STYLIST_SYSTEM_INSTRUCTION }],
          },
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      });

      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text?.trim();

      if (text) {
        return text;
      }
    } catch {
      // Try next model if timeout or network failure
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return null;
}

export const geminiService = Object.freeze({
  generateStylistAdvice,
});
