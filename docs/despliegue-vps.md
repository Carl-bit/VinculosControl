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
  hostname por silo, o `*.<dominio>` si el plan lo permite). Un silo nuevo
  necesita su hostname antes de P8.

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
| `EJECUTOR_DEMOS` | slugs de demostracion, por ejemplo `demo-kibou` (paso 5). Nunca un centro real |
| `SILO_INTERNO_URL`, `SILO_INTERNO_SLUGS` | comentados (solo desarrollo local) |

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
2. En el `.env` del host B, `EJECUTOR_DEMOS=demo-kibou` (el slug que vas a
   usar) y `up -d ejecutor`. Hostname `demo-kibou.<dominio>` en el tunel.
3. Consola > Demos: slug `demo-kibou`, nombre, canal `demo`, modulos y
   cantidades. Se encola APROVISIONAR:
   - P5 (llaves, manual): `sh infra/host-b/llaves-silo.sh demo-kibou "Operador:proveedor,Demo:centro,Sobre:caja" --prueba` y confirmar en la consola.
   - P9 (respaldo): `sh infra/host-b/respaldo-silo.sh demo-kibou` y reintentar el paso.
   - P10 genera los datos. Correos y contrasena: `infra/host-b/silos/demo-kibou/demo-cuentas.txt` (600, solo en el VPS).
4. Resembrar desde Demos (una vez por hora como maximo).

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

## 8. Problemas comunes

- **Login de un silo con 503 "No se pudo enviar el codigo"**: Mailpit no esta
  unido a la red de borde con su alias. `servidor.sh levantar <slug>` lo repone.
- **Agente sin latido**: revisar `CONTROL_URL` (https y el path `/agente/` en el
  tunel) y `AGENTE_TOKEN` (`crear-agente` con el mismo nombre rota el token).
- **P10 de un demo falla con 403**: el slug no esta en `EJECUTOR_DEMOS`.
- **P8 espera al operador**: falta el hostname del silo en el tunel.
