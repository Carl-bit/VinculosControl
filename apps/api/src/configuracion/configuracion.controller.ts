import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UnauthorizedException, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { IsString, Length } from 'class-validator';

import type { OperadorSesion } from '../acceso/acceso.service';
import { CorreoService } from '../acceso/correo.service';
import { hashClave, LIMITES, sesionVigente, verificarClave } from '../acceso/reglas';
import { IpCliente, Operador, SesionGuard } from '../acceso/sesion.guard';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../comun/prisma.service';
import { ConsolaGuard } from '../consola/consola.guard';

class CambioClaveDto {
  @IsString()
  @Length(1, 200)
  actual: string;

  @IsString()
  @Length(LIMITES.claveMin, 200)
  nueva: string;
}

/**
 * Vista Configuracion: parametros del plano de control (solo lectura; viven en
 * el codigo y en el .env), operadores y sesiones (revocar), y cambio de la
 * propia contrasena. Pendiente de la fase 1: hoy esto ya no exige el CLI.
 */
@Controller('consola/config')
@UseGuards(ConsolaGuard, SesionGuard)
export class ConfiguracionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly correo: CorreoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get()
  async ver(@Operador() op: OperadorSesion) {
    const ahora = new Date();
    const [operadores, sesiones] = await Promise.all([
      this.prisma.operador.findMany({ orderBy: { creadoEn: 'asc' }, select: { id: true, correo: true, nombre: true, activo: true, bloqueadaHasta: true, creadoEn: true } }),
      this.prisma.sesion.findMany({
        where: { revocadaEn: null, ultimaActividad: { gt: new Date(ahora.getTime() - LIMITES.inactividadMin * 60_000) } },
        orderBy: { ultimaActividad: 'desc' },
        include: { operador: { select: { correo: true } } },
      }),
    ]);
    const smtp = process.env.SMTP_HOST ?? '';
    return {
      plazos: [
        { k: 'Gracia en salida', v: '30 dias' },
        { k: 'Enlace de fase 2', v: '7 dias' },
        { k: 'Invitacion del admin inicial', v: '72 h (R5)' },
        { k: 'Respaldo diario', v: '02:00 Chile (ventana sin cambios 01:45 a 02:30)' },
        { k: 'Autorizacion de soporte', v: '1 a 72 h (la da el ADMIN)' },
      ],
      seguridad: [
        { k: 'Verificacion en dos pasos', v: `codigo por correo, ${LIMITES.codigoMin} min, en cada inicio` },
        { k: 'Bloqueo', v: `${LIMITES.fallos} intentos, ${LIMITES.bloqueoMin} min` },
        { k: 'Sesion inactiva', v: `${LIMITES.inactividadMin} min (maximo ${LIMITES.sesionMaxH} h)` },
        { k: 'Host', v: 'A (separado de los silos)' },
      ],
      correo: [
        { k: 'Servidor', v: smtp ? (/mailpit|127\.0\.0\.1|localhost/.test(smtp) ? 'Mailpit (local)' : `SMTP ${smtp}`) : 'sin configurar' },
        { k: 'Remitente', v: process.env.CORREO_REMITENTE ?? '-' },
        { k: 'Configuration set (SES)', v: process.env.SES_CONFIGURATION_SET || '-' },
      ],
      operadores: operadores.map((o) => ({ ...o, bloqueada: !!o.bloqueadaHasta && o.bloqueadaHasta > ahora })),
      sesiones: sesiones
        .filter((s) => sesionVigente(s, ahora))
        .map((s) => ({ id: s.id, operador: s.operador.correo, desde: s.creadaEn, ultimaActividad: s.ultimaActividad, ip: s.ip, actual: s.id === op.sesionId })),
    };
  }

  @Post('sesiones/:id/revocar')
  @HttpCode(204)
  async revocar(@Param('id', ParseIntPipe) id: number, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    const s = await this.prisma.sesion.findUnique({ where: { id }, include: { operador: { select: { correo: true } } } });
    if (!s || s.revocadaEn) return;
    await this.prisma.sesion.update({ where: { id }, data: { revocadaEn: new Date() } });
    await this.auditoria.registrar(op.correo, 'auth.sesion_revocada', s.operador.correo, [`sesion ${id}`, ip].filter(Boolean).join(' · '));
  }

  /** Cambia la propia contrasena; cierra las demas sesiones del operador. */
  @Post('clave')
  @HttpCode(204)
  async clave(@Body() b: CambioClaveDto, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    const o = await this.prisma.operador.findUniqueOrThrow({ where: { id: op.operadorId } });
    if (!verificarClave(b.actual, o.claveHash)) {
      await this.auditoria.registrar(op.correo, 'auth.cambio_clave_rechazado', op.correo, ip);
      throw new UnauthorizedException({ mensaje: 'La contrasena actual no coincide' });
    }
    if (b.nueva === b.actual) throw new UnprocessableEntityException({ mensaje: 'La nueva contrasena debe ser distinta' });
    await this.prisma.$transaction([
      this.prisma.operador.update({ where: { id: o.id }, data: { claveHash: hashClave(b.nueva) } }),
      this.prisma.sesion.updateMany({ where: { operadorId: o.id, revocadaEn: null, id: { not: op.sesionId } }, data: { revocadaEn: new Date() } }),
    ]);
    await this.auditoria.registrar(op.correo, 'auth.clave_cambiada', op.correo, ip);
  }

  /** Correo de prueba al propio operador (verifica SMTP / SES). */
  @Post('correo-prueba')
  @HttpCode(204)
  async correoPrueba(@Operador() op: OperadorSesion) {
    await this.correo.enviarPrueba(op.correo);
    await this.auditoria.registrar(op.correo, 'operador.correo_prueba', op.correo);
  }
}
