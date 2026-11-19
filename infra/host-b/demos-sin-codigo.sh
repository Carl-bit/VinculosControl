#!/bin/sh
# Una sola vez, para los demos creados antes del 2026-11-19 (R10: demo sin
# segundo factor). Agrega ES_DEMO al servicio backend del compose de cada demo
# (silos/demo-*/docker-compose.yml), como ya lo hace la plantilla para los demos
# nuevos. Solo toca demos generados por el ejecutor con ES_DEMO=true en su .env.
# No reinicia nada: el backend toma el cambio al recrearse con "Actualizar" en la
# consola (version del ERP con R10). Idempotente.
#
#   sh infra/host-b/demos-sin-codigo.sh            # todos los demo-*
#   sh infra/host-b/demos-sin-codigo.sh demo-kibou # uno
set -eu
falla() { echo "demos-sin-codigo: $*" >&2; exit 1; }

HOSTB=$(cd "$(dirname "$0")" && pwd)
valor() { [ -f "$HOSTB/.env" ] && sed -n "s/^$1=//p" "$HOSTB/.env" | tail -n 1 | tr -d '"\r' || true; }
SILOS=$(valor SILOS_HOST)
SILOS=${SILOS:-$HOSTB/silos}

if [ $# -gt 0 ]; then LISTA=$*; else LISTA=$(cd "$SILOS" && ls -d demo-* 2>/dev/null || true); fi
[ -n "$LISTA" ] || falla "no hay demos en $SILOS"

for SLUG in $LISTA; do
  echo "$SLUG" | grep -Eq '^demo-[a-z0-9-]{0,34}[a-z0-9]$' || falla "slug invalido (solo demo-*): $SLUG"
  ENV_SILO="$SILOS/$SLUG/.env"
  COMPOSE="$SILOS/$SLUG/docker-compose.yml"
  [ -f "$ENV_SILO" ] && [ -f "$COMPOSE" ] || { echo "$SLUG: sin .env o compose, se salta"; continue; }
  head -n 1 "$ENV_SILO" | grep -q '^# Generado por el ejecutor' || { echo "$SLUG: .env no lo creo el ejecutor, se salta"; continue; }
  grep -q '^ES_DEMO=true$' "$ENV_SILO" || { echo "$SLUG: sin ES_DEMO=true en su .env, se salta"; continue; }
  if [ "$(grep -c 'ES_DEMO: \${ES_DEMO:-}' "$COMPOSE")" -ge 2 ]; then
    echo "$SLUG: ya tenia ES_DEMO en el backend"
    continue
  fi
  # CORREO_REMITENTE solo existe en el servicio backend de la plantilla: ES_DEMO va justo despues.
  [ "$(grep -c '^      CORREO_REMITENTE:' "$COMPOSE")" -eq 1 ] || falla "$SLUG: no se encontro una sola linea CORREO_REMITENTE en el backend"
  cp -p "$COMPOSE" "$COMPOSE.antes-r10"
  sed -i '/^      CORREO_REMITENTE:/a\      ES_DEMO: ${ES_DEMO:-}' "$COMPOSE"
  echo "$SLUG: ES_DEMO agregado al backend (copia en docker-compose.yml.antes-r10)"
done
echo "Listo. Ahora en la consola: Silos > <demo> > Actualizar (version del ERP con R10, canal demo)."
