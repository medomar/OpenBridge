; ─────────────────────────────────────────────────────────────────
; create-installer.nsi — OpenBridge Windows Installer
;
; Usage (from project root):
;   makensis scripts\create-installer.nsi
;   makensis /DVERSION=0.0.5 scripts\create-installer.nsi
;
; Prerequisites:
;   - NSIS >= 3.0 installed:
;       Windows:  choco install nsis
;                 OR download from https://nsis.sourceforge.io
;   - release\openbridge-win-x64.exe must exist:
;       npm run package:win
;
; Output:
;   release\OpenBridge-{version}-Setup.exe
; ─────────────────────────────────────────────────────────────────

Unicode True

; ── Change to project root ───────────────────────────────────────
; This script lives in scripts\, so change one level up so that
; File and OutFile paths are relative to the project root.
!cd ".."

; ── Version ──────────────────────────────────────────────────────
; Pass with /DVERSION=x.y.z on the makensis command line.
; Example: makensis /DVERSION=0.0.5 scripts\create-installer.nsi
!ifndef VERSION
  !define VERSION "0.0.1"
!endif

; ── App metadata ─────────────────────────────────────────────────
!define APP_NAME       "OpenBridge"
!define APP_EXE_SRC    "openbridge-win-x64.exe"
!define APP_EXE_DEST   "openbridge.exe"
!define PUBLISHER      "OpenBridge Contributors"
!define APP_URL        "https://github.com/medomar/OpenBridge"
!define UNINSTALL_KEY  "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
!define OB_HOME_VAR    "OPENBRIDGE_HOME"
!define OB_HOME_VAL    "%USERPROFILE%\.openbridge"

; ── NSIS includes ────────────────────────────────────────────────
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

; ── Installer settings ───────────────────────────────────────────
Name             "${APP_NAME} ${VERSION}"
OutFile          "release\${APP_NAME}-${VERSION}-Setup.exe"
InstallDir       "$PROGRAMFILES64\${APP_NAME}"
InstallDirRegKey HKLM "${UNINSTALL_KEY}" "InstallLocation"
RequestExecutionLevel admin
SetCompressor    /SOLID lzma
BrandingText     "${APP_NAME} ${VERSION}"
ShowInstDetails  show
ShowUnInstDetails show

; ── MUI configuration ────────────────────────────────────────────
!define MUI_ABORTWARNING
!define MUI_ICON   "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

!define MUI_WELCOMEPAGE_TITLE "Welcome to ${APP_NAME} ${VERSION} Setup"
!define MUI_WELCOMEPAGE_TEXT \
  "This wizard will guide you through installing ${APP_NAME} on your PC.\
$\r$\n$\r$\n\
${APP_NAME} is an autonomous AI bridge that connects messaging platforms \
(WhatsApp, Telegram, Discord) to AI tools installed on your machine.\
$\r$\n$\r$\n\
Click Next to continue."

!define MUI_FINISHPAGE_TEXT \
  "${APP_NAME} ${VERSION} has been installed successfully.\
$\r$\n$\r$\n\
On first launch, the setup wizard will guide you through configuring \
your workspace and AI tools.\
$\r$\n$\r$\n\
Click Finish to close this installer."

!define MUI_FINISHPAGE_NOAUTOCLOSE

; ── Pages ─────────────────────────────────────────────────────────
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

; ── Section description strings ──────────────────────────────────
LangString DESC_Core    ${LANG_ENGLISH} \
  "OpenBridge core executable and required components."
LangString DESC_Desktop ${LANG_ENGLISH} \
  "Add a shortcut to the Desktop."

; ── Main installation section ────────────────────────────────────
Section "OpenBridge Core" SecCore
  SectionIn RO  ; Required — cannot be deselected by the user

  SetOutPath "$INSTDIR"

  ; Copy the packaged Windows binary and rename it
  File "release\${APP_EXE_SRC}"
  Rename "$INSTDIR\${APP_EXE_SRC}" "$INSTDIR\${APP_EXE_DEST}"

  ; Write the uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; ── Control Panel — Add/Remove Programs entry ────────────────
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayName"          "${APP_NAME}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayVersion"       "${VERSION}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "Publisher"            "${PUBLISHER}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "URLInfoAbout"         "${APP_URL}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "InstallLocation"      "$INSTDIR"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "UninstallString"      '"$INSTDIR\Uninstall.exe"'
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify"             1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair"             1

  ; Compute estimated install size (KB) for the Add/Remove Programs panel
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "EstimatedSize" "$0"

  ; ── OPENBRIDGE_HOME environment variable (user scope) ────────
  ; Stored as an expandable string so %USERPROFILE% resolves at
  ; access time rather than at install time, making it portable
  ; across user-profile renames and multi-user machines.
  WriteRegExpandStr HKCU "Environment" "${OB_HOME_VAR}" "${OB_HOME_VAL}"

  ; Broadcast the environment change so Explorer and open CMD
  ; windows pick it up without requiring a logoff/reboot.
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  ; ── Start Menu shortcuts ─────────────────────────────────────
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"

  CreateShortCut \
    "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" \
    "$INSTDIR\${APP_EXE_DEST}" "" \
    "$INSTDIR\${APP_EXE_DEST}" 0 \
    SW_SHOWNORMAL "" \
    "${APP_NAME} — Autonomous AI Bridge"

  CreateShortCut \
    "$SMPROGRAMS\${APP_NAME}\Uninstall ${APP_NAME}.lnk" \
    "$INSTDIR\Uninstall.exe"

SectionEnd

; ── Optional: Desktop shortcut ───────────────────────────────────
; Unchecked by default (/o). User can opt in during installation.
Section /o "Desktop Shortcut" SecDesktop

  CreateShortCut \
    "$DESKTOP\${APP_NAME}.lnk" \
    "$INSTDIR\${APP_EXE_DEST}" "" \
    "$INSTDIR\${APP_EXE_DEST}" 0 \
    SW_SHOWNORMAL "" \
    "${APP_NAME} — Autonomous AI Bridge"

SectionEnd

; ── Section descriptions shown on the Components page ────────────
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecCore}    $(DESC_Core)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} $(DESC_Desktop)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ── Uninstaller ───────────────────────────────────────────────────
Section "Uninstall"

  ; Remove the installed binary and uninstaller executable
  Delete "$INSTDIR\${APP_EXE_DEST}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir  "$INSTDIR"

  ; Remove Start Menu folder and shortcuts
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\Uninstall ${APP_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${APP_NAME}"

  ; Remove Desktop shortcut (silently ignored if it was never created)
  Delete "$DESKTOP\${APP_NAME}.lnk"

  ; Remove the OPENBRIDGE_HOME environment variable
  DeleteRegValue HKCU "Environment" "${OB_HOME_VAR}"

  ; Notify running applications of the environment change
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  ; Remove Control Panel entry
  DeleteRegKey HKLM "${UNINSTALL_KEY}"

  ; Note: the user's data directory (%USERPROFILE%\.openbridge) is
  ; intentionally NOT removed — it contains workspace knowledge,
  ; conversation history, and configuration the user may want to keep.

SectionEnd
