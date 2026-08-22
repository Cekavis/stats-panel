!include LogicLib.nsh

; The app is installed per-machine so the sensor broker and its repair payload
; live below Program Files. PawnIO is shared with other tools (for example
; FanControl), therefore uninstalling Stats Panel never removes it.
; The generated Tauri installer still displays its directory page. The
; callbacks below make that choice cosmetic and force the actual target to a
; protected, machine-wide directory before any files are copied.
Function .onVerifyInstDir
  ${If} ${RunningX64}
    StrCpy $0 "$PROGRAMFILES64\Stats Panel"
  ${Else}
    StrCpy $0 "$PROGRAMFILES\Stats Panel"
  ${EndIf}
  ${If} $INSTDIR != $0
    MessageBox MB_ICONEXCLAMATION|MB_OK "Stats Panel must be installed in $0."
    StrCpy $INSTDIR $0
  ${EndIf}
FunctionEnd

!macro StatsPanel_ForceProtectedInstallDir
  ${If} ${RunningX64}
    StrCpy $INSTDIR "$PROGRAMFILES64\Stats Panel"
  ${Else}
    StrCpy $INSTDIR "$PROGRAMFILES\Stats Panel"
  ${EndIf}
  SetShellVarContext all
!macroend

!macro StatsPanel_StopSensorService
  IfFileExists "$INSTDIR\stats-sensor-helper.exe" 0 stop_with_sc
    ExecWait '"$INSTDIR\stats-sensor-helper.exe" --stop-service' $0
    Goto stop_done
  stop_with_sc:
  ExecWait '"$SYSDIR\sc.exe" stop StatsPanelSensor' $0
  Sleep 750
  stop_done:
!macroend

!macro StatsPanel_InstallPawnIoIfMissing
  ; Do not routinely restart or upgrade a shared PawnIO installation. The
  ; protected broker repairs it on demand when its live device probe fails.
  ExecWait '"$SYSDIR\sc.exe" query PawnIO' $0
  ${If} $0 != 0
    IfFileExists "$INSTDIR\binaries\PawnIO_setup.exe" 0 +4
      ExecWait '"$INSTDIR\binaries\PawnIO_setup.exe" -install -silent' $1
      ${If} $1 == 3010
        SetRebootFlag true
        DetailPrint "PawnIO installation requires a Windows restart."
      ${ElseIf} $1 != 0
        DetailPrint "PawnIO setup returned exit code $1; the sensor service will retry when needed."
      ${EndIf}
  ${EndIf}
!macroend

!macro StatsPanel_ConfigureSensorService
  IfFileExists "$INSTDIR\stats-sensor-helper.exe" 0 service_missing
    ExecWait '"$INSTDIR\stats-sensor-helper.exe" --install-service' $0
    ${If} $0 != 0
      SetErrorLevel $0
      Abort "Stats Panel Sensor service setup failed with code $0."
    ${EndIf}
    Goto service_done
  service_missing:
    SetErrorLevel 2
    Abort "Stats Panel Sensor service executable is missing."
  service_done:
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro StatsPanel_ForceProtectedInstallDir
  !insertmacro StatsPanel_StopSensorService
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro StatsPanel_InstallPawnIoIfMissing
  !insertmacro StatsPanel_ConfigureSensorService
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro StatsPanel_StopSensorService
  ExecWait '"$SYSDIR\sc.exe" delete StatsPanelSensor' $0
!macroend
