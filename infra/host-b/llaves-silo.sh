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
[ -d "$SILOS/$SLUG" ] && [ ! -r "$SILOS/$SLUG" ] && falla "sin permiso para leer $SILOS/$SLUG (de $(stat -c %U "$SILOS/$SLUG" 2>/dev/null || echo otro usuario)): sudo chown -R $(id -un):$(id -gn) $SILOS (ejecutor anterior a EJECUTOR_UID_OPERADOR)"
[ -f "$ENV_SILO" ] || falla "no existe $ENV_SILO: el job APROVISIONAR aun no paso por P2"
head -n 1 "$ENV_SILO" | grep -q '^# Generado por el ejecutor' || falla "$ENV_SILO no lo creo el ejecutor"
[ ! -f "$ERP/infra/secrets/$SLUG/kek" ] || falla "$SLUG ya tiene KEK: no se vuelve a generar"

if [ "$PRUEBA" = --prueba ]; then
  echo "AVISO --prueba: al terminar se BORRAN las 3 partes de la llave de recuperacion y nadie podra recuperarla." >&2
  echo "Solo para silos de prueba; con un centro real, correr sin --prueba y entregar las partes." >&2
fi
echo "Llaves de $SLUG con el script del ERP ($SCRIPT)"
CLIENTE_SLUG=$SLUG MODO=docker ENV_SILO=$ENV_SILO ACTOR=${ACTOR:-$(whoami)} CUSTODIOS=$CUSTODIOS MSYS_NO_PATHCONV=1 sh "$SCRIPT"

PARTES="$ERP/infra/secrets/$SLUG/partes_entregar"
if [ "$PRUEBA" = --prueba ]; then
  rm -rf "$PARTES"
  echo "Silo de prueba: partes borradas ($PARTES)."
else
  echo
  echo "Partes para entregar (una por custodio, por canales distintos), en $PARTES:"
  # parte_N va al custodio N, en el orden en que se escribieron (cli-llaves del ERP).
  i=1
  echo "$CUSTODIOS" | tr ',' '\n' | while IFS=: read -r nombre rol; do
    echo "  parte_$i.shamir  ->  $nombre ($rol)"
    i=$((i + 1))
  done
  echo "Despues de entregarlas: shred -u $PARTES/* && rmdir $PARTES"
fi
echo "Luego, en la consola: job de $SLUG -> 'Llaves listas' con los mismos custodios."
