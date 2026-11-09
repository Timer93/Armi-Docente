; Custom NSIS hooks for ARMI Docente.
; Check actual installation processes without matching sibling directories
; or treating the installer itself as the application. Never force-kill ARMI:
; a running teacher application must finish its protected save before updating.

!macro customCheckAppRunning
  InitPluginsDir
  File /oname=$PLUGINSDIR\armi-check-install-processes.ps1 "${BUILD_RESOURCES_DIR}\check-install-processes.ps1"
  Push $R7
  Push $R8
  Push $R9
  System::Call 'kernel32::GetCurrentProcessId() i .s'
  Pop $R7
  ${Do}
    nsExec::ExecToStack /TIMEOUT=20000 '"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\armi-check-install-processes.ps1" -InstallDirectory "$INSTDIR" -IgnoreProcessId $R7'
    Pop $R8
    Pop $R9
    ${If} $R8 == 0
      ${ExitDo}
    ${ElseIf} $R8 == 1
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Hay procesos de ARMI que siguen usando la carpeta de instalación:$\r$\n$\r$\n$R9$\r$\nCierra ARMI con su cierre seguro y pulsa Reintentar." /SD IDCANCEL IDRETRY +2
      Quit
    ${Else}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "No se pudo comprobar si ARMI está abierto. No se ha forzado el cierre de ningún proceso.$\r$\n$\r$\n$R9$\r$\nPulsa Reintentar para comprobarlo de nuevo." /SD IDCANCEL IDRETRY +2
      Quit
    ${EndIf}
  ${Loop}
  Pop $R9
  Pop $R8
  Pop $R7
!macroend

!macro customInit
!macroend

!macro customInstall
!macroend

!macro customUnInstall
!macroend
