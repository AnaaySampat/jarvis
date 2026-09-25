/**
 * Lightweight in-memory Vector Database backed by localStorage.
 * Uses Google Vertex AI `text-embedding-004` to generate vectors and
 * cosine similarity to retrieve the most relevant facts.
 */

import { getAccessToken, extractProjectId } from "../providers/vertexAuth";
import { platformFetch } from "../tools/httpClient";
import { makeKV, readJson, writeJson } from "./store";

export interface VectorRecord {
  id: string;
  text: string;
  vector: number[];
  timestamp: number;
}

const STORAGE_KEY = "jarvis.android.embeddings.v1";
const kv = makeKV();

/** Cosine similarity between two vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Generate an embedding vector using Vertex AI. */
export async function generateEmbedding(text: string, saJson: string): Promise<number[]> {
  const token = await getAccessToken(saJson);
  const project = extractProjectId(saJson);
  const region = "us-central1"; // Embeddings are standard in us-central1
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(region)}/publishers/google/models/text-embedding-004:predict`;

  const body = JSON.stringify({
    instances: [{ content: text }],
  });

  const res = await platformFetch()(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Embedding failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    predictions?: Array<{ embeddings?: { values?: unknown } }>;
  };
  const vector = json?.predictions?.[0]?.embeddings?.values;
  if (!vector || !Array.isArray(vector)) {
    throw new Error("Invalid embedding response format");
  }
  return vector as number[];
}

/** Load records from local storage. */
export function loadVectors(): VectorRecord[] {
  return readJson<VectorRecord[]>(kv, STORAGE_KEY, []);
}

/** Save records to local storage. */
export function saveVectors(records: VectorRecord[]): void {
  writeJson(kv, STORAGE_KEY, records);
}

/** Find the top K most relevant records for a given query vector. */
export function searchTopK(queryVector: number[], k = 3): VectorRecord[] {
  const records = loadVectors();
  if (records.length === 0) return [];

  const scored = records.map((record) => ({
    record,
    score: cosineSimilarity(queryVector, record.vector),
  }));

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Return top K
  return scored.slice(0, k).map((s) => s.record);
}

/** Add a new record to the store. */
export function addVectorRecord(id: string, text: string, vector: number[]): void {
  const records = loadVectors();
  // Don't add duplicates
  if (records.some((r) => r.text === text)) return;
  records.push({ id, text, vector, timestamp: Date.now() });
  saveVectors(records);
}

/** Delete a record by exact text match (fallback to id). */
export function deleteVectorRecordByText(text: string): void {
  const records = loadVectors();
  const filtered = records.filter((r) => r.text !== text);
  if (records.length !== filtered.length) {
    saveVectors(filtered);
  }
}

/** Clear all records. */
export function clearVectors(): void {
  saveVectors([]);
}
