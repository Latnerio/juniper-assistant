import OpenAI from "openai";

const embeddingModel = "text-embedding-3-small";

function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }

  return new OpenAI({ apiKey });
}

export async function embedText(input: string): Promise<number[]> {
  const openai = createOpenAIClient();
  const response = await openai.embeddings.create({
    model: embeddingModel,
    input
  });

  return response.data[0].embedding;
}

export async function embedBatch(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) {
    return [];
  }

  const openai = createOpenAIClient();
  const response = await openai.embeddings.create({
    model: embeddingModel,
    input: inputs
  });

  return response.data.map((item) => item.embedding);
}
