import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function main() {
  if ((process.env.CONSOLA_SECRETO ?? '').length < 16) throw new Error('CONSOLA_SECRETO debe tener al menos 16 caracteres');
  if ((process.env.SITIO_SECRETO ?? '').length < 16) console.warn('SITIO_SECRETO sin definir (o corto): el formulario publico queda cerrado');
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
