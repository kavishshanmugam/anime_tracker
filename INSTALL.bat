@echo off
title Senpai - Installer Builder
echo.
echo ========================================
echo   Senpai - Anime Tracker Installer
echo ========================================
echo.

:: Check if Node.js is installed
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is required to build the installer.
    echo.
    echo Download it from https://nodejs.org/ (LTS recommended^)
    echo Install it, then run this again.
    echo.
    echo NOTE: Node.js is only needed to BUILD the installer.
    echo Once built, the installer exe can be shared to any PC
    echo without needing Node.js on that PC.
    echo.
    pause
    exit /b 1
)

echo [1/3] Installing dependencies...
call npm install --loglevel=error
if errorlevel 1 (
    echo.
    echo ERROR: Failed to install dependencies.
    echo Try deleting the node_modules folder and running this again.
    echo.
    pause
    exit /b 1
)

echo [2/3] Building installer...
call npm run package
set BUILD_EXIT=%errorlevel%

if %BUILD_EXIT% neq 0 (
    echo.
    echo ERROR: Build failed (exit code %BUILD_EXIT%^).
    echo Check the error messages above.
    echo.
    pause
    exit /b %BUILD_EXIT%
)

echo [3/3] Done!
echo.

:: Find the setup exe in release folder
for %%f in (release\*.exe) do (
    echo Installer created: %%f
    echo.
    echo To install on THIS computer:
    echo   The installer will open now - follow the prompts.
    echo.
    echo To install on ANOTHER computer:
    echo   Copy %%f to that PC and double-click it.
    echo   No Node.js or anything else needed on that PC.
    echo.
    echo After installing, Senpai appears in the Start Menu.
    echo Uninstall from Windows Settings ^> Apps like normal.
    echo.
    start "" "%%f"
    pause
    exit /b 0
)

echo ERROR: Installer exe not found in release folder.
echo Check the build output above.
pause
exit /b 1
