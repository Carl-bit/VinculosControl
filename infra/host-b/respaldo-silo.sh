#!/bin/sh
# P9 de APROVISIONAR (continuidad), para el operador en el host B (Linux o Git
# Bash). Version PowerShell: respaldo-silo.ps1. En un host B Linux real, despues
# correr instalar.sh del ERP para el cron diario de las 02:00.
#
# Crea infra/secrets/<slug>/respaldo.key si no existe (nunca la reemplaza) y corre
# el respaldo del ERP (infra/scripts/continuidad/respaldar.sh) con el .env del ejecutor.
#
#   sh infra/host-b/respaldo-silo.sh <slug>
set -eu
SLUG=${1:?Uso: respaldo-silo.sh <slug>}
falla() { echo "respaldo-silo: $*" >&2; exit 1; }
echo "$SLUG" | grep -Eq '^[a-z][a-z0-9-]{1,38}[a-z0-9]$' || falla "slug invalido: $SLUG"

HOSTB=$(cd "$(dirname "$0")" && pwd)
valor() { [ -f "$HOSTB/.env" ] && sed -n "s/^$1=//p" "$HOSTB/.env" | tail -n 1 | tr -d '"\r' || true; }
IMAGENES=$(valor IMAGENES_HOST)
ERP=${ERP:-${IMAGENES%/infra/imagenes}}
[ -n "$ERP" ] || falla 'falta ERP=<raiz del ERP> o IMAGENES_HOST en infra/host-b/.env'
SILOS=$(valor SILOS_HOST)
SILOS=${SILOS:-$HOSTB/silos}
ENV_SILO="$SILOS/$SLUG/.env"
SECRETOS="$ERP/infra/secrets/$SLUG"

[ -f "$ERP/infra/scripts/continuidad/respaldar.sh" ] || falla "no existe respaldar.sh en $ERP"
[ -f "$ENV_SILO" ] || falla "no existe $ENV_SILO: el job APROVISIONAR aun no paso por P2"
head -n 1 "$ENV_SILO" | grep -q '^# Generado por el ejecutor' || falla "$ENV_SILO no lo creo el ejecutor"
[ -f "$SECRETOS/kek" ] || falla "$SLUG aun no tiene llaves (P5): primero llaves-silo.sh"

if [ ! -f "$SECRETOS/respaldo.key" ]; then
  (umask 077 && openssl rand -base64 48 > "$SECRETOS/respaldo.key")
  echo "respaldo.key creada (guardar una copia fuera del host)"
fi
CLIENTE_SLUG=$SLUG ENV_SILO=$ENV_SILO MSYS_NO_PATHCONV=1 sh "$ERP/infra/scripts/continuidad/respaldar.sh"
echo "Listo. En la consola, el job de $SLUG sigue (o reintenta desde P9)."
