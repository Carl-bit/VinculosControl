import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Correo de la consola por SMTP: Mailpit en local, la interfaz SMTP de SES en
 * produccion (con su configuration set propio en SES_CONFIGURATION_SET).
 * Solo manda el codigo de acceso; nunca datos de silos ni de pacientes.
 */
@Injectable()
export class CorreoService {
  private readonly log = new Logger(CorreoService.name);
  private readonly remitente = process.env.CORREO_REMITENTE ?? '';
  private readonly transporte: Transporter | null;

  constructor() {
    const host = process.env.SMTP_HOST;
    const puerto = Number(process.env.SMTP_PUERTO ?? 1025);
    const usuario = process.env.SMTP_USUARIO;
    this.transporte = host
      ? nodemailer.createTransport({
          host,
          port: puerto,
          secure: puerto === 465,
          // Con credenciales (SES) se exige STARTTLS; Mailpit local va sin TLS ni usuario.
          requireTLS: !!usuario && puerto !== 465,
          auth: usuario ? { user: usuario, pass: process.env.SMTP_CLAVE ?? '' } : undefined,
        })
      : null;
    if (!this.transporte) this.log.warn('SMTP_HOST sin definir: el login de la consola no podra enviar codigos');
  }

  async enviarCodigo(para: string, codigo: string, minutos: number): Promise<void> {
    await this.enviar(para, `Codigo de acceso a vinculos-control: ${codigo}`, [
      `Tu codigo de acceso a la consola es ${codigo}.`,
      `Vence en ${minutos} minutos y sirve una sola vez.`,
      '',
      'Si no intentaste entrar, ignora este correo y cambia tu contrasena: alguien la conoce.',
    ]);
  }

  /** Enlace privado de fase 2 al contacto del centro. El enlace es la unica llave. */
  async enviarEnlaceFase2(para: string, centro: string, url: string, dias: number): Promise<void> {
    await this.enviar(para, `Vinculos: completa los datos de ${centro}`, [
      'Hola,',
      '',
      `Gracias por la reunion. Para preparar la plataforma de ${centro} necesitamos algunos datos formales:`,
      'razon social, RUT, responsables, dominio y modulos.',
      '',
      url,
      '',
      `El enlace es personal y vence en ${dias} dias. Puedes guardar y volver cuantas veces quieras.`,
      'No incluyas datos de pacientes.',
    ]);
  }

  /**
   * Aviso al operador: llego una solicitud por el sitio publico. Solo el nombre
   * del centro, tamano y modulos de interes; el detalle se ve en la consola.
   */
  async avisarSolicitud(para: string, centro: string, tamano: string | null, modulos: string[]): Promise<void> {
    await this.enviar(para, `vinculos-control: nueva solicitud de ${centro}`, [
      `Llego una solicitud de ${centro} por el sitio publico.`,
      '',
      `Tamano del equipo: ${tamano ?? 'sin indicar'}`,
      `Modulos de interes: ${modulos.length ? modulos.join(', ') : 'sin indicar'}`,
      '',
      'Revisala en la consola: Solicitudes.',
    ]);
  }

  /**
   * Copia del acta de eliminacion al responsable de datos del centro (S7).
   * Solo metadatos: que se borro, cuando, quien y el hash del acta.
   */
  async enviarActaEliminacion(para: string, a: { centro: string; silo: string; fecha: string; items: string[]; exporteHuella: string | null; actaRecepcion: string | null; nota: string | null; hash: string }): Promise<void> {
    await this.enviar(para, `Vinculos: acta de eliminacion de ${a.centro}`, [
      `Acta de eliminacion de los datos de ${a.centro} (instancia ${a.silo}).`,
      '',
      `Eliminado de produccion y respaldos el dia ${a.fecha}.`,
      '',
      'Se realizo:',
      ...a.items.map((i) => `- ${i}`),
      '',
      `Exporte entregado (huella SHA-256): ${a.exporteHuella ?? '-'}`,
      `Acta de recepcion (hash): ${a.actaRecepcion ?? '-'}`,
      ...(a.nota ? [`Nota: ${a.nota}`] : []),
      '',
      `Hash de esta acta: ${a.hash}`,
      '',
      'Vinculos actuo como encargado del tratamiento. La conservacion de las fichas (15 anos) queda a cargo del centro con el exporte entregado.',
    ]);
  }

  /** Copia del acta de reversion de una salida (el servicio continua). Solo metadatos. */
  async enviarActaReversion(para: string, a: { centro: string; silo: string; texto: string; fecha: string; hash: string }): Promise<void> {
    await this.enviar(para, `Vinculos: se revirtio la salida de ${a.centro}`, [
      `${a.texto}.`,
      '',
      `Instancia: ${a.silo}. Fecha: ${a.fecha}.`,
      'La plataforma sigue disponible con los mismos datos. Si no pediste revertir la salida, responde este correo.',
      '',
      `Hash de esta acta: ${a.hash}`,
    ]);
  }

  /** Prueba de la configuracion de correo (vista Configuracion). */
  async enviarPrueba(para: string): Promise<void> {
    await this.enviar(para, 'vinculos-control: correo de prueba', ['Si lees esto, el correo de la consola funciona.']);
  }

  private async enviar(para: string, asunto: string, lineas: string[]): Promise<void> {
    if (!this.transporte || !this.remitente) throw new ServiceUnavailableException('El correo de la consola no esta configurado');
    const set = process.env.SES_CONFIGURATION_SET;
    try {
      await this.transporte.sendMail({
        from: this.remitente,
        to: para,
        subject: asunto,
        text: lineas.join('\n'),
        headers: set ? { 'X-SES-CONFIGURATION-SET': set } : undefined,
      });
    } catch (e) {
      this.log.error(`no se pudo enviar el correo: ${e instanceof Error ? e.message : String(e)}`);
      throw new ServiceUnavailableException('No se pudo enviar el correo. Intenta de nuevo.');
    }
  }
}
