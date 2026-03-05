import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { Transport } from '@nestjs/microservices';

async function bootstrap() {
  // 1. Initialize with Fastify Adapter
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }) // Fastify's built-in logger
  );

  // This connects NestJS to your local Mosquitto Broker
  app.connectMicroservice({
    transport: Transport.MQTT,
    options: {
      url: process.env.MQTT_URL || 'mqtt://localhost:1883',
    },
  });

  await app.startAllMicroservices();

  // 2. Configure CORS (Restricting to your frontend domains)
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*', // Pull from .env
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // 3. Set Global Prefix (Standard practice for GBI/VATIO APIs) [cite: 3]
  app.setGlobalPrefix('api/v1');

  // 4. Global Validation (Ensures incoming data matches your future DTOs)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0'); // 0.0.0.0 allows access within your local network

  Logger.log(`🚀 VATIO Infrastructure is running on: http://localhost:${port}/api/v1`);
}
bootstrap();