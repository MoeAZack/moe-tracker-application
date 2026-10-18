@echo off
setlocal
set "SCRIPT=%~dp0scrim-capture.ps1"
if not exist "%SCRIPT%" (
  echo MoeTracker scrim capture script was not found.
  pause
  exit /b 1
)

set "ROUNDS=%~1"
if "%ROUNDS%"=="" set /p ROUNDS=How many numbered rounds appear in TIMELINE? [22]: 
if "%ROUNDS%"=="" set "ROUNDS=22"
set "TEMPLATE=without-performance"
set "PROFILE=%~3"
if "%PROFILE%"=="" set "PROFILE=fullscreen-windowed"
set "DISPLAY=%~4"
if "%DISPLAY%"=="" set "DISPLAY=primary"

if /I "%~2"=="elevated" goto run_capture

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs -ArgumentList '%ROUNDS%','elevated','%PROFILE%','%DISPLAY%'"
if errorlevel 1 (
  echo Could not request Windows elevation.
  pause
  exit /b 1
)
exit /b 0

:run_capture
echo MoeTracker Scrim Capture is starting for %ROUNDS% rounds. The report layout will be detected automatically.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -RoundCount %ROUNDS% -Template "%TEMPLATE%" -CaptureProfile "%PROFILE%" -Display "%DISPLAY%"
set "CAPTURE_EXIT=%ERRORLEVEL%"
echo.
if "%CAPTURE_EXIT%"=="0" (
  echo Capture completed successfully.
  timeout /t 2 /nobreak >nul
  exit /b 0
) else (
  echo Capture stopped with exit code %CAPTURE_EXIT%.
)
echo Review the error above, then close this window.
pause
exit /b %CAPTURE_EXIT%
