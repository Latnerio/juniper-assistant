import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { createClient } from "@supabase/supabase-js";

import { KNOWLEDGE_BUNDLE } from "@/lib/knowledge-bundle";

const MAX_MESSAGE_LENGTH = 10_000;

const SYSTEM_PROMPT_PREFIX = `You are a Juniper Booking Engine (JBE) expert. You have complete knowledge of the system from training materials, API documentation, and operational guides.

RULES:
1. Detect the user's language and respond in the SAME language (Italian or English).
2. Answer confidently and directly. You have the full knowledge base available.
3. Structure answers with clear steps, bullet points, and practical guidance.
4. When a question maps to a specific module or workflow, provide the step-by-step procedure.
5. If the knowledge base genuinely does not cover a topic, say so briefly. Never recommend "contact support" as your primary answer.
6. Your job is to BE the manual. Answer as a senior Juniper consultant would.
7. Distinguish between similar concepts (e.g., special offers vs special markup, contracts vs rates).

KNOWLEDGE BASE:
`;

function detectLanguage(input: string): "it" | "en" {
  const normalized = input.toLowerCase();
  const italianSignals = [
    /\b(ciao|buongiorno|grazie|come|dove|perche|quale|impostare|configurare)\b/,
    /\b(il|lo|la|gli|della|delle|degli|nel|nella|dopo)\b/,
    /[àèéìòù]/
  ];
  return italianSignals.some((pattern) => pattern.test(normalized)) ? "it" : "en";
}

function normalizeQuestion(q: string): string {
  return q.toLowerCase().trim().replace(/[?!.,;:]+$/g, "").replace(/\s+/g, " ");
}

async function hashQuestion(q: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(normalizeQuestion(q));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
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
      return new Response(`Message too long. Maximum length is ${MAX_MESSAGE_LENGTH} characters.`, { status: 400 });
    }

    const language = detectLanguage(latest.content);
    const languageInstruction = language === "it" ? "Rispondi in italiano." : "Respond in English.";

    // Check response cache (only for single-turn questions, not follow-ups)
    const supabase = getSupabase();
    if (supabase && messages.length === 1) {
      const hash = await hashQuestion(latest.content);
      const { data: cached } = await supabase
        .from("response_cache")
        .select("answer, hit_count")
        .eq("question_hash", hash)
        .single();

      if (cached?.answer) {
        // Increment hit count async (fire and forget)
        void supabase.from("response_cache").update({ hit_count: ((cached as any).hit_count ?? 0) + 1 }).eq("question_hash", hash).then(() => {});

        // Return cached answer as a stream-compatible response
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`f:{"messageId":"cached-${hash.slice(0, 8)}"}\n`));
            // Send full answer in one chunk
            const escaped = JSON.stringify(cached.answer);
            controller.enqueue(encoder.encode(`0:${escaped}\n`));
            controller.enqueue(encoder.encode(`e:{"finishReason":"stop","usage":{"promptTokens":0,"completionTokens":0},"isContinued":false}\n`));
            controller.enqueue(encoder.encode(`d:{"finishReason":"stop","usage":{"promptTokens":0,"completionTokens":0}}\n`));
            controller.close();
          }
        });
        return new Response(stream, {
          headers: { "Content-Type": "text/plain; charset=utf-8", "X-Cache": "HIT" }
        });
      }
    }

    // Use prompt caching via provider options
    const stream = streamText({
      model: anthropic("claude-haiku-4-20250414", { cacheControl: true }),
      system: SYSTEM_PROMPT_PREFIX + KNOWLEDGE_BUNDLE + "\n\n" + languageInstruction,
      messages,
      providerOptions: {
        anthropic: {
          cacheControl: { type: "ephemeral" }
        }
      },
      async onFinish({ text }) {
        // Cache the response for single-turn questions
        if (supabase && messages.length === 1 && text && text.length > 50) {
          const hash = await hashQuestion(latest.content);
          try {
            await supabase.from("response_cache").upsert({
              question_hash: hash,
              question: latest.content,
              answer: text,
              language,
              hit_count: 0
            }, { onConflict: "question_hash" });
          } catch { /* ignore cache write failures */ }
        }
      }
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
