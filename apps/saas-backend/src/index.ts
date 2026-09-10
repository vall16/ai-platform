// SaaS backend entry point.

import { loadConfig } from './config.js';
import { buildApp } from './app.js';

async function main() {
  const config = loadConfig();
  const { app, ctx } = await buildApp(config);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    await ctx.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`SaaS backend listening on ${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
