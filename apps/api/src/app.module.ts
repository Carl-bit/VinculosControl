import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AccesoController } from './acceso/acceso.controller';
import { AccesoService } from './acceso/acceso.service';
import { CorreoService } from './acceso/correo.service';
import { SesionGuard } from './acceso/sesion.guard';
import { AgenteController } from './agente/agente.controller';
import { AgenteGuard } from './agente/agente.guard';
import { AlertasService } from './alertas/alertas.service';
import { AuditoriaController } from './auditoria/auditoria.controller';
import { AuditoriaService } from './auditoria/auditoria.service';
import { CentrosController } from './centros/centros.controller';
import { CentrosService } from './centros/centros.service';
import { Fase2Service } from './centros/fase2.service';
import { PrismaService } from './comun/prisma.service';
import { ConfiguracionController } from './configuracion/configuracion.controller';
import { OperacionController } from './incidentes/operacion.controller';
import { OperacionService } from './incidentes/operacion.service';
import { JobsAgenteController, JobsConsolaController } from './jobs/jobs.controller';
import { JobsService } from './jobs/jobs.service';
import { ConsolaController } from './consola/consola.controller';
import { PublicoController, SitioGuard } from './publico/publico.controller';
import { SalidasController } from './salidas/salidas.controller';
import { SalidasCierre } from './salidas/cierre.service';
import { SalidasService } from './salidas/salidas.service';
import { SaludService } from './salud/salud.service';
import { SolicitudesAgenteController, SolicitudesConsolaController } from './solicitudes/solicitudes.controller';
import { SolicitudesService } from './solicitudes/solicitudes.service';

/** Monitoreo, acceso de la consola, auditoria, centros (fase 1 publica + pipeline comercial), cola de jobs, solicitudes de modulos (tarea 31) y salidas. */
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AgenteController, ConsolaController, AccesoController, AuditoriaController, CentrosController, PublicoController, JobsConsolaController, JobsAgenteController, OperacionController, ConfiguracionController, SolicitudesAgenteController, SolicitudesConsolaController, SalidasController],
  providers: [PrismaService, AgenteGuard, AlertasService, SaludService, AuditoriaService, CorreoService, AccesoService, SesionGuard, CentrosService, Fase2Service, SitioGuard, JobsService, OperacionService, SolicitudesService, SalidasService, SalidasCierre],
})
export class AppModule {}
