/**
 * Variables de entorno de los services, antes de importarlos (CONSOLA_SECRETO
 * se lee al construir AccesoService). DATABASE_URL la fija el globalSetup.
 * Sin SMTP: el correo se reemplaza por CorreoFalso.
 */
process.env.CONSOLA_SECRETO = 'secreto-de-prueba-de-integracion';
delete process.env.SMTP_HOST;
