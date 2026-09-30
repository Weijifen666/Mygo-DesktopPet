@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-private-voice.ps1" -Cpu
if errorlevel 1 pause
