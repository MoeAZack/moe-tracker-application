; Included by electron-builder (build.nsis.include). Leaves a copy of this
; installer in the app's update folder, so the first automatic update can roll
; back to the version that was installed before it. desktop/update-health.cjs
; reads it from Local Workspace\Updates\installed.
!macro customInstall
  Push $0
  SetShellVarContext current
  StrCpy $0 "$APPDATA\${APP_PACKAGE_NAME}\Local Workspace\Updates\installed"
  CreateDirectory "$0"
  Delete "$0\*.exe"
  CopyFiles /SILENT "$EXEPATH" "$0\Moe-Tracker-Application-${VERSION}-Setup.exe"
  ${if} $installMode == "all"
    SetShellVarContext all
  ${endIf}
  Pop $0
!macroend
