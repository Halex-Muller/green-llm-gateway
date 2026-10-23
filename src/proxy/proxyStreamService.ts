import { request } from 'undici';
import { ENV } from '../config/env.js';

export async function forwardToUpstreamStream(
  path: string,
  method: string,
  headers: any,
  body: any,
  onChunk: (chunkString: string) => void,
  onComplete: (fullText: string, fullResponseJson: any) => void,
  onError: (error: Error) => void
) {
  const targetUrl = `${ENV.UPSTREAM_API_URL}${path}`;

  const cleanHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (['host', 'connection', 'content-length', 'content-encoding'].includes(key.toLowerCase())) {
      continue;
    }
    if (typeof value === 'string') {
      cleanHeaders[key] = value;
    }
  }

  if (!cleanHeaders['authorization'] && ENV.UPSTREAM_API_KEY) {
    cleanHeaders['authorization'] = `Bearer ${ENV.UPSTREAM_API_KEY}`;
  }

  try {
    const response = await request(targetUrl, {
      method: method as any,
      headers: cleanHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.statusCode !== 200) {
      const errData = await response.body.json();
      throw new Error(`Erro upstream streaming (${response.statusCode}): ${JSON.stringify(errData)}`);
    }

    let accumulatedText = '';
    const chunks: any[] = [];

    const bodyStream = response.body as any;
    for await (const chunk of bodyStream) {
      const decoded = chunk.toString('utf-8');
      onChunk(decoded);

      // Tentar extrair o conteúdo para reconstrução da resposta completa (para cache e analytics)
      const lines = decoded.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const json = JSON.parse(line.substring(6));
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              accumulatedText += delta;
            }
            chunks.push(json);
          } catch (e) {
            // Ignorar linhas parciais ou inválidas de SSE
          }
        }
      }
    }

    // Construir objeto de resposta padrão OpenAI compatível com o cache
    const fullResponseJson = {
      id: `chatcmpl-${Math.random().toString(36).substring(2, 9)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model || 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: accumulatedText,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: accumulatedText.length / 4,
        total_tokens: 10 + accumulatedText.length / 4,
      },
    };

    onComplete(accumulatedText, fullResponseJson);
  } catch (error: any) {
    console.error('[Proxy Stream Error]:', error.message);
    onError(error);
  }
}
