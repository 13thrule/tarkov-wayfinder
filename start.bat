@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 18 or newer is required. Get it from https://nodejs.org & pause & exit /b 1)
start "" http://localhost:8801
node server.js
pause
