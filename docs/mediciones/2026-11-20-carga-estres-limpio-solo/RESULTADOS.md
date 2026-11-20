# Silo recien sembrado contra silo con datos acumulados (2026-11-20)

Separa las dos causas posibles de que el VPS sea mas lento que Windows
(`../2026-11-20-solo/RESULTADOS.md`): datos acumulados en `estres` o CPU de
la maquina. Dos corridas de `stress-agenda.js` (5 min: colision, lectura
publica y equipo) con `scripts/mediciones/medir.sh`, cada silo como unico
silo en el host (demos, el otro silo y `llama-server` detenidos):

| Carpeta | Comando | Silo |
|---|---|---|
| `2026-11-20-carga-estres-limpio-solo/` | `medir.sh limpio` | `estres-limpio`, creado y sembrado justo antes, borrado al final |
| `2026-11-20-carga-estres-solo-0612/` | `medir.sh carga --solo` | `estres`, con los datos de todas las corridas anteriores |

Misma maquina (i7-4790, 8 hilos), mismos limites (256 MiB y 1 vCPU por
servicio, `connection_limit=12`), mismo `PERFIL=estres`.
`2026-11-20-carga-estres-solo/` (sin hora) no es valida: k6 no corrio por un
error del script, ya corregido.

## Comparacion

| Medida | `estres-limpio` (nuevo) | `estres` 06:12 (acumulado) | `estres` 03:31 (a mano, `../2026-11-20-solo/`) | Umbral |
|---|---|---|---|---|
| Colision: 201 / 409 / 503 / otro | 3 / 74 / 13 / 0 | 3 / 75 / 12 / 0 | 3 / 87 / 0 / 0 | una 201 por ronda |
| Citas activas solapadas | 0 | 0 | 0 | 0 |
| `lectura_publica` p95 / mediana | 118 / 25 ms | 134 / 26 ms | 113 / 24 ms | p95 < 300 ms |
| `carga_normal` 200 | 100 % (4.988) | 99,97 % (1 de 4.892 fallo) | 100 % | 100 % |
| Total p95 / maximo | 184 ms / 15,3 s | 191 ms / 21,4 s | 161 ms / 683 ms | - |
| Peticiones / por segundo | 20.870 / 69,2 | 20.418 / 67,4 | 21.398 / 71,1 | - |
| Pool lleno (P2028 en el log) | 13 | 13 | 0 | - |
| CPU backend prom. / pico | 61 / 90 % | 62 / 90 % | 51 / 87 % | - |
| CPU db prom. / pico | 32 / 48 % | 31 / 49 % | 26 / 43 % | - |
| RAM pico backend / db | 101 / 137 MiB | 98 / 117 MiB | 99 / 118 MiB | < 256 MiB |
| Reinicios / OOM | 0 / no | 1 (ver abajo) / no | 0 / no | 0 |

## Lectura

- **Los datos acumulados no explican la lentitud.** El silo recien sembrado
  da casi lo mismo que `estres`: p95 de lectura publica 118 contra 134 ms,
  igual mediana, la misma CPU del backend. La diferencia con Windows (p95
  6,6 ms) viene de la maquina (CPU i7-4790 de 2014, Linux con Docker), no de
  los datos. Pregunta de `../2026-11-20-solo/` cerrada.
- **Las 503 de la colision son normales en esta maquina.** Aparecen en 2 de
  3 corridas con el silo solo (12 a 13 por corrida). En la rafaga, 30 reservas
  simultaneas compiten por las 12 conexiones del pool con los otros dos
  escenarios. Las que no consiguen conexion reciben 503 con `Retry-After`,
  como se diseno el 2026-11-07. La integridad no cambia: una reserva por ronda
  y 0 solapes. La corrida de las 03:31 sin 503 fue la excepcion, no la regla.
- **Esas mismas esperas por el pool dan los maximos de 15 a 21 s.** El p95
  no se mueve (118 a 191 ms); solo se alarga la cola de las peticiones que
  esperan una conexion durante la rafaga. El fallo de `ocupacion` (1 de
  4.892) es una de esas.
- **Que mejorar, si hace falta:** con el limite de 1 vCPU el backend llega a
  90 %. Mas conexiones en el pool solo moverian la espera a la CPU. Las
  opciones son subir la CPU del backend o aceptar el 503 con `Retry-After`
  en rafagas que un centro real no tiene (30 personas reservando el mismo
  horario en el mismo segundo).
- **Memoria: sobra** en los dos silos (pico 137 MiB de 256 MiB).

## Reinicio del backend de `estres`

`verificar.txt` de la corrida 06:12 muestra 1 reinicio del backend, pero no
ocurrio durante k6: la RAM del backend crece de forma continua (74 a 98 MiB)
sin caidas. Ocurrio antes: `medir.sh limpio` detiene `estres` y al terminar lo
vuelve a encender en el orden frontend, backend, db. El backend arranco sin
su db, se cayo y Docker lo reinicio una vez. La db en reposo con 36 MiB (frente
a 57 a 76 MiB en otras corridas) confirma que acababa de arrancar. Corregido
en `medir.sh`: ahora enciende primero las db y espera que esten sanas.
