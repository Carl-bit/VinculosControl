#!/bin/sh
# P5 de APROVISIONAR (llaves del silo), para el operador en el host B (Linux o
# Git Bash). Version PowerShell: llaves-silo.ps1.
#
# NO genera llaves por su cuenta: solo prepara las variables y llama al script
# manual del ERP (infra/scripts/llaves/aprovisionar.sh) con el .env que dejo el
# ejecutor en P2. Lo corre siempre el operador.
#
#   sh infra/host-b/llaves-silo.sh <slug> "Ana Perez:proveedor,Luis Soto:centro,Sobre:caja fuerte" [--prueba]
#
# --prueba: silo de prueba, borra las partes al final. Rutas desde
# infra/host-b/.env: IMAGENES_HOST (de ahi la raiz del ERP; o ERP=<ruta>) y
# SILOS_HOST (vacio = infra/host-b/silos).
set -eu
SLUG=${1:?Uso: llaves-silo.sh <slug> "<Nombre:rol,Nombre:rol,Nombre:rol>" [--prueba]}
CUSTODIOS=${2:?Faltan los custodios: tres Nombre:rol separados por coma}
PRUEBA=${3:-}
falla() { echo "llaves-silo: $*" >&2; exit 1; }

echo "$SLUG" | grep -Eq '^[a-z][a-z0-9-]{1,38}[a-z0-9]$' || falla "slug invalido: $SLUG"
echo "$CUSTODIOS" | grep -Eq '^[^:,]+:[^:,]+(,[^:,]+:[^:,]+){2}$' || falla 'custodios: tres "Nombre:rol" separados por coma'

HOSTB=$(cd "$(dirname "$0")" && pwd)
valor() { [ -f "$HOSTB/.env" ] && sed -n "s/^$1=//p" "$HOSTB/.env" | tail -n 1 | tr -d '"\r' || true; }
IMAGENES=$(valor IMAGENES_HOST)
ERP=${ERP:-${IMAGENES%/infra/imagenes}}
[ -n "$ERP" ] || falla 'falta ERP=<raiz del ERP> o IMAGENES_HOST en infra/host-b/.env'
SILOS=$(valor SILOS_HOST)
SILOS=${SILOS:-$HOSTB/silos}
ENV_SILO="$SILOS/$SLUG/.env"
SCRIPT="$ERP/infra/scripts/llaves/aprovisionar.sh"

[ -f "$SCRIPT" ] || falla "no existe $SCRIPT"
[ -f "$ENV_SILO" ] || falla "no existe $ENV_SILO: el job APROVISIONAR aun no paso por P2"
head -n 1 "$ENV_SILO" | grep -q '^# Generado por el ejecutor' || falla "$ENV_SILO no lo creo el ejecutor"
[ ! -f "$ERP/infra/secrets/$SLUG/kek" ] || falla "$SLUG ya tiene KEK: no se vuelve a generar"

echo "Llaves de $SLUG con el script del ERP ($SCRIPT)"
CLIENTE_SLUG=$SLUG MODO=docker ENV_SILO=$ENV_SILO ACTOR=${ACTOR:-$(whoami)} CUSTODIOS=$CUSTODIOS MSYS_NO_PATHCONV=1 sh "$SCRIPT"

PARTES="$ERP/infra/secrets/$SLUG/partes_entregar"
if [ "$PRUEBA" = --prueba ]; then
  rm -rf "$PARTES"
  echo "Silo de prueba: partes borradas ($PARTES)."
else
  echo "Entrega cada parte de $PARTES a su custodio por un canal distinto y despues borrala (shred -u)."
fi
echo "Luego, en la consola: job de $SLUG -> 'Llaves listas' con los mismos custodios."
