@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
set "NODE_ENV=production"
cd /d "%~dp0"
".\node_modules\electron\dist\electron.exe" .
