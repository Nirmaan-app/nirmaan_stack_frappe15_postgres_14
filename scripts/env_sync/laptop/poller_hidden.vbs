' poller_hidden.vbs -- the scheduled task "BoQ Checkpoint Poller" starts this with wscript.exe, so no console window
' ever shows (a task that starts bash.exe directly flashes one at every run). It runs ONE poller_run.sh in Git Bash,
' hidden, and waits for it, so the task counts as running until the run ends (one instance at a time). CKP-3, 2026-11-18.
Option Explicit
Dim fso, sh, here, script, bash, rc
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(fso.GetParentFolderName(here), "poller_run.sh")
bash = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Git\bin\bash.exe"
If Not fso.FileExists(bash) Then WScript.Quit 3
If Not fso.FileExists(script) Then WScript.Quit 4
rc = sh.Run("""" & bash & """ """ & script & """", 0, True)
WScript.Quit rc
