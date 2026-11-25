' NAI Studio — Native Windows Desktop Silent Launcher (Zero Black Console Window)
Option Explicit
Dim fso, shell, rootDir, pyw, candidates, c, scriptPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = rootDir & "\desktop_app.py"

candidates = Array( _
  rootDir & "\.venv\Scripts\pythonw.exe", _
  rootDir & "\venv\Scripts\pythonw.exe", _
  shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Python\bin\pythonw.exe" _
)

pyw = ""
For Each c In candidates
  If fso.FileExists(c) Then
    pyw = c
    Exit For
  End If
Next

If pyw = "" Then
  pyw = "pythonw.exe"
End If

shell.CurrentDirectory = rootDir
shell.Run """" & pyw & """ """ & scriptPath & """", 0, False
