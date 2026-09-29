; Dentiva Pro - custom NSIS installer hooks
; Keeps clinic data safe: application data lives in %APPDATA%\Dentiva Pro and is
; NEVER removed automatically. Uninstall removes binaries + shortcuts only.

!macro customInstall
  DetailPrint "Dentiva Pro application files installed."
  DetailPrint "Clinic data is stored in: $APPDATA\Dentiva Pro"
!macroend

!macro customUnInstall
  MessageBox MB_OK|MB_ICONINFORMATION "Dentiva Pro has been uninstalled.$\r$\n$\r$\nYour clinic data (database, attachments, backups and configuration) has been PRESERVED in:$\r$\n$APPDATA\Dentiva Pro$\r$\n$\r$\nDelete that folder manually only if you are certain you no longer need the data."
!macroend

!macro customHeader
  !system "echo Dentiva Pro installer"
!macroend
