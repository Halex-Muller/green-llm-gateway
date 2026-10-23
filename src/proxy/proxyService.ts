import { request } from 'undici';
import { ENV } from '../config/env.js';

export async function forwardToUpstream(path: string, method: string, headers: any, body: any) {
  const targetUrl = `${ENV.UPSTREAM_API_URL}${path}`;

  // Remove cabeçalhos que podem causar conflito no proxy (ex: host, content-length)
  const cleanHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (['host', 'connection', 'content-length', 'content-encoding'].includes(key.toLowerCase())) {
      continue;
    }
    if (typeof value === 'string') {
      cleanHeaders[key] = value;
    }
  }

  // Se houver chave configurada no .env e o cliente não enviou Authorization, usamos a do .env
  if (!cleanHeaders['authorization'] && ENV.UPSTREAM_API_KEY) {
    cleanHeaders['authorization'] = `Bearer ${ENV.UPSTREAM_API_KEY}`;
  }

  try {
    const response = await request(targetUrl, {
      method: method as any,
      headers: cleanHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(response.headers)) {
      if (value) {
        responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
      }
    }

    const responseData = await response.body.json();

    return {
      statusCode: response.statusCode,
      headers: responseHeaders,
      data: responseData,
    };
  } catch (error: any) {
    console.error('[Proxy Error] Falha ao comunicar com o upstream:', error.message);
    throw new Error(`Erro no proxy upstream: ${error.message}`);
  }
}
