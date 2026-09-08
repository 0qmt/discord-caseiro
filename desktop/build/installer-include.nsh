; Electron Builder normally relaunches through the Start Menu shortcut.
; On this Windows installation that Shell shortcut invocation can fail after a
; silent update, even though the executable itself is valid. Keep the normal
; path and add a direct fallback only for updater-driven forced restarts.
!macro customInstall
  ${if} ${isUpdated}
  ${andIf} ${isForceRun}
    ExecShell "open" "$appExe" "--updated"
  ${endIf}
!macroend
