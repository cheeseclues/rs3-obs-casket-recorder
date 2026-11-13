@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch-Recorder.ps1"
if errorlevel 1 (
  echo.
  echo Launcher failed. Check launcher.log in this folder.
  pause
)
