!include "MUI2.nsh"
!include "LogicLib.nsh"

Function customInit
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\20f726f4-eb4b-53a7-a447-f2062c4bad89" "UninstallString"
  StrCmp $R0 "" checkAllUsers

  MessageBox MB_YESNO|MB_ICONQUESTION "A previous version of ${PRODUCT_NAME} is detected in your User Account. Would you like to uninstall it first?" IDNO done
  ClearErrors
  ExecWait '$R0 _?=$INSTDIR'
  IfErrors done

  checkAllUsers:
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\20f726f4-eb4b-53a7-a447-f2062c4bad89" "UninstallString"
  StrCmp $R0 "" done

  MessageBox MB_YESNO|MB_ICONQUESTION "A previous version of ${PRODUCT_NAME} is detected on your Device. Would you like to uninstall it first?" IDNO done
  ClearErrors
  ExecWait '$R0 _?=$INSTDIR'
  IfErrors done

done:
FunctionEnd

Section "MainSection" SEC01
  Call customInit
  SetOutPath "$INSTDIR"
  ClearErrors
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}" "$INSTDIR\PhraseVault.exe"
  IfErrors showError skipError
  
showError:
  MessageBox MB_ICONEXCLAMATION "Failed to set autostart registry key."
skipError:
SectionEnd

Section "Install"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Un.MainSection" SEC01-Un
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
SectionEnd
