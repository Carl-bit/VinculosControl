# Vinculos - Plano de control: contexto completo

Documento de referencia para construir `vinculos-control`, el proyecto que presenta, vende, aprovisiona, actualiza y da de baja los centros (silos) de Vinculos. Es adyacente al ERP (`vinculos`) y respeta sus reglas de negocio.

Estado del producto: version 0.1.4 (aun no hay 1.0.0).

---

## 0. Resumen en una pagina

- **Silos:** cada centro vive en su propio contenedor + su propia base Postgres, en un host compartido detras de Traefik. Es multi-tenant de infraestructura, pero logicamente single-tenant.
- **Una sola imagen:** todos los silos corren la misma imagen `vinculos:<version>`. Nada se programa para un cliente especifico.
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
HOST B: SILOS (Traefik + registry + agente)
|- registry      : registro privado de imagenes (registry:2 o Zot)
|- agente        : toma jobs, ejecuta pasos con Docker local, reporta logs y metricas
|- demo.vinculos.cl  -> vinculos:0.1.4 + db_demo   (se reinicia cada noche)
|- kibou.vinculos.cl -> vinculos:0.1.4 + db_kibou
'- otro.cl (CNAME)   -> vinculos:0.1.3 + db_otro   (fijado)
```

Decision: **el plano de control va en un host separado desde el inicio.** Si se compromete la consola, no se compromete el Docker de los silos. El costo de mantener el agente y un host extra se asume como costo de seguridad.

Reglas de la arquitectura:
- El plano de control **nunca** guarda ni lee datos clinicos. Solo metadatos (centro, version, modulos, estado, conteos).
- Cada silo tiene su propio usuario de Postgres, sus propios secretos (JWT, clave de cifrado) y su propio volumen de archivos.
- **Modelo pull:** el plano de control no tiene acceso al Docker del host de silos ni puertos abiertos hacia el. El agente del host B pide trabajos al plano de control (conexion saliente), los ejecuta localmente y devuelve el resultado de cada paso.
- El agente valida cada job contra una lista cerrada de acciones (aprovisionar, reconfigurar, actualizar, exportar, eliminar, reiniciar_demo). No ejecuta comandos arbitrarios recibidos del plano de control.
- La comunicacion agente -> silo usa el endpoint interno `/internal/*` del silo, autenticado con un token por silo y solo dentro de la red Docker del host B.
- El agente usa Docker a traves de `docker-socket-proxy`, que limita los endpoints permitidos.

### Registro de imagenes
- Registro privado en el host B (`registry:2` o Zot) detras de Traefik, con TLS y usuario. Bitbucket Pipelines construye y hace push.
- Mismas reglas para cuando se migre a AWS ECR: tags inmutables (`0.1.4` nunca se republica), cada silo registra el digest `sha256:...` ademas del tag.
- La consola lista los releases leyendo la API del registro (`/v2/vinculos/tags/list`; con ECR, su API equivalente) a traves del agente.

### Monitoreo
| Que | Como | Donde |
|---|---|---|
| Disponibilidad de cada silo | El plano de control consulta `https://<dominio>/health` | Host A |
| CPU, RAM y disco por silo | cAdvisor (o `docker stats` leido por el agente) -> el agente reporta cada minuto | Host B -> A |
| Logs | Loki + Promtail, o Dozzle en la fase inicial | Host B |
| Resultado de jobs | El agente envia el log de cada paso | Host B -> A |
| Agente vivo | Latido cada 30 s; si falta mas de 2 minutos, alerta en la consola | Host A |

---

## 2. Ciclo de vida de un centro (maquina de estados)

```
SOLICITUD -> CONTACTADO -> REUNION -> DATOS_COMPLETOS -> APROBADO
   -> APROVISIONANDO -> ACTIVO <-> SUSPENDIDO
   -> EN_SALIDA -> EXPORTADO -> GRACIA -> ELIMINADO
   (DESCARTADO desde cualquier estado previo a APROBADO)
```

| Estado | Que significa | Quien lo mueve |
|---|---|---|
| SOLICITUD | Llego el formulario del sitio (manifiesto fase 1) | Sistema |
| CONTACTADO / REUNION | Conversacion comercial y levantamiento | Proveedor |
| DATOS_COMPLETOS | El centro entrego los datos formales (manifiesto fase 2) | Centro via enlace seguro |
| APROBADO | Proveedor revisa y aprueba el manifiesto completo y el contrato | Proveedor |
| APROVISIONANDO | Corre el job de aprovisionamiento (seccion 5) | Worker |
| ACTIVO | Silo funcionando | Sistema |
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
| modulos_interes | agenda, fichas, sitio_publico |
| sitio_existente | si (integrar) / no (nuevo) |
| estilo_preferido | cuaderno |
| como_trabajan_hoy | texto libre corto (ej. "Encuadrado + planillas") |
| comentarios | texto libre |

### Fase 2 - Datos formales (despues de la reunion)

| Bloque | Campos |
|---|---|
| Entidad | razon social, RUT, tipo (sociedad de profesionales, EIRL, persona natural), direccion |
| Responsables | admin inicial (nombre, correo), director tecnico o responsable de datos (recibe exportes) |
| Dominio | subdominio `*.vinculos.cl` o dominio propio (CNAME) |
| Estilo | tema (moderno/cuaderno/editorial), overrides de tokens, logo |
| Modulos contratados | lista validada contra dependencias |
| Reglas | parametros por modulo (ver abajo) |
| Version | canal (estable/beta) o version fija |
| Legal | contrato de encargo de tratamiento aceptado (fecha, version del documento) |

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
version: { canal: estable }          # o { fija: "0.1.3" }
estilo:
  tema: cuaderno
  overrides: { "--accent": "#2E6E6E" }
  logo: logo.png
modulos: [nucleo, fichas, agenda, equipo, match, sitio_publico]
reglas:
  agenda.duracion_sesion_min: 50
  agenda.aviso_cancelacion_h: 24
  agenda.margen_traslado_min: 15
  derivacion.respuesta_h: 24
  practicante.consentimiento_h: 48
  roles.gestion_habilitado: false
  pagos.modelo: centro              # centro | directo_profesional
semilla:
  plantilla: centro_psicologico
  servicios:
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
- **Cifrado por uso:** entrada por HTTPS directo al silo, guardada con AES-256-GCM (clave del silo) y borrada al terminar el proceso; salida en ZIP/7z AES-256; respaldos internos con `age`.
- **Encuadrado:** su ayuda publica no documenta una exportacion masiva de fichas (solo importar un listado de consultantes y descargar adjuntos uno por uno). El centro probablemente debera pedirla a su soporte; desde el 1-dic-2026 puede exigirla como derecho de portabilidad (Ley 21.719). Se resuelve con el asistente de mapeo + PDF como documento historico.

---

## 5. Aprovisionamiento (desarrollo detallado)

Se ejecuta como **job**. El plano de control lo crea; el agente del host de silos lo toma y lo ejecuta. Cada paso es idempotente, se registra y puede reintentarse desde el paso que fallo.

Cola de jobs en el Postgres del plano de control (tabla `job` + `SELECT ... FOR UPDATE SKIP LOCKED` al reclamar), sin Redis, coherente con el resto del proyecto. El agente reclama por HTTPS (`POST /agente/jobs/reclamar`) y reporta cada paso (`POST /agente/jobs/:id/pasos`).

| Paso | Accion | Verificacion | Si falla |
|---|---|---|---|
| P0 Validar | Schema del manifiesto, dependencias de modulos, dominio libre, version existente en el registry | Todo valido | Job no parte, error al proveedor |
| P1 Reservar | Crear registro `silo` en estado APROVISIONANDO, id, nombre de red, rutas | Registro creado | Reintentar |
| P2 Base de datos | `CREATE DATABASE vinculos_<id>` + rol propio sin acceso a otras bases | Conexion OK con el rol nuevo | Borrar solo si la creo este job |
| P3 Secretos | Generar JWT secret, clave de cifrado del silo y token interno. Guardarlos en `silos/<id>/.env` (permisos 600) o como Docker secrets | Archivo presente | Regenerar |
| P4 Migraciones | `docker run vinculos:<ver> prisma migrate deploy` | Tabla de migraciones al dia | Detener; la base esta vacia, se puede rehacer |
| P5 Carga inicial | `docker run vinculos:<ver> seed --manifest /m.yaml` (base + plantilla + datos del centro) | Conteos esperados, revision del manifiesto registrada | Reintentar (upsert) |
| P6 Compose | Renderizar `silo.compose.tpl`: imagen, env, labels de Traefik, limites (512MB / 1 vCPU), red, volumen | Archivo valido (`docker compose config`) | Corregir plantilla |
| P7 Levantar | `docker compose up -d` | `GET /health` OK antes de un timeout | `down` y volver a P6 |
| P8 Dominio | Subdominio: el wildcard ya resuelve. Dominio propio: verificar CNAME. Traefik emite el certificado Let's Encrypt | HTTPS responde con certificado valido | Silo queda ACTIVO_SIN_DOMINIO y se avisa |
| P9 Admin | `POST /internal/admin-inicial`: crea la cuenta ADMIN e invitacion de un solo uso (expira 72 h) | Correo enviado (SES; Mailpit en local) | Reenviar |
| P10 Cierre | Silo ACTIVO; registrar version, modulos, hash del manifiesto; evento de auditoria | - | - |

Rollback: solo se deshace lo que creo el mismo job. Si ya existen datos cargados por el centro, nunca se borra nada automaticamente.

Otros jobs que reutilizan los mismos pasos:
- `reconfigurar` (cambio de estilo, reglas o modulos): `POST /internal/config` con la nueva revision del manifiesto. No requiere reiniciar.
- `actualizar` (nueva version): seccion 7.
- `exportar` y `eliminar`: seccion 8.
- `reiniciar_demo`: cada noche borra y vuelve a crear el silo demo con datos ficticios.

Ejecucion inicial: los pasos pueden partir como un script (`provision.sh centros/<id>.yaml`) corrido a mano en el host B. Luego el boton "Aprovisionar" de la consola encola el mismo trabajo y el agente lo ejecuta.

Respaldos: el agente genera un `pg_dump` diario **por silo**, cifrado con `age` (clave publica en el host B, clave privada fuera de linea), guardado en una carpeta o prefijo propio del silo (`respaldos/<id>/`). Asi se pueden eliminar directamente en la salida.

---

## 6. Modulos

Dependencias (las valida P0 y la consola):

```
nucleo (seguridad, usuarios, roles)  <- siempre activo
|- fichas        (Fichas y pacientes)      depende de: nucleo
|- agenda        (Agenda y espacios)       depende de: nucleo
|- equipo        (RR.HH. y perfiles)       depende de: nucleo
|- match         (Match terapeutico)       requiere: equipo   | opcional: agenda
|- cobros        (Cobros)                  requiere: agenda   | opcional: match
'- sitio_publico (sitio del centro)        requiere: equipo   | opcional: agenda, match
```

Reglas:
- Se agregan o quitan **solo por solicitud del centro**, desde la consola del proveedor. Queda registro de quien lo pidio y cuando.
- Todo el codigo de los modulos viene en la imagen; el manifiesto los activa con feature flags.
- **Quitar un modulo no borra sus datos:** se oculta la interfaz y se bloquea la escritura. Los datos clinicos siguen bajo la retencion legal de 15 anos.
- No se puede quitar un modulo del que dependa otro modulo activo.

---

## 7. Versiones y actualizacion en cascada

Versionado semantico en la etapa 0.x:
- `0.1.4 -> 0.1.5` (patch): correcciones; sin cambios incompatibles.
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
- Por silo: respaldo (`pg_dump`) -> `migrate deploy` -> cambiar contenedor (Traefik) -> `/health` -> si falla, se vuelve a la imagen anterior.
- Las migraciones son solo aditivas: agregar columnas o tablas, nunca renombrar ni borrar en la misma version. Borrar algo se hace en una version posterior, cuando ningun silo usa ya la anterior. Asi la vuelta atras de imagen es segura.
- El admin de cada centro ve las notas de la version en su panel.
- Origen de las imagenes: CI en Bitbucket construye y publica `vinculos:<version>` en el registro privado del host B. La consola registra los releases y su canal; cada silo guarda tag y digest.

---

## 8. Protocolo de salida (centro que se retira)

Marco: el centro es el **responsable** de los datos y Vinculos es el **encargado** del tratamiento (Ley 21.719, vigente desde el 1 de diciembre de 2026). Al terminar el contrato, el encargado devuelve y elimina los datos. La retencion de 15 anos de las fichas (Decreto 41/2012 Minsal) pasa a ser del centro con el exporte entregado.

| Paso | Accion | Evidencia |
|---|---|---|
| S1 Solicitud | Termino de contrato con fecha de corte | Evento registrado |
| S2 Solo lectura | Sin nuevas reservas ni pagos; pacientes avisados por el centro | Estado EN_SALIDA |
| S3 Exportar | Job dentro del silo: por ficha, un PDF legible + JSON estructurado + adjuntos; CSV de pacientes, agenda historica, registros de pagos, equipo; `manifest.json` con hash SHA-256 de cada archivo | Paquete generado |
| S4 Cifrar y entregar | Paquete ZIP/7z con AES-256 y contrasena larga aleatoria. La contrasena va por un canal distinto al enlace (SMS o WhatsApp al responsable de datos). Instrucciones: abrir con 7-Zip (el descompresor nativo de Windows no abre AES-256) | Enlace de un solo uso con expiracion |
| S5 Verificar | El centro descarga, verifica los hashes y firma el acta de recepcion | Acta en la consola |
| S6 Gracia | Silo apagado y base conservada **30 dias** por si falta algo | Estado GRACIA |
| S7 Eliminar | Drop de base, volumenes y secretos, y **borrado directo de `respaldos/<id>/`** (los respaldos son por silo, no se espera la rotacion) | Certificado: "eliminado de produccion y respaldos el dia X" |
| S8 Cierre | En el plano de control solo quedan metadatos (fechas, actas, hashes del paquete), nunca contenido | Estado ELIMINADO |

Ni el proveedor ni el admin del centro abren el contenido del exporte durante el proceso. El job lo genera dentro del silo.

---

## 9. Sitio de Vinculos (landing por bloques)

Mensaje central: **"Tu plataforma se arma por vinculos"**. La landing debe mostrar visualmente que la plataforma son **bloques que encajan y funcionan aunque no esten todos activos**.

Secciones:
1. **Hero con bloques:** el nucleo al centro y los modulos encajando a su alrededor. El visitante enciende y apaga bloques; las dependencias se ven como conexiones, y un bloque sin su requisito se muestra atenuado con el aviso "necesita Equipo".
2. **Un bloque por modulo:** problema que resuelve, flujo en pasos, captura real del Centro de Prueba y quien lo usa (admin, profesional, paciente).
3. **Estilos:** los 3 estilos con vista previa en vivo, reutilizando el sistema de diseno.
4. **Demo:** entrar a `demo.vinculos.cl` como paciente o como equipo.
5. **Como trabajamos:** solicitud -> reunion -> datos -> tu plataforma lista; salida con exporte completo.
6. **Seguridad:** la ficha solo la ve su tratante, cifrado, Ley 21.719 y retencion de 15 anos.
7. **Solicitud:** formulario de fase 1, con los bloques elegidos arriba ya marcados.

---

## 10. Reglas heredadas del ERP que el plano de control debe respetar

- La ficha solo la ve el profesional tratante (salvo un acceso temporal por segunda opinion). El admin ve el trabajo del equipo solo por codigos de ficha. **El proveedor no ve nada clinico.**
- El admin valida solo el registro RNPI, el titulo y el certificado de alumno regular. El perfil lo gestiona el profesional; el admin solo puede pedir una correccion.
- Roles: ADMIN, GESTION (deshabilitado por defecto, se activa por configuracion), PROFESIONAL, PRACTICANTE, PACIENTE. Una cuenta puede tener varios roles.
- Vinculos no maneja dinero: cada centro conecta su propia pasarela y credenciales.
- Retencion minima de 15 anos para las fichas; la purga es manual, a partir de un listado.
- Verificacion en dos pasos por codigo al correo, tambien para el admin y para la consola del proveedor.
- Correo transaccional con Amazon SES (Mailpit en local).
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
| Gracia y respaldos | 30 dias de gracia; respaldos por silo cifrados con `age`, borrados directamente en la eliminacion |
| Cifrado | ZIP/7z AES-256 para el exporte al centro; HTTPS + AES-256-GCM en reposo para importaciones; `age` para respaldos internos |
| Formatos de otros sistemas | Formato canonico propio + adaptadores de entrada y salida; PDF sin estructura como documento historico |
| Admin e importacion clinica | El admin no ve el contenido de las fichas que importa: solo conteos, codigos y errores |
| Precios y planes | En pausa. Solo se piensa a nivel de centro. Campo `tipo_cliente` reservado en el manifiesto |

Pendientes:
- Precios y planes para centros.
- Modelo para profesionales independientes (futuro): es una persona, no una organizacion. Requiere adaptar el apartado del profesional y probablemente un silo compartido con aislamiento por fila, porque un silo completo por persona no se paga.
- Actualizar el capitulo de la tesis con el nuevo alcance (seccion 11) al retomar la redaccion.

---

## 13. Entorno de pruebas local

Objetivo: probar despliegues completos y medir rendimiento real antes de pasar a la nube.

| Rol | Maquina | Contenido |
|---|---|---|
| Host A (plano de control) | Maquina distinta al host B | web, api, db control |
| Host B (silos) | PC local usado como VPS: Intel i7 de 4a generacion, 16 GB DDR3 | Traefik, registry, agente, 2 silos de prueba + demo |

Configuracion de los silos de prueba:
- Limites por silo iguales al plan objetivo (512 MB RAM / 1 vCPU), para simular produccion.
- Dos centros de prueba con datos ficticios de distinto tamano (ej. 5 y 20 profesionales), mas el silo demo.

Pruebas y metricas a registrar (sirven como resultados de la tesis):
| Prueba | Herramienta | Que se mide |
|---|---|---|
| Aprovisionamiento | Consola + agente | Tiempo total y por paso (P0-P10), tasa de exito, reintentos |
| Actualizacion en cascada | Consola + agente | Tiempo por silo, tiempo sin servicio en el swap, vuelta atras |
| Colisiones de reserva | k6 | Reservas duplicadas = 0 (consulta SQL contra la restriccion EXCLUDE) |
| Uso diario simulado | k6 (escenario mixto: login, agenda, fichas, sitio publico) | Latencia p50/p95, errores, RAM y CPU por silo |
| Estres | k6 con carga creciente | Punto de quiebre por silo y del host completo; cuantos silos soporta el host B |
| Salida | Job exportar + eliminar | Tiempo de exporte, tamano del paquete, verificacion de hashes |

Las metricas se toman del agente (cAdvisor / `docker stats`) y de k6, y se guardan por corrida para comparar versiones.
