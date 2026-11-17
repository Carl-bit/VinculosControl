import { Body, ConflictException, Controller, Get, HttpCode, Injectable, Post, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CANALES_DEMO, LIMITES_DEMO, MODULOS_MVP, TEMAS, validarP0, type Borrador } from '@vinculos/manifest';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

import type { OperadorSesion } from '../acceso/acceso.service';
import { IpCliente, Operador, SesionGuard } from '../acceso/sesion.guard';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { guardarRevision } from '../centros/borrador';
import { PrismaService } from '../comun/prisma.service';
import { ConsolaGuard } from '../consola/consola.guard';
import { JobsService } from '../jobs/jobs.service';

const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

class CrearDemoDto {
  @Matches(SLUG)
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
 * host B genera los datos (solo si el slug esta en EJECUTOR_DEMOS) y guarda
 * correos y contrasena alla; aqui llegan solo conteos.
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
    if (await this.prisma.centro.findUnique({ where: { slug: d.slug } })) throw new ConflictException({ mensaje: `El slug ${d.slug} ya es de otro centro` });
    if (await this.prisma.silo.findUnique({ where: { slug: d.slug } })) throw new ConflictException({ mensaje: `El agente ya reporta un silo erp-${d.slug}` });
    const borrador = this.borrador(d);
    const p0 = validarP0(borrador, d.slug);
    if (!p0.ok || !p0.manifiesto) throw new UnprocessableEntityException({ mensaje: 'Manifiesto del demo invalido', errores: p0.errores });
    const ahora = new Date();
    const centro = await this.prisma.$transaction(async (tx) => {
      const c = await tx.centro.create({
        data: { nombre: d.nombre, slug: d.slug, contactoNombre: 'Operador de Vinculos', contactoCorreo: op.correo, comuna: 'Demostracion', origen: 'demo' },
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

  async listar() {
    const centros = await this.prisma.centro.findMany({ where: { origen: 'demo' }, orderBy: { creadoEn: 'desc' } });
    return Promise.all(
      centros.map(async (c) => {
        const rev = c.revisionAprobada ? await this.prisma.revisionManifiesto.findUnique({ where: { centroId_numero: { centroId: c.id, numero: c.revisionAprobada } }, select: { contenido: true } }) : null;
        const m = (rev?.contenido ?? {}) as { demo?: { cuentas_madre: number; profesionales: number; pacientes: number }; dominio?: { valor?: string } };
        const [silo, ultimo, resembrado] = await Promise.all([
          c.slug ? this.prisma.silo.findUnique({ where: { slug: c.slug }, select: { vistoEn: true, version: true, adoptado: true } }) : null,
          this.prisma.job.findFirst({ where: { centroId: c.id, tipo: 'APROVISIONAR' }, orderBy: { id: 'desc' }, select: { id: true, estado: true, error: true } }),
          c.slug ? this.prisma.job.findFirst({ where: { siloSlug: c.slug, tipo: 'REINICIAR_DEMO' }, orderBy: { id: 'desc' }, select: { id: true, estado: true, creadoEn: true, terminadoEn: true } }) : null,
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
}
