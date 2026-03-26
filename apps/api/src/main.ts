import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from apps/api/ (works when running from dist/)
config({ path: resolve(__dirname, '../.env') });

import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { getTrpcOpenApiPaths, getTrpcTags } from './trpc/trpc-openapi-docs';
import { RedisHealthService } from './database/redis-health.service';
import { FailoverIoAdapter } from './events/failover-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
}

void bootstrap();
