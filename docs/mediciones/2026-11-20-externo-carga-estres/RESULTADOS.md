# Carga desde fuera del VPS (2026-11-20)

k6 0.54.0 en otro equipo (PC con Ryzen 9 7900X, Docker Desktop) contra
`https://estres.charlielearns.work/api` con
`scripts/mediciones/medir-externo.ps1`. El trafico pasa por Internet,
Cloudflare, el tunel (`cloudflared`) y Traefik, como el de un usuario real.
Mismo script que las corridas internas (`stress-agenda.js`, 5 min: 10 VUs del
equipo, 20 de lectura publica, 30 x 3 rondas de colision). k6 ya no le quita
CPU al silo.

Nota: el PC y el VPS estan en la misma red local. Aun asi el trafico sale a
Cloudflare y vuelve por el tunel; no hay atajo por la LAN.

## Resultado (`k6.txt`, `k6.json`, `contexto.txt`)

| Medida | Externo | VPS, silo solo (interno) | Umbral | Resultado |
|---|---|---|---|---|
| Checks | 100 % (15.880) | 100 % | 100 % | Cumple |
| Colision: 201 / 409 / 503 / otro | 3 / 87 / 0 / 0 | 3 / 87 / 0 / 0 | una 201 por ronda | Cumple |
| Lectura publica: p95 | **284 ms** | 113 ms | < 300 ms | Cumple, justo |
| Lectura publica: minimo / mediana | 131 / 163 ms | 1,5 / 24 ms | - | - |
| Total: p95 / max | 343 / 806 ms | 162 / 683 ms | - | - |
| Peticiones | 15.884 (52,5 por s) | 21.398 (71,0 por s) | - | - |
| Respuestas 429 o paginas de Cloudflare | 0 | - | 0 | Cumple |

Los 87 fallos HTTP (0,54 %) son las 409 esperadas de la colision.

## Lectura

- **El silo se comporta igual desde fuera:** misma integridad (una reserva
  por ronda), 0 errores, 0 respuestas 503 y Cloudflare no limito.
- **Cloudflare y el tunel suman unos 130 a 140 ms fijos por peticion.** La
  respuesta mas rapida tarda 131 ms (contra 1,5 ms dentro del host) y la
  mediana sube en ~139 ms. Es la ida y vuelta al borde de Cloudflare y el
  tunel, no trabajo del silo. Por eso caen las peticiones por segundo: cada
  VU espera mas cada respuesta.
- **El p95 de lectura publica queda a 16 ms del umbral.** El umbral de
  300 ms se definio midiendo dentro del host. Para el usuario final conviene
  separar: p95 del silo (interno) < 300 ms y p95 externo < 300 ms + latencia
  de red de base. Decision del usuario.
- Para bajar la latencia de base: revisar en que centro de datos de
  Cloudflare termina el tunel (`cloudflared tunnel info`, columna de
  ubicacion). Lo ideal es Santiago (SCL); si es otro pais, sale de ahi la
  mayor parte de los ~130 ms.

## Pendiente

- Rampa externa: `medir-externo.ps1 ... -Modo rampa`.
- Antes del arreglo, `k6.txt` se guardaba en UTF-16 (`Tee-Object` de
  PowerShell 5.1). Este se convirtio a UTF-8 y el script ya escribe UTF-8.
