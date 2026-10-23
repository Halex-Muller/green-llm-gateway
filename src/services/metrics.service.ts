/**
 * Serviço de Métricas de Sustentabilidade (Green Metrics)
 * Calcula a pegada de carbono evitada, energia poupada e custo economizado.
 */

export interface GreenMetrics {
  cacheHit: boolean;
  isCascaded: boolean;
  estimatedTokensSaved: number;
  energySavedKWh: number;
  carbonSavedGCO2e: number;
  latencySavedMs: number;
}

export function calculateGreenMetrics(
  cacheHit: boolean,
  isCascaded: boolean,
  promptLength: number = 100
): GreenMetrics {
  let estimatedTokensSaved = 0;
  let energySavedKWh = 0;
  let carbonSavedGCO2e = 0;
  let latencySavedMs = 0;

  // Constantes de estimativa ecológica e performance por requisição de LLM
  // Média estimada: ~0.0003 kWh por chamada de LLM pesada (GPT-4o)
  const KWH_PER_HEAVY_CALL = 0.0003;
  // Média de fator de emissão (ex: grid global médio ~475 gCO2e / kWh)
  const G_CO2_PER_KWH = 475;

  if (cacheHit) {
    // Cache Hit poupa quase 100% do esforço computacional e latência do LLM
    estimatedTokensSaved = Math.max(50, Math.round(promptLength / 4) * 2);
    energySavedKWh = KWH_PER_HEAVY_CALL;
    carbonSavedGCO2e = energySavedKWh * G_CO2_PER_KWH;
    latencySavedMs = 1200; // Média estimada de economia de 1.2s de inferência
  } else if (isCascaded) {
    // Model Cascading (indo para SLM mais leve) consome cerca de 70% menos energia que um modelo de fronteira (FLM)
    estimatedTokensSaved = 0;
    energySavedKWh = KWH_PER_HEAVY_CALL * 0.7;
    carbonSavedGCO2e = energySavedKWh * G_CO2_PER_KWH;
    latencySavedMs = 600; // SLMs respondem mais rápido
  }

  return {
    cacheHit,
    isCascaded,
    estimatedTokensSaved,
    energySavedKWh: Number(energySavedKWh.toFixed(6)),
    carbonSavedGCO2e: Number(carbonSavedGCO2e.toFixed(4)),
    latencySavedMs,
  };
}
