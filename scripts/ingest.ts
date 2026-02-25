import fs from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { embedBatch } from "../lib/embeddings";

type ChunkRecord = {
  content: string;
  metadata: {
    source: string;
    chunkIndex: number;
    documentType: "markdown" | "transcript";
  };
};

const CHUNK_SIZE_TOKENS = 800;
const CHUNK_OVERLAP_TOKENS = 50;
const MAX_SECTION_TOKENS = 1500;
const EMBEDDING_BATCH_SIZE = 32;

type IngestOptions = {
  knowledgePath: string;
  clean: boolean;
};

function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.33);
}

function recursiveChunk(text: string, maxTokens: number, overlapTokens: number): string[] {
  const cleaned = text.replace(/\r/g, "").trim();
  if (!cleaned) {
    return [];
  }

  const paragraphs = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph);

    if (paragraphTokens > maxTokens) {
      const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
      for (const sentence of sentences) {
        const sentenceTokens = estimateTokens(sentence);
        if (currentTokens + sentenceTokens > maxTokens && current.length > 0) {
          chunks.push(current.join("\n\n"));
          const overlap = current.join(" ").split(/\s+/).slice(-Math.max(1, overlapTokens)).join(" ");
          current = overlap ? [overlap, sentence] : [sentence];
          currentTokens = estimateTokens(current.join(" "));
        } else {
          current.push(sentence);
          currentTokens += sentenceTokens;
        }
      }
      continue;
    }

    if (currentTokens + paragraphTokens > maxTokens && current.length > 0) {
      chunks.push(current.join("\n\n"));
      const overlap = current.join(" ").split(/\s+/).slice(-Math.max(1, overlapTokens)).join(" ");
      current = overlap ? [overlap, paragraph] : [paragraph];
      currentTokens = estimateTokens(current.join(" "));
    } else {
      current.push(paragraph);
      currentTokens += paragraphTokens;
    }
  }

  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }

  return chunks.filter((chunk) => estimateTokens(chunk) > 10);
}

/**
 * Split markdown by headings (## or ###), keeping each section as a complete chunk.
 * If a section exceeds MAX_SECTION_TOKENS, fall back to recursive chunking for that section.
 * Small adjacent sections are merged to avoid tiny chunks.
 */
function sectionAwareChunk(text: string): string[] {
  const cleaned = text.replace(/\r/g, "").trim();
  if (!cleaned) return [];

  // Split on ## or ### headings, keeping the heading with its content
  const sectionRegex = /^(#{2,3}\s+.+)$/gm;
  const sections: { heading: string; body: string }[] = [];
  let lastIndex = 0;
  let lastHeading = "";
  let match: RegExpExecArray | null;

  // Collect all heading positions
  const headings: { heading: string; index: number }[] = [];
  while ((match = sectionRegex.exec(cleaned)) !== null) {
    headings.push({ heading: match[1], index: match.index });
  }

  // Build sections from headings
  if (headings.length === 0) {
    // No headings, fall back to recursive chunking
    return recursiveChunk(cleaned, CHUNK_SIZE_TOKENS, CHUNK_OVERLAP_TOKENS);
  }

  // Content before first heading
  const preamble = cleaned.substring(0, headings[0].index).trim();
  if (preamble && estimateTokens(preamble) > 10) {
    sections.push({ heading: "", body: preamble });
  }

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index;
    const end = i + 1 < headings.length ? headings[i + 1].index : cleaned.length;
    const sectionText = cleaned.substring(start, end).trim();
    sections.push({ heading: headings[i].heading, body: sectionText });
  }

  // Now produce chunks: keep sections intact, merge small ones, split large ones
  const chunks: string[] = [];
  let buffer = "";
  let bufferTokens = 0;

  for (const section of sections) {
    const sectionTokens = estimateTokens(section.body);

    // If section is too large, flush buffer then sub-chunk the section
    if (sectionTokens > MAX_SECTION_TOKENS) {
      if (buffer) {
        chunks.push(buffer.trim());
        buffer = "";
        bufferTokens = 0;
      }
      const subChunks = recursiveChunk(section.body, CHUNK_SIZE_TOKENS, CHUNK_OVERLAP_TOKENS);
      chunks.push(...subChunks);
      continue;
    }

    // If adding this section would exceed target, flush buffer
    if (bufferTokens + sectionTokens > CHUNK_SIZE_TOKENS && buffer) {
      chunks.push(buffer.trim());
      buffer = "";
      bufferTokens = 0;
    }

    buffer += (buffer ? "\n\n" : "") + section.body;
    bufferTokens += sectionTokens;
  }

  if (buffer.trim()) {
    chunks.push(buffer.trim());
  }

  return chunks.filter((chunk) => estimateTokens(chunk) > 10);
}

function cleanTranscriptNoise(input: string): string {
  const lines = input.split("\n");
  const greetingPattern = /^(hello|hi|hey|ciao|buongiorno|buonasera|grazie|thanks)[\s,!.-]*$/i;

  const cleanedLines = lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .filter((line) => !greetingPattern.test(line));

  const cleanedText = cleanedLines.join("\n");

  return cleanedText
    .replace(/\b(\w+)(\s+\1\b){2,}/gi, "$1")
    .replace(/\b(uh|um|ehm|mmm)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function listFilesRecursively(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursively(fullPath);
      }
      return [fullPath];
    })
  );

  return nested.flat();
}

async function readKnowledgeFiles(baseDir: string): Promise<ChunkRecord[]> {
  const files = await listFilesRecursively(baseDir);

  const markdownFiles = files.filter((file) => file.endsWith(".md"));
  const transcriptFiles = files.filter(
    (file) =>
      file.includes(`${path.sep}video_transcripts${path.sep}`) && file.endsWith(".txt.txt")
  );

  const records: ChunkRecord[] = [];

  for (const filePath of markdownFiles) {
    const raw = await fs.readFile(filePath, "utf8");
    const chunks = sectionAwareChunk(raw);
    chunks.forEach((content, chunkIndex) => {
      records.push({
        content,
        metadata: {
          source: path.relative(baseDir, filePath),
          chunkIndex,
          documentType: "markdown"
        }
      });
    });
  }

  for (const filePath of transcriptFiles) {
    const raw = await fs.readFile(filePath, "utf8");
    const cleaned = cleanTranscriptNoise(raw);
    const chunks = recursiveChunk(cleaned, CHUNK_SIZE_TOKENS, CHUNK_OVERLAP_TOKENS);

    chunks.forEach((content, chunkIndex) => {
      records.push({
        content,
        metadata: {
          source: path.relative(baseDir, filePath),
          chunkIndex,
          documentType: "transcript"
        }
      });
    });
  }

  return records;
}

function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable");
  }

  if (!key) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function parseArgs(argv: string[]): IngestOptions {
  let clean = true;
  let knowledgePath: string | null = null;

  for (const arg of argv) {
    if (arg === "--clean") {
      clean = true;
      continue;
    }

    if (arg === "--no-clean") {
      clean = false;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (knowledgePath) {
      throw new Error("Only one knowledge base path is supported.");
    }

    knowledgePath = arg;
  }

  if (!knowledgePath) {
    throw new Error("Usage: npx tsx scripts/ingest.ts [--clean|--no-clean] /path/to/knowledge-base");
  }

  return { knowledgePath, clean };
}

async function run() {
  const { knowledgePath, clean } = parseArgs(process.argv.slice(2));

  const absolutePath = path.resolve(knowledgePath);
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Knowledge base path does not exist or is not a directory: ${absolutePath}`);
  }

  console.log(`Reading knowledge base from: ${absolutePath}`);
  const records = await readKnowledgeFiles(absolutePath);
  if (records.length === 0) {
    console.log("No chunks found. Nothing to ingest.");
    return;
  }

  console.log(`Prepared ${records.length} chunks. Generating embeddings and inserting into Supabase...`);
  const supabase = getSupabaseAdminClient();

  if (clean) {
    console.log("Cleaning existing documents before ingest...");
    const { error: deleteError } = await supabase.from("documents").delete().not("id", "is", null);
    if (deleteError) {
      throw new Error(`Failed clearing existing documents: ${deleteError.message}`);
    }
  }

  for (let i = 0; i < records.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = records.slice(i, i + EMBEDDING_BATCH_SIZE);
    const embeddings = await embedBatch(batch.map((item) => item.content));

    const payload = batch.map((item, index) => ({
      content: item.content,
      metadata: item.metadata,
      embedding: embeddings[index]
    }));

    const { error } = await supabase.from("documents").insert(payload);
    if (error) {
      throw new Error(`Failed inserting batch starting at ${i}: ${error.message}`);
    }

    console.log(`Inserted ${Math.min(i + EMBEDDING_BATCH_SIZE, records.length)} / ${records.length}`);
  }

  console.log("Ingestion completed successfully.");
}

run().catch((error) => {
  console.error("Ingestion failed:", error);
  process.exit(1);
});
