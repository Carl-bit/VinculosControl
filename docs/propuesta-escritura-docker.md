# Propuesta: como dar al host B la capacidad de crear silos (job aprovisionar)

Estado: **opcion C aprobada por el usuario (2026-11-12)**. Primera etapa implementada: `apps/ejecutor` con los verbos `estado` y `reiniciar` (job REINICIAR_SILO).

## Contexto

Hoy el agente del host B lee Docker a traves de `docker-socket-proxy` con
`CONTAINERS: 1`, `NETWORKS: 1` y `POST: 0`: solo GET. Con eso corre el job
VERIFICAR. Para `aprovisionar` (P1 a P10, CONTEXTO.md seccion 5),
`reiniciar_demo`, `actualizar` y `eliminar` hay que crear, arrancar, detener y
borrar contenedores, redes y volumenes. La pregunta es como dar esa capacidad
sin romper las reglas duras de `CLAUDE.md`.

## Problemas de abrir la escritura en el proxy (POST: 1)

1. **Escribir en la API de Docker equivale a ser root en el host B.** Quien
   pueda crear un contenedor puede pedirlo `Privileged`, con `/` del host
   montado, `--pid=host` o red del host. El proxy filtra por seccion de la API
   (CONTAINERS, NETWORKS, VOLUMES...), no por el contenido de la peticion: con
   `CONTAINERS: 1` y `POST: 1` se puede crear cualquier contenedor.
2. **Las llaves quedan al alcance.** La KEK y `recuperacion.pub` de cada silo
   viven en `infra/secrets/<slug>/` del host B. Un contenedor con el disco del
   host montado las lee. Eso rompe "el agente no genera ni lee llaves" y, con
   la KEK, la confidencialidad de las columnas cifradas de todos los centros.
3. **Un solo agente para todos los silos.** Un token filtrado o una falla en el
   agente (o en una dependencia) compromete todos los centros del host a la vez.
4. **La lista cerrada vive solo en el codigo del agente.** El proxy no sabe que
   el agente solo deberia hacer `compose up` de `erp-<slug>`; no puede hacerla
   cumplir. Si el agente se compromete, la lista cerrada desaparece.
5. **Borrar datos queda permitido.** Con `POST: 1` tambien pasan los DELETE: un
   `down -v` por error o malicia borra `db_data` y `exportaciones` de un silo.
   La regla dice que el rollback nunca borra datos cargados por el centro.
6. **Construir imagenes en el host es otra puerta.** Hoy el compose del ERP
   construye la imagen por silo (requisito R1 pendiente). Con `BUILD` abierto,
   un Dockerfile con `RUN` corre como root en el host.
7. **Poca trazabilidad.** El proxy no deja registro de que llamada hizo quien;
   la auditoria quedaria solo en lo que el agente quiera reportar.

## Opciones

| Opcion | Que es | Riesgo | Esfuerzo |
|---|---|---|---|
| A. Abrir el proxy (`POST: 1` + CONTAINERS, NETWORKS, VOLUMES, IMAGES) | El agente habla con Docker como hoy, pero escribiendo | Alto: problemas 1 a 7 completos | Bajo |
| B. Proxy con reglas propias | Un proxy que ademas de la ruta revise el cuerpo: imagen solo del registro privado por digest, sin `Privileged`, sin montajes fuera de los volumenes del silo, sin red/pid del host, label `erp-<slug>`, sin DELETE de volumenes | Medio: hay que mantener las reglas al dia con la API de Docker | Medio |
| C. Ejecutor de silos con verbos cerrados (recomendada) | Un servicio chico en el host B, el unico con el socket de Docker, que expone solo verbos de alto nivel: `preparar(slug)`, `levantar(slug, servicios)`, `detener(slug)`, `estado(slug)`. Renderiza el compose desde la plantilla del plano de control y nunca recibe parametros libres. El agente le pide verbos; nunca toca Docker | Bajo: la lista cerrada la hace cumplir el ejecutor, no el agente | Medio |

## Recomendacion: opcion C, en dos etapas

Diseno:
- **Ejecutor** (`apps/ejecutor`, contenedor propio en el host B): unico con
  `/var/run/docker.sock`. Escucha solo en una red interna o un socket unix
  compartido con el agente; nunca expuesto.
- **Verbos cerrados**, cada uno con validacion estricta del slug
  (`^[a-z][a-z0-9-]{1,38}[a-z0-9]$`) y nada mas:
  - `preparar(slug)`: crea `silos/<slug>/` y renderiza `silo.compose.tpl` (P3).
  - `levantar(slug, ["db","migrate"])` y `levantar(slug, todo)`: `docker compose up -d` (P4, P6).
  - `detener(slug)`: `docker compose stop` (nunca `down -v`).
  - `estado(slug)`: lectura.
  - Sin verbo para borrar volumenes: eso lo hace el operador a mano en la salida (S7), con acta.
- **Imagenes solo por digest** del registro privado (requisito R1): sin `build`
  en el host. El ejecutor rechaza cualquier `image:` que no sea
  `registro/vinculos-api@sha256:...` o `vinculos-web@sha256:...`.
- **Llaves fuera de su alcance:** la KEK sigue en `infra/secrets/<slug>/kek`,
  dueno operador, permisos 600; el compose la referencia como secret de
  archivo (la lee el daemon de Docker, no el ejecutor ni el agente). P5 sigue
  siendo manual (ESPERANDO_LLAVES).
- **Secretos generables** (contrasenas de BD, JWT, token interno): los genera
  el ejecutor en `silos/<slug>/.env` (600) en P2; no viajan al plano de control.
- **Auditoria local:** el ejecutor escribe cada verbo (fecha, slug, verbo,
  resultado) en un log de solo agregar; el agente lo reporta como log del paso.
- **El proxy de lectura se mantiene** para el monitoreo (`POST: 0`).

Etapas:
1. Hecha (2026-11-12): verbos `estado` y `reiniciar` (backend y frontend; nunca
   db). `reiniciar_demo` se aparto de esta etapa porque el script del ERP
   regenera las llaves del demo. Decidido 2026-11-13: sin excepcion a la regla de
   llaves; enfoque B: resembrar los datos ficticios conservando las llaves
   (requisito R10 en `docs/requisitos-erp.md`), sin verbo de borrado de volumenes.
   Ampliado el mismo dia a B + A: `resembrar_demo(slug)` (B, sin borrado) y
   `reconstruir_demo(slug, escenario)` (A: recrea solo el volumen de BD de un
   demo conservando las llaves). A es la unica excepcion acotada a "sin verbo de
   borrado": slug en `EJECUTOR_DEMOS` + `identidad_silo.es_demo`, comando fijo
   del ERP (`infra/scripts/demo/reconstruir.sh`), escenario validado.
   Tambien (R11): `conectar_borde(slug)` y `soltar_borde(slug)` para unir y
   soltar a Traefik y al agente de `erp-<slug>_borde`.
2. `aprovisionar` completo, cuando el ERP tenga R1 (imagenes unicas por
   digest), R4 (`/api/internal/config`) y R5 (`/api/internal/admin-inicial`).
   Hecho 2026-11-15 (R1, R4 y R5 listos): verbos `preparar` y `levantar`
   (`apps/ejecutor/src/aprovisionar.ts`). El ejecutor corre el CLI de
   `docker compose` (sin shell, argumentos fijos) sobre el compose renderizado
   en `silos/<slug>/`. Las rutas de `postgres/init` y `secrets/<slug>/` son las
   del ERP en el host (`ERP_INFRA_HOST`) y las resuelve el daemon, asi que
   `infra/secrets/` no se monta en el ejecutor. Falta el job en la API y el
   agente.

## Decisiones (2026-11-12)

1. **Opcion C aprobada.**
2. **El ejecutor no borra volumenes ni datos.** La salida sigue el protocolo
   vigente: los datos se conservan solo durante el periodo de gracia para entregar
   el exporte cifrado, y la eliminacion (S7) la hace el operador con acta.
3. **R1 se mantiene como requisito** (imagen unica por digest para todos los
   centros; el aislamiento por centro esta en contenedores, red, base, volumenes y
   secretos, no en la imagen). Explicacion en `docs/roadmap.md`, requisito R1.

## Decision 2026-11-14: salida con opciones B y C

El usuario aprobo, para la salida de un centro (CONTEXTO.md seccion 8):

- **B. `detener` y `reanudar`** (`apps/ejecutor/src/ciclo.ts`): `detener` para
  frontend, backend y db de `erp-<slug>` (suelta antes la red de borde); no
  borra contenedores, volumenes, redes, secretos ni respaldos. `reanudar`
  arranca db, espera que este sana y arranca backend y frontend (une el borde).
  Jobs DETENER_SILO (S6) y REANUDAR_SILO (reversion en gracia).
- **C. `eliminar`**: el unico verbo que destruye. Para que sea real y no un
  checklist, pero acotado:
  - consentimiento local en el host B: el operador crea a mano
    `infra/host-b/bajas/<slug>` con el hash del acta de recepcion de esa salida;
    el ejecutor lo monta en solo lectura. Un plano de control o un agente
    comprometidos no pueden borrar un silo sin ese archivo;
  - la peticion trae el mismo hash (lo pone el plano de control desde el acta);
  - el silo debe estar detenido y fuera de la ventana de respaldo;
  - verifica todas las precondiciones antes de borrar lo primero;
  - borra solo recursos con la label `com.docker.compose.project=erp-<slug>` y
    el prefijo `erp-<slug>` (contenedores, volumenes, redes) y la carpeta
    `respaldos/<slug>/` (rechaza enlaces simbolicos);
  - no toca `infra/secrets/<slug>/` (llaves: shred manual), el bucket externo,
    el DNS, el tunel ni el crontab;
  - devuelve el log de lo borrado: queda en el paso X2 del job y en el acta S7.
  Job ELIMINAR (P0 en el plano de control: GRACIA vencida, confirmacion escrita,
  silo detenido, sin reversion, hash del acta).
- El verbo `reconstruir_demo` (R10, opcion A) sigue siendo la otra excepcion,
  acotada a los demos.
