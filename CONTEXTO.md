# Vinculos - Plano de control: contexto completo

Documento de referencia para construir `vinculos-control`, el proyecto que presenta, vende, aprovisiona, actualiza y da de baja los centros (silos) de Vinculos. Es adyacente al ERP (`vinculos`) y respeta sus reglas de negocio.

Estado del producto: version 0.1.0 en el `package.json` del ERP (aun no hay 1.0.0; el primer tag del registro fija la version real).

Alineado con el ERP el 2026-11-07. El estado real del ERP (reglas, parametros, despliegue manual, requisitos pendientes alli) esta en `ERP_REGLAS_Y_DESPLIEGUE.md`. Si este documento y el ERP chocan, manda el ERP.

---

## 0. Resumen en una pagina

- **Silos:** cada centro vive en su propio stack `erp-<slug>` (servicios `db` con su propio Postgres, `migrate`, `backend`, `frontend`), detras del Traefik del host. En pruebas varios silos comparten el host B; en Lightsail el plan es 1 GB / 1 vCPU con un silo por host. Es multi-tenant de infraestructura, pero logicamente single-tenant.
- **Una sola imagen:** todos los silos corren las mismas imagenes `vinculos-api:<version>` y `vinculos-web:<version>`. Nada se programa para un cliente especifico. Requisito en el ERP: hoy el compose construye por silo y el front hornea el nombre del centro (`NEXT_PUBLIC_CENTRO_NOMBRE`); debe leerlo en runtime.
- **Manifiesto declarativo:** cada centro se describe en un manifiesto (YAML/JSON validado por schema) con datos del centro, estilo, modulos, reglas parametrizables, canal de version. El silo se construye y reconfigura desde ese manifiesto.
- **Plano de control:** app aparte (este proyecto) con:
  1. Sitio publico de Vinculos (landing por bloques + demo + solicitud).
  2. Consola del proveedor (solo Charlie): solicitudes, manifiestos, silos, modulos, versiones, salidas.
  3. Worker de aprovisionamiento que ejecuta los trabajos.
- **Despliegue por canales:** releases versionados que bajan en cascada (demo -> beta -> estable), con silos que pueden fijarse a una version.

Aporte para la tesis: **plano de control + silos + manifiesto declarativo + despliegue por canales.**

---

## 1. Arquitectura

```
HOST A: PLANO DE CONTROL (vinculos-control)       vinculos.cl
|  web : landing por bloques, demo, solicitud, /consola
|  api : solicitudes, centros, manifiestos, releases, jobs, salidas, monitoreo
|  db  : postgres "control" (SIN datos clinicos, nunca)
|
|        ^  el agente consulta jobs y reporta resultados
|        |  (solo conexiones salientes desde el host B, HTTPS + token del agente)
|
HOST B: SILOS (cloudflared + Traefik + registry + agente)
|- cloudflared   : tunel de entrada; el host no abre puertos
|- traefik       : enruta por labels (Host + /api), TLS 1.2+, compress solo en /api
|- registry      : registro privado de imagenes (registry:2 o Zot)
|- agente        : toma jobs, ejecuta pasos con Docker local, reporta logs y metricas
|- demo.vinculos.cl  -> stack erp-demo  (vinculos-api/web:0.1.0 + db propia)
|- prueba.vinculos.cl -> stack erp-centro-prueba (0.1.0)
'- otro.cl (dominio propio) -> stack erp-otro (0.1.0, fijado)
```

Decision: **el plano de control va en un host separado desde el inicio.** Si se compromete la consola, no se compromete el Docker de los silos. El costo de mantener el agente y un host extra se asume como costo de seguridad.

Reglas de la arquitectura:
- El plano de control **nunca** guarda ni lee datos clinicos. Solo metadatos (centro, version, modulos, estado, conteos).
- Cada silo tiene su propio Postgres (contenedor `db`, red `interna` sin salida al proxy), sus roles (`vinculos_owner` solo para migrar y mantencion, `app_user` para la API con RLS, `soporte_vinculos` NOLOGIN), sus propios secretos (JWT, KEK, `recuperacion.pub`, `respaldo.key`) y sus volumenes (`db_data`, `exportaciones`).
- **Modelo pull:** el plano de control no tiene acceso al Docker del host de silos ni puertos abiertos hacia el. El agente del host B pide trabajos al plano de control (conexion saliente), los ejecuta localmente y devuelve el resultado de cada paso.
- El agente valida cada job contra una lista cerrada de acciones (aprovisionar, reconfigurar, actualizar, exportar, eliminar, reiniciar_demo). No ejecuta comandos arbitrarios recibidos del plano de control.
- La comunicacion agente -> silo usa el endpoint interno `/api/internal/*` del silo, autenticado con un token por silo y solo dentro de la red Docker del host B. **No existe aun en el ERP**: se construye alli como modulo `interno` que llama funciones SECURITY DEFINER (aplicar revision del manifiesto, invitar admin inicial, publicar politicas, notas de version, estado de exportaciones). Mientras no exista, esos pasos se hacen a mano como dueno en el contenedor `migrate` (`ERP_REGLAS_Y_DESPLIEGUE.md`, seccion 5).
- El agente nunca entra al silo con una cuenta de usuario: el ERP tiene sesion unica y cortaria la sesion de esa persona.
- El agente usa Docker a traves de `docker-socket-proxy`, que limita los endpoints permitidos.

### Registro de imagenes
- Registro privado en el host B (`registry:2` o Zot) detras de Traefik, con TLS y usuario. Bitbucket Pipelines construye y hace push.
- Mismas reglas para cuando se migre a AWS ECR: tags inmutables (`0.1.0` nunca se republica), cada silo registra el digest `sha256:...` ademas del tag.
- La consola lista los releases leyendo la API del registro (`/v2/vinculos/tags/list`; con ECR, su API equivalente) a traves del agente.

### Monitoreo
| Que | Como | Donde |
|---|---|---|
| Disponibilidad de cada silo | El plano de control consulta `https://<dominio>/api/salud` (`{ estado, bd, canarios }`, 200 o 503; canarios = la KEK descifra) | Host A |
| CPU, RAM y disco por silo | cAdvisor (o `docker stats` leido por el agente) -> el agente reporta cada minuto. Limites: db 256M, backend 256M, frontend 256M | Host B -> A |
| Alertas del host | `salud.sh` del ERP por cron cada 5 min: salud, disco sobre 80 % y 5xx sostenidos; el agente puede leer su salida | Host B -> A |
| Latencia por ruta | `p95.sh` del ERP (p50/p95/max desde los logs de pino, rutas sin ids ni query) | Host B -> A |
| Consultas de BD | `pg_stat_statements` en cada silo; solo el operador lo consulta y solo agregados | Host B |
| Logs | Dozzle en la fase inicial (Loki + Promtail despues). Los logs del ERP no llevan datos clinicos ni tokens; aun asi no salen del host B | Host B |
| Respaldos | Resultado del cron de `respaldar.sh` (fecha, tamano, sha256) y de la prueba mensual | Host B -> A |
| Resultado de jobs | El agente envia el log de cada paso | Host B -> A |
| Agente vivo | Latido cada 30 s; si falta mas de 2 minutos, alerta en la consola | Host A |

Las alertas internas del silo (accesos anomalos, login fallido repetido, canario fallido) son del ADMIN del centro; al plano de control solo llega el canario via `/api/salud`.

---

## 2. Ciclo de vida de un centro (maquina de estados)

```
SOLICITUD -> CONTACTADO -> REUNION -> DATOS_COMPLETOS -> APROBADO
   -> APROVISIONANDO -> ACTIVO <-> SUSPENDIDO
   -> EN_SALIDA -> EXPORTADO -> GRACIA -> ELIMINADO
   (DESCARTADO desde cualquier estado previo a APROBADO)
   (EN_SALIDA, EXPORTADO o GRACIA -> estado previo: reversion de la salida, hasta antes de eliminar)
```

| Estado | Que significa | Quien lo mueve |
|---|---|---|
| SOLICITUD | Llego el formulario del sitio (manifiesto fase 1) | Sistema |
| CONTACTADO / REUNION | Conversacion comercial y levantamiento | Proveedor |
| DATOS_COMPLETOS | El centro entrego los datos formales (manifiesto fase 2) | Centro via enlace seguro |
| APROBADO | Proveedor revisa y aprueba el manifiesto completo y el contrato | Proveedor |
| APROVISIONANDO | Corre el job de aprovisionamiento (seccion 5) | Worker |
| ACTIVO | Silo funcionando | Sistema |
| ACTIVO_SIN_DOMINIO | Silo sano pero el dominio o su certificado aun no responden (P8) | Sistema |
| SUSPENDIDO | Silo en solo lectura o apagado (impago, solicitud) | Proveedor |
| EN_SALIDA ... ELIMINADO | Protocolo de salida (seccion 8) | Proveedor + centro |

Cada cambio de estado queda en una tabla de eventos (auditoria): quien, cuando, desde que estado, por que.

---

## 3. Manifiesto en dos fases

El formulario publico pide poco, para llegar a una reunion. Despues de la reunion se pide el resto por un enlace privado y con expiracion. Funciona en los dos sentidos: el proveedor puede completar campos desde la consola y el centro puede corregir los suyos mientras el estado sea anterior a APROBADO.

### Fase 1 - Solicitud (formulario publico, sin datos sensibles)

| Campo | Ejemplo |
|---|---|
| nombre_centro | Centro Kibou |
| contacto (nombre, correo, telefono) | Ana Perez, ana@kibou.cl |
| comuna / region | Providencia, RM |
| tamano_equipo | 6 a 15 profesionales |
| modulos_interes | AGENDA, FICHAS, PAGINA_PUBLICA |
| sitio_existente | si (integrar) / no (nuevo) |
| estilo_preferido | moderno (unico disponible hoy en el ERP) |
| como_trabajan_hoy | texto libre corto (ej. "Encuadrado + planillas") |
| comentarios | texto libre |

### Fase 2 - Datos formales (despues de la reunion)

| Bloque | Campos |
|---|---|
| Entidad | razon social, RUT, tipo (sociedad de profesionales, EIRL, persona natural), direccion |
| Responsables | admin inicial (nombre, correo), director tecnico o responsable de datos (recibe exportes), custodio del centro para la parte 2 de la llave de recuperacion |
| Dominio | subdominio `*.vinculos.cl` o dominio propio (ruta en el tunel Cloudflare; requiere custom hostname o DNS delegado) |
| Estilo | tema `moderno` o `cuaderno` (los implementados en el ERP; `editorial` esta disenado en el boceto del landing y falta implementarlo en el ERP), colores de marca por zona (el ERP exige contraste en la BD), logo. En la fase 1 el centro marca una preferencia: moderno, cuaderno, editorial, "tenemos nuestros colores" o "aun no lo se" |
| Modulos contratados | lista validada contra dependencias |
| Reglas | parametros por modulo (ver abajo) |
| Version | canal (estable/beta) o version fija |
| Legal | terminos de servicio y DPA: el operador publica la version en el silo (`politicas`) y un ADMIN la acepta dentro del silo (`aceptaciones_contrato`); la consola guarda version y fecha de aceptacion |

### Ejemplo de manifiesto completo

```yaml
schema: 1
tipo_cliente: centro                 # por ahora solo "centro"; "independiente" es futuro
centro:
  id: kibou
  nombre: Centro Kibou
  razon_social: Kibou Psicologia SpA
  rut: 76.xxx.xxx-x
  tipo_entidad: sociedad_profesionales
  admin: { nombre: Ana Perez, correo: admin@kibou.cl }
  responsable_datos: { nombre: Ana Perez, correo: direccion@kibou.cl }
dominio: { tipo: subdominio, valor: kibou.vinculos.cl }
version: { canal: estable }          # o { fija: "0.1.0" }
estilo:
  tema: moderno                      # unico tema del ERP hoy
  marca: { principal: "#2E6E6E" }    # colores por zona; la BD del ERP valida el contraste
  logo: logo.png
# Enum modulo_centro del ERP; nucleo es implicito. La BD exige MATCH -> EQUIPO y COBROS -> AGENDA.
modulos: [FICHAS, AGENDA, EQUIPO, MATCH, PAGINA_PUBLICA]
# Nombres = columnas de configuracion_centro del ERP (lista completa en ERP_REGLAS_Y_DESPLIEGUE.md, seccion 4).
reglas:
  plazo_aviso_cancelacion_horas: 24
  margen_traslado_min: 15
  plazo_respuesta_derivacion_horas: 24
  plazo_consentimiento_horas: 48
  rol_gestion_habilitado: false
  modelo_cobro: CENTRO              # CENTRO | DIRECTO | MIXTO
  recordatorio_horas_antes: 24
  horas_plazo_pago_equipo: 12
  bloquear_agenda_morosos: true
semilla:
  plantilla: centro_psicologico
  horario_centro: { lun_vie: "09:00-20:00" }   # ilustrativo: el formato se define contra la tabla horario_centro del ERP
  tipos_atencion:                    # la duracion de sesion vive aqui, no como regla global
    - { nombre: Terapia individual, min: 50, precio: 35000 }
legal:
  contrato_encargo: { version: "2026-11", aceptado_en: "2026-11-20" }
```

Reglas del manifiesto:
- Las reglas de negocio de un cliente son **parametros**, no codigo. Si algo no cabe como parametro, se crea una opcion nueva del modulo para todos, apagada por defecto. Nunca un fork.
- El manifiesto se versiona: cada cambio aprobado crea una nueva revision con su hash. El silo registra que revision tiene aplicada.
- El schema vive en un paquete compartido (`@vinculos/manifest`) que usan tanto el plano de control como el silo (para la carga inicial).

---

## 4. Tres tipos de datos de entrada

| Tipo | Que es | Quien lo carga | Como |
|---|---|---|---|
| A. Configuracion inicial | Datos y reglas del centro del manifiesto, plantilla de servicios y catalogos | Plano de control | Carga inicial automatica al aprovisionar (idempotente, upsert) |
| B. Datos operativos | Equipo, documentos de titulo/RNPI, horarios, boxes, fotos, textos del perfil | El centro, dentro de su silo | Asistente de primer ingreso + carga masiva por planilla |
| C. Datos clinicos historicos | Pacientes y fichas del sistema anterior | El centro, dentro de su silo | Importacion clinica masiva (abajo) |

Nota de nombre: "semilla" queda reservado para la configuracion inicial (A). B y C son "carga" e "importacion".

### B. Carga masiva operativa
- Plantillas CSV/XLSX descargables desde el silo: profesionales, servicios, boxes, horarios.
- Flujo: subir -> validacion en seco (sin escribir) -> reporte de errores por fila -> confirmar -> escribir.
- Cada profesional invitado completa su propio perfil (regla: el perfil lo gestiona el profesional, el admin solo valida RNPI, titulo y certificado de alumno regular).

### C. Importacion clinica masiva (respeta "la ficha solo la ve su tratante")
- La herramienta corre **dentro del silo**, nunca en el plano de control. El proveedor no ve contenido clinico.
- Paquete de importacion: CSV de pacientes, CSV de fichas/evoluciones y ZIP de adjuntos con un indice (`ficha_ref, archivo`). Cada fila indica el profesional tratante (correo o RUT).
- El admin sube el paquete cifrado, pero solo ve el resultado de la validacion: conteos, codigos de ficha y errores sin contenido clinico ("fila 42: tratante no existe").
- Cada ficha importada queda asignada a su tratante. El tratante recibe el aviso "Tienes N fichas importadas para revisar" y las confirma.
- Alternativa: cada profesional importa solo sus propias fichas desde "Importar mis fichas".
- Las fichas importadas quedan marcadas con `origen: importado`, sistema de origen y fecha. Su contenido original no se edita: lo nuevo se agrega como evolucion.

### Adaptadores de entrada y salida
Vinculos no depende del formato de otro sistema. Todo pasa por un **formato canonico** propio:

```
ENTRADA: cualquier archivo -> adaptador de entrada -> formato canonico -> validacion previa -> importacion
SALIDA : datos del silo -> formato canonico -> adaptador de salida -> paquete de exporte
```

- **Formato canonico:** plantillas CSV/XLSX (pacientes, fichas, evoluciones, equipo, servicios) + ZIP de documentos con indice. Versionado (`canonico: 1`).
- **Asistente de mapeo de columnas:** para cualquier CSV/XLSX el usuario indica que columna corresponde a cada campo (RUT, fecha, tratante...). El mapeo se guarda como adaptador reutilizable (ej. "Encuadrado listado consultantes").
- **PDF sin estructura:** se importa como "documento historico" asociado al paciente y a su tratante, sin interpretar el contenido. Extraer datos con IA queda como trabajo futuro (rama de notas clinicas con IA).
- **Salida:** el exporte de la seccion 8 se genera en el mismo formato canonico, de modo que otro centro con Vinculos (o el mismo centro en el futuro) pueda volver a importarlo sin mapeo.
- **Cifrado por uso:** entrada por HTTPS directo al silo, guardada con AES-256-GCM (clave del silo) y borrada al terminar el proceso; salida en `.vxp` (AES-256-GCM, clave del ADMIN derivada con scrypt); respaldos internos con openssl AES-256 PBKDF2 y `respaldo.key`.
- **Estado en el ERP:** la carga masiva B y la importacion clinica C aun no existen; la exportacion del centro hoy entrega JSON por tabla + PDF por ficha (no el formato canonico). El formato canonico y sus adaptadores son trabajo nuevo en el ERP.
- **Encuadrado:** su ayuda publica no documenta una exportacion masiva de fichas (solo importar un listado de consultantes y descargar adjuntos uno por uno). El centro probablemente debera pedirla a su soporte; desde el 1-dic-2026 puede exigirla como derecho de portabilidad (Ley 21.719). Se resuelve con el asistente de mapeo + PDF como documento historico.

---

## 5. Aprovisionamiento (desarrollo detallado)

Se ejecuta como **job**. El plano de control lo crea; el agente del host de silos lo toma y lo ejecuta. Cada paso es idempotente, se registra y puede reintentarse desde el paso que fallo.

Cola de jobs en el Postgres del plano de control (tabla `job` + `SELECT ... FOR UPDATE SKIP LOCKED` al reclamar), sin Redis, coherente con el resto del proyecto. El agente reclama por HTTPS (`POST /agente/jobs/reclamar`) y reporta cada paso (`POST /agente/jobs/:id/pasos`).

| Paso | Accion | Verificacion | Si falla |
|---|---|---|---|
| P0 Validar | Schema del manifiesto, dependencias de modulos, dominio libre, version existente en el registry (tag + digest), migraciones de la version marcadas como aditivas | Todo valido | Job no parte, error al proveedor |
| P1 Reservar | Crear registro `silo` en estado APROVISIONANDO, slug, nombre del stack `erp-<slug>`, rutas | Registro creado | Reintentar |
| P2 Secretos generables | Generar `POSTGRES_PASSWORD`, `OWNER_DB_PASSWORD`, `APP_DB_PASSWORD` (solo caracteres URL-safe), `JWT_SECRET` (32+) y token interno. Escribir `silos/<slug>/.env` (permisos 600) desde `infra/.env.example` del ERP, con `LOGIN_LIMITE_POR_MINUTO=10`, `JOBS_MANUALES=false`, `NODE_ENV=production` | Archivo presente | Regenerar solo si lo creo este job |
| P3 Compose | Renderizar `silo.compose.tpl` (derivada de `infra/docker-compose.yml` del ERP): imagenes por tag, env, labels de Traefik (`Host` + `/api`, compress en `/api`), limites (db 256M, backend 256M, frontend 256M, cpus 1.0), Postgres con `shared_buffers=64MB`, `max_connections=24`, `work_mem=2MB` y `pg_stat_statements`, redes `interna` y `proxy`, volumenes `db_data` y `exportaciones` | Archivo valido (`docker compose config`) | Corregir plantilla |
| P4 BD y migraciones | `docker compose up -d db migrate`: Postgres propio del silo, init de roles, `prisma migrate deploy` y contrasena de `app_user` | `migrate` termina con 0; tabla de migraciones al dia | Detener; la base esta vacia, se puede rehacer |
| P5 Llaves (manual) | Job en ESPERANDO_LLAVES. El operador corre `infra/scripts/llaves/aprovisionar.sh` (KEK, `recuperacion.pub`, 4 DEK con canario, 3 partes Shamir con sus custodios), entrega cada parte por un canal distinto y borra `partes_entregar/`. Regla del ERP: nada genera llaves automaticamente | La consola registra custodios y fecha (nunca las partes); el operador confirma | Esperar |
| P6 Levantar | `docker compose up -d`. La API solo arranca si la huella de la KEK y los canarios coinciden | `GET /api/salud` 200 antes de un timeout | `down` y volver a P3 |
| P7 Carga inicial | Via `/api/internal/*` (requisito del ERP): `configuracion_centro`, horario, tipos de atencion, espacios, contenido publico y marca de la revision del manifiesto. Mientras no exista: SQL como dueno en `migrate` | Conteos esperados, revision del manifiesto registrada | Reintentar (upsert) |
| P8 Dominio | Subdominio: ruta en el tunel Cloudflare hacia Traefik. Dominio propio: custom hostname o DNS delegado. Certificado por desafio DNS o de origen (el challenge TLS-ALPN no funciona tras el tunel) | HTTPS responde y `/api/salud` 200 por el dominio | Silo queda ACTIVO_SIN_DOMINIO y se avisa |
| P9 Continuidad y contrato | `infra/scripts/continuidad/instalar.sh` (`respaldo.key`, cron de respaldo 02:00, `salud.sh` cada 5 min, recordatorio de prueba mensual); primer respaldo y restauracion de prueba. Publicar TERMINOS_SERVICIO y DPA en `politicas` | Respaldo con sha256; restauracion OK; politicas publicadas | Reintentar |
| P10 Admin y cierre | Admin inicial via `/api/internal/admin-inicial` (requisito del ERP: invitacion de un solo uso, 72 h; hoy por seed). Silo ACTIVO; registrar version, digest, modulos, hash del manifiesto; evento de auditoria | Correo enviado (SES; Mailpit en local) | Reenviar |

Rollback: solo se deshace lo que creo el mismo job. Si ya existen datos cargados por el centro, nunca se borra nada automaticamente.

Otros jobs que reutilizan los mismos pasos:
- `reconfigurar` (cambio de estilo, reglas o modulos): `POST /api/internal/config` con la nueva revision del manifiesto (requisito del ERP). No requiere reiniciar: el ERP cachea los modulos 30 s y el sitio publico revalida cada 60 s.
- `actualizar` (nueva version): seccion 7.
- `exportar` y `eliminar`: seccion 8.
- `reiniciar_demo`: recrea el silo demo con datos ficticios (`seed:demo` del ERP; se niega con `NODE_ENV=production`, asi que corre con un entorno propio del demo). El seed paga las horas de hoy y del proximo dia habil, por lo que basta cada 2 dias habiles; un reinicio corta las sesiones abiertas del demo.

Ejecucion inicial: los pasos pueden partir como un script (`provision.sh centros/<slug>.yaml`) corrido a mano en el host B. Luego el boton "Aprovisionar" de la consola encola el mismo trabajo y el agente lo ejecuta (salvo P5, siempre manual).

Respaldos: los genera el cron que instala `instalar.sh` del ERP (`respaldar.sh`): `pg_dump -Fc` diario 02:00 Chile **por silo**, cifrado AES-256 con openssl PBKDF2 y `respaldo.key` (distinta de la KEK; copia fuera del host), sha256, en un prefijo propio del silo (`respaldos/<slug>/`). Retencion 7 dias en el host y 35 en el destino externo. RPO 24 h, RTO 4 h habiles. El agente reporta el resultado y la prueba mensual de restauracion. Al ser por silo, se eliminan directamente en la salida.

---

## 6. Modulos

Dependencias (las valida P0 y la consola):

```
nucleo (seguridad, usuarios, roles)  <- siempre activo, no figura en el enum
|- FICHAS         (Fichas y pacientes)     depende de: nucleo
|- AGENDA         (Agenda y espacios)      depende de: nucleo
|- EQUIPO         (RR.HH. y perfiles)      depende de: nucleo
|- MATCH          (Match terapeutico)      requiere: EQUIPO   | opcional: AGENDA   (CHECK en la BD)
|- COBROS         (Cobros)                 requiere: AGENDA   | opcional: MATCH    (CHECK en la BD)
|- PAGINA_PUBLICA (sitio del centro)       requiere: EQUIPO   | opcional: AGENDA, MATCH (solo en el plano de control)
'- WHATSAPP       (avisos por WhatsApp)    apagado por defecto, post-MVP, sin dependencia definida
```

Nombres = enum `modulo_centro` del ERP, columna `configuracion_centro.modulos_activos`. Default del ERP: todos menos WHATSAPP. La API del silo no tiene GRANT para cambiarla: solo el operador (hoy SQL como dueno; luego `/api/internal/config`). La BD exige MATCH -> EQUIPO y COBROS -> AGENDA (`configuracion_centro_modulos_coherentes`); PAGINA_PUBLICA -> EQUIPO lo valida el plano de control. Estado: COBROS esta parcial (reglas de finanzas abiertas); la pasarela real es post-MVP.

Reglas:
- Se agregan o quitan **solo por solicitud del centro**, desde la consola del proveedor. Queda registro de quien lo pidio y cuando.
- Todo el codigo de los modulos viene en la imagen; el manifiesto los activa con feature flags.
- **Quitar un modulo no borra sus datos:** se oculta la interfaz y se bloquea la escritura. Los datos clinicos siguen bajo la retencion legal de 15 anos.
- No se puede quitar un modulo del que dependa otro modulo activo.

---

## 7. Versiones y actualizacion en cascada

Versionado semantico en la etapa 0.x:
- `0.1.0 -> 0.1.1` (patch): correcciones; sin cambios incompatibles.
- `0.1.x -> 0.2.0` (minor): puede incluir cambios incompatibles mientras no exista una 1.0.0.

Canales:
- `demo`: recibe todo apenas sale.
- `beta`: centros que aceptan recibir antes.
- `estable`: el resto.
- `fija`: el silo no se mueve hasta que el proveedor lo cambie.

Reglas de la cascada:
- Los patch se aplican automaticamente dentro de su canal.
- Los minor requieren confirmacion por silo desde la consola.
- Orden: demo -> pruebas de humo -> beta -> estable, **un silo a la vez**.
- Por silo: respaldo (`respaldar.sh`) -> servicio `migrate` con la imagen nueva (`prisma migrate deploy`) -> recrear `backend` y `frontend` (Traefik) -> `/api/salud` -> si falla, se vuelve a la imagen anterior.
- No se actualiza un silo con una exportacion del centro en curso (job del ERP, por defecto en ventana nocturna segun el horario del centro) ni en la ventana de respaldo de las 02:00. El estado de exportaciones se consulta por `/api/internal/*` (requisito del ERP).
- Las migraciones son solo aditivas desde el primer silo real: agregar columnas o tablas, nunca renombrar ni borrar en la misma version. Borrar algo se hace en una version posterior, cuando ningun silo usa ya la anterior. Asi la vuelta atras de imagen es segura. El historial actual del ERP tiene migraciones destructivas anteriores a esta regla.
- El admin de cada centro ve las notas de la version en su panel (requisito del ERP: pantalla y endpoint interno aun no existen).
- Origen de las imagenes: CI en Bitbucket construye y publica `vinculos-api:<version>` y `vinculos-web:<version>` en el registro privado del host B. La consola registra los releases y su canal; cada silo guarda tag y digest.

---

## 8. Protocolo de salida (centro que se retira)

Marco: el centro es el **responsable** de los datos y Vinculos es el **encargado** del tratamiento (Ley 21.719, vigente desde el 1 de diciembre de 2026). Al terminar el contrato, el encargado devuelve y elimina los datos. La retencion de 15 anos de las fichas (Decreto 41/2012 Minsal) pasa a ser del centro con el exporte entregado.

| Paso | Accion | Evidencia |
|---|---|---|
| S1 Solicitud | Termino de contrato con fecha de corte | Evento registrado |
| S2 Solo lectura | Sin nuevas reservas ni pagos; pacientes avisados por el centro | Estado EN_SALIDA |
| S3 Exportar | El ADMIN del centro, en Configuracion > Exportar datos, elige una clave de 16+ caracteres y pulsa "Preparar ahora (urgente)". Job dentro del silo: todas las tablas salvo llaves, sesiones, tokens, codigos e intentos de login, con columnas cifradas ya legibles (JSON por tabla) + un PDF por ficha. Huella SHA-256 en `registro_exportaciones` | Paquete generado; la consola registra fecha, tamano y huella |
| S4 Cifrar y entregar | Archivo `exportacion-centro-AAAA-MM-DD.vxp`, AES-256-GCM con clave derivada (scrypt) de la clave del ADMIN, que Vinculos no conoce ni guarda. Disponible 24 h, se borra al descargar. Vinculos entrega `descifrar.mjs` para abrirlo | Descarga registrada en el silo |
| S5 Verificar | El centro descifra, revisa los conteos del `indice.json` y firma el acta de recepcion (huella, conteo de pacientes y fichas, quien recibe) | Acta en la consola |
| S6 Gracia | Silo apagado (job DETENER_SILO del ejecutor: para los contenedores sin borrar nada; o a mano con confirmacion) y base conservada **30 dias** desde el acta (salvo otro plazo en el contrato), con confirmacion escrita antes de borrar | Estado GRACIA |
| S7 Eliminar | Job ELIMINAR del ejecutor (contenedores, volumenes, redes y `respaldos/<slug>/` del host; exige el archivo `bajas/<slug>` en el host B con el hash del acta de recepcion) y a mano el resto: `down`, borrar volumenes, `respaldos/<slug>/` en el host y en el bucket (incluidas versiones), `shred -u` de `infra/secrets/<slug>/`, aviso a los custodios para destruir su parte, quitar ruta del tunel/DNS y lineas `# vinculos:<slug>` del crontab (`docs/cumplimiento/baja_centro.md` del ERP) | Acta de eliminacion: "eliminado de produccion y respaldos el dia X" |
| S8 Cierre | En el plano de control solo quedan metadatos (fechas, actas, hashes del paquete), nunca contenido | Estado ELIMINADO |

**Reversion** (decidida 2026-11-14): si el centro se dio de baja por error o se arrepiente antes de eliminar, con su solicitud escrita la salida se revierte. Desde EN_SALIDA o EXPORTADO vuelve al estado previo en el acto; desde GRACIA, el job REANUDAR_SILO arranca el silo detenido y al quedar sano vuelve. Queda un acta de reversion (hash) con copia por correo, y la salida como historial. Despues de que el job ELIMINAR empieza a borrar, o del acta S7, no hay vuelta. Las actas de eliminacion y de reversion se envian al responsable de datos del manifiesto.

El proveedor nunca abre el contenido del exporte: el job lo genera dentro del silo y solo el ADMIN conoce la clave. El exporte incluye las notas clinicas porque es la entrega legal de las fichas al Responsable: debe pedirlo quien responde por ellas (direccion del centro). El formato canonico (seccion 4) seria un adaptador de salida posterior.

---

## 8b. Soporte e incidentes (lo que registra la consola)

Soporte (`docs/cumplimiento/soporte.md` del ERP): el ADMIN otorga en su silo una autorizacion (motivo, alcance DIAGNOSTICO o CONFIGURACION, 1 a 72 h). Solo entonces el operador habilita `soporte_vinculos` con `VALID UNTIL` y corre `soporte_resumen()`, `soporte_notificaciones_con_error(dias)` o `soporte_configuracion()`; todo queda en `registro_soporte`, visible para el ADMIN. La consola lleva el ticket (fechas, alcance, resultado sin datos), nunca el detalle del silo.

Incidentes (`docs/cumplimiento/incidentes.md` del ERP), registro fuera del silo en la consola:

| | S1 critico | S2 alto | S3 medio |
|---|---|---|---|
| Contencion | max 1 h | max 4 h | max 2 dias habiles |
| Aviso inicial al centro | max 24 h | max 48 h | informe mensual |
| Actualizaciones | cada 24 h | cada 48 h | - |
| Informe final | 10 dias habiles | 10 dias habiles | 20 dias habiles |

Conectarse a un silo como dueno fuera de mantencion es un incidente.

---

## 9. Sitio de Vinculos (landing por bloques)

Mensaje central: **"Tu plataforma se arma por vinculos"**. La landing debe mostrar visualmente que la plataforma son **bloques que encajan y funcionan aunque no esten todos activos**.

Secciones:
1. **Hero con bloques:** el nucleo al centro y los modulos encajando a su alrededor. El visitante enciende y apaga bloques; las dependencias se ven como conexiones, y un bloque sin su requisito se muestra atenuado con el aviso "necesita Equipo".
2. **Un bloque por modulo:** problema que resuelve, flujo en pasos, captura real del Centro de Prueba y quien lo usa (admin, profesional, paciente).
3. **Estilos:** vista previa en vivo de los estilos "Moderno A" y "Cuaderno" con la marca por zona del centro (editorial, ya disenado, se agrega cuando este implementado en el ERP), reutilizando el sistema de diseno.
4. **Demo:** entrar a `demo.vinculos.cl` como paciente o como equipo.
5. **Como trabajamos:** solicitud -> reunion -> datos -> tu plataforma lista; salida con exporte completo.
6. **Seguridad:** la ficha solo la ve su tratante, cifrado, Ley 21.719 y retencion de 15 anos.
7. **Solicitud:** formulario de fase 1, con los bloques elegidos arriba ya marcados.

---

## 10. Reglas heredadas del ERP que el plano de control debe respetar

- La ficha solo la ve el profesional tratante; otro profesional solo via `derivaciones` (protocolo formal), nunca por cambio de rol. El admin ve el trabajo del equipo solo por codigos de ficha. **El proveedor no ve nada clinico ni personal**, cifrado o no.
- El admin valida solo el registro RNPI (SIS, hoy manual), el titulo y el certificado de alumno regular. Un profesional no aparece en el sitio publico hasta estar validado. El perfil lo gestiona el profesional; el admin pide correcciones y a la segunda solicitud sin cambios puede editar avisando el motivo.
- Roles: ADMIN, GESTION (deshabilitado por defecto, `rol_gestion_habilitado`), PROFESIONAL, PRACTICANTE (con fecha de expiracion de acceso), PACIENTE, RESPONSABLE (adulto responsable de un menor). Una cuenta puede tener varios roles. Sesion unica por usuario.
- Vinculos no maneja dinero: cada centro conecta su propia pasarela y credenciales (post-MVP; las credenciales viven cifradas en el silo, nunca en el manifiesto ni en la consola). `modelo_cobro`: CENTRO, DIRECTO o MIXTO. La hora se confirma con el pago; el moroso no puede agendar.
- Menores: la cita no se confirma sin adulto responsable registrado.
- Retencion minima de 15 anos para las fichas; la purga es manual, a partir de un listado.
- Verificacion en dos pasos por codigo al correo (6 digitos, 10 min, 5 intentos, codigos de respaldo), obligatoria para el equipo del centro y para la consola del proveedor. TOTP existe en el ERP pero apagado.
- Correo transaccional con Amazon SES (Mailpit en local), puerto 587, dominio con SPF, DKIM y DMARC. Remitente de la plataforma con el nombre del centro y Reply-To del centro; configuration set por silo y uno propio para la consola. Plantillas sin contenido clinico.
- Terminos de servicio y DPA viven en cada silo; la lista de subencargados (`docs/cumplimiento/subencargados.md` del ERP: Lightsail, SES, Let's Encrypt, Cloudflare) alimenta el DPA.
- Interfaz optimizada para 1920x1080; reglas de accesibilidad del sistema de diseno (areas de 44 px, texto de 15 px o mas, contraste AA).

---

## 11. Alcance para la tesis

Decisiones previas: el panel maestro era una capa delgada construida al final, y el onboarding autoservicio estaba fuera de alcance. Con este documento se propone:

| Dentro de la tesis | Trabajo futuro |
|---|---|
| Manifiesto con schema y paquete compartido | Onboarding 100% autoservicio (sin aprobacion del proveedor) |
| Script de aprovisionamiento + boton en la consola (aprobado por el proveedor) | Importadores especificos por sistema de origen (Encuadrado, etc.) |
| Consola: solicitudes, silos, versiones, modulos | Facturacion de Vinculos a los centros |
| Canales demo/estable y actualizacion uno a uno | Migracion de un silo a un host dedicado |
| Landing por bloques + formulario de fase 1 | |
| Protocolo de salida documentado + job de exporte | |

---

## 12. Decisiones tomadas y pendientes

Tomadas (nov 2026):
| Tema | Decision |
|---|---|
| Registro de imagenes | Privado en el propio host de silos (`registry:2` o Zot). Mismas reglas (tags inmutables + digest) al migrar a AWS ECR |
| Plano de control | Host separado desde el inicio, con agente en modelo pull en el host de silos. El costo extra se asume por seguridad |
| Gracia y respaldos | 30 dias de gracia; respaldos por silo cifrados con openssl AES-256 (`respaldo.key`), borrados directamente en la eliminacion |
| Cifrado | `.vxp` AES-256-GCM con clave del ADMIN para el exporte al centro; HTTPS + AES-256-GCM en reposo para importaciones; openssl AES-256 PBKDF2 para respaldos internos; columnas sensibles con DEK envueltas por la KEK del silo |
| Entrada de red | Tunel Cloudflare sin puertos abiertos; Cloudflare es subencargado (ve el trafico en claro), DPA firmado antes de datos reales |
| Plan por silo | 1 GB / 1 vCPU (medido: un silo usa 460-520 MB); puede subir tras las pruebas de capacidad |
| Llaves | KEK y partes Shamir solo con los scripts manuales del ERP; el aprovisionamiento espera al operador (P5) |
| Interfaz agente -> silo | Modulo `/api/internal/*` nuevo en el ERP con funciones SECURITY DEFINER; sin credenciales de dueno en runtime |
| Formatos de otros sistemas | Formato canonico propio + adaptadores de entrada y salida; PDF sin estructura como documento historico |
| Admin e importacion clinica | El admin no ve el contenido de las fichas que importa: solo conteos, codigos y errores |
| Precios y planes | En pausa. Solo se piensa a nivel de centro. Campo `tipo_cliente` reservado en el manifiesto |

Pendientes:
- Precios y planes para centros.
- Modelo para profesionales independientes (futuro): es una persona, no una organizacion. Requiere adaptar el apartado del profesional y probablemente un silo compartido con aislamiento por fila, porque un silo completo por persona no se paga.
- Actualizar el capitulo de la tesis con el nuevo alcance (seccion 11) al retomar la redaccion.
- Requisitos en el ERP antes de automatizar: imagenes unicas por digest (configuracion en runtime ya hecha, R9/R11, 2026-11-13; falta registro + CI, R1), modulo `/api/internal/*` (base, R2 y R3 hechos 2026-11-13; faltan R4 y R5), notas de version en el panel del ADMIN, funcion de agregados periodicos para la consola (hoy `soporte_resumen()` exige autorizacion del centro; acordarlo en el DPA). Estado al dia en `docs/roadmap.md`.
- Dominio propio de un centro tras el tunel Cloudflare: custom hostnames (Cloudflare for SaaS) o DNS delegado.
- Texto legal final de terminos y DPA, si la aceptacion de un ADMIN basta como firma, y el plazo de eliminacion por defecto.

---

## 13. Entorno de pruebas local

Objetivo: probar despliegues completos y medir rendimiento real antes de pasar a la nube.

| Rol | Maquina | Contenido |
|---|---|---|
| Host A (plano de control) | Maquina distinta al host B | web, api, db control |
| Host B (silos) | PC local usado como VPS: Intel i7 de 4a generacion, 16 GB DDR3 | Traefik, registry, agente, 2 silos de prueba + demo |

Configuracion de los silos de prueba:
- Limites por silo iguales al plan objetivo (1 GB RAM / 1 vCPU: db 256M, backend 256M, frontend 256M, resto para el SO y Traefik), para simular produccion. Ya estan en `infra/docker-compose.yml` del ERP.
- Dos centros de prueba con datos ficticios de distinto tamano (ej. 5 y 20 profesionales), mas el silo demo.

Pruebas y metricas a registrar (sirven como resultados de la tesis):
| Prueba | Herramienta | Que se mide |
|---|---|---|
| Aprovisionamiento | Consola + agente | Tiempo total y por paso (P0-P10), tasa de exito, reintentos |
| Actualizacion en cascada | Consola + agente | Tiempo por silo, tiempo sin servicio en el swap, vuelta atras |
| Colisiones de reserva | k6 (`prompts/04_pruebas.md` del ERP) | Reservas duplicadas = 0 (consulta SQL de duplicados en `citas`, no el reporte de k6) |
| Lectura publica | k6 escenario `lectura_publica` | p95 < 300 ms, 0 % de 5xx |
| Uso diario simulado | k6 (escenario mixto: login, agenda, fichas, sitio publico) | Latencia p50/p95, errores, RAM y CPU por silo |
| Estres | k6 con carga creciente | Punto de quiebre por silo y del host completo; cuantos silos soporta el host B |
| Salida | Job exportar + eliminar | Tiempo de exporte, tamano del paquete, verificacion de hashes |

Las metricas se toman del agente (cAdvisor / `docker stats`) y de k6, y se guardan por corrida para comparar versiones.
