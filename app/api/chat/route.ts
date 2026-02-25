import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";

import { embedText } from "@/lib/embeddings";
import { createSupabaseServerClient, type DocumentRow } from "@/lib/supabase";

const TOP_K = 12;
const THRESHOLD = 0.25;
const MAX_MESSAGE_LENGTH = 10_000;

const SYSTEM_PROMPT = `You are a Juniper Booking Engine expert assistant. You answer questions about the Juniper Booking Engine (JBE) system, its modules, configuration, booking flows, and operational procedures.

IMPORTANT: Detect the language of the user's question and respond in the SAME language. If they ask in Italian, respond in Italian. If they ask in English, respond in English.

Use the provided context as your primary source. If the context contains partial information, provide what you can and clearly note what is not covered. If the context has no relevant information at all, say so honestly. Do not fabricate specific procedures, but you may provide general Juniper Booking Engine guidance based on common patterns visible in the context.

When relevant, mention the source of your information (e.g., "According to the training on Predefined Packages..." or "Secondo la formazione sui Pacchetti Predefiniti...").

Be concise and practical. Use bullet points for step-by-step procedures.`;

function detectLanguage(input: string): "it" | "en" {
  const normalized = input.toLowerCase();
  const italianSignals = [
    /\b(ciao|buongiorno|grazie|come|dove|perche|quale|impostare|configurare)\b/,
    /\b(il|lo|la|gli|della|delle|degli|nel|nella|dopo)\b/,
    /[àèéìòù]/
  ];

  return italianSignals.some((pattern) => pattern.test(normalized)) ? "it" : "en";
}

function buildContext(docs: DocumentRow[]) {
  return docs
    .map((doc, index) => {
      const source =
        typeof doc.metadata?.source === "string"
          ? doc.metadata.source
          : `unknown-source-${index + 1}`;
      return `[Source ${index + 1}: ${source}]\n${doc.content}`;
    })
    .join("\n\n");
}

function buildSources(docs: DocumentRow[]) {
  return docs.map((doc, index) => ({
    source:
      typeof doc.metadata?.source === "string"
        ? doc.metadata.source
        : `unknown-source-${index + 1}`,
    similarity: doc.similarity
  }));
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
    const queryEmbedding = await embedText(latest.content);
    const supabase = createSupabaseServerClient();

    // Vector search
    const { data: vectorDocs, error: vecError } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: THRESHOLD,
      match_count: TOP_K
    });

    if (vecError) {
      throw vecError;
    }

    // Keyword fallback: extract significant words and search
    const stopWords = new Set(["how", "do", "i", "a", "an", "the", "in", "to", "of", "is", "it", "and", "or", "for", "on", "at", "by", "what", "where", "when", "can", "with"]);
    const keywords = latest.content.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2 && !stopWords.has(w));
    const keywordQuery = keywords.slice(0, 4).join(" & ");

    let keywordDocs: DocumentRow[] = [];
    if (keywords.length > 0) {
      // Use ilike with the most specific multi-word phrases first, then individual keywords
      const phrases = keywords.slice(0, 5);
      const pattern = `%${phrases.join("%")}%`;
      const { data: kwData } = await supabase
        .from("documents")
        .select("id, content, metadata")
        .ilike("content", pattern)
        .limit(6);
      if (kwData && kwData.length > 0) {
        keywordDocs = kwData.map((d: any) => ({ ...d, similarity: 0.5 }));
      } else {
        // Fallback: search for any 2 keywords together
        for (let i = 0; i < Math.min(phrases.length, 3) && keywordDocs.length === 0; i++) {
          for (let j = i + 1; j < Math.min(phrases.length, 4) && keywordDocs.length === 0; j++) {
            const { data: kwData2 } = await supabase
              .from("documents")
              .select("id, content, metadata")
              .ilike("content", `%${phrases[i]}%${phrases[j]}%`)
              .limit(6);
            if (kwData2 && kwData2.length > 0) {
              keywordDocs = kwData2.map((d: any) => ({ ...d, similarity: 0.45 }));
            }
          }
        }
      }
    }

    // Merge and deduplicate (vector results take priority)
    const seenIds = new Set((vectorDocs ?? []).map((d: DocumentRow) => d.id));
    const mergedDocs = [
      ...(vectorDocs ?? []),
      ...keywordDocs.filter((d: DocumentRow) => !seenIds.has(d.id))
    ].slice(0, TOP_K);

    const docs = mergedDocs as DocumentRow[];
    const contextText = buildContext(docs);
    const sources = buildSources(docs);

    const languageInstruction = language === "it" ? "Rispondi in italiano." : "Respond in English.";

    const citationInstruction =
      language === "it"
        ? `Quando usi il contesto, cita esplicitamente la fonte tra parentesi alla fine della frase (esempio: [Source 2]). Fonti disponibili: ${sources
            .map((item, index) => `[Source ${index + 1}: ${item.source}]`)
            .join(", ")}`
        : `When using context, explicitly cite the source in brackets at the end of the sentence (example: [Source 2]). Available sources: ${sources
            .map((item, index) => `[Source ${index + 1}: ${item.source}]`)
            .join(", ")}`;

    const contextPrompt = docs.length
      ? `Retrieved context:\n${contextText}`
      : "No relevant context was retrieved.";

    const fullSystemPrompt = `${SYSTEM_PROMPT}\n\n${languageInstruction}\n\n${citationInstruction}\n\n${contextPrompt}`;

    const stream = streamText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: fullSystemPrompt,
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
