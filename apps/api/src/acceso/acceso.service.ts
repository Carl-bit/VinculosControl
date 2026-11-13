import { randomBytes } from 'node:crypto';

import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { hashToken } from '../agente/agente.guard';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../comun/prisma.service';
import { CorreoService } from './correo.service';
import {
  CLAVE_RELLENO,
  enmascararCorreo,
  esperaReenvio,
  evaluarCodigo,
  evaluarCredenciales,
  generarCodigo,
  generarId,
  hmacCodigo,
  igualesHex,
  LIMITES,
  normalizarCorreo,
  sesionVigente,
  venceCodigo,
  verificarClave,
} from './reglas';

export interface OperadorSesion {
  sesionId: number;
  operadorId: number;
  correo: string;
  nombre: string;
}

const MSG_CREDENCIALES = 'Correo o contrasena incorrectos.';

@Injectable()
export class AccesoService {
  private readonly secreto = process.env.CONSOLA_SECRETO ?? '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly correo: CorreoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Paso 1. Si la contrasena calza, envia el codigo y devuelve el id del desafio para el paso 2. */
  async credenciales(correoIn: string, clave: string, ip: string | null) {
    const correo = normalizarCorreo(correoIn);
    const ahora = new Date();
    const op = await this.prisma.operador.findUnique({ where: { correo } });
    // Se verifica siempre (contra un hash de relleno si no existe) para no delatar correos por el tiempo de respuesta.
    const claveOk = verificarClave(clave, op?.claveHash ?? CLAVE_RELLENO) && !!op;
    const r = evaluarCredenciales(op, claveOk, ahora);

    if (r.resultado === 'bloqueada') {
      await this.auditoria.registrar(correo, 'auth.intento_bloqueada', correo, ip);
      throw new HttpException({ mensaje: `Cuenta bloqueada por intentos fallidos. Intenta despues de las ${hora(r.bloqueadaHasta)}.`, bloqueadaHasta: r.bloqueadaHasta }, HttpStatus.LOCKED);
    }
    if (!op) {
      await this.auditoria.registrar('desconocido', 'auth.credenciales_invalidas', null, ip);
      throw new UnauthorizedException({ mensaje: MSG_CREDENCIALES });
    }
    await this.prisma.operador.update({ where: { id: op.id }, data: { fallos: r.fallos, bloqueadaHasta: r.bloqueadaHasta } });
    if (r.resultado === 'bloqueo') {
      await this.auditoria.registrar(correo, 'auth.bloqueo', correo, `${LIMITES.fallos} intentos fallidos; bloqueada ${LIMITES.bloqueoMin} min${ip ? ` · ${ip}` : ''}`);
      throw new HttpException({ mensaje: `Cuenta bloqueada ${LIMITES.bloqueoMin} minutos por intentos fallidos.`, bloqueadaHasta: r.bloqueadaHasta }, HttpStatus.LOCKED);
    }
    if (r.resultado === 'invalida') {
      await this.auditoria.registrar(correo, 'auth.credenciales_invalidas', correo, ip);
      throw new UnauthorizedException({ mensaje: MSG_CREDENCIALES });
    }

    // Un solo desafio vivo por operador: los anteriores dejan de servir.
    await this.prisma.codigoAcceso.updateMany({ where: { operadorId: op.id, usadoEn: null }, data: { usadoEn: ahora } });
    const id = generarId();
    const codigo = generarCodigo();
    await this.prisma.codigoAcceso.create({
      data: { id, operadorId: op.id, codigoHmac: hmacCodigo(this.secreto, id, codigo), enviadoEn: ahora, venceEn: venceCodigo(ahora), ip },
    });
    try {
      await this.correo.enviarCodigo(op.correo, codigo, LIMITES.codigoMin);
    } catch (e) {
      await this.prisma.codigoAcceso.delete({ where: { id } });
      throw e;
    }
    await this.auditoria.registrar(correo, 'auth.codigo_enviado', correo, ip);
    return { desafio: id, correo: enmascararCorreo(op.correo), venceMin: LIMITES.codigoMin, reenviarEnS: LIMITES.reenvioS };
  }

  /** Paso 2. Codigo correcto = sesion nueva; devuelve el token (la web lo guarda en una cookie httpOnly). */
  async verificar(desafio: string, codigo: string, ip: string | null) {
    const ahora = new Date();
    const d = await this.prisma.codigoAcceso.findUnique({ where: { id: desafio }, include: { operador: true } });
    const ok = !!d && igualesHex(d.codigoHmac, hmacCodigo(this.secreto, desafio, codigo));
    const r = evaluarCodigo(d, ok, ahora);
    const correo = d?.operador.correo ?? 'desconocido';

    if (r === 'vencido') throw new UnauthorizedException({ mensaje: 'El codigo vencio o ya se uso. Vuelve a ingresar tus credenciales.', volver: true });
    if (!d) throw new UnauthorizedException();
    if (r === 'invalido' || r === 'agotado') {
      await this.prisma.codigoAcceso.update({ where: { id: desafio }, data: { intentos: { increment: 1 } } });
      await this.auditoria.registrar(correo, r === 'agotado' ? 'auth.codigo_agotado' : 'auth.codigo_invalido', correo, ip);
      if (r === 'agotado') throw new UnauthorizedException({ mensaje: 'Demasiados intentos. Vuelve a ingresar tus credenciales.', volver: true });
      throw new UnauthorizedException({ mensaje: 'Codigo incorrecto.', restantes: LIMITES.intentosCodigo - d.intentos - 1 });
    }
    if (!d.operador.activo) throw new UnauthorizedException({ mensaje: MSG_CREDENCIALES, volver: true });

    // Un uso: si dos peticiones llegan juntas, solo una marca el codigo.
    const marcado = await this.prisma.codigoAcceso.updateMany({ where: { id: desafio, usadoEn: null }, data: { usadoEn: ahora } });
    if (marcado.count !== 1) throw new UnauthorizedException({ mensaje: 'El codigo ya se uso.', volver: true });

    const anterior = await this.prisma.sesion.findFirst({ where: { operadorId: d.operadorId }, orderBy: { creadaEn: 'desc' }, select: { creadaEn: true, ip: true } });
    const token = randomBytes(32).toString('base64url');
    await this.prisma.sesion.create({ data: { tokenHash: hashToken(token), operadorId: d.operadorId, ip } });
    await this.auditoria.registrar(correo, 'auth.sesion_iniciada', correo, ip);
    return {
      token,
      operador: { nombre: d.operador.nombre, correo: d.operador.correo },
      ip,
      inactividadMin: LIMITES.inactividadMin,
      ultimoAcceso: anterior && { en: anterior.creadaEn, ip: anterior.ip, mismaIp: !!ip && anterior.ip === ip },
    };
  }

  /** Nuevo codigo para el mismo desafio (45 s entre envios, maximo 3 reenvios). */
  async reenviar(desafio: string, ip: string | null) {
    const ahora = new Date();
    const d = await this.prisma.codigoAcceso.findUnique({ where: { id: desafio }, include: { operador: true } });
    const espera = d ? esperaReenvio(d, ahora) : null;
    if (!d || espera === null) throw new UnauthorizedException({ mensaje: 'Ya no se puede reenviar. Vuelve a ingresar tus credenciales.', volver: true });
    if (espera > 0) throw new HttpException({ mensaje: `Espera ${espera} s para reenviar.`, reenviarEnS: espera }, HttpStatus.TOO_MANY_REQUESTS);
    const codigo = generarCodigo();
    await this.correo.enviarCodigo(d.operador.correo, codigo, LIMITES.codigoMin);
    await this.prisma.codigoAcceso.update({
      where: { id: desafio },
      data: { codigoHmac: hmacCodigo(this.secreto, desafio, codigo), enviadoEn: ahora, venceEn: venceCodigo(ahora), intentos: 0, reenvios: { increment: 1 } },
    });
    await this.auditoria.registrar(d.operador.correo, 'auth.codigo_reenviado', d.operador.correo, ip);
    return { reenviarEnS: LIMITES.reenvioS, venceMin: LIMITES.codigoMin };
  }

  /** Lo usa SesionGuard en cada peticion de la consola. Renueva la actividad como mucho una vez por minuto. */
  async validarSesion(token: string): Promise<OperadorSesion | null> {
    const ahora = new Date();
    const s = await this.prisma.sesion.findUnique({ where: { tokenHash: hashToken(token) }, include: { operador: true } });
    if (!s || !s.operador.activo || !sesionVigente(s, ahora)) return null;
    if (ahora.getTime() - s.ultimaActividad.getTime() > 60_000) await this.prisma.sesion.update({ where: { id: s.id }, data: { ultimaActividad: ahora } });
    return { sesionId: s.id, operadorId: s.operadorId, correo: s.operador.correo, nombre: s.operador.nombre };
  }

  async salir(op: OperadorSesion, ip: string | null): Promise<void> {
    await this.prisma.sesion.update({ where: { id: op.sesionId }, data: { revocadaEn: new Date() } });
    await this.auditoria.registrar(op.correo, 'auth.salida', op.correo, ip);
  }

  /** Datos de la barra superior: quien esta conectado y desde cuando. */
  async yo(op: OperadorSesion) {
    const s = await this.prisma.sesion.findUniqueOrThrow({ where: { id: op.sesionId }, select: { creadaEn: true, ip: true } });
    return { nombre: op.nombre, correo: op.correo, sesion: { desde: s.creadaEn, ip: s.ip, inactividadMin: LIMITES.inactividadMin } };
  }

  /** Limpieza diaria: desafios de mas de 1 dia y sesiones terminadas hace mas de 90 dias. */
  @Cron('30 4 * * *')
  async limpiar(): Promise<void> {
    const dia = new Date(Date.now() - 86_400_000);
    const noventa = new Date(Date.now() - 90 * 86_400_000);
    await this.prisma.codigoAcceso.deleteMany({ where: { enviadoEn: { lt: dia } } });
    await this.prisma.sesion.deleteMany({ where: { ultimaActividad: { lt: noventa } } });
  }
}

const hora = (d: Date) => d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Santiago' });
