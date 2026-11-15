import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function main() {
  if ((process.env.CONSOLA_SECRETO ?? '').length < 16) throw new Error('CONSOLA_SECRETO debe tener al menos 16 caracteres');
  if ((process.env.LANDING_SECRETO ?? '').length < 16) console.warn('LANDING_SECRETO sin definir (o corto): la landing (solicitudes y fase 2) queda cerrada');
  const app = await NestFactory.create(AppModule);
  // whitelist + forbid: el agente no puede colar campos fuera del contrato (nada clinico ni de log).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0');
}

void main();
