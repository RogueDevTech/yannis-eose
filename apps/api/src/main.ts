import { existsSync } from 'fs';
import { config } from 'dotenv';
import dns from 'node:dns';
import { resolve } from 'path';

// Load env: repo root `.env` first (shared monorepo vars), then `apps/api/.env` overrides,
// then path relative to `dist/` / `src/` so `pnpm dev` from any cwd still picks up API keys.
const envCandidates = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'apps/api/.env'),
  resolve(__dirname, '../.env'),
];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: true });
  }
}

// Prefer IPv4 when resolving API hosts (SendGrid, etc.) — some networks break IPv6 DNS.
dns.setDefaultResultOrder('ipv4first');

import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { getTrpcOpenApiPaths, getTrpcTags } from './trpc/trpc-openapi-docs';
import { RedisHealthService } from './database/redis-health.service';
import { FailoverIoAdapter } from './events/failover-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Enable Nest's shutdown hooks so providers with OnModuleDestroy /
  // OnApplicationShutdown (DB pool, Redis client, sockets, schedulers) tear
  // down cleanly when the process receives SIGTERM/SIGINT. Without this,
  // killing the process leaves the port held in TIME_WAIT and partial work
  // mid-flight — the recurring EADDRINUSE pattern we kept hitting in dev.
  app.enableShutdownHooks();
  // The GCP dev VM sits behind Cloudflare Tunnel, so trust proxy headers for
  // accurate client IPs in rate limits / auth logging.
  const httpAdapter = app.getHttpAdapter();
  const expressApp = httpAdapter.getInstance() as { set: (key: string, value: unknown) => void };
  expressApp.set('trust proxy', true);
  const redisHealth = app.get(RedisHealthService);
  app.useWebSocketAdapter(new FailoverIoAdapter(app, redisHealth));

  // Security headers — helmet adds X-Content-Type-Options, X-Frame-Options,
  // Strict-Transport-Security, X-XSS-Protection, etc.
  app.use(helmet());

  // CORS: allow comma-separated origins (e.g. for Cloudflare tunnels: web URL + API URL)
  const corsOrigins = (process.env['CORS_ORIGIN'] ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins.length > 1 ? corsOrigins : corsOrigins[0] || 'http://localhost:5173',
    credentials: true,
  });

  // Swagger API documentation at /api/docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Yannis EOSE API')
    .setDescription(
      'Enterprise Operations & Sales Engine — REST & tRPC API. ' +
        'All tRPC procedures are documented below. Queries use GET with `input` query param (JSON). Mutations use POST with JSON body. Auth via `yannis_session` cookie.',
    )
    .setVersion('1.0')
    .addCookieAuth('yannis_session')
    .addTag('tRPC', 'All endpoints use the tRPC protocol at /trpc/{router}.{procedure}')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // Merge tRPC endpoint documentation
  const trpcPaths = getTrpcOpenApiPaths();
  document.paths = { ...(document.paths ?? {}), ...trpcPaths };
  document.tags = [...(document.tags ?? []), ...getTrpcTags()];

  SwaggerModule.setup('api/docs', app, document);

  const port = process.env['PORT'] ?? 4444;
  await app.listen(port);
  console.warn(`[Yannis API] Running on http://localhost:${port}`);
  console.warn(`[Yannis API] Swagger docs at http://localhost:${port}/api/docs`);
  if (
    process.env['NODE_ENV'] === 'production' &&
    !process.env['SESSION_COOKIE_DOMAIN']?.trim()
  ) {
    console.warn(
      '[Yannis API] SESSION_COOKIE_DOMAIN is unset — browsers will not send yannis_session to a different API host (e.g. WebSocket on api-*). Set SESSION_COOKIE_DOMAIN to your parent domain (e.g. .roguedevtech.com).',
    );
  }

  // Belt-and-suspenders: in addition to Nest's enableShutdownHooks, watch for
  // the signals ourselves so we can log a clear "shutting down" line and
  // call app.close() if Nest hasn't already started the teardown. Idempotent
  // — Nest's internal close() guard makes the second call a no-op.
  const closeOnSignal = (signal: NodeJS.Signals) => {
    console.warn(`[Yannis API] Received ${signal}, closing gracefully…`);
    app.close().catch((err) => {
      console.error(`[Yannis API] app.close() failed:`, err);
    });
  };
  process.on('SIGTERM', closeOnSignal);
  process.on('SIGINT', closeOnSignal);
}

bootstrap().catch((err: unknown) => {
  // Friendly message for the most common dev pain — a stray previous instance
  // still holding the port. Print the actionable fix instead of a 30-line
  // Node stack trace.
  const port = process.env['PORT'] ?? 4444;
  if (err && typeof err === 'object' && (err as { code?: string }).code === 'EADDRINUSE') {
    console.error(
      `[Yannis API] Port ${port} is already in use. Another API instance is running.\n` +
        `[Yannis API] Find the offender:  lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
        `[Yannis API] Kill it:            kill <pid>`,
    );
  } else {
    console.error('[Yannis API] Failed to bootstrap:', err);
  }
  // Exit non-zero so PM2 / Cloud Run / Docker restart the container instead of
  // silently leaving us with a hung process.
  process.exit(1);
});
