#!/bin/bash
# Mediciones del host B (seccion 13 de CONTEXTO.md). Corre en el VPS, desde
# cualquier carpeta. Cada modo deja una carpeta ~/mediciones/<fecha>-<modo>/
# con los archivos crudos y un resumen.txt; para analizarla, traerla al PC:
#   scp -r dev@<vps>:~/mediciones/<carpeta> "<repo>\docs\mediciones"
#
#   medir.sh carga  [slug] [--solo]   k6 stress-agenda.js (5 min): colision, lectura publica, equipo
#   medir.sh limpio                   crea estres-limpio (recien sembrado), mide carga --solo y lo borra
#   medir.sh rampa  [slug] [--solo]   k6 stress-rampa.js: 10, 25, 50, 100, 200 VUs (2 min c/u), punto de quiebre
#   medir.sh host   [slug]            huella de cada silo en reposo + rampa con todos arriba: cuantos silos caben
#   medir.sh sonda  <slug>            /api/salud cada 1 s por el dominio publico (Ctrl+C): segundos sin servicio
#   medir.sh jobs   <TIPO> [horas]    tiempos por paso de los jobs (APROVISIONAR, ACTUALIZAR, ELIMINAR...)
#
# slug por defecto: estres. --solo detiene los demas silos (erp-*) y OTROS
# (por defecto llama-server) y los vuelve a encender al terminar, aunque falle.
# Variables: ERP (raiz del ERP; si no, la de IMAGENES_HOST de infra/host-b/.env),
# MEDICIONES (~/mediciones), DOMINIO_BASE (si no, la de infra/host-a/.env),
# OTROS ("llama-server"), CONSERVAR=1 (limpio: no borra estres-limpio).
set -euo pipefail

CONTROL=$(cd "$(dirname "$0")/../.." && pwd)
valor() { [ -f "$1" ] && sed -n "s/^$2=//p" "$1" | tail -n 1 | tr -d '"\r' || true; }
IMAGENES=$(valor "$CONTROL/infra/host-b/.env" IMAGENES_HOST)
ERP=${ERP:-${IMAGENES%/infra/imagenes}}
ERP=${ERP:-$HOME/Vinculos/Vinculos}
BASE=${MEDICIONES:-$HOME/mediciones}
DOMINIO_BASE=${DOMINIO_BASE:-$(valor "$CONTROL/infra/host-a/.env" DOMINIO_BASE)}
OTROS=${OTROS:-llama-server}
K6=grafana/k6:0.54.0
R=""

falla() { echo "medir: $*" >&2; exit 1; }
paso() { echo "== $*"; }
ahora() { date +%T; }

[ -d "$ERP/backend/pruebas" ] || falla "no encuentro el ERP en $ERP (ERP=<ruta>)"

carpeta() {
  R="$BASE/$(date +%F)-$1"
  [ -e "$R" ] && R="$R-$(date +%H%M)"
  mkdir -p "$R"
  echo "Carpeta: $R"
}

maquina() {
  { lscpu | grep -E 'Model name|^CPU\(s\)'; free -h; df -h /; docker version --format 'Docker {{.Server.Version}}'
    echo '--- contenedores'; docker ps --format '{{.Names}}'; } > "$R/maquina.txt"
}

# docker stats cada 5 s de los contenedores que calzan con $1, a $2.
muestrear() {
  while true; do
    docker stats --no-stream --format "$(date +%T),{{.Name}},{{.CPUPerc}},{{.MemUsage}}" | grep -E "$1" || true
    sleep 5
  done
}
STATS_PID=""
stats_inicio() { muestrear "$1" > "$R/$2" & STATS_PID=$!; }
stats_fin() { [ -n "$STATS_PID" ] && kill "$STATS_PID" 2>/dev/null || true; STATS_PID=""; }

reposo() {
  paso "Reposo (2 min)"
  muestrear "$1" > "$R/stats-reposo.csv" & local pid=$!
  sleep 120; kill "$pid" 2>/dev/null || true
}

# --solo: detiene los otros silos y OTROS; vuelven al terminar (trap).
DETENIDOS=""
detener_otros() {
  local slug=$1
  DETENIDOS="$R/detenidos.txt"
  { docker ps --format '{{.Names}}' | grep -E '^erp-' | grep -v -E "^erp-${slug}-(db|backend|frontend|migrate)-1$" || true
    for o in $OTROS; do docker ps --format '{{.Names}}' | grep -x "$o" || true; done; } > "$DETENIDOS"
  if [ -s "$DETENIDOS" ]; then
    paso "Deteniendo $(wc -l < "$DETENIDOS") contenedor(es) para medir $slug solo (vuelven al terminar)"
    docker stop $(cat "$DETENIDOS") > /dev/null
  fi
}
restaurar() {
  stats_fin
  if [ -n "$DETENIDOS" ] && [ -s "$DETENIDOS" ]; then
    paso "Encendiendo lo detenido"
    docker start $(cat "$DETENIDOS") > /dev/null || echo "medir: revisar a mano: docker start \$(cat $DETENIDOS)" >&2
    DETENIDOS=""
  fi
}
trap restaurar EXIT
trap 'exit 130' INT TERM

credenciales() {
  local slug=$1
  P=$(valor "$ERP/infra/servidor/silos/$slug.env" SEED_PASSWORD)
  M=$(valor "$ERP/.env" MAILPIT_UI_AUTH)
  [ -n "$P" ] || falla "sin SEED_PASSWORD en $ERP/infra/servidor/silos/$slug.env (silo de servidor.sh?)"
  [ -n "$M" ] || falla "sin MAILPIT_UI_AUTH en $ERP/.env"
  docker network inspect "erp-${slug}_borde" > /dev/null 2>&1 || falla "no existe la red erp-${slug}_borde (silo levantado?)"
}

# Contenedores de un silo y Traefik en el CSV de stats (hora,nombre,cpu,ram).
del_silo() { echo ",erp-$1-(db|backend|frontend)-1,|,vinculos-servidor-traefik-1,"; }

# k6 en la red de borde del silo. $1 slug, $2 script, resto: argumentos extra de docker run.
k6() {
  local slug=$1 script=$2; shift 2
  docker run --rm --user "$(id -u):$(id -g)" --network "erp-${slug}_borde" \
    -v "$ERP/backend/pruebas:/scripts:ro" -v "$R:/out" \
    -e API_URL="http://erp-${slug}-backend-1:3001/api" -e MAILPIT_URL="http://$M@mailpit:8025" -e PASSWORD="$P" \
    "$@" "$K6" run "/scripts/$script"
}

# Picos y promedios de un CSV de stats, entre dos horas (o todo).
picos() {
  awk -F, -v a="${2:-00:00:00}" -v b="${3:-99:99:99}" '$1>=a && $1<=b {
    gsub(/%/,"",$3); split($4,m," / "); v=m[1]
    if (v ~ /GiB/) {sub(/GiB/,"",v); v*=1024} else if (v ~ /KiB/) {sub(/KiB/,"",v); v/=1024} else sub(/MiB/,"",v)
    n[$2]++; sc[$2]+=$3; sm[$2]+=v; if ($3+0>cpu[$2]) cpu[$2]=$3+0; if (v+0>mem[$2]) mem[$2]=v+0
  } END { for (c in n) printf "%-34s CPU prom %5.1f %%  pico %5.1f %%   RAM prom %4.0f  pico %4.0f MiB\n", c, sc[c]/n[c], cpu[c], sm[c]/n[c], mem[c] }' "$1" | sort
}

cierre() {
  local slug=$1 desde=$2 hasta=$3
  paso "Verificacion"
  CLIENTE_SLUG=$slug sh "$ERP/infra/stress/verificar.sh" > "$R/verificar.txt" 2>&1 || true
  docker logs "erp-${slug}-backend-1" --since "$4" 2>&1 | grep -c P2028 > "$R/p2028.txt" || true
  { echo "Silo: $slug   k6: $desde a $hasta"
    echo; echo "--- verificar"; cat "$R/verificar.txt"
    echo; echo "--- pool lleno (P2028 en el log del backend): $(cat "$R/p2028.txt")"
    echo; echo "--- reposo"; picos "$R/stats-reposo.csv"
    echo; echo "--- durante k6"; picos "$R/stats-carga.csv" "$desde" "$hasta"; } > "$R/resumen.txt"
  cat "$R/resumen.txt"
}

modo_carga() {
  local slug=${1:-estres} solo=${2:-}
  carpeta "carga-$slug${solo:+-solo}"
  credenciales "$slug"
  [ -n "$solo" ] && detener_otros "$slug"
  maquina
  reposo "$(del_silo "$slug")"
  stats_inicio "$(del_silo "$slug")" stats-carga.csv
  paso "k6 stress-agenda.js (5 min)"
  local log desde hasta; log=$(date -u +%Y-%m-%dT%H:%M:%SZ); desde=$(ahora)
  k6 "$slug" stress-agenda.js --summary-export=/out/k6.json | tee "$R/k6.txt" || echo "k6 cruzo algun umbral (ver k6.txt)"
  hasta=$(ahora); sleep 6; stats_fin
  cierre "$slug" "$desde" "$hasta" "$log"
}

modo_rampa() {
  local slug=${1:-estres} solo=${2:-}
  carpeta "rampa-$slug${solo:+-solo}"
  credenciales "$slug"
  [ -n "$solo" ] && detener_otros "$slug"
  maquina
  reposo "$(del_silo "$slug")"
  stats_inicio "$(del_silo "$slug")" stats-carga.csv
  paso "k6 stress-rampa.js (10, 25, 50, 100, 200 VUs; unos 10 min)"
  local log desde hasta; log=$(date -u +%Y-%m-%dT%H:%M:%SZ); desde=$(ahora)
  k6 "$slug" stress-rampa.js -e SALIDA=/out/rampa.json | tee "$R/k6.txt" || echo "k6 cruzo umbrales (esperado en una rampa)"
  hasta=$(ahora); sleep 6; stats_fin
  cierre "$slug" "$desde" "$hasta" "$log"
  { echo; echo "--- rampa"; sed -n '/^Rampa contra/,$p' "$R/k6.txt"; } >> "$R/resumen.txt"
  sed -n '/^Rampa contra/,$p' "$R/k6.txt"
}

modo_limpio() {
  local slug=estres-limpio
  [ -n "$DOMINIO_BASE" ] || falla "falta DOMINIO_BASE (infra/host-a/.env o DOMINIO_BASE=...)"
  paso "Creando $slug recien sembrado (servidor.sh del ERP; la primera vez tarda unos minutos)"
  ( cd "$ERP" && PERFIL=estres sh infra/servidor/servidor.sh levantar "$slug" "$slug.$DOMINIO_BASE" "Centro Estres Limpio" )
  local estado=0
  modo_carga "$slug" --solo || estado=$?
  restaurar
  if [ "${CONSERVAR:-0}" = 1 ]; then
    echo "CONSERVAR=1: $slug queda arriba"
  else
    paso "Borrando $slug (contenedores, volumenes, .env, llaves de prueba y token)"
    ( cd "$ERP" && sh infra/servidor/servidor.sh bajar "$slug" ) || true
    docker compose -p "erp-$slug" down -v --remove-orphans || true
    rm -rf "$ERP/infra/servidor/silos/$slug.env" "$ERP/infra/secrets/$slug" "$ERP/infra/servidor/internos/$slug.token"
  fi
  return $estado
}

modo_host() {
  local slug=${1:-estres}
  carpeta "host-$slug"
  credenciales "$slug"
  maquina
  paso "Huella de todos los silos en reposo (2 min)"
  reposo ",erp-"
  free -m > "$R/free-reposo.txt"
  stats_inicio ",erp-|,vinculos-servidor-traefik-1," stats-carga.csv
  paso "Rampa contra $slug con todos los silos arriba"
  local log desde hasta; log=$(date -u +%Y-%m-%dT%H:%M:%SZ); desde=$(ahora)
  k6 "$slug" stress-rampa.js -e SALIDA=/out/rampa.json | tee "$R/k6.txt" || true
  hasta=$(ahora); sleep 6; stats_fin
  free -m > "$R/free-carga.txt"
  cierre "$slug" "$desde" "$hasta" "$log"
  # Por silo: suma de sus contenedores (RAM promedio en reposo) y cuantos mas caben.
  local disp; disp=$(awk '/^Mem:/ {print $7}' "$R/free-reposo.txt")
  { echo; echo "--- silos en reposo (suma de db, backend y frontend)"
    awk -F, '{ split($4,m," / "); v=m[1]; if (v ~ /GiB/) {sub(/GiB/,"",v); v*=1024} else sub(/MiB/,"",v)
      s=$2; sub(/-(db|backend|frontend|migrate)-1$/,"",s); suma[s"|"$1]+=v; vistos[s]=1 }
      END { for (k in suma) { split(k,p,"|"); tot[p[1]]+=suma[k]; n[p[1]]++ } for (s in vistos) printf "%-28s %5.0f MiB\n", s, tot[s]/n[s] }' "$R/stats-reposo.csv" | sort
    echo
    awk -F, -v disp="$disp" '{ split($4,m," / "); v=m[1]; if (v ~ /GiB/) {sub(/GiB/,"",v); v*=1024} else sub(/MiB/,"",v)
      s=$2; sub(/-(db|backend|frontend|migrate)-1$/,"",s); suma[s"|"$1]+=v; vistos[s]=1 }
      END { for (k in suma) { split(k,p,"|"); tot[p[1]]+=suma[k]; n[p[1]]++ } c=0; t=0; for (s in vistos) { c++; t+=tot[s]/n[s] }
        prom=t/c; reserva=1024
        printf "Silos: %d, RAM promedio por silo en reposo: %.0f MiB\n", c, prom
        printf "RAM disponible del host: %d MiB (se reservan %d MiB para el SO y el plano del host)\n", disp, reserva
        printf "Caben aprox. %d silos mas por uso en reposo, %d mas por limite (768 MiB por silo)\n", (disp-reserva)/prom, (disp-reserva)/768 }' "$R/stats-reposo.csv"; } >> "$R/resumen.txt"
  sed -n '/--- silos en reposo/,$p' "$R/resumen.txt"
  sed -n '/^Rampa contra/,$p' "$R/k6.txt"
}

modo_sonda() {
  local slug=${1:?Uso: medir.sh sonda <slug>}
  [ -n "$DOMINIO_BASE" ] || falla "falta DOMINIO_BASE"
  carpeta "sonda-$slug"
  local url="https://$slug.$DOMINIO_BASE/api/salud"
  paso "Sonda a $url cada 1 s. Ctrl+C para terminar (despues de la actualizacion)"
  trap 'resumen_sonda; exit 0' INT
  while true; do
    echo "$(date +%T) $(curl -s -o /dev/null -m 5 -w '%{http_code}' "$url" || true)" | tee -a "$R/sonda.txt"
    sleep 1
  done
}
resumen_sonda() {
  awk '{ n++; if ($2!="200") { malas++; racha++; if (racha>max) {max=racha; fin=$1} } else racha=0 }
    END { printf "Muestras: %d, distintas de 200: %d, racha mas larga sin servicio: %d s (termino %s)\n", n, malas, max, fin }' "$R/sonda.txt" | tee "$R/resumen.txt"
}

modo_jobs() {
  local tipo=${1:?Uso: medir.sh jobs <TIPO> [horas]} horas=${2:-48}
  echo "$tipo" | grep -Eq '^[A-Z_]+$' || falla "tipo invalido: $tipo"
  echo "$horas" | grep -Eq '^[0-9]+$' || falla "horas invalidas: $horas"
  carpeta "jobs-$(echo "$tipo" | tr 'A-Z_' 'a-z-')"
  docker exec -i vinculos-control-db-1 psql -U control -d control > "$R/jobs.txt" <<SQL
SELECT j.id, j.silo_slug, p.codigo, p.estado, p.intentos, round(extract(epoch FROM p.fin_en - p.inicio_en)) AS seg
FROM pasos_job p JOIN jobs j ON j.id = p.job_id
WHERE j.tipo = '$tipo' AND j.creado_en > now() - interval '$horas hours'
ORDER BY j.id, p.orden;
SELECT j.id, j.silo_slug, j.estado, round(extract(epoch FROM j.terminado_en - j.creado_en)) AS seg_total,
       sum(p.intentos) - count(*) FILTER (WHERE p.intentos > 0) AS reintentos
FROM jobs j JOIN pasos_job p ON p.job_id = j.id
WHERE j.tipo = '$tipo' AND j.creado_en > now() - interval '$horas hours'
GROUP BY j.id ORDER BY j.id;
SQL
  cat "$R/jobs.txt"
}

ACCION=${1:-}
[ $# -gt 0 ] && shift
SOLO=""
ARGS=()
for a in "$@"; do if [ "$a" = --solo ]; then SOLO=--solo; else ARGS+=("$a"); fi; done
case "$ACCION" in
  carga) modo_carga "${ARGS[0]:-estres}" "$SOLO" ;;
  rampa) modo_rampa "${ARGS[0]:-estres}" "$SOLO" ;;
  limpio) modo_limpio ;;
  host) modo_host "${ARGS[0]:-estres}" ;;
  sonda) modo_sonda "${ARGS[0]:-}" ;;
  jobs) modo_jobs "${ARGS[0]:-}" "${ARGS[1]:-48}" ;;
  *) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
echo
echo "Listo: $R"
