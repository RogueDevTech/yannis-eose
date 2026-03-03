import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from apps/api/ (works when running from dist/)
config({ path: resolve(__dirname, '../.env') });

import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { getTrpcOpenApiPaths, getTrpcTags } from './trpc/trpc-openapi-docs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security headers — helmet adds X-Content-Type-Options, X-Frame-Options,
  // Strict-Transport-Security, X-XSS-Protection, etc.
  app.use(helmet());

  app.enableCors({
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
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
}

void bootstrap();
