# Juniper Knowledge Assistant - Build Spec

## Overview
RAG chatbot that answers Juniper Booking Engine questions using an ingested knowledge base. Users ask in Italian or English, system responds in the same language.

## Stack
- **Framework**: Next.js 14+ (App Router)
- **UI**: Tailwind CSS + shadcn/ui for chat components
- **Backend**: Next.js API routes
- **Vector DB**: Supabase with pgvector extension
- **Embeddings**: OpenAI text-embedding-3-small
- **LLM**: Anthropic Claude (claude-sonnet-4-20250514 via API, with claude-haiku-4-20250414 as fallback)
- **Streaming**: Vercel AI SDK (@ai-sdk/anthropic)
- **Deploy**: Vercel

## Architecture

### Ingestion Pipeline (`scripts/ingest.ts`)
1. Read all .md files from knowledge base directory (passed as arg)
2. Read all .txt.txt transcript files from video_transcripts/
3. Chunk using recursive text splitter (~500 tokens per chunk, 50 token overlap)
4. For transcripts: clean up obvious noise (repeated words, greeting patterns) before chunking
5. Generate embeddings via OpenAI API
6. Store in Supabase `documents` table with metadata (source file, chunk index)

### Supabase Schema
```sql
create extension if not exists vector;

create table documents (
  id bigserial primary key,
  content text not null,
  metadata jsonb,
  embedding vector(1536)
);

create index on documents using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create or replace function match_documents (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where 1 - (documents.embedding <=> query_embedding) > match_threshold
  order by (documents.embedding <=> query_embedding)
  limit match_count;
$$;
```

### API Route (`app/api/chat/route.ts`)
1. Receive user message
2. Detect language (Italian or English) from input
3. Embed the user question
4. Vector search: top 8 chunks above 0.7 similarity threshold
5. Build system prompt with retrieved context + language instruction
6. Stream response via Claude API
7. Include source citations in response

### System Prompt
```
You are a Juniper Booking Engine expert assistant. You answer questions about the Juniper Booking Engine (JBE) system, its modules, configuration, booking flows, and operational procedures.

IMPORTANT: Detect the language of the user's question and respond in the SAME language. If they ask in Italian, respond in Italian. If they ask in English, respond in English.

Use ONLY the provided context to answer. If the context doesn't contain enough information to answer, say so honestly. Do not make up information.

When relevant, mention the source of your information (e.g., "According to the training on Predefined Packages..." or "Secondo la formazione sui Pacchetti Predefiniti...").

Be concise and practical. Use bullet points for step-by-step procedures.
```

### Chat UI (`app/page.tsx`)
- Clean chat interface with message bubbles
- User messages right-aligned, assistant left-aligned
- Streaming responses
- Juniper red branding (#d70000)
- "Powered by Juniper Knowledge Base" footer
- Placeholder: "Ask me anything about Juniper Booking Engine... / Chiedimi qualsiasi cosa sul Juniper Booking Engine..."
- Mobile responsive

## Environment Variables
```
OPENAI_API_KEY=         # for embeddings
ANTHROPIC_API_KEY=      # for chat
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=  # for ingestion
```

## File Structure
```
juniper-assistant/
├── app/
│   ├── api/chat/route.ts
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── chat.tsx
│   ├── message.tsx
│   └── ui/ (shadcn)
├── lib/
│   ├── supabase.ts
│   └── embeddings.ts
├── scripts/
│   └── ingest.ts
├── supabase/
│   └── migrations/001_create_documents.sql
├── .env.local.example
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── next.config.js
```

## Commands
- `npm run dev` - local dev
- `npx tsx scripts/ingest.ts /path/to/knowledge-base` - ingest knowledge
- `vercel deploy` - deploy

## Knowledge Base Location
The knowledge base to ingest is at:
`/Users/bono/.openclaw/workspace/juniper-knowledge/`

It contains:
- 23 markdown files (API docs, booking flows, elearning knowledge, glossary, etc.)
- 45 video transcript files in `elearning/video_transcripts/*.txt.txt`
