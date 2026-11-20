# Rampa y capacidad del host (2026-11-20)

Punto de quiebre de un silo y huella de los silos en el host (seccion 13 de
`CONTEXTO.md`: "Estres | k6 con carga creciente | punto de quiebre por silo y
del host"). Dos corridas con `scripts/mediciones/medir.sh`, misma maquina que
`../2026-11-20-vps/` (i7-4790, 8 hilos, 15 GiB):

| Carpeta | Comando | Que habia arriba |
|---|---|---|
| `2026-11-20-rampa-estres-solo/` | `medir.sh rampa --solo` | solo `estres` (demos y `llama-server` detenidos) |
| `2026-11-20-host-estres/` | `medir.sh host` | `estres`, `demo`, `demo-paris`, `llama-server` y la db de un `estres-limpio` a medias |

Rampa (`stress-rampa.js` del ERP): 10, 25, 50, 100 y 200 VUs, 2 min cada
etapa (15 s de subida). 7 de cada 10 VUs leen el sitio publico (centro,
catalogo, disponibilidad de 14 dias) y 3 de cada 10 son del equipo
(ocupacion y citas de 7 dias); 1 s de pausa por iteracion; solo lecturas.
Quiebre: p95 > 300 ms o mas de 1 % de respuestas 5xx. k6 en la red de borde
del silo (misma maquina).

## Rampa

| VUs | Solo: pet/s | Solo: p95 | Solo: max | Host: pet/s | Host: p95 | Host: max | 5xx | Quiebre |
|---|---|---|---|---|---|---|---|---|
| 10 | 23,5 | 67 ms | 342 ms | 24,6 | 55 ms | 259 ms | 0 % | no |
| 25 | 58,0 | 139 ms | 551 ms | 58,0 | 135 ms | 520 ms | 0 % | no |
| 50 | 111,4 | 187 ms | 529 ms | 112,5 | 188 ms | 572 ms | 0 % | no |
| 100 | 214,5 | 197 ms | 447 ms | 211,0 | 207 ms | 495 ms | 0 % | no |
| 200 | 250,2 | **805 ms** | 1.114 ms | 243,9 | **855 ms** | 1.190 ms | 0 % | **SI** |

En las dos corridas: 0 respuestas 5xx, 0 respuestas 429, 0 P2028 (pool
lleno) en el log del backend, 0 solapes, 0 reinicios, 0 OOM.

CPU del backend de `estres` (promedio por minuto, corrida solo; 100 % = su
vCPU completa):

| Minuto | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Etapa | 10 | 10-25 | 25 | 25-50 | 50 | 50-100 | 100 | 100-200 | 200 | 200 |
| CPU | 26 % | 39 % | 46 % | 51 % | 62 % | 76 % | 85 % | 100 % | 101 % | 99 % |

Pico 104 % (solo) y 106 % (host). La db llega a 71 % de su vCPU. RAM pico:
backend 115 MiB, db 104 MiB, de 256 MiB cada uno.

## Lectura

- **Punto de quiebre: entre 100 y 200 VUs.** Hasta 100 VUs (unas 215
  peticiones por segundo) el p95 queda bajo 210 ms. A 200 VUs el silo da
  solo 250 por segundo (deberia dar ~430 si escalara) y el p95 sube a
  805 ms: las peticiones esperan en cola.
- **La causa es la CPU del backend.** Llega a 100 % de su vCPU en la subida
  a 200 VUs y se queda ahi. La memoria y el pool de conexiones no son el
  limite (RAM bajo la mitad, 0 P2028). Para mas capacidad por silo hay que
  subir la CPU del backend, no la RAM.
- **Degrada sin errores.** Sobre el quiebre la API se pone lenta pero no
  devuelve 5xx: no colapsa.
- **Traducido a uso real:** 100 VUs con 1 s de pausa son mucho mas que un
  centro (decenas de profesionales y pacientes que no piden cada segundo).
  El silo tiene holgura amplia para un centro con el limite de 1 vCPU.
- **Los otros silos en reposo no afectan.** Con `demo`, `demo-paris` y
  `llama-server` arriba la rampa da lo mismo (diferencias de 2 a 6 %, dentro
  del ruido). Lo que afecta es otro silo con carga (la colision de la corrida
  con 6 silos, `../2026-11-20-vps/`).

## Capacidad del host (`host-estres/resumen.txt`)

RAM de cada silo en reposo (db + backend + frontend, promedio de 2 min):

| Silo | RAM en reposo |
|---|---|
| `demo` | 158 MiB |
| `demo-paris` | 158 MiB |
| `estres` (con mas datos acumulados) | 226 MiB |

`estres-limpio` tenia solo la db (31 MiB): era una corrida de `medir.sh
limpio` que no termino. El resumen lo conto como silo y dio 143 MiB por silo
y "82 silos mas"; sin el, el promedio es **181 MiB** (corregido en
`medir.sh`: los silos sin backend ya no cuentan).

RAM disponible: 12.889 MiB; se reservan 1.024 MiB para el SO y el plano del
host. Quedan 11.865 MiB:

| Criterio | Silos mas que caben |
|---|---|
| Por uso real en reposo (181 MiB) | ~65 |
| Por limites (768 MiB por silo: 3 x 256) | **15** |
| Por CPU con carga simultanea (backend 1 vCPU + db ~0,7) | ~4 a 5 activos a la vez en 8 hilos |

- El numero seguro para planificar es el de los limites: **15 silos mas**
  (unos 18 en total) en este host. Asi ningun silo puede dejar a otro sin
  memoria aunque todos llenen su limite.
- La CPU no limita la cantidad de silos (en reposo usan ~1 %), limita
  cuantos pueden estar en su pico a la vez. Centros con horas punta
  parecidas compiten por los 8 hilos.
- Durante la rampa la RAM del host bajo solo 142 MiB (free: 12.889 ->
  12.747 MiB); el swap no se uso.

## Pendiente

- `medir.sh carga --solo` (`2026-11-20-carga-estres-solo/`) **no es valida**:
  k6 no corrio (`k6.txt` vacio, inicio y fin a las 04:14:43). Causa: el
  script pasaba `--summary-export` antes de la imagen y docker lo rechazaba.
  Corregido en `medir.sh`; repetir. La carga del silo solo ya esta medida a
  mano en `../2026-11-20-solo/`.
- `medir.sh limpio`: no hay carpeta y quedo `erp-estres-limpio-db-1`
  corriendo sin backend. Revisar la salida de `servidor.sh levantar` y
  repetir. Ahora `medir.sh` borra `estres-limpio` tambien cuando `levantar`
  falla.
