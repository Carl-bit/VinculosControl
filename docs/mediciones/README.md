# Mediciones

Una carpeta por corrida (`AAAA-MM-DD-<lugar>`), con los archivos crudos y su
`RESULTADOS.md`. Como se toman: `docs/despliegue-vps.md` (seccion de
mediciones) y `docs/operacion/servidor_pruebas.md` del ERP.

| Corrida | Que se midio | Resultado |
|---|---|---|
| [2026-11-20-externo-carga-estres](2026-11-20-externo-carga-estres/RESULTADOS.md) | k6 desde otro PC por el dominio publico (Cloudflare, tunel, Traefik) | Mismo comportamiento que adentro; Cloudflare y el tunel suman ~130 ms por peticion; p95 lectura publica 284 ms (umbral 300) |
| [2026-11-20-rampa-estres-solo](2026-11-20-rampa-estres-solo/RESULTADOS.md) (+ `2026-11-20-host-estres`) | Rampa 10 a 200 VUs, solo y con otros silos; huella por silo | Quiebre entre 100 y 200 VUs (CPU del backend al 100 %), 0 errores 5xx; 181 MiB por silo en reposo; caben 15 silos mas por limites |
| `2026-11-20-carga-estres-solo` | `medir.sh carga --solo` | No valida: k6 no corrio (error del script, corregido); repetir |
| [2026-11-20-solo](2026-11-20-solo/RESULTADOS.md) | k6 contra `estres` como unico silo (comparacion de las tres corridas) | Cumple todos los umbrales: 100 % de checks, 0 solapes, 0 respuestas 503, max 683 ms; p95 lectura publica 113 ms |
| [2026-11-20-vps](2026-11-20-vps/RESULTADOS.md) | k6 contra `estres` con 6 silos en el host; aprovisionamiento de demos | Integridad, memoria y lectura publica cumplen; `carga_normal` 99,6 % (10 fallos en la rafaga de reservas); demo completo en 1,5 a 2 min |

## Como medir

En el VPS, desde la raiz del repo del control (`git pull` en los dos repos
antes; el ERP trae `backend/pruebas/stress-rampa.js`):

| Comando | Que mide | Dura |
|---|---|---|
| `bash scripts/mediciones/medir.sh carga --solo` | `estres` solo: colision, lectura publica y equipo (como Windows) | ~8 min |
| `bash scripts/mediciones/medir.sh limpio` | lo mismo con `estres-limpio` recien sembrado, que despues se borra (separa datos acumulados de CPU) | ~15 min la primera vez |
| `bash scripts/mediciones/medir.sh rampa --solo` | punto de quiebre: 10, 25, 50, 100 y 200 VUs, 2 min c/u; quiebre = p95 > 300 ms o 5xx > 1 % | ~13 min |
| `bash scripts/mediciones/medir.sh host` | huella en reposo de cada silo arriba + rampa contra `estres` con todos: cuantos silos caben | ~15 min |
| `bash scripts/mediciones/medir.sh sonda demo-1` | `/api/salud` cada 1 s mientras se actualiza (Ctrl+C al terminar): segundos sin servicio | lo que dure |
| `bash scripts/mediciones/medir.sh jobs ACTUALIZAR` | tiempos por paso de los jobs de las ultimas 48 h (tambien APROVISIONAR, ELIMINAR...) | segundos |

`--solo` detiene los demas silos y `llama-server` y los vuelve a encender al
terminar, aunque algo falle. Cada modo deja `~/mediciones/<fecha>-<modo>/` con
un `resumen.txt`; se trae al PC con
`scp -r dev@<vps>:~/mediciones/<carpeta> "<repo>\docs\mediciones"` (sin barra
al final de la ruta de Windows).

Desde el PC, por el dominio publico (Cloudflare, tunel y Traefik en el camino;
Docker Desktop encendido):

```powershell
.\scripts\mediciones\medir-externo.ps1 -Dominio <dominio> -Ssh dev@<vps>
.\scripts\mediciones\medir-externo.ps1 -Dominio <dominio> -Ssh dev@<vps> -Modo rampa
```

Necesita el Mailpit del ERP publicado en `https://correo.<dominio>` (el codigo
del login de `estres`); deja la carpeta directo en `docs\mediciones\`.

Actualizacion en cascada: `medir.sh sonda <slug>` en una terminal, "Aplicar al
canal" en la consola, Ctrl+C al terminar y `medir.sh jobs ACTUALIZAR`.
Salida de un centro: manual por la consola (EN_SALIDA, exporte del ADMIN,
acta, detener, eliminar tras la gracia minima de 1 dia) y `medir.sh jobs
ELIMINAR` / `DETENER_SILO`.

Archivos de cada corrida: `maquina.txt` (hardware y contenedores),
`stats-reposo.csv` y `stats-carga.csv` (`docker stats` cada 5 s), `k6.txt` y
`k6.json` (resumen de k6), `verificar.txt` (solapes, reinicios, OOM) y
`aprovisionamiento.txt` (pasos de los jobs, de la BD `control`).
