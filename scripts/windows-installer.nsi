; Per-user Wing installer; built by scripts/package-windows.cjs.
; Needs SOURCE, OUTFILE, VERSION and ICON defined on the command line.
Unicode true
!include "MUI2.nsh"

Name "Wing"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Wing"
InstallDirRegKey HKCU "Software\Wing" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Wing.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Wing"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Wing"
  ; A running Wing holds its files open.
  nsExec::Exec 'taskkill /IM Wing.exe'
  Sleep 1000
  RMDir /r "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${SOURCE}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall Wing.exe"
  CreateShortcut "$SMPROGRAMS\Wing.lnk" "$INSTDIR\Wing.exe"
  CreateShortcut "$DESKTOP\Wing.lnk" "$INSTDIR\Wing.exe"
  WriteRegStr HKCU "Software\Wing" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Wing"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Wing"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\Wing.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall Wing.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

; Removes the app only; browsing data in %APPDATA%\Wing stays.
Section "Uninstall"
  nsExec::Exec 'taskkill /IM Wing.exe'
  Sleep 1000
  Delete "$SMPROGRAMS\Wing.lnk"
  Delete "$DESKTOP\Wing.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\Wing"
SectionEnd
