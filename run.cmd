@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
set "NODE_ENV=production"
cd /d "%~dp0"
if exist electron\main-loaded.txt del electron\main-loaded.txt
if exist debug.log del debug.log
echo Starting electron...
".\node_modules\electron\dist\electron.exe" .
echo Exit code: %ERRORLEVEL%
