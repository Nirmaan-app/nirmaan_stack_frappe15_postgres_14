' copier_shortcut.vbs -- what the laptop Desktop shortcuts "Copier - Pause", "Copier - Resume" and "Copier - Status" run
' (CKP-3, owner 2026-11-18 17:10 "yes add the shortcut"). No console window; one message box with the result in plain words.
'   wscript.exe copier_shortcut.vbs pause | resume | status
' pause / resume call `env_sync.sh poller pause | resume`, then one poller run so the heartbeat shows the new state at once.
' status only reads the heartbeat. The message is also written to frappe-bench\envsync\poll\copier_last_message.txt;
' with COPIER_NO_MSGBOX=1 in the environment (tests) no box is shown.
Option Explicit
Dim fso, sh, here, envsync, runner, bash, bench, stateDir, hbPath, action, msg, q
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
q = Chr(34)
here = fso.GetParentFolderName(WScript.ScriptFullName)                       ' ...\scripts\env_sync\laptop
envsync = fso.BuildPath(fso.GetParentFolderName(here), "env_sync.sh")
runner = fso.BuildPath(fso.GetParentFolderName(here), "poller_run.sh")
bench = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(here)))))
stateDir = bench & "\envsync\poll"
hbPath = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\OneDrive\Desktop\BoQ main lane\_run_records\ckp_heartbeat.txt"
bash = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Git\bin\bash.exe"
action = "status"
If WScript.Arguments.Count > 0 Then action = LCase(WScript.Arguments(0))

Function HbLine(label)                                                      ' the value after "<label>:" in the heartbeat
  Dim f, line, p
  HbLine = ""
  If Not fso.FileExists(hbPath) Then Exit Function
  Set f = fso.OpenTextFile(hbPath, 1)
  Do Until f.AtEndOfStream
    line = f.ReadLine
    If LCase(Left(line, Len(label) + 1)) = LCase(label) & ":" Then
      HbLine = Trim(Mid(line, Len(label) + 2))
      p = InStr(HbLine, " (")
      If label = "location" And p > 0 Then HbLine = Left(HbLine, p - 1)
      Exit Do
    End If
  Loop
  f.Close
End Function

Function HbAll()
  Dim f
  HbAll = "(no heartbeat file yet)"
  If fso.FileExists(hbPath) Then
    Set f = fso.OpenTextFile(hbPath, 1)
    If Not f.AtEndOfStream Then HbAll = f.ReadAll
    f.Close
  End If
End Function

Sub RunHidden(args)
  sh.Run q & bash & q & " " & args, 0, True
End Sub

If Not fso.FileExists(bash) Then
  msg = "Git Bash was not found (" & bash & "). Nothing was changed."
ElseIf action = "pause" Then
  RunHidden q & envsync & q & " poller pause"
  RunHidden q & runner & q
  If fso.FileExists(stateDir & "\paused") Then
    msg = "The checkpoint copier is PAUSED." & vbCrLf & "Double-click 'Copier - Resume' to turn it back on."
  Else
    msg = "The pause did NOT take effect. The copier is still ON. Tell Claude."
  End If
ElseIf action = "resume" Then
  RunHidden q & envsync & q & " poller resume"
  RunHidden q & runner & q
  If fso.FileExists(stateDir & "\paused") Then
    msg = "The resume did NOT take effect. The copier is still PAUSED. Tell Claude."
  Else
    msg = "The checkpoint copier is ON." & vbCrLf & "Location: " & HbLine("location") & "." & vbCrLf & "Last code copy: " & HbLine("last good B1") & "."
  End If
ElseIf action = "leaving" Then
  ' CKP-4 D4: raise the shared "leaving" flag, then start the copier's task at once (it would see the flag within 15
  ' minutes anyway). The copier checkpoints every detected unit and writes READY to the heartbeat and the relay.
  RunHidden q & envsync & q & " leaving"
  sh.Run "schtasks.exe /Run /TN " & q & "BoQ Checkpoint Poller" & q, 0, False
  If fso.FileExists(stateDir & "\paused") Then
    msg = "The copier is PAUSED, so no checkpoint was started." & vbCrLf & "Double-click 'Copier - Resume' first, then 'Leaving' again."
  Else
    msg = "Checkpoint started - wait for READY in the chat." & vbCrLf & "(This box will not close the laptop. 'Copier - Status' shows the result.)"
  End If
Else
  If fso.FileExists(stateDir & "\paused") Then msg = "The checkpoint copier is PAUSED." Else msg = "The checkpoint copier is ON."
  msg = msg & vbCrLf & vbCrLf & HbAll()
End If

On Error Resume Next
Dim o
Set o = fso.CreateTextFile(stateDir & "\copier_last_message.txt", True)
o.Write Now & " [" & action & "] " & msg
o.Close
On Error GoTo 0
If sh.ExpandEnvironmentStrings("%COPIER_NO_MSGBOX%") <> "1" Then MsgBox msg, 64, "BoQ Checkpoint Copier"
