import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
    credentials: true,
  });

  // Swagger API documentation at /api/docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Yannis EOSE API')
    .setDescription('Enterprise Operations & Sales Engine — REST & tRPC API')
    .setVersion('1.0')
    .addCookieAuth('yannis_session')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env['PORT'] ?? 4444;
  await app.listen(port);
  console.warn(`[Yannis API] Running on http://localhost:${port}`);
  console.warn(`[Yannis API] Swagger docs at http://localhost:${port}/api/docs`);
}

void bootstrap();
