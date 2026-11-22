@echo off
cd /d "%~dp0"
if not exist node_modules\wrangler\bin\wrangler.js (
  echo Instalando herramientas de desarrollo de ARMI Web...
  call npm ci
  if errorlevel 1 goto error
)
if not exist .dev.vars (
  echo Falta configurar .dev.vars. Consulta README.md antes de continuar.
  goto error
)
call npm run db:local
if errorlevel 1 goto error
echo Abre http://localhost:8787 cuando aparezca Ready.
echo Para detener esta prueba, presiona Ctrl+C en esta ventana.
call npm run dev
goto :eof
:error
echo No se pudo iniciar ARMI Web.
pause
exit /b 1
