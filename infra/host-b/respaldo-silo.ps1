# P9 de APROVISIONAR (continuidad), para el operador en un host B con Windows.
# Version Linux: respaldo-silo.sh (en Linux, ademas, instalar.sh del ERP deja
# el cron diario de las 02:00).
#
# Crea infra/secrets/<slug>/respaldo.key si no existe (nunca la reemplaza: con
# otra llave los respaldos anteriores no se abren) y corre el respaldo del ERP
# (infra/scripts/continuidad/respaldar.sh) con el .env que dejo el ejecutor.
#
# Uso (PowerShell, desde la raiz del plano de control):
#   .\infra\host-b\respaldo-silo.ps1 -Slug e2eprov
param(
  [Parameter(Mandatory = $true)][string]$Slug,
  [string]$Erp = ''
)
$ErrorActionPreference = 'Stop'
if ($Slug -notmatch '^[a-z][a-z0-9-]{1,38}[a-z0-9]$') { throw "Slug invalido: $Slug" }

$hostB = $PSScriptRoot
$envHost = @{}
$archivoEnv = Join-Path $hostB '.env'
if (Test-Path $archivoEnv) {
  foreach ($linea in Get-Content $archivoEnv) {
    if ($linea -match '^\s*([A-Z_][A-Z0-9_]*)=(.*)$') { $envHost[$Matches[1]] = $Matches[2].Trim('"') }
  }
}
if (-not $Erp) {
  if (-not $envHost['IMAGENES_HOST']) { throw 'Falta -Erp o IMAGENES_HOST en infra\host-b\.env' }
  $Erp = Split-Path (Split-Path $envHost['IMAGENES_HOST'] -Parent) -Parent
}
$silos = if ($envHost['SILOS_HOST']) { $envHost['SILOS_HOST'] } else { Join-Path $hostB 'silos' }
$envSilo = Join-Path $silos "$Slug\.env"
$script = Join-Path $Erp 'infra\scripts\continuidad\respaldar.sh'
$secretos = Join-Path $Erp "infra\secrets\$Slug"
$bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'

if (-not (Test-Path $script)) { throw "No existe $script (revisa -Erp)" }
if (-not (Test-Path $envSilo)) { throw "No existe ${envSilo}: el job APROVISIONAR aun no paso por P2" }
if (-not ((Get-Content $envSilo -TotalCount 1) -like '# Generado por el ejecutor*')) { throw "$envSilo no lo creo el ejecutor: no se usa" }
if (-not (Test-Path (Join-Path $secretos 'kek'))) { throw "El silo $Slug aun no tiene llaves (P5): primero llaves-silo.ps1" }
if (-not (Test-Path $bash)) { throw "Falta Git Bash en $bash" }

$nombres = 'CLIENTE_SLUG', 'ENV_SILO', 'MSYS_NO_PATHCONV'
try {
  $env:CLIENTE_SLUG = $Slug
  $env:ENV_SILO = ($envSilo -replace '\\', '/')
  $env:MSYS_NO_PATHCONV = '1'
  $llave = (Join-Path $secretos 'respaldo.key') -replace '\\', '/'
  # Solo si falta: la llave de respaldo es del silo y no se rota aqui.
  & $bash -c "[ -f '$llave' ] || { umask 077 && openssl rand -base64 48 > '$llave' && echo 'respaldo.key creada (guardar una copia fuera del host)'; }"
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear respaldo.key' }
  & $bash ($script -replace '\\', '/')
  if ($LASTEXITCODE -ne 0) { throw "respaldar.sh termino con $LASTEXITCODE" }
} finally {
  foreach ($n in $nombres) { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
}
Write-Host "Listo. En la consola, el job de $Slug sigue (o reintenta desde P9)."
