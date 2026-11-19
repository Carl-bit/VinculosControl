import { Body, ConflictException, Controller, Get, Header, HttpCode, Injectable, NotFoundException, Param, ParseIntPipe, Post, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { CANALES_DEMO, errorPrefijoDemo, LIMITES_DEMO, MODULOS_MVP, TEMAS, validarP0, type Borrador } from '@vinculos/manifest';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

import type { OperadorSesion } from '../acceso/acceso.service';
import { IpCliente, Operador, SesionGuard } from '../acceso/sesion.guard';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { guardarRevision } from '../centros/borrador';
import { PrismaService } from '../comun/prisma.service';
import { ConsolaGuard } from '../consola/consola.guard';
import { JobsService } from '../jobs/jobs.service';
import { ACTIVOS, enVentanaRespaldo } from '../jobs/pasos';
import { type CuentaDemo, descifrarClave } from './acceso';

const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const HORA = 60 * 60_000;
/** Vida de un demo (decision del usuario 2026-11-19): 1 dia; se extiende de a 24 h, hasta 7 dias desde ahora. */
export const VIDA_DEMO_MS = 24 * HORA;
const MAX_DEMO_MS = 7 * 24 * HORA;
/** Esperas manuales de un APROVISIONAR que la baja cancela (un demo a medio aprovisionar tambien vence). */
const ESPERAS_CANCELABLES = ['ESPERANDO_LLAVES', 'ESPERANDO_OPERADOR'];

/** Nueva fecha de vencimiento al extender: 24 h mas desde la fecha actual (o desde ahora si ya vencio), con tope de 7 dias. */
export function extenderVence(actual: Date | null, ahora: Date): Date {
  const base = Math.max(actual?.getTime() ?? 0, ahora.getTime());
  return new Date(Math.min(base + VIDA_DEMO_MS, ahora.getTime() + MAX_DEMO_MS));
}

class CrearDemoDto {
  @Matches(SLUG)
  @Matches(/^demo-/, { message: 'El slug de un demo empieza con demo- (ej. demo-kibou)' })
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(/^[\p{L}\p{N} .,'&()-]+$/u)
  nombre!: string;

  /** Canal (demo, beta, estable) o version fija X.Y.Z. */
  @IsOptional()
  @IsIn([...CANALES_DEMO])
  canal?: string;

  @IsOptional()
  @Matches(/^\d+\.\d+\.\d+$/)
  fija?: string;

  @IsIn([...TEMAS])
  tema!: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsIn([...MODULOS_MVP], { each: true })
  modulos!: string[];

  @Type(() => Number)
  @IsInt()
  @Min(LIMITES_DEMO.cuentas_madre[0])
  @Max(LIMITES_DEMO.cuentas_madre[1])
  cuentasMadre!: number;

  @Type(() => Number)
  @IsInt()
  @Min(LIMITES_DEMO.profesionales[0])
  @Max(LIMITES_DEMO.profesionales[1])
  profesionales!: number;

  @Type(() => Number)
  @IsInt()
  @Min(LIMITES_DEMO.pacientes[0])
  @Max(LIMITES_DEMO.pacientes[1])
  pacientes!: number;
}

/**
 * Demos a medida (R10): el operador elige cuantas cuentas madre, profesionales y
 * pacientes tendra el centro de demostracion. Se crea el centro (origen demo)
 * con un manifiesto ficticio ya aprobado y se encola APROVISIONAR: en P10 el
 * host B genera los datos (solo si el slug esta en EJECUTOR_DEMOS) y el agente
 * reporta el acceso del demo (cuentas ficticias y contrasena, cifrada aqui)
 * para compartirlo desde la consola (decision 2026-11-19). Se borra con el demo.
 */
@Injectable()
export class DemosService {
  readonly dominioBase = process.env.DOMINIO_BASE ?? 'vinculos.cl';

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly jobs: JobsService,
  ) {}

  /** Borrador del manifiesto de un demo: datos de la empresa ficticios y evidentes. */
  borrador(d: CrearDemoDto): Borrador {
    const correo = `direccion1@${d.slug}.demo.vinculos.cl`;
    return {
      centro: {
        nombre: d.nombre,
        razon_social: `${d.nombre} (demostracion)`,
        rut: '11111111-1',
        tipo_entidad: 'otra',
        admin: { nombre: 'Direccion 1 (Demo)', correo },
        responsable_datos: { nombre: 'Direccion 1 (Demo)', correo },
      },
      dominio: { tipo: 'subdominio', valor: `${d.slug}.${this.dominioBase}` },
      version: d.fija ? { fija: d.fija } : { canal: (d.canal ?? 'demo') as (typeof CANALES_DEMO)[number] },
      estilo: { tema: d.tema as (typeof TEMAS)[number] },
      modulos: d.modulos as Borrador['modulos'],
      reglas: {},
      legal: { contrato_encargo: { version: 'demo', firmado_en: new Date().toISOString().slice(0, 10) } },
      demo: { cuentas_madre: d.cuentasMadre, profesionales: d.profesionales, pacientes: d.pacientes },
    };
  }

  async crear(d: CrearDemoDto, op: OperadorSesion, ip: string | null) {
    if (d.canal && d.fija) throw new UnprocessableEntityException({ mensaje: 'Elige un canal o una version fija, no ambos' });
    const prefijo = errorPrefijoDemo(d.slug, true);
    if (prefijo) throw new UnprocessableEntityException({ mensaje: prefijo });
    const previo = await this.prisma.centro.findUnique({ where: { slug: d.slug } });
    // Un demo eliminado suelta su slug (EJECUTOR_DEMOS es una lista fija del host B: los slugs se reusan).
    if (previo?.origen === 'demo' && previo.estado === 'ELIMINADO') await this.prisma.centro.update({ where: { id: previo.id }, data: { slug: null } });
    else if (previo) throw new ConflictException({ mensaje: `El slug ${d.slug} ya es de otro centro` });
    if (await this.prisma.silo.findUnique({ where: { slug: d.slug } })) throw new ConflictException({ mensaje: `El agente ya reporta un silo erp-${d.slug}` });
    const borrador = this.borrador(d);
    const p0 = validarP0(borrador, d.slug);
    if (!p0.ok || !p0.manifiesto) throw new UnprocessableEntityException({ mensaje: 'Manifiesto del demo invalido', errores: p0.errores });
    const ahora = new Date();
    const centro = await this.prisma.$transaction(async (tx) => {
      const c = await tx.centro.create({
        data: {
          nombre: d.nombre,
          slug: d.slug,
          contactoNombre: 'Operador de Vinculos',
          contactoCorreo: op.correo,
          comuna: 'Demostracion',
          origen: 'demo',
          demoVenceEn: new Date(ahora.getTime() + VIDA_DEMO_MS),
        },
      });
      const r = await guardarRevision(tx, c.id, 3, p0.manifiesto as unknown as Prisma.InputJsonValue, op.correo);
      await tx.centro.update({ where: { id: c.id }, data: { estado: 'APROBADO', revisionAprobada: r.numero, hashAprobado: r.hash, aprobadoEn: ahora } });
      await tx.transicionCentro.create({ data: { centroId: c.id, desde: null, hacia: 'APROBADO', actor: op.correo, motivo: `demo a medida · rev ${r.numero} · sha ${r.hash.slice(0, 12)}` } });
      return c;
    });
    await this.auditoria.registrar(
      op.correo,
      'demo.creado',
      `centro:${centro.id}`,
      `${d.slug} · ${d.cuentasMadre} cuenta(s) madre, ${d.profesionales} profesional(es), ${d.pacientes} paciente(s)${ip ? ` · ${ip}` : ''}`,
    );
    const job = await this.jobs.crear('APROVISIONAR', { centroId: centro.id }, op, ip);
    return { centroId: centro.id, job };
  }

  /** Extiende el demo 24 h (tope 7 dias desde ahora). Para revisarlo despues de la reunion. */
  async extender(centroId: number, op: OperadorSesion, ip: string | null) {
    const c = await this.prisma.centro.findUnique({ where: { id: centroId } });
    if (!c || c.origen !== 'demo') throw new NotFoundException({ mensaje: 'Demo no encontrado' });
    if (c.estado === 'ELIMINADO') throw new UnprocessableEntityException({ mensaje: 'El demo ya fue eliminado' });
    const baja = await this.prisma.job.findFirst({ where: { centroId, tipo: 'ELIMINAR_DEMO', estado: { in: [...ACTIVOS] } }, select: { id: true } });
    if (baja) throw new ConflictException({ mensaje: `La baja ya esta en curso (job #${baja.id})` });
    const venceEn = extenderVence(c.demoVenceEn, new Date());
    await this.prisma.centro.update({ where: { id: centroId }, data: { demoVenceEn: venceEn } });
    await this.auditoria.registrar(op.correo, 'demo.extendido', `centro:${centroId}`, `${c.slug} · vence ${venceEn.toISOString()}${ip ? ` · ${ip}` : ''}`);
    return { venceEn };
  }

  /**
   * Baja de un demo: si el silo nunca se empezo a preparar (P2 sin correr), el
   * centro pasa directo a ELIMINADO; si no, se encola ELIMINAR_DEMO. Un
   * APROVISIONAR esperando al operador (llaves, dominio) se cancela antes; uno
   * corriendo bloquea (el vencimiento lo reintenta en la siguiente vuelta).
   */
  async darDeBaja(centroId: number, actor: string, ip: string | null, motivo: string) {
    const c = await this.prisma.centro.findUnique({ where: { id: centroId } });
    if (!c || c.origen !== 'demo') throw new NotFoundException({ mensaje: 'Demo no encontrado' });
    if (c.estado === 'ELIMINADO') throw new UnprocessableEntityException({ mensaje: 'El demo ya fue eliminado' });
    if (!c.slug) throw new UnprocessableEntityException({ mensaje: 'El demo no tiene slug' });
    const activos = await this.prisma.job.findMany({ where: { OR: [{ centroId }, { siloSlug: c.slug }], estado: { in: [...ACTIVOS] } }, select: { id: true, tipo: true, estado: true } });
    const corriendo = activos.find((j) => !(j.tipo === 'APROVISIONAR' && ESPERAS_CANCELABLES.includes(j.estado)));
    if (corriendo) throw new ConflictException({ mensaje: `Hay un job ${corriendo.tipo} en curso (#${corriendo.id}): espera a que termine` });
    for (const j of activos) await this.jobs.cancelar(j.id, { correo: actor }, ip);
    const preparado = await this.prisma.pasoJob.findFirst({ where: { codigo: 'P2', estado: { not: 'PENDIENTE' }, job: { centroId, tipo: 'APROVISIONAR' } }, select: { id: true } });
    if (!preparado) {
      await this.jobs.demoEliminado(centroId, c.slug, actor, `${motivo}; el silo no se llego a preparar en el host B`);
      return { job: null };
    }
    return { job: await this.jobs.crearEliminarDemo(centroId, c.slug, actor, ip) };
  }

  /** Cada 10 minutos: los demos vencidos se dan de baja. Un fallo queda en la auditoria y se reintenta en la siguiente vuelta. */
  @Cron('*/10 * * * *')
  async vencer() {
    if (enVentanaRespaldo(new Date())) return;
    const vencidos = await this.prisma.centro.findMany({ where: { origen: 'demo', estado: { not: 'ELIMINADO' }, demoVenceEn: { lt: new Date() } }, select: { id: true, slug: true } });
    for (const c of vencidos) {
      // Ya hay una baja en curso o una que fallo: el operador la reintenta desde el job.
      const baja = await this.prisma.job.findFirst({ where: { centroId: c.id, tipo: 'ELIMINAR_DEMO', estado: { in: [...ACTIVOS, 'FALLIDO'] } }, select: { id: true } });
      if (baja) continue;
      await this.darDeBaja(c.id, 'control', null, 'demo vencido (24 h)').catch((e: unknown) =>
        this.auditoria.registrar('control', 'demo.baja_no_encolada', `centro:${c.id}`, `${c.slug ?? '?'}: ${(e instanceof Error ? e.message : String(e)).slice(0, 250)}`),
      );
    }
  }

  /** Acceso para compartir el demo: enlace, contrasena comun y cuentas ficticias por rol. Cada lectura queda en la auditoria. */
  async acceso(centroId: number, op: OperadorSesion, ip: string | null) {
    const c = await this.prisma.centro.findUnique({ where: { id: centroId }, include: { accesoDemo: true } });
    if (!c || c.origen !== 'demo') throw new NotFoundException({ mensaje: 'Demo no encontrado' });
    if (c.estado === 'ELIMINADO' || !c.accesoDemo) throw new NotFoundException({ mensaje: 'El demo aun no tiene acceso (P10 sin terminar) o ya fue eliminado' });
    const clave = descifrarClave(process.env.CONSOLA_SECRETO ?? '', c.accesoDemo.claveCifrada);
    await this.auditoria.registrar(op.correo, 'demo.acceso_visto', `centro:${centroId}`, `${c.slug}${ip ? ` · ${ip}` : ''}`);
    return { url: c.slug ? `https://${c.slug}.${this.dominioBase}` : null, clave, cuentas: c.accesoDemo.cuentas as unknown as CuentaDemo[], creadoEn: c.accesoDemo.creadoEn, venceEn: c.demoVenceEn };
  }

  async listar() {
    const centros = await this.prisma.centro.findMany({ where: { origen: 'demo' }, orderBy: { creadoEn: 'desc' }, include: { accesoDemo: { select: { creadoEn: true } } } });
    return Promise.all(
      centros.map(async (c) => {
        const rev = c.revisionAprobada ? await this.prisma.revisionManifiesto.findUnique({ where: { centroId_numero: { centroId: c.id, numero: c.revisionAprobada } }, select: { contenido: true } }) : null;
        const m = (rev?.contenido ?? {}) as { demo?: { cuentas_madre: number; profesionales: number; pacientes: number }; dominio?: { valor?: string } };
        const [silo, ultimo, resembrado, baja] = await Promise.all([
          c.slug ? this.prisma.silo.findUnique({ where: { slug: c.slug }, select: { vistoEn: true, version: true, adoptado: true } }) : null,
          this.prisma.job.findFirst({ where: { centroId: c.id, tipo: 'APROVISIONAR' }, orderBy: { id: 'desc' }, select: { id: true, estado: true, error: true } }),
          c.slug ? this.prisma.job.findFirst({ where: { siloSlug: c.slug, tipo: 'REINICIAR_DEMO' }, orderBy: { id: 'desc' }, select: { id: true, estado: true, creadoEn: true, terminadoEn: true } }) : null,
          this.prisma.job.findFirst({ where: { centroId: c.id, tipo: 'ELIMINAR_DEMO' }, orderBy: { id: 'desc' }, select: { id: true, estado: true, error: true } }),
        ]);
        return {
          centroId: c.id,
          slug: c.slug,
          nombre: c.nombre,
          estado: c.estado,
          dominio: m.dominio?.valor ?? null,
          cantidades: m.demo ?? null,
          silo,
          aprovisionar: ultimo,
          resembrado,
          venceEn: c.demoVenceEn,
          baja,
          conAcceso: Boolean(c.accesoDemo),
        };
      }),
    );
  }
}

@Controller('consola/demos')
@UseGuards(ConsolaGuard, SesionGuard)
export class DemosController {
  constructor(private readonly demos: DemosService) {}

  @Get()
  listar() {
    return this.demos.listar();
  }

  @Post()
  @HttpCode(201)
  crear(@Body() b: CrearDemoDto, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.demos.crear(b, op, ip);
  }

  @Get(':id/acceso')
  @Header('Cache-Control', 'no-store')
  acceso(@Param('id', ParseIntPipe) id: number, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.demos.acceso(id, op, ip);
  }

  @Post(':id/extender')
  @HttpCode(200)
  extender(@Param('id', ParseIntPipe) id: number, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.demos.extender(id, op, ip);
  }

  @Post(':id/baja')
  @HttpCode(200)
  baja(@Param('id', ParseIntPipe) id: number, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.demos.darDeBaja(id, op.correo, ip, `baja pedida por ${op.correo}`);
  }
}
