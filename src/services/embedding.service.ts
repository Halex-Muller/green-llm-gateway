import { pipeline } from '@xenova/transformers';

/**
 * Singleton para carregar o modelo de embedding local (all-MiniLM-L6-v2)
 * Roda de forma totalmente local, sem custos de API ou dependência externa.
 */
class EmbeddingExtractor {
  private static instance: any = null;

  public static async getInstance() {
    if (!EmbeddingExtractor.instance) {
      console.log('[Embedding Service] Carregando modelo local (all-MiniLM-L6-v2)...');
      EmbeddingExtractor.instance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      console.log('[Embedding Service] Modelo carregado com sucesso!');
    }
    return EmbeddingExtractor.instance;
  }
}

export async function getEmbedding(text: string): Promise<number[]> {
  try {
    const extractor = await EmbeddingExtractor.getInstance();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    // O tensor retornado é convertido para array numérico padrão
    return Array.from(output.data);
  } catch (error: any) {
    console.error('[Embedding Service Error]:', error.message);
    throw new Error(`Falha ao gerar embedding local: ${error.message}`);
  }
}
