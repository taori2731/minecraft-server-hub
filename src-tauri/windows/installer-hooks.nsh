!define TOMONODE_SHORTCUT_NAME "TomoNode"

!macro TOMONODE_RENAME_OWNED_SHORTCUT OLD_PATH NEW_PATH
  !insertmacro IsShortcutTarget "${OLD_PATH}" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    !insertmacro IsShortcutTarget "${NEW_PATH}" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $1
    ${If} $1 = 1
      Delete "${OLD_PATH}"
    ${Else}
      ${If} ${FileExists} "${NEW_PATH}"
        DetailPrint "TomoNode shortcut name is already in use; preserving the existing shortcut."
      ${Else}
        Rename "${OLD_PATH}" "${NEW_PATH}"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro TOMONODE_DELETE_OWNED_SHORTCUT SHORTCUT_PATH
  !insertmacro IsShortcutTarget "${SHORTCUT_PATH}" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    !insertmacro UnpinShortcut "${SHORTCUT_PATH}"
    Delete "${SHORTCUT_PATH}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  SetShellVarContext current
  !if "${STARTMENUFOLDER}" != ""
    !insertmacro TOMONODE_RENAME_OWNED_SHORTCUT "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$SMPROGRAMS\$AppStartMenuFolder\${TOMONODE_SHORTCUT_NAME}.lnk"
  !else
    !insertmacro TOMONODE_RENAME_OWNED_SHORTCUT "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$SMPROGRAMS\${TOMONODE_SHORTCUT_NAME}.lnk"
  !endif
  !insertmacro TOMONODE_RENAME_OWNED_SHORTCUT "$DESKTOP\${PRODUCTNAME}.lnk" "$DESKTOP\${TOMONODE_SHORTCUT_NAME}.lnk"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  SetShellVarContext current
  ${If} $UpdateMode <> 1
    !if "${STARTMENUFOLDER}" != ""
      !insertmacro TOMONODE_DELETE_OWNED_SHORTCUT "$SMPROGRAMS\$AppStartMenuFolder\${TOMONODE_SHORTCUT_NAME}.lnk"
    !else
      !insertmacro TOMONODE_DELETE_OWNED_SHORTCUT "$SMPROGRAMS\${TOMONODE_SHORTCUT_NAME}.lnk"
    !endif
    !insertmacro TOMONODE_DELETE_OWNED_SHORTCUT "$DESKTOP\${TOMONODE_SHORTCUT_NAME}.lnk"
  ${EndIf}
!macroend
