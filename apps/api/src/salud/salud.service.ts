import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PrismaService } from '../comun/prisma.service';

/** Respuesta de GET /api/salud del ERP: solo booleanos (200 sano, 503 si no). */
interface Salud {
  estado?: string;
  bd?: boolean;
  canarios?: boolean;
}

/**
 * Disponibilidad vista desde afuera (host A), por el mismo camino que un
 * usuario: Cloudflare -> tunel -> Traefik -> API del silo. Solo silos
 * adoptados con dominio. Un timeout cuenta como caida.
 */
@Injectable()
export class SaludService implements OnModuleInit {
  private readonly log = new Logger(SaludService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agenda: SchedulerRegistry,
  ) {}

  onModuleInit() {
    const segundos = Number(process.env.SALUD_INTERVALO_S ?? 60);
    this.agenda.addInterval('salud', setInterval(() => void this.sondearTodos(), segundos * 1000));
  }

  async sondearTodos(): Promise<void> {
    const silos = await this.prisma.silo.findMany({ where: { adoptado: true, dominio: { not: null } }, select: { slug: true, dominio: true } });
    await Promise.all(silos.map((s) => this.sondear(s.slug, s.dominio!)));
  }

  async sondear(slug: string, dominio: string): Promise<void> {
    const inicio = Date.now();
    let fila: { http: number | null; ok: boolean; bd: boolean | null; canarios: boolean | null; error: string | null };
    try {
      const r = await fetch(`https://${dominio}/api/salud`, { signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'vinculos-control/0.1' } });
      const cuerpo = (await r.json().catch(() => ({}))) as Salud;
      fila = { http: r.status, ok: r.status === 200 && cuerpo.estado === 'ok', bd: cuerpo.bd ?? null, canarios: cuerpo.canarios ?? null, error: null };
    } catch (e) {
      const error = e instanceof Error && e.name === 'TimeoutError' ? 'sin respuesta en 5 s' : 'no se pudo conectar';
      fila = { http: null, ok: false, bd: null, canarios: null, error };
    }
    await this.prisma.muestraSalud.create({ data: { slug, ...fila, latenciaMs: Date.now() - inicio } });
    if (!fila.ok) this.log.warn(`${slug}: /api/salud ${fila.error ?? `HTTP ${fila.http}`}`);
  }
}
