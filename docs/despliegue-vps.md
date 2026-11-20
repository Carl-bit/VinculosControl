# Despliegue de pruebas en un VPS (todo en un servidor)

Decision 2026-11-16: para las pruebas, el plano de control (host A) y los silos
(host B) corren en el mismo VPS, como proyectos de compose separados. Se
mantiene el modelo pull: el agente llega a la API del control por HTTPS (tunel
de Cloudflare), nunca por la red local ni por un puerto abierto. En produccion
siguen siendo dos hosts.

Supuestos (los del servidor de pruebas actual): usuario `dev`, repo del ERP en
`~/Vinculos/Vinculos` con `infra/servidor/servidor.sh` ya usado (Traefik,
Mailpit y `cloudflared` del plano del host en marcha), dominio en Cloudflare
(ejemplo: `charlielearns.work`). Cambiar nombres y rutas si difieren.

## 0. Que queda corriendo

| Proyecto | Contenedores | Entra por |
|---|---|---|
| `vinculos-servidor` (ERP) | traefik, mailpit | tunel -> traefik:443 (silos) |
| `cloudflared` | tunel | Cloudflare |
| `vinculos-control` (host A) | db, api, web, landing, mailpit | tunel (consola con Access, landing, `/agente`) |
| `vinculos-agente` (host B) | agente, ejecutor, registro, cadvisor | sale al tunel (https) |
| `erp-<slug>` | db, migrate, backend, frontend | traefik |

## 1. Repos al dia

```sh
cd ~/Vinculos/Vinculos && git pull
cd ~/VinculosControl && git pull        # o: git clone git@github-control:Carl-bit/VinculosControl.git ~/VinculosControl
```

Silos del ERP ya levantados con `servidor.sh` (demo, estres): actualizarlos
(trae migraciones aditivas y el alias de Mailpit en la red de borde).

```sh
cd ~/Vinculos/Vinculos
PERFIL=estres sh infra/servidor/servidor.sh levantar estres
sh infra/servidor/servidor.sh bajar demo && sh infra/servidor/servidor.sh levantar demo
```

## 2. Host A (plano de control)

```sh
cd ~/VinculosControl
cp infra/host-a/.env.example infra/host-a/.env
```

En `infra/host-a/.env`:

| Variable | Valor |
|---|---|
| `CONTROL_DB_PASSWORD`, `CONSOLA_SECRETO`, `LANDING_SECRETO` | tres `openssl rand -hex 32` distintos |
| `API_IP` | `127.0.0.1` (la API no queda abierta: el agente entra por el tunel) |
| `LANDING_URL` | `https://vinculos.<dominio>` (la landing publica, paso 3) |
| `DOMINIO_BASE` | `<dominio>` (los silos quedan en `<slug>.<dominio>`) |
| `SMTP_*` | vacios: los codigos del login van al Mailpit del control (paso 6). Con SES: host, 587, usuario y clave SMTP |

```sh
docker compose -f infra/host-a/docker-compose.yml --env-file infra/host-a/.env up -d --build
docker exec vinculos-control-api-1 node dist/cli/crear-operador.js tu@correo "Tu nombre"   # contrasena: UNA vez
docker exec vinculos-control-api-1 node dist/cli/crear-agente.js host-b                     # token del agente: UNA vez
```

## 3. Tunel de Cloudflare

`cloudflared` entra a cuatro redes del control; cada una tiene un solo servicio,
asi la landing no ve la consola ni la base:

```sh
for r in tunel_consola tunel_publico tunel_agente tunel_correo; do docker network connect vinculos-control_$r cloudflared; done
```

(Si `cloudflared` se recrea, repetir.) En Cloudflare Zero Trust > Networks >
Tunnels > el tunel > Public Hostnames, agregar:

| Hostname | Path | Servicio |
|---|---|---|
| `control.<dominio>` | (vacio) | `http://vinculos-control-web-1:3000` |
| `vinculos.<dominio>` | (vacio) | `http://vinculos-control-landing-1:3000` |
| `agente-control.<dominio>` | `^/agente/` | `http://vinculos-control-api-1:4000` |
| `correo-control.<dominio>` | (vacio) | `http://vinculos-control-mailpit-1:8025` (solo pruebas) |

Todos de tipo HTTP y con el puerto interno del contenedor (no el de 127.0.0.1).

- **Access** (Zero Trust > Access > Applications > Self-hosted) sobre
  `control.<dominio>`: politica Allow solo con tu correo. La consola ademas
  pide contrasena y codigo.
- **Access obligatorio** sobre `correo-control.<dominio>`, con la misma
  politica: ahi llegan los codigos del login, sin Access la verificacion en dos
  pasos no protege nada. Con SES se borra este hostname.
- `agente-control.<dominio>` sin Access (el agente se autentica con su token)
  y solo con el path `/agente/`: el resto de la API no se publica.
- Los silos siguen por la regla que ya existe hacia `https://traefik:443` (un
  hostname por silo, o el comodin de abajo). Sin comodin, un silo nuevo
  necesita su hostname antes de P8.

### 3.1 Comodin para los silos (recomendado)

Con el comodin, un silo o demo nuevo no necesita su hostname en el tunel y P8
pasa solo.

1. Zero Trust > Networks > Tunnels > el tunel > Public Hostnames > Add:
   Subdomain `*`, Domain `<dominio>`, servicio igual al de los silos
   (`https://traefik:443`, mismas opciones de TLS). Dejarlo **ultimo**: las
   reglas se evaluan en orden y `control`, `vinculos`, `agente-control` y
   `correo-control` van antes.
2. DNS > Records: un `CNAME` `*` -> `<id-del-tunel>.cfargotunnel.com`,
   proxied (nube naranja). El panel a veces no lo crea para el comodin. Los
   registros con nombre propio siguen ganandole al comodin.
3. SSL/TLS > Edge Certificates: el certificado universal debe cubrir
   `*.<dominio>` (viene en el plan gratis; cubre un nivel, `demo-x.<dominio>`).
4. Access no cambia: las aplicaciones de `control` y `correo-control` siguen.
   Un subdominio que no existe llega a Traefik y responde 404 (antes NXDOMAIN).
5. Let's Encrypt: Traefik saca un certificado por dominio de silo (limite de
   unos 50 por semana por dominio). Con muchos demos que se crean y se borran,
   conviene un certificado comodin en el Traefik del ERP (requisito del ERP).

Prueba: crear un demo sin agregar su hostname; P8 debe pasar solo.

### 3.2 SSH por el tunel (acceso remoto al host B)

Para operar el host B fuera de la red local (P5, P9, entregar las partes de la
llave de un centro real) sin abrir el puerto 22. Las llaves nunca pasan por la
consola: se bajan por SSH a la maquina del operador y se entregan desde ahi.

1. Public Hostnames > Add: `ssh.<dominio>`, servicio `ssh://host.docker.internal:22`
   (o `ssh://<ip-del-host-en-la-red-de-cloudflared>:22`; si `cloudflared` corre
   en Docker, agregar `extra_hosts: host.docker.internal:host-gateway`).
2. Access > Applications > Self-hosted sobre `ssh.<dominio>`: politica Allow
   solo con el correo del operador (igual que `control`). Sin Access, no publicar.
3. En el PC del operador, con `cloudflared` instalado, en `~/.ssh/config`:

   ```
   Host vps
     HostName ssh.<dominio>
     User dev
     ProxyCommand cloudflared access ssh --hostname %h
   ```

   `ssh vps` abre el navegador para Access la primera vez. Copiar archivos:
   `scp vps:~/Vinculos/Vinculos/infra/secrets/<slug>/partes_entregar/parte_1.shamir .`
4. En el servidor: solo llave publica (`PasswordAuthentication no` en
   `/etc/ssh/sshd_config`).

Bitacora: Cloudflare registra quien entro, cuando y desde donde (Zero Trust >
Logs > Access); el servidor registra cada sesion en `/var/log/auth.log`. Para
grabar tambien los comandos: `auditd` o `script` en el perfil de `dev`.
Despues de entregar las partes de un centro real: `shred -u` en el servidor y
en el PC del operador.

## 4. Host B (agente, ejecutor y registro)

```sh
cd ~/VinculosControl
cp infra/host-b/.env.example infra/host-b/.env
```

En `infra/host-b/.env`:

| Variable | Valor |
|---|---|
| `CONTROL_URL` | `https://agente-control.<dominio>` |
| `AGENTE_TOKEN` | el que mostro `crear-agente` |
| `EJECUTOR_TOKEN` | `openssl rand -hex 32` |
| `RESPALDOS_HOST`, `TOKENS_INTERNOS_HOST`, `ERP_INFRA_HOST`, `IMAGENES_HOST` | los del ejemplo (rutas de `~/Vinculos/Vinculos/infra`) |
| `EJECUTOR_UNIR_BORDE` | `vinculos-servidor-traefik-1,vinculos-agente-agente-1` |
| `EJECUTOR_DEMOS` | `demo-*` (todos los demos; la consola reserva el prefijo `demo-`) o slugs sueltos. Nunca un centro real ni `*` |
| `SILO_INTERNO_URL`, `SILO_INTERNO_SLUGS` | comentados (solo desarrollo local) |

Antes del primer `up`, crear las carpetas montadas con el usuario del operador:
si no existen, Docker las crea como root y despues `publicar.sh`,
`respaldo-silo.sh` y `llaves-silo.sh` fallan con "Permission denied"
(hallazgo 2026-11-19). Si ya pasaron por un `up`, `sudo chown -R dev:dev` de
las mismas rutas.

```sh
E=~/Vinculos/Vinculos/infra
mkdir -p $E/imagenes $E/respaldos $E/servidor/internos infra/host-b/bajas infra/host-b/silos
```

```sh
docker compose -f infra/host-b/docker-compose.yml --env-file infra/host-b/.env up -d --build
docker logs -f vinculos-agente-agente-1   # latido, "reporte: N silo(s)", releases y exportaciones cada minuto
```

La consola muestra el host B "en linea" y los silos de `servidor.sh` sin adoptar.

## 5. Publicar una version del ERP y crear un demo

1. Publicar en el registro del host B (tags inmutables; la 0.1.0 ya existe y
   no trae lo nuevo, asi que una con sufijo):

   ```sh
   cd ~/Vinculos/Vinculos && sh infra/scripts/imagenes/publicar.sh 0.1.0-prueba.2
   ```

   En unos minutos aparece en Releases. Promoverla a `demo`.
2. Una sola vez: en el `.env` del host B, `EJECUTOR_DEMOS=demo-*` y
   `up -d ejecutor`. Con el comodin (3.1) no hace falta hostname por demo; sin
   el, `demo-kibou.<dominio>` en el tunel. Si el slug no esta permitido, P2
   falla antes de crear nada.
3. Consola > Demos: slug `demo-kibou` (siempre con `demo-`), nombre, canal `demo`, modulos y
   cantidades. Se encola APROVISIONAR:
   - P5 lo corre el host B solo (llaves de prueba con la CLI del ERP, partes borradas). Si P6 no encuentra la KEK, el job vuelve a P5 con el comando listo para copiar.
   - P9 se omite en los demos (sin respaldo ni cron). En un centro real: `sh infra/host-b/respaldo-silo.sh <slug>` y reintentar el paso.
   - P10 genera los datos. Consola > Demos > "Acceso": enlace, contrasena y cuentas por rol, con "Copiar todo" para compartir. Copia en el VPS: `cat infra/host-b/silos/demo-kibou/demo-cuentas.txt` (600). Con un ERP que tenga R10 (2026-11-19) el demo no pide codigo por correo.
4. Resembrar desde Demos (una vez por hora como maximo).
5. Cada demo vive 24 h: "Extender 24 h" en Demos (tope 7 dias). Al vencer se
   encola ELIMINAR_DEMO y el ejecutor lo borra; quedan a mano `infra/secrets/<slug>/`
   (shred) y el hostname del tunel. El slug queda libre para otro demo.

## 6. Mailpit del control y del ERP

Codigos de la consola en `https://correo-control.<dominio>` (paso 3, con
Access). Ambos Mailpit tambien quedan en `127.0.0.1` del VPS; por SSH desde tu PC:

```sh
ssh -L 18026:127.0.0.1:8026 -L 18025:127.0.0.1:8025 dev@<vps>
```

Consola en http://127.0.0.1:18026 y silos en http://127.0.0.1:18025. Se usan
puertos locales 18xxx porque Windows suele reservar 8025/8026 (Hyper-V, WSL):
`bind ... Permission denied` (ver `netsh interface ipv4 show excludedportrange protocol=tcp`).

## 7. Corrida real de ACTUALIZAR

Con un silo aprovisionado por la consola en el canal `demo`: publicar otra
version (`0.1.0-prueba.3`, o subir la version del ERP a 0.1.1 en
`backend/package.json` y `frontend/package.json` con su commit), promoverla a
`demo` y "Actualizar" desde el silo (o "Aplicar al canal"). El job respalda,
migra, recrea, comprueba `/api/salud` y entrega las notas de version.

### 7.1 Demos sin codigo por correo (R10, 2026-11-19)

Desde esta version un demo entra solo con correo y contrasena (el ERP no pide
segundo factor con `ES_DEMO=true` y la marca de la BD). En un demo "Actualizar"
omite el respaldo (U1), igual que P9. Una sola vez, en el VPS:

```sh
# 1. Repos al dia (ERP con R10 y control con la plantilla nueva)
cd ~/Vinculos/Vinculos && git pull
cd ~/VinculosControl && git pull

# 2. Control y host B reconstruidos (api trae la migracion accesos_demo)
docker compose -f infra/host-a/docker-compose.yml --env-file infra/host-a/.env up -d --build api web
docker compose -f infra/host-b/docker-compose.yml --env-file infra/host-b/.env up -d --build agente ejecutor

# 3. Version del ERP con R10 (tag nuevo, inmutable)
cd ~/Vinculos/Vinculos && sh infra/scripts/imagenes/publicar.sh 0.1.0-prueba.3
# Consola > Releases: promover 0.1.0-prueba.3 a demo.

# 4. Demos ya creados: ES_DEMO al backend de su compose (los nuevos ya lo traen)
cd ~/VinculosControl && sh infra/host-b/demos-sin-codigo.sh
```

5. Consola > Silos > cada `demo-*` > "Actualizar" (o Releases > "Aplicar al
   canal" `demo`). Recrea backend y frontend con la imagen nueva y el compose
   corregido. Probar: entrar con una cuenta de Demos > "Acceso"; no debe pedir
   codigo.

Si un demo es muy viejo (sin acceso en la consola, sin llaves automaticas), es
mas rapido darlo de baja y crear otro desde Demos.

## 8. Problemas comunes

- **Login de un silo con 503 "No se pudo enviar el codigo"**: Mailpit no esta
  unido a la red de borde con su alias. `servidor.sh levantar <slug>` lo repone.
- **"erp-<slug>-backend-1 no resuelve: el agente no esta en erp-<slug>_borde"**:
  el agente se recreo (`up -d --build agente`) y salio de las redes de borde.
  Un agente nuevo se reconecta solo al arrancar; con uno anterior:
  `docker network connect erp-<slug>_borde vinculos-agente-agente-1` y
  reintentar el paso desde el job.
- **Baja de un demo con "network erp-<slug>_borde has active endpoints"**:
  `servidor.sh` del ERP unio su Mailpit a esa red. Un ejecutor nuevo lo suelta
  solo; con uno anterior: `docker network disconnect erp-<slug>_borde
  vinculos-servidor-mailpit-1` y reintentar el paso desde el job.
- **Agente sin latido**: revisar `CONTROL_URL` (https y el path `/agente/` en el
  tunel) y `AGENTE_TOKEN` (`crear-agente` con el mismo nombre rota el token).
- **P2 de un demo falla con 403 "no esta en EJECUTOR_DEMOS"**: poner
  `EJECUTOR_DEMOS=demo-*`, `up -d ejecutor` y reintentar P2.
- **`Permission denied` en `publicar.sh`, `respaldo-silo.sh` o `llaves-silo.sh`**:
  carpetas creadas por Docker como root (paso 4): `sudo chown -R dev:dev`.
- **P8 espera al operador**: falta el hostname del silo en el tunel.
