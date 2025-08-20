@echo off
echo 🚀 Starting LLM Document Optimizer Test UI...
echo.
echo This will start a local web server to host the test UI
echo and avoid CORS issues with file:// protocol.
echo.
cd /d "%~dp0"
node serve.js
pause