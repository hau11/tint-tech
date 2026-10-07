@echo off
setlocal
pushd "%~dp0"

REM  push-live.bat  --  Bid Hunter one-step deploy.
REM
REM    push-live          test -> build -> deploy (goes live)
REM    push-live check    test -> build -> deploy --dry-run (changes nothing)
REM
REM  Deploy is gated on the test suite on purpose: CLAUDE.md says keep it
REM  green, and a worker that ships red is worse than one that ships late.
REM
REM  Database migrations are deliberately NOT run here. They change the
REM  production schema and are rare; keeping them manual means a routine
REM  code deploy can never alter your data by surprise. When a migration
REM  is needed, run it yourself first:
REM    npx wrangler d1 migrations apply tint-intelligence --remote

set "MODE=%~1"
set "APPURL=https://tint-intelligence-ai.haut011.workers.dev"
set "WHO=%TEMP%\bh-whoami.txt"

echo ===============================================
if /i "%MODE%"=="check" (
  echo   Bid Hunter  --  CHECK ONLY, nothing goes live
) else (
  echo   Bid Hunter  --  PUSH LIVE
)
echo ===============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
  ) else (
    echo ERROR: Node.js not found on PATH.
    echo Install it from https://nodejs.org and try again.
    goto :fail
  )
)

set "WRANGLER=node_modules\.bin\wrangler.cmd"
if not exist "%WRANGLER%" (
  echo ERROR: node_modules is missing or incomplete.
  echo Run this once:  npm install
  goto :fail
)

echo [1/4] Running the test suite...
echo.
call npm test
if errorlevel 1 (
  echo.
  echo *** TESTS FAILED -- NOTHING WAS DEPLOYED. ***
  echo Fix the failures above, then run push-live again.
  goto :fail
)
echo.
echo       tests passed.
echo.

echo [2/4] Building the frontend bundles...
call npm run build
if errorlevel 1 (
  echo.
  echo *** BUILD FAILED -- NOTHING WAS DEPLOYED. ***
  goto :fail
)
echo       built public\app.js and public\portal.js
echo.

echo [3/4] Checking the Cloudflare login...
if /i "%MODE%"=="check" goto :skiplogin
call "%WRANGLER%" whoami > "%WHO%" 2>&1
findstr /C:"not authenticated" "%WHO%" >nul
if not errorlevel 1 (
  echo       not logged in -- opening your browser now, click Allow.
  call "%WRANGLER%" login
  if errorlevel 1 (
    echo *** LOGIN FAILED -- NOTHING WAS DEPLOYED. ***
    goto :fail
  )
) else (
  echo       already logged in.
)
goto :afterlogin
:skiplogin
echo       skipped -- a dry run needs no Cloudflare login.
:afterlogin
echo.

if /i "%MODE%"=="check" (
  echo [4/4] Dry run -- validating the deploy without publishing...
  call "%WRANGLER%" deploy --dry-run
  if errorlevel 1 goto :fail
  echo.
  echo ===== CHECK PASSED. Nothing went live. =====
  echo Run push-live with no arguments to actually deploy.
  goto :done
)

echo [4/4] Deploying to Cloudflare...
call "%WRANGLER%" deploy
if errorlevel 1 (
  echo.
  echo *** DEPLOY FAILED. ***
  goto :fail
)

echo.
echo ================= LIVE =================
echo %APPURL%
echo =======================================
goto :done

:fail
echo.
popd
pause
exit /b 1

:done
echo.
popd
pause
exit /b 0
