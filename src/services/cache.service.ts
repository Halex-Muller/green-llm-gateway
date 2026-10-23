export interface CacheEntry {
  embedding: number[];
  prompt: string;
  response: any;
  createdAt: number;
}

export class SemanticCache {
  private cache: CacheEntry[] = [];
  private similarityThreshold: number;
  private maxEntries: number;

  constructor(similarityThreshold = 0.90, maxEntries = 1000) {
    this.similarityThreshold = similarityThreshold;
    this.maxEntries = maxEntries;
  }

  /**
   * Calcula a similaridade de cosseno entre dois vetores normalizados
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Procura no cache uma resposta similar com base no embedding do prompt
   */
  public find(queryEmbedding: number[]): { response: any; similarity: number } | null {
    let bestMatch: any = null;
    let highestSimilarity = -1;

    for (const entry of this.cache) {
      const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    if (highestSimilarity >= this.similarityThreshold && bestMatch) {
      return {
        response: bestMatch.response,
        similarity: highestSimilarity,
      };
    }

    return null;
  }

  /**
   * Adiciona uma nova entrada ao cache semântico
   */
  public set(embedding: number[], prompt: string, response: any): void {
    if (this.cache.length >= this.maxEntries) {
      this.cache.shift(); // Remove o mais antigo (FIFO)
    }

    this.cache.push({
      embedding,
      prompt,
      response,
      createdAt: Date.now(),
    });
  }

  public clear(): void {
    this.cache = [];
  }

  public size(): number {
    return this.cache.length;
  }
}

// Instância global compartilhada do cache semântico
export const globalSemanticCache = new SemanticCache(
  parseFloat(process.env.CACHE_SIMILARITY_THRESHOLD || '0.90')
);
