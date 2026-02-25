import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";

import { KNOWLEDGE_BUNDLE } from "@/lib/knowledge-bundle";

const MAX_MESSAGE_LENGTH = 10_000;

const SYSTEM_PROMPT = `You are a Juniper Booking Engine (JBE) expert. You have complete knowledge of the system from training materials, API documentation, and operational guides.

RULES:
1. Detect the user's language and respond in the SAME language (Italian or English).
2. Answer confidently and directly. You have the full knowledge base available.
3. Structure answers with clear steps, bullet points, and practical guidance.
4. When a question maps to a specific module or workflow, provide the step-by-step procedure.
5. If the knowledge base genuinely does not cover a topic, say so briefly. Never recommend "contact support" as your primary answer.
6. Your job is to BE the manual. Answer as a senior Juniper consultant would.
7. Distinguish between similar concepts (e.g., special offers vs special markup, contracts vs rates).

KNOWLEDGE BASE:
${KNOWLEDGE_BUNDLE}`;

function detectLanguage(input: string): "it" | "en" {
  const normalized = input.toLowerCase();
  const italianSignals = [
    /\b(ciao|buongiorno|grazie|come|dove|perche|quale|impostare|configurare)\b/,
    /\b(il|lo|la|gli|della|delle|degli|nel|nella|dopo)\b/,
    /[àèéìòù]/
  ];

  return italianSignals.some((pattern) => pattern.test(normalized)) ? "it" : "en";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const latest = messages.at(-1);

    if (!latest?.content || typeof latest.content !== "string") {
      return new Response("Invalid message payload", { status: 400 });
    }

    if (latest.content.length > MAX_MESSAGE_LENGTH) {
      return new Response(`Message too long. Maximum length is ${MAX_MESSAGE_LENGTH} characters.`, {
        status: 400
      });
    }

    const language = detectLanguage(latest.content);
    const languageInstruction = language === "it" ? "Rispondi in italiano." : "Respond in English.";

    const stream = streamText({
      model: anthropic("claude-haiku-4-20250414"),
      system: `${SYSTEM_PROMPT}\n\n${languageInstruction}`,
      messages
    });

    return stream.toDataStreamResponse({
      sendReasoning: false,
      sendSources: false,
      getErrorMessage: (err) => {
        const message = err instanceof Error ? err.message : "Unexpected error";
        return `Chat generation error: ${message}`;
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return new Response(message, { status: 500 });
  }
}
