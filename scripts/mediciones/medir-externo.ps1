<#
Medicion desde fuera del VPS (seccion 13 de CONTEXTO.md): k6 en este PC con
Docker Desktop contra el dominio publico del silo. El trafico pasa por
Internet, Cloudflare, el tunel y Traefik, como el de un usuario real.

  .\scripts\mediciones\medir-externo.ps1 -Dominio charlielearns.work -Ssh dev@192.168.1.55
  .\scripts\mediciones\medir-externo.ps1 -Dominio charlielearns.work -Ssh dev@192.168.1.55 -Modo rampa

-Modo carga  stress-agenda.js (5 min: colision, lectura publica, equipo)
-Modo rampa  stress-rampa.js (10, 25, 50, 100, 200 VUs, 2 min c/u)

Credenciales: con -Ssh las lee del VPS (SEED_PASSWORD del silo y
MAILPIT_UI_AUTH del ERP; pide la clave SSH); si no, -Password y -MailpitAuth.
El codigo del segundo paso se lee del Mailpit del ERP publicado en
https://correo.<dominio> (-Correo para otro nombre).

Resultado en docs\mediciones\<fecha>-externo-<modo>-<slug>\ (k6.txt, k6.json o
rampa.json, contexto.txt). Respuestas 429 o paginas de Cloudflare en el
resultado son del borde (limite por IP o proteccion), no capacidad del silo.
Despues, en el VPS: CLIENTE_SLUG=<slug> sh infra/stress/verificar.sh.
#>
param(
  [Parameter(Mandatory = $true)][string]$Dominio,
  [string]$Slug = 'estres',
  [ValidateSet('carga', 'rampa')][string]$Modo = 'carga',
  [string]$Ssh = '',
  [string]$Password = '',
  [string]$MailpitAuth = '',
  [string]$Correo = '',
  [string]$ErpVps = '~/Vinculos/Vinculos',
  [string]$Pruebas = ''
)
$ErrorActionPreference = 'Stop'

if ($Slug -notmatch '^[a-z][a-z0-9-]{1,38}[a-z0-9]$') { throw "Slug invalido: $Slug" }
if ($Dominio -notmatch '^[a-z0-9.-]+\.[a-z]{2,}$') { throw "Dominio invalido: $Dominio" }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $Pruebas) { $Pruebas = Join-Path (Split-Path $repo -Parent) 'SW Proyecto\backend\pruebas' }
if (-not (Test-Path (Join-Path $Pruebas 'stress-rampa.js'))) { throw "No encuentro los scripts de k6 del ERP en $Pruebas (-Pruebas <ruta>)" }
if (-not $Correo) { $Correo = "correo.$Dominio" }

if ($Ssh) {
  Write-Host "Leyendo credenciales del VPS ($Ssh)"
  $leidas = ssh $Ssh "sed -n 's/^SEED_PASSWORD=//p' $ErpVps/infra/servidor/silos/$Slug.env; sed -n 's/^MAILPIT_UI_AUTH=//p' $ErpVps/.env"
  $lineas = @($leidas | Where-Object { $_ -ne '' })
  if ($lineas.Count -lt 2) { throw 'No se pudieron leer SEED_PASSWORD y MAILPIT_UI_AUTH por SSH' }
  if (-not $Password) { $Password = $lineas[0].Trim() }
  if (-not $MailpitAuth) { $MailpitAuth = $lineas[1].Trim() }
}
if (-not $Password -or -not $MailpitAuth) { throw 'Faltan credenciales: -Ssh dev@<vps> o -Password y -MailpitAuth' }

docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker no responde: abrir Docker Desktop' }

$fecha = Get-Date -Format 'yyyy-MM-dd'
$out = Join-Path $repo "docs\mediciones\$fecha-externo-$Modo-$Slug"
if (Test-Path $out) { $out = "$out-$(Get-Date -Format 'HHmm')" }
New-Item -ItemType Directory -Force $out | Out-Null

$api = "https://$Slug.$Dominio/api"
$salud = try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 "$api/salud").StatusCode } catch { "error: $($_.Exception.Message)" }
@(
  "Fecha: $(Get-Date -Format 's')"
  "Equipo: $env:COMPUTERNAME ($((Get-CimInstance Win32_Processor | Select-Object -First 1).Name))"
  "API: $api  (salud: $salud)"
  "Modo: $Modo"
  "IP publica: $(try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 'https://api.ipify.org').Content } catch { 'desconocida' })"
) | Set-Content -Encoding utf8 (Join-Path $out 'contexto.txt')
Get-Content (Join-Path $out 'contexto.txt')

$script = if ($Modo -eq 'rampa') { 'stress-rampa.js' } else { 'stress-agenda.js' }
$k6args = @('run', '--rm', '-v', "${Pruebas}:/scripts:ro", '-v', "${out}:/out",
  '-e', "API_URL=$api", '-e', "MAILPIT_URL=https://$MailpitAuth@$Correo", '-e', "PASSWORD=$Password",
  'grafana/k6:0.54.0', 'run')
if ($Modo -eq 'rampa') { $k6args += @('-e', 'SALIDA=/out/rampa.json') } else { $k6args += '--summary-export=/out/k6.json' }
$k6args += "/scripts/$script"

Write-Host "k6 $script contra $api (carga: 5 min; rampa: unos 10 min)"
$inicio = Get-Date
# k6 escribe el progreso por stderr: en PowerShell 5.1 eso seria un error con Stop.
$ErrorActionPreference = 'Continue'
docker @k6args 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath (Join-Path $out 'k6.txt')
$ErrorActionPreference = 'Stop'
$fin = Get-Date
Add-Content -Encoding utf8 (Join-Path $out 'contexto.txt') "k6: $($inicio.ToString('HH:mm:ss')) a $($fin.ToString('HH:mm:ss')) (hora del PC)"

Write-Host ''
Write-Host "Listo: $out"
Write-Host "En el VPS, para cerrar: CLIENTE_SLUG=$Slug sh infra/stress/verificar.sh (desde $ErpVps)"
