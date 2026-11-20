# Mediciones en el VPS, silo solo (2026-11-20)

Misma prueba que `../2026-11-20-vps/` (k6 `stress-agenda.js`, 5 minutos),
pero con `estres` como unico silo en marcha: los demos detenidos y
`llama-server` apagado. Es la cifra limpia del silo en Linux, comparable con
la de Windows (2026-11-07, `docs/operacion/resultados_04_pruebas.md` del ERP).
Archivos crudos en esta carpeta; k6 corrio de 03:31:02 a 03:37:04.

## Maquina (`maquina.txt`)

i7-4790 (8 hilos), 15 GiB (13 GiB disponibles), Docker 29.9.2. En marcha:
`estres`, plano de control, agente, ejecutor, registro, Traefik, 2 Mailpit,
cloudflared y uptime-kuma. Sin otros silos ni `llama-server`. Limites del
silo: 256 MiB y 1 vCPU por servicio, `connection_limit=12`.

## Comparacion de las tres corridas

| Medida | Windows, silo solo (2026-11-07) | VPS, 6 silos (2026-11-20) | **VPS, silo solo (2026-11-20)** | Umbral |
|---|---|---|---|---|
| Colision: 201 / 409 / 503 / otro | 3 / 87 / 0 / 0 | 3 / 75 / 12 / 0 | **3 / 87 / 0 / 0** | una 201 por ronda |
| Citas activas solapadas | 0 | 0 | **0** | 0 |
| `lectura_publica` p95 | 6,6 ms | 103 ms | **113 ms** | < 300 ms |
| `lectura_publica` errores | 0 % | 0 % | **0 %** (16.158 checks) | 0 % 5xx |
| `carga_normal` 200 | 100 % | 99,6 % (10 fallos) | **100 %** (5.146 checks) | 100 % |
| Peticiones totales / por segundo | 23.789 / 79 | 21.089 / 69,9 | **21.398 / 71,1** | - |
| Duracion p95 / maxima (todas) | 8,2 ms / - | 157 ms / 17,5 s | **161 ms / 683 ms** | - |
| Pool lleno (P2028 en el log) | - | 12 respuestas 503 | **0** | - |
| Memoria pico backend / db | 98 / 100 MiB | 97 / 117 MiB | **99 / 118 MiB** | < 256 MiB, sin OOM |
| CPU pico backend / db (1 vCPU) | 32 % / 10 % | 87 % / 45 % | **87 % / 43 %** | - |
| CPU promedio en carga backend / db | - | 57 % / 29 % | **51 % / 26 %** | - |
| Reinicios / OOM | 0 / no | 0 / no | **0 / no** | 0 |

Recursos en reposo (antes de k6): backend 0 % y 82 MiB, db 0,6 % y 76 MiB,
frontend 53 MiB, Traefik 31 MiB.

## Lectura

- **Con el silo solo cumple todos los umbrales.** 100 % de checks en los dos
  escenarios, cero solapes, una reserva por ronda, ningun 503 y respuesta
  maxima de 683 ms.
- **Lo que cambia al compartir el host es la cola, no la mediana.** Con 6
  silos el p95 es casi el mismo (157 ms contra 161 ms), pero aparecen el pool
  lleno (12 respuestas 503), los 10 fallos de `ocupacion` y una respuesta de
  17,5 s. La diferencia es de picos simultaneos, no de capacidad media: la
  CPU del backend llega al mismo 87 % en las dos corridas.
- **La latencia del VPS es mayor que la de Windows tambien con el silo solo**
  (p95 113 ms contra 6,6 ms en lectura publica), asi que no se explica por
  los otros silos. Causas probables, sin medir por separado: (1) CPU de 2014
  (i7-4790) frente a la del equipo de desarrollo; (2) `estres` acumula datos
  de todas las corridas (cada una reserva horas nuevas), mientras que en
  Windows era un silo recien sembrado; la disponibilidad de 14 dias y la
  ocupacion recorren mas citas. Para separarlas: correr la prueba contra un
  silo `estres` recien creado en el mismo VPS.
- **Memoria: sobra.** Menos de la mitad del limite en los tres casos; el
  presupuesto de 1 GB por silo tiene holgura.
- **El limite del silo es la CPU del backend** (1 vCPU): 87 % de pico en la
  rafaga de reservas. Si en produccion hace falta mas margen, el primer ajuste
  es CPU del backend, no memoria ni conexiones.

## Pendiente

- Prueba desde otra maquina por `https://estres.<dominio>` (Cloudflare y
  Traefik en el camino).
- Silo `estres` recien sembrado en el VPS, para separar el efecto de los datos
  acumulados del de la CPU.
- Estres creciente (punto de quiebre) y cuantos silos soporta el host.
