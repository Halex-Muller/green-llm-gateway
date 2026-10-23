export interface ClientQuota {
  clientId: string;
  requestsThisMinute: number;
  minuteResetTime: number;
  tokensUsedToday: number;
  tokensDailyLimit: number;
  cacheHitsCount: number;
  totalRequestsCount: number;
  lastRequestTime: number;
}

class QuotaManager {
  private clients: Map<string, ClientQuota> = new Map();
  private maxRequestsPerMinute: number = 30; // Limite padrão de RPM
  private defaultDailyTokenLimit: number = 50000; // Cota diária padrão de tokens

  public checkAndConsume(clientKey: string, estimatedTokens: number = 100, isCacheHit: boolean = false): { allowed: boolean; remainingRPM: number; quotaExceededMessage?: string } {
    const now = Date.now();
    const minuteDuration = 60 * 1000;

    let client = this.clients.get(clientKey);

    if (!client) {
      client = {
        clientId: clientKey,
        requestsThisMinute: 0,
        minuteResetTime: now + minuteDuration,
        tokensUsedToday: 0,
        tokensDailyLimit: this.defaultDailyTokenLimit,
        cacheHitsCount: 0,
        totalRequestsCount: 0,
        lastRequestTime: now,
      };
      this.clients.set(clientKey, client);
    }

    client.totalRequestsCount++;
    client.lastRequestTime = now;

    if (isCacheHit) {
      client.cacheHitsCount++;
      // Bônus Verde: Cache HIT não consome cota de tokens nem conta no rate limit de requisições!
      return {
        allowed: true,
        remainingRPM: Math.max(0, this.maxRequestsPerMinute - client.requestsThisMinute),
      };
    }

    // Resetar contador de minuto se expirou
    if (now > client.minuteResetTime) {
      client.requestsThisMinute = 0;
      client.minuteResetTime = now + minuteDuration;
    }

    // Verificar Rate Limit por Minuto
    if (client.requestsThisMinute >= this.maxRequestsPerMinute) {
      return {
        allowed: false,
        remainingRPM: 0,
        quotaExceededMessage: 'Rate limit excedido: limite de requisições por minuto atingido.',
      };
    }

    // Verificar Cota de Tokens Diária
    if (client.tokensUsedToday + estimatedTokens > client.tokensDailyLimit) {
      return {
        allowed: false,
        remainingRPM: Math.max(0, this.maxRequestsPerMinute - client.requestsThisMinute),
        quotaExceededMessage: 'Cota de tokens diária esgotada para esta chave de cliente.',
      };
    }

    // Consumir cota
    client.requestsThisMinute++;
    client.tokensUsedToday += estimatedTokens;

    return {
      allowed: true,
      remainingRPM: Math.max(0, this.maxRequestsPerMinute - client.requestsThisMinute),
    };
  }

  public getClientStats(clientKey: string): ClientQuota | undefined {
    return this.clients.get(clientKey);
  }

  public getAllClients(): ClientQuota[] {
    return Array.from(this.clients.values());
  }
}

export const globalQuotaManager = new QuotaManager();
