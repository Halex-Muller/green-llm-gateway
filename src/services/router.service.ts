/**
 * Serviço de Roteamento de Modelos (Model Cascading)
 * Analisa a complexidade do prompt para economizar energia e custos usando SLMs em tarefas simples.
 */

export interface RoutingDecision {
  model: string;
  isCascaded: boolean;
  reason: string;
}

export function evaluateComplexity(messages: Array<{ role: string; content: string }>, requestedModel?: string): RoutingDecision {
  const defaultModel = requestedModel || process.env.DEFAULT_FLM_MODEL || 'gpt-4o';
  const slmModel = process.env.DEFAULT_SLM_MODEL || 'gpt-3.5-turbo';

  // Se o modelo solicitado já for um modelo leve, mantemos
  if (defaultModel.includes('3.5') || defaultModel.includes('mini') || defaultModel.includes('flash')) {
    return {
      model: defaultModel,
      isCascaded: false,
      reason: 'Requested model is already lightweight.',
    };
  }

  // Extrair todo o texto das mensagens do usuário para análise
  const userContent = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');

  const charCount = userContent.length;

  // Heurísticas de complexidade
  const hasCodeBlock = /```[\s\S]*?```/.test(userContent) || userContent.includes('function') || userContent.includes('class ');
  const complexKeywords = [
    'analise profunda', 'arquitetura', 'refatore', 'compare', 'algoritmo',
    'demonstre', 'cálculo', 'matemática', 'otimize', 'debugging', 'segurança',
    'explique detalhadamente', 'strategy', 'design pattern', 'proof'
  ];

  const lowerContent = userContent.toLowerCase();
  const hasComplexKeyword = complexKeywords.some((keyword) => lowerContent.includes(keyword));

  // Critério para envio ao SLM (modelo verde/leve):
  // - Menos de 400 caracteres
  // - Sem blocos de código
  // - Sem palavras-chave complexas
  const isSimpleTask = charCount < 400 && !hasCodeBlock && !hasComplexKeyword;

  if (isSimpleTask) {
    console.log(`[Model Cascading] 🌿 Tarefa simples detectada (${charCount} chars). Redirecionando de ${defaultModel} para SLM verde: ${slmModel}`);
    return {
      model: slmModel,
      isCascaded: true,
      reason: `Task is simple (${charCount} chars, no complex keywords or code). Routed to SLM for energy efficiency.`,
    };
  }

  console.log(`[Model Cascading] ⚡ Tarefa complexa/extensa detectada (${charCount} chars, code: ${hasCodeBlock}, keywords: ${hasComplexKeyword}). Mantendo FLM: ${defaultModel}`);
  return {
    model: defaultModel,
    isCascaded: false,
    reason: `Task requires frontier model (chars: ${charCount}, code: ${hasCodeBlock}, complex keywords: ${hasComplexKeyword}).`,
  };
}
