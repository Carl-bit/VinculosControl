# Mediciones en el VPS (2026-11-20)

Primera corrida de carga y aprovisionamiento en el servidor real (Linux), con
el tunel de Cloudflare, Traefik y el plano de control en marcha. Repite en
Linux lo medido el 2026-11-07 en Windows (`docs/operacion/resultados_04_pruebas.md`
del ERP) y agrega los tiempos de aprovisionamiento por la consola (seccion 13
de `CONTEXTO.md`). Archivos crudos en esta carpeta.

## Maquina y contexto (`maquina.txt`)

| Dato | Valor |
|---|---|
| CPU | Intel Core i7-4790 @ 3.60 GHz, 8 hilos |
| RAM | 15 GiB (11 GiB disponibles al empezar), swap 4 GiB sin uso |
| Disco | 457 GB, 12 % usado |
| Docker | 29.9.2, `default-address-pools` 10.200.0.0/16 en /24 |
| Silos en marcha | 6: `estres` (medido), `demo`, `demo-1`, `demo-2`, `demo-5`, `demo-paris` |
| Otros servicios | plano de control completo, agente, ejecutor, registro, Traefik, 2 Mailpit, cloudflared, uptime-kuma y `llama-server` (en marcha al tomar `maquina.txt`) |

Limites del silo medido, iguales al plan objetivo: db 256 MiB, backend 256 MiB,
frontend 256 MiB, 1 vCPU por servicio; `connection_limit=12`.

Importante para comparar: en Windows (2026-11-07) habia un solo silo en la
maquina. Aqui el silo comparte el host con otros 5 silos, el plano de control
y un modelo de lenguaje. Los tiempos son una cota superior del silo solo.

## Carga con k6 (`k6.txt`, `k6.json`, `verificar.txt`)

k6 0.54.0 en un contenedor en la red de borde del silo (misma maquina: le
quita CPU al silo). 5 minutos, 3 escenarios: `carga_normal` (10 VUs del
equipo: ocupacion y citas de 7 dias), `lectura_publica` (20 VUs: centro,
catalogo y disponibilidad de 14 dias) y `colision_reserva` (30 VUs x 3 rondas
sobre el mismo profesional y horario).

| Medida | VPS 2026-11-20 | Windows 2026-11-07 | Umbral | Resultado |
|---|---|---|---|---|
| Colision: reservas 201 / 409 / 503 / otro | 3 / 75 / 12 / 0 | 3 / 87 / 0 / 0 | una 201 por ronda, 0 de otro estado | Cumple |
| Citas activas solapadas despues de la corrida | **0** | 0 | 0 | Cumple |
| `lectura_publica`: p95 y errores | p95 103 ms, mediana 21 ms, 0 % de errores (15.939 checks) | p95 6,6 ms | p95 < 300 ms, 0 % 5xx | Cumple |
| `carga_normal`: respuestas 200 | `citas` 100 %; `ocupacion` 99,6 % (10 de 2.528 fallaron) | 100 % | 100 % | **No cumple** |
| Total | 21.089 peticiones, 69,9 por segundo, p95 157 ms, max 17,5 s | 23.789, 79 por segundo, p95 8,2 ms | - | - |
| Reinicios / OOM | 0 / no | 0 / no | 0 | Cumple |

Fallos HTTP: 97 de 21.089 (0,45 %) = 75 respuestas 409 y 12 respuestas 503 de
la colision (esperadas) + los 10 de `ocupacion`.

## Recursos del silo (`stats-carga.csv`, `stats-reposo.csv`)

`docker stats` cada 5 s. Promedios dentro de la ventana de k6 (02:36:35 a
02:41:40); "reposo" es la misma maquina antes de la prueba.

| Contenedor | CPU reposo | CPU prom. en carga | CPU pico | RAM reposo | RAM prom. en carga | RAM pico | Limite |
|---|---|---|---|---|---|---|---|
| backend | 0,2 % | 57 % | 87 % (02:37:57, colision) | 79 MiB | 95 MiB | 97 MiB | 256 MiB |
| db | 1,2 % | 29 % | 45 % (02:37:57) | 70 MiB | 112 MiB | 117 MiB | 256 MiB |
| frontend | 0 % | 0 % | 0 % | 53 MiB | 53 MiB | 53 MiB | 256 MiB |
| Traefik | 0,2 % | 0,1 % | 1,6 % | 33 MiB | 32 MiB | 35 MiB | 128 MiB |

(Porcentajes de CPU sobre un nucleo: el limite del servicio es 1 vCPU.)

## Lectura

- **Integridad bajo choque: cumple.** 30 reservas simultaneas por ronda sobre
  el mismo horario dejan exactamente una por ronda y cero solapes; el
  `EXCLUDE` de la BD sostiene la regla aunque la API sature.
- **Memoria: holgada.** Pico de 97 MiB (backend) y 117 MiB (db) de 256 MiB:
  menos de la mitad del presupuesto por servicio.
- **El cuello es la CPU del backend.** Llega a 87 % de su vCPU en la rafaga de
  reservas. En ese momento el pool de 12 conexiones se llena: 12 reservas
  reciben 503 con `Retry-After` (diseno de 2026-11-07, la API no colapsa) y
  hay respuestas lentas (max 17,5 s). Los 10 fallos de `ocupacion` caen en la
  misma prueba; lo mas probable es que tambien sean 503 del pool, pero k6 no
  guardo su codigo: confirmar con
  `docker logs erp-estres-backend-1 --since <hora> | grep -c P2028`.
- **Latencia mayor que en Windows** (p95 global 8 ms -> 157 ms; lectura publica
  7 ms -> 103 ms). No es comparable uno a uno: 6 silos, el plano de control y
  `llama-server` compartian el host, y k6 corria en la misma maquina. Sigue
  muy por debajo del umbral de lectura publica (300 ms).

Repetido con el silo solo el mismo dia: `../2026-11-20-solo/RESULTADOS.md`
(cumple todos los umbrales; ahi esta la comparacion de las tres corridas).
Pendiente: k6 desde otra maquina por `https://estres.<dominio>` (pasa por
Cloudflare y Traefik).

## Aprovisionamiento por la consola (`aprovisionamiento.txt`)

Corridas limpias con el flujo actual de demos (P5 por el ejecutor, P9
omitido), sin intervencion del operador:

| Job | Demo | Total | P2 | P4 BD | P5 llaves | P6 levantar | P8 dominio | P10 datos |
|---|---|---|---|---|---|---|---|---|
| 18 | demo-facil | 91 s | 0 s | 23 s | 13 s | 12 s | 4 s | 27 s |
| 20 | demo-1 | 99 s | 0 s | 23 s | 11 s | 13 s | 1 s | 47 s |
| 25 | demo-5 | 126 s | 0 s | 29 s | 13 s | 13 s | 1 s | 59 s |

- Un demo completo: 1,5 a 2 minutos. P4 (BD y migraciones), P5 y P6 son
  estables (~50 s entre los tres); P10 varia con la cantidad de datos
  generados.
- Tasa de exito de las corridas limpias: 3 de 3, sin reintentos.

Corridas que no entran en la tabla, y por que:

| Jobs | Que paso | Estado hoy |
|---|---|---|
| 1, 2, 5, 6, 8, 10 | P0 rechazo el manifiesto (validacion antes de crear nada) | Comportamiento esperado |
| 12, 14 | P5 manual (antes de 2026-11-19): 25 y 36 min por la espera del operador | Reemplazado por P5 automatico en demos |
| 21, 24 | `demo-2` heredo la KEK de un demo eliminado con el mismo slug: el backend no levantaba (P6) | Corregido: la baja vacia `secrets/<slug>/` y P5 descarta una KEK sin llaves en la BD |
| 22 | Docker sin subredes (`all predefined address pools have been fully subnetted`) y reintento en loop | Corregido: `default-address-pools` y el agente acota el error del paso |
