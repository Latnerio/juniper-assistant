import { openai } from "@ai-sdk/openai";
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
8. When screenshots are provided in the context, include them in your answer using markdown image syntax: ![description](url). Place screenshots near the relevant step or section they illustrate.

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

        // Return cached answer as plain text stream
        return new Response(cached.answer, {
          headers: { "Content-Type": "text/plain; charset=utf-8", "X-Cache": "HIT" }
        });
      }
    }

    // Find relevant screenshots
    let screenshotContext = "";
    if (supabase) {
      const words = latest.content.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
      const { data: screenshots } = await supabase
        .from("screenshot_index")
        .select("title, public_url, context, topics");
      
      if (screenshots && screenshots.length > 0) {
        const matched = screenshots.filter((s: any) => 
          s.topics?.some((topic: string) => 
            words.some((w: string) => topic.includes(w) || w.includes(topic))
          )
        ).slice(0, 3);
        
        if (matched.length > 0) {
          screenshotContext = "\n\nRELEVANT SCREENSHOTS (include in your answer where appropriate):\n" +
            matched.map((s: any) => `- ${s.title}: ${s.public_url} (${s.context})`).join("\n");
        }
      }
    }

    const stream = streamText({
      model: openai("gpt-4.1-nano"),
      system: SYSTEM_PROMPT_PREFIX + KNOWLEDGE_BUNDLE + screenshotContext + "\n\n" + languageInstruction,
      messages,
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

    return stream.toTextStreamResponse();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return new Response(message, { status: 500 });
  }
}
