Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!addplugindir "${PLUGINS}"
!include "${STDUTILS}"
Name "ARMI Estudiante"
Icon "${ICON}"
UninstallIcon "${ICON}"
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
OutFile "${OUTPUT}"
InstallDir "$PROGRAMFILES64\ARMI Estudiante"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
VIProductVersion "1.3.0.0"
VIAddVersionKey /LANG=3082 "ProductName" "ARMI Estudiante"
VIAddVersionKey /LANG=3082 "FileDescription" "Instalador del agente de aula ARMI Estudiante"
VIAddVersionKey /LANG=3082 "FileVersion" "1.3.0"
VIAddVersionKey /LANG=3082 "LegalCopyright" "ARMI"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_TEXT "ARMI Estudiante buscará al docente automáticamente. La vinculación se aprueba desde ARMI Docente. El icono quedará junto al reloj y el agente arrancará con Windows."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Esta versión requiere Windows 10 u 11 de 64 bits."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "Se requiere Windows 10 u 11."
    Abort
  ${EndIf}
  SetRegView 64
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" "Release"
  ${If} $0 < 528040
    MessageBox MB_ICONSTOP "Instala .NET Framework 4.8 desde Windows Update antes de continuar."
    Abort
  ${EndIf}
FunctionEnd
Section "Agente ARMI Estudiante"
  SetShellVarContext all
  ${If} ${FileExists} "$INSTDIR\ARMI.Estudiante.exe"
    nsExec::ExecToLog '"$INSTDIR\ARMI.Estudiante.exe" --stop-service'
    Pop $0
    ${If} $0 != 0
      Abort "No se pudo detener el servicio anterior. Los archivos se conservaron."
    ${EndIf}
  ${EndIf}
  SetOutPath "$INSTDIR"
  File "${PAYLOAD}\ARMI.Estudiante.exe"
  File "${SOURCE}\LEEME.html"
  File "${PAYLOAD}\native-host.template.json"
  SetOutPath "$INSTDIR\Extension"
  File /r "${EXTENSION}\*.*"
  nsExec::ExecToLog '"$INSTDIR\ARMI.Estudiante.exe" --install-service'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "No se pudo registrar el servicio. Consulta %TEMP%\armi-student-last-error.txt."
    Abort
  ${EndIf}
  CreateDirectory "$SMPROGRAMS\ARMI Estudiante"
  Delete "$SMPROGRAMS\ARMI Estudiante\Vincular equipo.lnk"
  CreateShortcut "$SMPROGRAMS\ARMI Estudiante\Estado del equipo.lnk" "$INSTDIR\ARMI.Estudiante.exe" "--tray"
  CreateShortcut "$SMPROGRAMS\ARMI Estudiante\Instrucciones.lnk" "$INSTDIR\LEEME.html"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ARMIStudentAgent" "DisplayName" "ARMI Estudiante"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ARMIStudentAgent" "DisplayVersion" "1.3.0"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ARMIStudentAgent" "Publisher" "ARMI"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ARMIStudentAgent" "DisplayIcon" "$INSTDIR\ARMI.Estudiante.exe,0"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ARMIStudentAgent" "UninstallString" '$\"$INSTDIR\Desinstalar.exe$\"'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ARMIStudentAgent" "NoModify" 1
  ${IfNot} ${Silent}
    ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\ARMI.Estudiante.exe" "open" "--tray"
  ${EndIf}
SectionEnd
Section "Uninstall"
  SetShellVarContext all
  SetRegView 64
  nsExec::ExecToLog '"$INSTDIR\ARMI.Estudiante.exe" --uninstall-service'
  Pop $0
  ${If} $0 != 0
    Abort "No se pudo retirar el servicio y sus políticas. No se eliminaron los archivos."
  ${EndIf}
  Delete "$INSTDIR\ARMI.Estudiante.exe"
  Delete "$INSTDIR\LEEME.html"
  Delete "$INSTDIR\native-host.json"
  Delete "$INSTDIR\native-host.template.json"
  Delete "$INSTDIR\Desinstalar.exe"
  ; Only packaged extension files; never recurse across the student's resource folder.
  Delete "$INSTDIR\Extension\manifest.json"
  Delete "$INSTDIR\Extension\background.js"
  Delete "$INSTDIR\Extension\controller.js"
  Delete "$INSTDIR\Extension\policy.js"
  Delete "$INSTDIR\Extension\popup.html"
  Delete "$INSTDIR\Extension\popup.css"
  Delete "$INSTDIR\Extension\popup.js"
  Delete "$INSTDIR\Extension\icons\16.png"
  Delete "$INSTDIR\Extension\icons\32.png"
  Delete "$INSTDIR\Extension\icons\48.png"
  Delete "$INSTDIR\Extension\icons\128.png"
  RMDir "$INSTDIR\Extension\icons"
  RMDir "$INSTDIR\Extension"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\ARMI Estudiante\Vincular equipo.lnk"
  Delete "$SMPROGRAMS\ARMI Estudiante\Estado del equipo.lnk"
  Delete "$SMPROGRAMS\ARMI Estudiante\Instrucciones.lnk"
  RMDir "$SMPROGRAMS\ARMI Estudiante"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ARMIStudentAgent"
  ; Credentials/receipts remain private to administrators; all classroom resources remain intact.
SectionEnd
