# Rampa desde fuera del VPS (2026-11-20)

`stress-rampa.js` (10, 25, 50, 100 y 200 VUs, 2 min cada etapa; quiebre:
p95 > 300 ms o 5xx > 1 %) desde el PC (Ryzen 9 7900X, Docker Desktop) contra
`https://estres.charlielearns.work/api` con
`medir-externo.ps1 -Modo rampa`. Pasa por Internet, Cloudflare, el tunel y
Traefik. `estres` solo en el VPS (demos y `llama-server` detenidos). k6 de
03:28:57 a 03:39:15 (hora del PC).

## Resultado (`rampa.json`, `k6.txt`, `verificar.txt`)

| VUs | Externo: pet/s | Externo: p95 | Externo: max | Interno solo: pet/s | Interno solo: p95 | Diferencia de p95 | 5xx | Quiebre externo |
|---|---|---|---|---|---|---|---|---|
| 10 | 16,7 | 227 ms | 531 ms | 23,5 | 67 ms | +160 ms | 0 % | no |
| 25 | 42,4 | 301 ms | 609 ms | 58,0 | 139 ms | +162 ms | 0 % | SI (por 1 ms) |
| 50 | 83,0 | 367 ms | 765 ms | 111,4 | 187 ms | +180 ms | 0 % | SI |
| 100 | 159,7 | 453 ms | 1.278 ms | 214,5 | 197 ms | +256 ms | 0 % | SI |
| 200 | 228,9 | 890 ms | 1.868 ms | 250,2 | 805 ms | +85 ms | 0 % | SI |

0 respuestas 5xx, 0 respuestas 429 (Cloudflare no limito), 0 solapes, 0 OOM.
El reinicio del backend en `verificar.txt` es el mismo de antes (el contador
de Docker no vuelve a 0; ver `../2026-11-20-carga-estres-limpio-solo/`).

## Lectura

- **El quiebre a 25 VUs es de la red, no del silo.** El camino por Cloudflare
  y el tunel suma unos 160 ms a cada peticion (igual que en
  `../2026-11-20-externo-carga-estres/`). Con esa base el p95 parte en 227 ms
  y cruza los 300 ms apenas sube la carga. Dentro del host el mismo silo
  no quiebra hasta 200 VUs.
- **Hasta 50 VUs la diferencia es constante (160 a 180 ms):** solo latencia
  de red. A 100 VUs crece a +256 ms: aparece una cola extra en el camino
  (tunel `cloudflared` o Traefik) que no se ve dentro del host. No se midio
  que pieza es; `docker stats` de `cloudflared` y Traefik en la proxima rampa
  externa lo diria.
- **A 200 VUs manda el silo:** el backend esta en su limite de CPU (como en
  la rampa interna), el p95 es casi el mismo (890 contra 805 ms) y las
  peticiones por segundo tambien (229 contra 250).
- **Con este criterio el usuario final ve p95 bajo 300 ms solo con poca
  carga.** El criterio de 300 ms no sirve tal cual para medir desde fuera:
  mezcla la red con el silo. Propuesta (decision del usuario): medir el silo
  dentro del host con p95 < 300 ms, y desde fuera p95 < 300 ms + latencia de
  base (aprox. 450 ms aqui), mas revisar la ubicacion del tunel.
