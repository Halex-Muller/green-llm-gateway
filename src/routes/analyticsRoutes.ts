import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { globalSemanticCache } from '../services/cache.service.js';
import { globalQuotaManager } from '../services/quota.service.js';

export interface RequestRecord {
  id: string;
  timestamp: string;
  clientId: string;
  cacheHit: boolean;
  isCascaded: boolean;
  modelRouted: string;
  energySavedKWh: number;
  carbonSavedGCO2e: number;
  costSavedUsd: number;
  latencySavedMs: number;
}

class GatewayStats {
  private totalRequests: number = 0;
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private cascadedRequests: number = 0;
  private directUpstreamRequests: number = 0;
  private totalEnergySavedKWh: number = 0;
  private totalCarbonSavedGCO2e: number = 0;
  private totalCostSavedUsd: number = 0;
  private totalLatencySavedMs: number = 0;
  private recentCalls: RequestRecord[] = [];
  private maxHistorySize: number = 50;

  public recordRequest(
    clientId: string,
    cacheHit: boolean,
    isCascaded: boolean,
    modelRouted: string,
    energySaved: number,
    carbonSaved: number,
    costSaved: number,
    latencySaved: number
  ) {
    this.totalRequests++;

    if (cacheHit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
      if (isCascaded) {
        this.cascadedRequests++;
      } else {
        this.directUpstreamRequests++;
      }
    }

    this.totalEnergySavedKWh += energySaved;
    this.totalCarbonSavedGCO2e += carbonSaved;
    this.totalCostSavedUsd += costSaved;
    this.totalLatencySavedMs += latencySaved;

    const record: RequestRecord = {
      id: `req_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date().toISOString(),
      clientId,
      cacheHit,
      isCascaded,
      modelRouted,
      energySavedKWh: energySaved,
      carbonSavedGCO2e: carbonSaved,
      costSavedUsd: costSaved,
      latencySavedMs: latencySaved,
    };

    this.recentCalls.unshift(record);
    if (this.recentCalls.length > this.maxHistorySize) {
      this.recentCalls.pop();
    }
  }

  public getStats() {
    const cacheHitRatio = this.totalRequests > 0 ? (this.cacheHits / this.totalRequests) * 100 : 0;
    const clientsData = globalQuotaManager.getAllClients();

    return {
      total_requests: this.totalRequests,
      cache_hits: this.cacheHits,
      cache_misses: this.cacheMisses,
      cache_hit_ratio_percent: Number(cacheHitRatio.toFixed(2)),
      cascaded_requests: this.cascadedRequests,
      direct_upstream_requests: this.directUpstreamRequests,
      sustainability: {
        total_energy_saved_kwh: Number(this.totalEnergySavedKWh.toFixed(6)),
        total_carbon_saved_gco2e: Number(this.totalCarbonSavedGCO2e.toFixed(4)),
        total_cost_saved_usd: Number(this.totalCostSavedUsd.toFixed(4)),
        equivalent_tree_absorption_days: Number((this.totalCarbonSavedGCO2e / 21).toFixed(2)),
      },
      performance: {
        total_latency_saved_seconds: Number((this.totalLatencySavedMs / 1000).toFixed(2)),
      },
      active_cache_entries: globalSemanticCache.size(),
      clients: clientsData,
      recent_calls: this.recentCalls,
      timestamp: new Date().toISOString(),
    };
  }
}

export const globalGatewayStats = new GatewayStats();

export async function analyticsRoutes(fastify: FastifyInstance) {
  fastify.get('/v1/green/analytics', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = globalGatewayStats.getStats();
      reply.code(200);
      return {
        status: 'success',
        service: 'Green LLM Gateway - Analytics API',
        data: stats,
      };
    } catch (error: any) {
      reply.code(500).send({
        status: 'error',
        message: error.message || 'Erro ao recuperar métricas de sustentabilidade',
      });
    }
  });

  const dashboardHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Green LLM Gateway | Sustainability & Quotas Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
  <div class="max-w-7xl mx-auto px-4 py-8">
    <header class="flex flex-col md:flex-row justify-between items-center mb-8 border-b border-slate-800 pb-6">
      <div>
        <div class="flex items-center gap-3">
          <span class="text-3xl">🌱</span>
          <h1 class="text-2xl md:text-3xl font-bold tracking-tight text-emerald-400">Green LLM Gateway</h1>
        </div>
        <p class="text-slate-400 mt-1 text-sm md:text-base">Painel de Sustentabilidade, Rate Limits & Cotas por Cliente</p>
      </div>
      <div class="mt-4 md:mt-0 flex items-center gap-3">
        <span id="live-indicator" class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-950 text-emerald-400 border border-emerald-800">
          <span class="w-2 h-2 mr-2 bg-emerald-500 rounded-full animate-pulse"></span> Ao Vivo
        </span>
        <button onclick="fetchAnalytics()" class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-lg shadow-emerald-900/30 flex items-center gap-2">
          🔄 Atualizar Dados
        </button>
      </div>
    </header>

    <!-- Cards em Destaque -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div class="absolute -right-4 -bottom-4 text-6xl opacity-10">💰</div>
        <p class="text-slate-400 text-sm font-medium">Economia Financeira</p>
        <h3 id="card-cost" class="text-3xl font-bold text-emerald-400 mt-2">$0.0000</h3>
        <span class="text-xs text-slate-500 mt-1 block">Baseado em chamadas evitadas/otimizadas</span>
      </div>

      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div class="absolute -right-4 -bottom-4 text-6xl opacity-10">⚡</div>
        <p class="text-slate-400 text-sm font-medium">Energia Poupada</p>
        <h3 id="card-energy" class="text-3xl font-bold text-cyan-400 mt-2">0.0000 kWh</h3>
        <span class="text-xs text-slate-500 mt-1 block">Redução de consumo computacional</span>
      </div>

      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div class="absolute -right-4 -bottom-4 text-6xl opacity-10">🌍</div>
        <p class="text-slate-400 text-sm font-medium">Carbono Evitado</p>
        <h3 id="card-carbon" class="text-3xl font-bold text-emerald-300 mt-2">0.0000 gCO2e</h3>
        <span id="card-trees" class="text-xs text-slate-500 mt-1 block">Equivalente a 0 dias de árvore</span>
      </div>

      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div class="absolute -right-4 -bottom-4 text-6xl opacity-10">🎯</div>
        <p class="text-slate-400 text-sm font-medium">Taxa de Cache Hit</p>
        <h3 id="card-cache-ratio" class="text-3xl font-bold text-amber-400 mt-2">0.0%</h3>
        <span id="card-total-reqs" class="text-xs text-slate-500 mt-1 block">Total de 0 requisições</span>
      </div>
    </div>

    <!-- Gráfico e Tabela de Clientes -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl lg:col-span-1 flex flex-col justify-between">
        <div>
          <h2 class="text-lg font-semibold text-slate-200 mb-1">Distribuição de Tráfego</h2>
          <p class="text-slate-400 text-xs mb-4">Como as requisições estão sendo atendidas</p>
        </div>
        <div class="relative h-64 flex items-center justify-center">
          <canvas id="trafficChart"></canvas>
        </div>
        <div class="grid grid-cols-3 gap-2 mt-4 text-center text-xs">
          <div class="bg-slate-800 p-2 rounded-lg"><span class="block text-amber-400 font-bold" id="stat-hits">0</span>Cache Hit</div>
          <div class="bg-slate-800 p-2 rounded-lg"><span class="block text-emerald-400 font-bold" id="stat-cascaded">0</span>Cascading</div>
          <div class="bg-slate-800 p-2 rounded-lg"><span class="block text-cyan-400 font-bold" id="stat-upstream">0</span>Upstream</div>
        </div>
      </div>

      <!-- Tabela de Consumo por Cliente (Rate Limit & Green Quotas) -->
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl lg:col-span-2 flex flex-col">
        <h2 class="text-lg font-semibold text-slate-200 mb-1">Consumo por Cliente (API Key / Client)</h2>
        <p class="text-slate-400 text-xs mb-4">Controle de requisições, tokens diários e bônus verde por cache</p>
        <div class="overflow-x-auto flex-1 max-h-80">
          <table class="w-full text-left text-xs text-slate-300">
            <thead class="bg-slate-800/60 uppercase text-slate-400 sticky top-0">
              <tr>
                <th class="p-3">Client ID</th>
                <th class="p-3">Reqs Totais</th>
                <th class="p-3">Cache Hits (Bônus)</th>
                <th class="p-3">Tokens Usados</th>
                <th class="p-3">Cota Diária</th>
              </tr>
            </thead>
            <tbody id="clients-table-body" class="divide-y divide-slate-800">
              <tr>
                <td colspan="5" class="p-4 text-center text-slate-500">Nenhum cliente registrado ainda.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Histórico Recente -->
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl mb-8">
      <h2 class="text-lg font-semibold text-slate-200 mb-1">Histórico Recente de Requisições</h2>
      <p class="text-slate-400 text-xs mb-4">Últimas chamadas processadas pelo gateway</p>
      <div class="overflow-x-auto max-h-64">
        <table class="w-full text-left text-xs text-slate-300">
          <thead class="bg-slate-800/60 uppercase text-slate-400 sticky top-0">
            <tr>
              <th class="p-3">ID</th>
              <th class="p-3">Cliente</th>
              <th class="p-3">Tipo / Rota</th>
              <th class="p-3">Modelo</th>
              <th class="p-3">Economia kWh</th>
              <th class="p-3">Horário</th>
            </tr>
          </thead>
          <tbody id="history-table-body" class="divide-y divide-slate-800">
            <tr>
              <td colspan="6" class="p-4 text-center text-slate-500">Nenhuma requisição registrada ainda.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    let trafficChart = null;

    function initChart() {
      const ctx = document.getElementById('trafficChart').getContext('2d');
      trafficChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Cache Semântico', 'Model Cascading', 'Upstream Direto'],
          datasets: [{
            data: [0, 0, 0],
            backgroundColor: ['#f59e0b', '#10b981', '#06b6d4'],
            borderWidth: 0,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#94a3b8', font: { size: 11 } }
            }
          },
          cutout: '70%'
        }
      });
    }

    async function fetchAnalytics() {
      try {
        const res = await fetch('/v1/green/analytics');
        const json = await res.json();
        if (json.status === 'success') {
          const d = json.data;

          document.getElementById('card-cost').innerText = \`$\${d.sustainability.total_cost_saved_usd.toFixed(4)}\`;
          document.getElementById('card-energy').innerText = \`\${d.sustainability.total_energy_saved_kwh.toFixed(4)} kWh\`;
          document.getElementById('card-carbon').innerText = \`\${d.sustainability.total_carbon_saved_gco2e.toFixed(4)} gCO2e\`;
          document.getElementById('card-trees').innerText = \`Equivalente a \${d.sustainability.equivalent_tree_absorption_days} dias de árvore\`;
          document.getElementById('card-cache-ratio').innerText = \`\${d.cache_hit_ratio_percent}%\`;
          document.getElementById('card-total-reqs').innerText = \`Total de \${d.total_requests} requisições\`;

          document.getElementById('stat-hits').innerText = d.cache_hits;
          document.getElementById('stat-cascaded').innerText = d.cascaded_requests;
          document.getElementById('stat-upstream').innerText = d.direct_upstream_requests;

          if (trafficChart) {
            trafficChart.data.datasets[0].data = [d.cache_hits, d.cascaded_requests, d.direct_upstream_requests];
            trafficChart.update();
          }

          // Tabela de Clientes
          const clientsTbody = document.getElementById('clients-table-body');
          if (d.clients && d.clients.length > 0) {
            clientsTbody.innerHTML = d.clients.map(c => \`
              <tr class="hover:bg-slate-800/40">
                <td class="p-3 font-mono text-emerald-400 font-semibold">\${c.clientId}</td>
                <td class="p-3">\${c.totalRequestsCount}</td>
                <td class="p-3 text-amber-400 font-semibold">\${c.cacheHitsCount} 🌿</td>
                <td class="p-3">\${c.tokensUsedToday}</td>
                <td class="p-3 text-slate-400">\${c.tokensDailyLimit}</td>
              </tr>
            \`).join('');
          } else {
            clientsTbody.innerHTML = \`<tr><td colspan="5" class="p-4 text-center text-slate-500">Nenhum cliente registrado.</td></tr>\`;
          }

          // Tabela de Histórico
          const tbody = document.getElementById('history-table-body');
          if (d.recent_calls && d.recent_calls.length > 0) {
            tbody.innerHTML = d.recent_calls.map(call => \`
              <tr class="hover:bg-slate-800/40">
                <td class="p-3 font-mono text-slate-400">\${call.id}</td>
                <td class="p-3 font-mono text-emerald-300">\${call.clientId}</td>
                <td class="p-3">
                  \${call.cacheHit ? '<span class="px-2 py-0.5 bg-amber-950 text-amber-400 border border-amber-800 rounded font-semibold">CACHE HIT</span>' :
                     call.isCascaded ? '<span class="px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded font-semibold">CASCADED</span>' :
                     '<span class="px-2 py-0.5 bg-cyan-950 text-cyan-400 border border-cyan-800 rounded font-semibold">UPSTREAM</span>'}
                </td>
                <td class="p-3 font-mono text-slate-300">\${call.modelRouted}</td>
                <td class="p-3 text-emerald-400 font-semibold">\${call.energySavedKWh.toFixed(5)} kWh</td>
                <td class="p-3 text-slate-400">\${new Date(call.timestamp).toLocaleTimeString()}</td>
              </tr>
            \`).join('');
          } else {
            tbody.innerHTML = \`<tr><td colspan="6" class="p-4 text-center text-slate-500">Nenhuma requisição registrada ainda.</td></tr>\`;
          }
        }
      } catch (e) {
        console.error('Erro ao buscar analytics:', e);
      }
    }

    window.onload = () => {
      initChart();
      fetchAnalytics();
      setInterval(fetchAnalytics, 10000);
    };
  </script>
</body>
</html>`;

  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.type('text/html').code(200);
    return dashboardHtml;
  });

  fastify.get('/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.type('text/html').code(200);
    return dashboardHtml;
  });
}
