# P5 de APROVISIONAR (llaves del silo), para el operador en un host B con Windows
# (Docker Desktop). Version Linux: llaves-silo.sh.
#
# NO genera llaves por su cuenta: solo prepara las variables y llama al script
# manual del ERP (infra/scripts/llaves/aprovisionar.sh) con el .env que dejo el
# ejecutor en P2. Lo corre siempre el operador (CLAUDE.md: llaves solo con los
# scripts del ERP, corridos por el operador).
#
# Uso (PowerShell, desde la raiz del repo del plano de control):
#   .\infra\host-b\llaves-silo.ps1 -Slug e2eprov -Custodios "Ana Perez:proveedor,Luis Soto:centro,Sobre:caja fuerte"
#   .\infra\host-b\llaves-silo.ps1 -Slug e2eprov -Custodios "..." -Prueba   # silo de prueba: borra las partes al final
#
# Las rutas salen de infra\host-b\.env: IMAGENES_HOST (infra/imagenes del ERP,
# de ahi la raiz del ERP) y SILOS_HOST (vacio = infra\host-b\silos).
# Si PowerShell bloquea scripts: powershell -ExecutionPolicy Bypass -File .\infra\host-b\llaves-silo.ps1 ...
param(
  [Parameter(Mandatory = $true)][string]$Slug,
  # Nombre:rol separados por coma, uno por parte (3). Quedan en el registro de llaves del silo.
  [Parameter(Mandatory = $true)][string]$Custodios,
  [string]$Actor = $env:USERNAME,
  # Raiz del repo del ERP; por defecto se deduce de IMAGENES_HOST.
  [string]$Erp = '',
  [switch]$Prueba
)
$ErrorActionPreference = 'Stop'

if ($Slug -notmatch '^[a-z][a-z0-9-]{1,38}[a-z0-9]$') { throw "Slug invalido: $Slug" }
if (($Custodios -split ',').Count -ne 3 -or $Custodios -notmatch '^[^:,]+:[^:,]+(,[^:,]+:[^:,]+){2}$') {
  throw 'Custodios: tres "Nombre:rol" separados por coma (uno por parte)'
}

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
$script = Join-Path $Erp 'infra\scripts\llaves\aprovisionar.sh'
$bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'

if (-not (Test-Path $script)) { throw "No existe $script (revisa -Erp)" }
if (-not (Test-Path $envSilo)) { throw "No existe ${envSilo}: el job APROVISIONAR aun no paso por P2" }
if (-not ((Get-Content $envSilo -TotalCount 1) -like '# Generado por el ejecutor*')) { throw "$envSilo no lo creo el ejecutor: no se usa" }
if (-not (Test-Path $bash)) { throw "Falta Git Bash en $bash" }
if (Test-Path (Join-Path $Erp "infra\secrets\$Slug\kek")) { throw "El silo $Slug ya tiene KEK: no se vuelve a generar (rotar es otro runbook)" }

if ($Prueba) {
  Write-Warning "-Prueba: al terminar se BORRAN las 3 partes de la llave de recuperacion y nadie podra recuperarla. Solo para silos de prueba; con un centro real, correr sin -Prueba y entregar las partes."
}
Write-Host "Llaves de $Slug con el script del ERP ($script)"
$nombres = 'CLIENTE_SLUG', 'MODO', 'ENV_SILO', 'ACTOR', 'CUSTODIOS', 'MSYS_NO_PATHCONV'
try {
  $env:CLIENTE_SLUG = $Slug
  $env:MODO = 'docker'
  $env:ENV_SILO = ($envSilo -replace '\\', '/')
  $env:ACTOR = $Actor
  $env:CUSTODIOS = $Custodios
  $env:MSYS_NO_PATHCONV = '1'
  & $bash ($script -replace '\\', '/')
  if ($LASTEXITCODE -ne 0) { throw "El script de llaves del ERP termino con $LASTEXITCODE" }
} finally {
  foreach ($n in $nombres) { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
}

$partes = Join-Path $Erp "infra\secrets\$Slug\partes_entregar"
if ($Prueba) {
  Remove-Item -Recurse -Force $partes -ErrorAction SilentlyContinue
  Write-Host "Silo de prueba: partes borradas ($partes)."
} else {
  Write-Host ''
  Write-Host "Partes para entregar (una por custodio, por canales distintos), en ${partes}:"
  $nombresCustodios = $Custodios -split ','
  $i = 0
  foreach ($a in (Get-ChildItem $partes -File | Sort-Object Name)) {
    $quien = if ($i -lt $nombresCustodios.Count) { $nombresCustodios[$i] -replace ':', ' (' } else { '?' }
    Write-Host "  $($a.Name)  ->  $quien)"
    $i++
  }
  Write-Host 'Despues de entregarlas, borra la carpeta (Remove-Item -Recurse -Force <ruta de arriba>).'
}
Write-Host "Luego, en la consola: job de $Slug -> 'Llaves listas' con los mismos custodios."
