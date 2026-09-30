@echo off
setlocal
cd /d "%~dp0"
if not exist "index.js" (
  echo Missing upstream widget. Run scripts\setup-upstream.ps1 first.
  exit /b 1
)
if not exist "model" (
  echo Missing local Live2D resources. Run scripts\setup-upstream.ps1 first.
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Missing Electron. Run npm ci first.
  exit /b 1
)
"node_modules\electron\dist\electron.exe" .
