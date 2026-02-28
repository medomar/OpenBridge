; NSIS customisation script for OpenBridge installer
; Included by electron-builder during Windows NSIS builds.

; Set OPENBRIDGE_HOME environment variable to the user's home directory
; so the bridge process can find its data files.
!macro customInstall
  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" \
    "OPENBRIDGE_HOME" "$PROFILE\.openbridge"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUnInstall
  DeleteRegValue HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" \
    "OPENBRIDGE_HOME"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
