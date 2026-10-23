import Fastify from 'fastify';
import { ENV } from './config/env.js';
import { chatRoutes } from './routes/chatRoutes.js';
import { analyticsRoutes } from './routes/analyticsRoutes.js';

const fastify = Fastify({
  logger: true,
});

// Registrar rotas
fastify.register(chatRoutes);
fastify.register(analyticsRoutes);

async function start() {
  try {
    await fastify.listen({ port: ENV.PORT, host: ENV.HOST });
    console.log(`\n🌱 Green LLM Gateway rodando com sucesso!`);
    console.log(`📡 Endpoints disponíveis:`);
    console.log(`   - POST http://localhost:${ENV.PORT}/v1/chat/completions`);
    console.log(`   - GET  http://localhost:${ENV.PORT}/v1/green/analytics`);
    console.log(`   - GET  http://localhost:${ENV.PORT}/health\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
