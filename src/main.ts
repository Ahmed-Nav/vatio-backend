import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { Transport } from '@nestjs/microservices';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import { getSessionCookieName } from './modules/auth/session.config';

async function bootstrap() {
  // 1. Initialize with Fastify Adapter
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  app.enableShutdownHooks();
  // Nest's adapter and the plugin currently resolve Fastify through separate
  // type instances, although they share the same runtime API.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  await app.register(fastifyCookie as any);

  // This connects NestJS to your local Mosquitto Broker
  app.connectMicroservice(
    {
      transport: Transport.MQTT,
      options: {
        url: process.env.MQTT_URL || 'mqtt://localhost:1883',
      },
    },
    {
      inheritAppConfig: true,
    },
  );

  await app.startAllMicroservices();

  // 2. Configure CORS (Restricting to your frontend domains)
  const allowedOrigins = (
    process.env.ALLOWED_ORIGINS || 'http://localhost:5173'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // 3. Set Global Prefix (Standard practice for GBI/VATIO APIs)
  app.setGlobalPrefix('api/v1');

  // 4. Global Validation (Ensures incoming data matches your future DTOs)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // 5. Global Exception Filter (Standard error envelope: { code, message, timestamp })
  app.useGlobalFilters(new HttpExceptionFilter());

  // 6. Swagger / OpenAPI Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Vatio IoT API')
    .setDescription('Backend API for the Vatio IoT platform')
    .setVersion('2.0')
    .addCookieAuth(getSessionCookieName())
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0'); // 0.0.0.0 allows access within your local network

  Logger.log(
    `🚀 VATIO Infrastructure is running on: http://localhost:${port}/api/v1`,
  );
  Logger.log(`📚 Swagger docs available at: http://localhost:${port}/api/docs`);
}
void bootstrap();
