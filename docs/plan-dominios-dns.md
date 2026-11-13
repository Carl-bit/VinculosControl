# Plan de dominios, DNS y Cloudflare Access

Estado: propuesta para decidir (2026-11-13). No hay codigo asociado todavia.
Relacionado: CONTEXTO seccion 12 (pendiente "dominio propio de un centro"),
manifiesto (`dominio`), estado `ACTIVO_SIN_DOMINIO` (paso P8).

## 1. Hechos que ordenan la decision

- Un `.cl` solo se registra en NIC Chile (directo o por un registrador
  acreditado). Cloudflare no **vende** `.cl`, pero si **administra su DNS**: en
  NIC se cambian los servidores de nombre (NS) del dominio por los que entrega
  Cloudflare y la zona queda en Cloudflare (plan gratis). Ese es el modelo de
  hoy del servidor de pruebas.
- La entrada es por tunel (`cloudflared`): cada nombre publico se agrega como
  "Public Hostname" del tunel y apunta a `https://traefik:443`. El certificado
  del origen lo saca Traefik por desafio DNS en la zona de Cloudflare.
- Un dominio que no esta en nuestra cuenta de Cloudflare no puede entrar por el
  tunel tal cual: o se delega a nuestra cuenta, o se usa Cloudflare for SaaS
  (custom hostnames).

## 2. Propuesta

### Nivel 1 (base, siempre): subdominio de Vinculos

- Registrar en NIC un dominio propio de Vinculos (por ejemplo `vinculos.cl`,
  si esta libre; `vinculos.com` ya no) y delegar sus NS a Cloudflare.
- Cada centro nace con `<slug>.vinculos.cl` (P8). Certificado comodin
  `*.vinculos.cl` en Traefik por DNS, una regla del tunel `*.vinculos.cl`.
- Costo: solo el dominio en NIC. Sin trabajo para el centro.

### Nivel 2 (opcional, por centro): dominio propio del centro

El centro registra o ya tiene su `.cl` en NIC y **conserva su DNS** (correo,
sitio actual). Recomendado: **Cloudflare for SaaS (custom hostnames)** en la
zona de Vinculos:

1. En la consola se registra `agenda.centroejemplo.cl` (o `www.`) para el silo.
2. El centro agrega en su DNS un `CNAME agenda -> <slug>.vinculos.cl` y un
   `TXT` de validacion que entrega Cloudflare.
3. Cloudflare emite el certificado de borde; el tunel enruta al mismo Traefik.
   El router del silo acepta `Host(<slug>.vinculos.cl) || Host(agenda.centroejemplo.cl)`.
4. Mientras no valide: el silo sigue en `ACTIVO_SIN_DOMINIO` con su subdominio.

Limites a confirmar antes de elegir: el dominio raiz (`centroejemplo.cl` sin
`www`) no admite CNAME; se usa un subdominio y el centro redirige la raiz desde
su proveedor. Precio de custom hostnames segun el plan vigente de Cloudflare
(revisar al decidir; hay cupo gratis inicial).

Alternativa descartada salvo pedido del centro: que delegue sus NS a nuestra
cuenta de Cloudflare (pasariamos a administrar su correo y todo su DNS).

### Que cambia en el codigo (cuando se decida)

- Manifiesto: `dominio` = subdominio fijo + `dominio_propio` opcional.
- P8 (`aprovisionar`): crear el Public Hostname del tunel y, con dominio
  propio, el custom hostname por la API de Cloudflare (token con permisos
  minimos, solo en el host A); el agente no toca Cloudflare.
- ERP: `DOMINIO` del silo pasa a admitir mas de un host en la regla de Traefik.

## 3. Cloudflare Access para la consola (sin codigo)

No es un contenedor nuevo: es una aplicacion de Zero Trust configurada en el
panel de Cloudflare, que se pone delante de un nombre publicado por un tunel.

1. Tunel del host A: correr `cloudflared` junto a la consola (o usar el mismo
   tunel si host A y host B estan en la misma maquina) y publicar
   `consola.vinculos.cl -> http://web:3000` (contenedor `vinculos-control-web-1`).
   La API (`:4000`) no se publica: el agente llega por la red interna o por
   otro nombre con su propia regla.
2. Zero Trust > Access > Applications > Add > Self-hosted: dominio
   `consola.vinculos.cl`.
3. Politica: Allow, Include "Emails" con los correos de los operadores.
   Metodo de ingreso: One-time PIN (codigo al correo), sin otro proveedor.
4. Probar en una ventana privada: primero pide el codigo de Cloudflare y
   despues el login propio de la consola (correo, contrasena y codigo de 6
   digitos). Son dos capas independientes.

Se puede automatizar despues (API de Cloudflare o Terraform), pero con una sola
consola el panel basta y se documenta aqui.

## 4. Situacion del nombre (2026-11-13)

- `vinculo.cl` ya esta registrado en NIC por terceros y `vinculos.cl` redirige
  al mismo sitio: ambos tienen dueno. `vinculos.com` tambien esta registrado.
- Hoy el proyecto usa un subdominio de prueba en una zona propia de Cloudflare
  (aprendizaje y muestras); sirve para pruebas, no para centros reales.
- Cambiar el nombre del proyecto sigue siendo viable para registrar un `.cl`
  propio en NIC sin conflicto de marca. El nombre no esta atado al codigo: los
  dominios salen de `DOMINIO_BASE` (plano de control) y del `.env` de cada
  silo; las imagenes y paquetes (`vinculos-api`, `@vinculos/manifest`) son
  nombres internos. Antes de elegir: buscar el nombre en NIC y en INAPI (marca).

## 5. Decisiones pendientes del usuario

1. Nombre del proyecto y su `.cl` en NIC (`vinculo.cl` y `vinculos.cl` estan tomados) para el nivel 1.
2. Nivel 2 con Cloudflare for SaaS, o solo subdominios en el MVP.
3. Nombre publico de la consola (`consola.<dominio>`).
