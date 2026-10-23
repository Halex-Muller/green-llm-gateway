import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { forwardToUpstream } from '../proxy/proxyService.js';
import { forwardToUpstreamStream } from '../proxy/proxyStreamService.js';
import { getEmbedding } from '../services/embedding.service.js';
import { globalSemanticCache } from '../services/cache.service.js';
import { evaluateComplexity } from '../services/router.service.js';
import { calculateGreenMetrics } from '../services/metrics.service.js';
import { globalQuotaManager } from '../services/quota.service.js';
import { globalGatewayStats } from './analyticsRoutes.js';

export async function chatRoutes(fastify: FastifyInstance) {
  // Health check com métricas do cache
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    return {
      status: 'ok',
      service: 'Green LLM Gateway',
      version: '1.0.0',
      cacheEntries: globalSemanticCache.size(),
      timestamp: new Date().toISOString(),
    };
  });

  // Rota compatível com OpenAI v1/chat/completions (Suporte a Cache, Cascading, Streaming, Green Metrics e Quotas/Rate Limiting)
  fastify.post('/v1/chat/completions', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const body = request.body as any;
    const isStreaming = body && body.stream === true;

    // Identificar a chave do cliente (Authorization Bearer ou X-Green-Client-Key)
    const authHeader = request.headers['authorization'];
    const clientKeyHeader = request.headers['x-green-client-key'] as string;
    let clientId = 'default-client';

    if (clientKeyHeader) {
      clientId = clientKeyHeader;
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      clientId = token.length > 10 ? `client_${token.substring(0, 6)}...` : token;
    }

    try {
      console.log(`[Gateway] Requisição recebida de cliente: ${clientId} (Stream: ${isStreaming})`);

      // 1. Extrair a última mensagem do usuário do payload
      let userPrompt = '';
      if (body && Array.isArray(body.messages) && body.messages.length > 0) {
        const userMessages = body.messages.filter((m: any) => m.role === 'user');
        if (userMessages.length > 0) {
          userPrompt = userMessages[userMessages.length - 1].content;
        }
      }

      const semanticCacheEnabled = process.env.SEMANTIC_CACHE_ENABLED !== 'false';
      let promptEmbedding: number[] | null = null;
      let isCacheHit = false;
      let cachedResult: any = null;

      // 2. Consultar o cache semântico antes de checar quota restritiva
      if (semanticCacheEnabled && userPrompt) {
        try {
          promptEmbedding = await getEmbedding(userPrompt);
          const found = globalSemanticCache.find(promptEmbedding);

          if (found) {
            isCacheHit = true;
            cachedResult = found;
          }
        } catch (cacheError: any) {
          console.warn(`[Semantic Cache Warning] Erro na consulta ao cache:`, cacheError.message);
        }
      }

      // 3. Verificar Quota e Rate Limit (Bônus Verde: Cache HIT não consome quota)
      const estimatedTokens = Math.max(50, Math.round(userPrompt.length / 4));
      const quotaCheck = globalQuotaManager.checkAndConsume(clientId, estimatedTokens, isCacheHit);

      if (!quotaCheck.allowed) {
        console.warn(`[Quota Exceeded] Cliente ${clientId} atingiu o limite.`);
        reply.header('X-RateLimit-Remaining', quotaCheck.remainingRPM.toString());
        reply.header('X-Green-Quota-Saved', isCacheHit ? 'true' : 'false');
        reply.code(429).send({
          error: {
            message: quotaCheck.quotaExceededMessage || 'Rate limit ou cota diária excedida.',
            type: 'rate_limit_error',
            code: 429,
          },
        });
        return;
      }

      // 4. Se for Cache HIT
      if (isCacheHit && cachedResult) {
        const duration = Date.now() - startTime;
        console.log(`[Semantic Cache] 🎯 CACHE HIT! Similaridade: ${(cachedResult.similarity * 100).toFixed(2)}% em ${duration}ms`);

        const greenMetrics = calculateGreenMetrics(true, false, userPrompt.length);
        const costSavedUsd = 0.002;

        globalGatewayStats.recordRequest(
          clientId,
          true,
          false,
          'cached-response',
          greenMetrics.energySavedKWh,
          greenMetrics.carbonSavedGCO2e,
          costSavedUsd,
          greenMetrics.latencySavedMs
        );

        reply.header('X-RateLimit-Remaining', quotaCheck.remainingRPM.toString());
        reply.header('X-Green-Quota-Saved', 'true');
        reply.header('X-Green-Cache', 'HIT');
        reply.header('X-Green-Similarity', cachedResult.similarity.toFixed(4));
        reply.header('X-Green-Model-Routed', 'cached-response');
        reply.header('X-Green-Energy-Saved-kWh', greenMetrics.energySavedKWh.toString());
        reply.header('X-Green-Carbon-Saved-gCO2e', greenMetrics.carbonSavedGCO2e.toString());
        reply.header('X-Green-Latency-Saved-ms', greenMetrics.latencySavedMs.toString());
        reply.header('X-Gateway-Latency-Ms', duration.toString());

        if (isStreaming) {
          reply.raw.setHeader('Content-Type', 'text/event-stream');
          reply.raw.setHeader('Cache-Control', 'no-cache');
          reply.raw.setHeader('Connection', 'keep-alive');
          reply.raw.statusCode = 200;

          const assistantContent = cachedResult.response?.choices?.[0]?.message?.content || '';
          const chunkPayload = {
            id: `chatcmpl-${Math.random().toString(36).substring(2, 9)}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'cached-model',
            choices: [{ index: 0, delta: { content: assistantContent }, finish_reason: 'stop' }],
          };

          reply.raw.write(`data: ${JSON.stringify(chunkPayload)}\n\n`);
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
          return;
        }

        const responseWithMetrics = {
          ...cachedResult.response,
          green_metrics: {
            ...greenMetrics,
            costSavedUsd,
          },
        };

        reply.code(200);
        return responseWithMetrics;
      }

      console.log(`[Semantic Cache] Cache MISS. Avaliando roteamento de modelos...`);

      // 5. Aplicar Model Cascading no Cache Miss
      const modelCascadingEnabled = process.env.MODEL_CASCADING_ENABLED !== 'false';
      let routingDecision = { model: body?.model, isCascaded: false, reason: 'Model cascading disabled.' };

      if (modelCascadingEnabled && body && Array.isArray(body.messages)) {
        routingDecision = evaluateComplexity(body.messages, body.model);
        body.model = routingDecision.model;
      }

      const greenMetrics = calculateGreenMetrics(false, routingDecision.isCascaded, userPrompt.length);
      const costSavedUsd = routingDecision.isCascaded ? 0.0015 : 0;

      // 6. Streaming com Cache MISS
      if (isStreaming) {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('X-RateLimit-Remaining', quotaCheck.remainingRPM.toString());
        reply.raw.setHeader('X-Green-Quota-Saved', 'false');
        reply.raw.setHeader('X-Green-Cache', 'MISS');
        reply.raw.setHeader('X-Green-Model-Routed', routingDecision.model);
        reply.raw.setHeader('X-Green-Cascaded', routingDecision.isCascaded.toString());
        reply.raw.setHeader('X-Green-Energy-Saved-kWh', greenMetrics.energySavedKWh.toString());
        reply.raw.setHeader('X-Green-Carbon-Saved-gCO2e', greenMetrics.carbonSavedGCO2e.toString());
        reply.raw.statusCode = 200;

        let reconstructedFullText = '';
        let fullResponseJson: any = null;

        await forwardToUpstreamStream(
          '/chat/completions',
          request.method,
          request.headers,
          body,
          (chunkStr) => {
            reply.raw.write(chunkStr);
          },
          (fullText, fullJson) => {
            reconstructedFullText = fullText;
            fullResponseJson = fullJson;
          },
          (err) => {
            console.error('[Stream Error]', err.message);
          }
        );

        globalGatewayStats.recordRequest(
          clientId,
          false,
          routingDecision.isCascaded,
          routingDecision.model,
          greenMetrics.energySavedKWh,
          greenMetrics.carbonSavedGCO2e,
          costSavedUsd,
          greenMetrics.latencySavedMs
        );

        if (semanticCacheEnabled && promptEmbedding && reconstructedFullText && fullResponseJson) {
          globalSemanticCache.set(promptEmbedding, userPrompt, fullResponseJson);
        }

        reply.raw.end();
        return;
      }

      // 7. Non-Streaming tradicional com Cache MISS
      const result = await forwardToUpstream(
        '/chat/completions',
        request.method,
        request.headers,
        body
      );

      const duration = Date.now() - startTime;

      if (semanticCacheEnabled && promptEmbedding && result.statusCode === 200 && result.data) {
        globalSemanticCache.set(promptEmbedding, userPrompt, result.data);
      }

      globalGatewayStats.recordRequest(
        clientId,
        false,
        routingDecision.isCascaded,
        routingDecision.model,
        greenMetrics.energySavedKWh,
        greenMetrics.carbonSavedGCO2e,
        costSavedUsd,
        greenMetrics.latencySavedMs
      );

      reply.header('X-RateLimit-Remaining', quotaCheck.remainingRPM.toString());
      reply.header('X-Green-Quota-Saved', 'false');
      reply.header('X-Green-Cache', 'MISS');
      reply.header('X-Green-Model-Routed', routingDecision.model);
      reply.header('X-Green-Cascaded', routingDecision.isCascaded.toString());
      reply.header('X-Green-Energy-Saved-kWh', greenMetrics.energySavedKWh.toString());
      reply.header('X-Green-Carbon-Saved-gCO2e', greenMetrics.carbonSavedGCO2e.toString());
      reply.header('X-Green-Latency-Saved-ms', greenMetrics.latencySavedMs.toString());
      reply.header('X-Gateway-Latency-Ms', duration.toString());
      reply.code(result.statusCode);

      for (const [key, value] of Object.entries(result.headers)) {
        if (!['transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) {
          reply.header(key, value);
        }
      }

      if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
        return {
          ...result.data,
          green_metrics: {
            ...greenMetrics,
            costSavedUsd,
          },
        };
      }

      return result.data;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`[Gateway Error] Falha após ${duration}ms:`, error.message);

      reply.code(502).send({
        error: {
          message: error.message || 'Erro interno no Green LLM Gateway',
          type: 'gateway_error',
          code: 502,
        },
      });
    }
  });
}
