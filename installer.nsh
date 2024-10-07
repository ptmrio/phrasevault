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

Function un.closePhraseVault
    ; Check if PhraseVault is running
    nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq PhraseVault.exe" /FO CSV /NH'
    Pop $0
    StrCmp $0 "INFO: No tasks are running which match the specified criteria." notRunning
    
    ; If running, ask the user if they want to close it
    MessageBox MB_YESNO|MB_ICONQUESTION "PhraseVault is currently running. Would you like to close it before uninstalling?" IDNO notRunning
    ClearErrors
    nsExec::Exec '"taskkill /IM PhraseVault.exe /F"'
    IfErrors notRunning

notRunning:
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
    Call un.closePhraseVault
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
    Delete "$INSTDIR\*.*"
    RMDir "$INSTDIR"
SectionEnd
