!include "MUI2.nsh"
!include "LogicLib.nsh"

Function customInit
  ; Check for uninstall string in HKCU using the GUID
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\20f726f4-eb4b-53a7-a447-f2062c4bad89" "UninstallString"
  StrCmp $R0 "" checkAllUsers

  MessageBox MB_YESNO|MB_ICONQUESTION "A previous version of ${PRODUCT_NAME} is detected in your User Account. Would you like to uninstall it first?" IDNO done
  ClearErrors
  ExecWait '$R0 _?=$INSTDIR' ; preserve user data by not removing the installation directory
  IfErrors done
  Goto done

  checkAllUsers:
  ; Check for uninstall string in HKLM using the GUID
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\20f726f4-eb4b-53a7-a447-f2062c4bad89" "UninstallString"
  StrCmp $R0 "" done

  MessageBox MB_YESNO|MB_ICONQUESTION "A previous version of ${PRODUCT_NAME} is detected on your Device. Would you like to uninstall it first?" IDNO done
  ClearErrors
  ExecWait '$R0 _?=$INSTDIR' ; preserve user data by not removing the installation directory
  IfErrors done

done:
FunctionEnd

Section "MainSection" SEC01
  Call customInit
SectionEnd
