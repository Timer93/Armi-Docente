param([ValidateSet('Edge','Chrome')][string]$Navegador='Edge')
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot 'extension'
$inventory=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'archivos.json') -Raw | ConvertFrom-Json
foreach($file in $inventory) {
    $relative=[string]$file.path
    $absolute=[IO.Path]::GetFullPath((Join-Path $source $relative))
    if(!$absolute.StartsWith([IO.Path]::GetFullPath($source)+'\',[StringComparison]::OrdinalIgnoreCase)) {throw 'El paquete contiene una ruta no valida.'}
    if((Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash -ne $file.sha256) {throw ('El archivo no esta completo: '+$relative+'. Extrae nuevamente el ZIP.')}
}
$destination=Join-Path $env:LOCALAPPDATA 'ARMI Estudiantes/extension'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach($file in $inventory) {
    $target=Join-Path $destination $file.path
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $source $file.path) -Destination $target -Force
    if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $file.sha256) {throw 'La copia de la extension no paso la comprobacion.'}
}
$page=if($Navegador -eq 'Edge'){'edge://extensions'}else{'chrome://extensions'}
Write-Host ''
Write-Host 'Archivos de ARMI Estudiantes instalados y verificados.'
Write-Host ('Carpeta que debes seleccionar: '+$destination)
Write-Host ('1. Abre '+$page+' en '+$Navegador+'.')
Write-Host '2. Activa Modo de desarrollador y pulsa Cargar descomprimida.'
Write-Host '3. Selecciona la carpeta indicada arriba. No la borres: el navegador la utiliza.'
Write-Host '4. Abre la extension y escribe la direccion de ARMI y el codigo generado por el docente.'
Write-Host 'El navegador requiere confirmar la carga. Este script no instala politicas ni modifica su seguridad.'
if(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'LEEME.html')) {Invoke-Item -LiteralPath (Join-Path $PSScriptRoot 'LEEME.html')}
