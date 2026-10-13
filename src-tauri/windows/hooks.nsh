; Hooks de l'installeur Windows (NSIS), branchés par
; `bundle.windows.nsis.installerHooks` dans tauri.conf.json.
;
; Chaque installation repart de zéro, mise à jour comprise : rien de ce
; qu'une installation précédente a laissé ne doit réapparaître. Sans cela, une
; réinstallation « propre » affichait encore les comptes Gmail d'avant, comme
; s'ils étaient connectés — le désinstalleur ne touche pas au trousseau, et ne
; vide les dossiers de données que si l'utilisateur coche la case.

!macro NSIS_HOOK_PREINSTALL
  ; Dossiers de l'application : annuaire des comptes et règles (Roaming),
  ; cache, journaux et profil WebView2 (Local). Lus dans l'environnement plutôt
  ; que par $APPDATA, qui désigne le profil commun en installation par machine.
  ReadEnvStr $0 APPDATA
  ReadEnvStr $1 LOCALAPPDATA
  RMDir /r "$0\${BUNDLEID}"
  RMDir /r "$1\${BUNDLEID}"

  ; Jetons Google et clé d'API LLM, dans le Gestionnaire d'identifiants. Le
  ; crate keyring les nomme `<clé>.<service>` : on efface tout ce qui finit par
  ; l'identifiant de l'application, y compris les `google_refresh_token:<adresse>`
  ; des comptes inactifs, dont on ne connaît pas les adresses ici.
  nsExec::Exec `cmd /c for /f "tokens=1,* delims==" %a in ('cmdkey /list ^| findstr /l /c:".${BUNDLEID}"') do @cmdkey /delete:%b`
  Pop $0
!macroend
