@echo off
setlocal
pushd "%~dp0"

REM  push-live.bat  --  Bid Hunter one-step release.
REM
REM    push-live          test -> build -> commit+push -> deploy (goes live)
REM    push-live check    test -> build -> deploy --dry-run (changes nothing,
REM                       commits nothing, pushes nothing)
REM
REM  Deploy is gated on the test suite on purpose: CLAUDE.md asks for it to
REM  stay green, and a worker that ships red is worse than one that ships late.
REM
REM  D1 migrations are deliberately NOT run here. They change the production
REM  schema and are rare; keeping them manual means a routine code deploy can
REM  never alter your data by surprise. When one is needed, run it first:
REM    npx wrangler d1 migrations apply tint-intelligence --remote

set "MODE=%~1"
set "APPURL=https://tint-intelligence-ai.haut011.workers.dev"
set "WHO=%TEMP%\bh-whoami.txt"
set "CHG=%TEMP%\bh-changes.txt"
set "PUSHWARN="

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

REM ---- find git (not on PATH here; GitHub Desktop ships one) ----
set "GIT="
where git >nul 2>&1
if not errorlevel 1 set "GIT=git"
if defined GIT goto :gitready
for /f "delims=" %%D in ('dir /b /ad /o-n "%LOCALAPPDATA%\GitHubDesktop\app-*" 2^>nul') do call :trygit "%%D"
:gitready

echo [1/5] Running the test suite...
echo.
call npm test
if errorlevel 1 (
  echo.
  echo *** TESTS FAILED -- NOTHING WAS COMMITTED OR DEPLOYED. ***
  echo Fix the failures above, then run push-live again.
  goto :fail
)
echo.
echo       tests passed.
echo.

echo [2/5] Building the frontend bundles...
call npm run build
if errorlevel 1 (
  echo.
  echo *** BUILD FAILED -- NOTHING WAS COMMITTED OR DEPLOYED. ***
  goto :fail
)
echo       built public\app.js and public\portal.js
echo.

echo [3/5] Committing and pushing to GitHub...
if /i "%MODE%"=="check" (
  echo       skipped in check mode.
  goto :afterpush
)
if not defined GIT (
  echo       WARNING: git not found, so this release will NOT be committed
  echo       or pushed. Deploy continues. Install Git for Windows to fix.
  set "PUSHWARN=1"
  goto :afterpush
)
"%GIT%" status --porcelain > "%CHG%" 2>&1
for %%A in ("%CHG%") do set "CHGSIZE=%%~zA"
if "%CHGSIZE%"=="0" (
  echo       working tree is clean, nothing to commit.
  goto :pushonly
)
echo.
"%GIT%" status --short
echo.
set "MSG="
set /p "MSG=Commit message (press Enter for a timestamped one): "
if not defined MSG set "MSG=push-live release %DATE% %TIME%"
"%GIT%" add -A
"%GIT%" commit -m "%MSG%"
if errorlevel 1 (
  echo       WARNING: commit failed. Deploy continues, but this release is
  echo       not recorded in git.
  set "PUSHWARN=1"
  goto :afterpush
)
:pushonly
"%GIT%" push
if errorlevel 1 (
  echo.
  echo       WARNING: push failed. Your commit is safe locally but is NOT
  echo       on GitHub. Deploy continues.
  set "PUSHWARN=1"
) else (
  echo       pushed to GitHub.
)
:afterpush
echo.

echo [4/5] Checking the Cloudflare login...
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
  echo [5/5] Dry run -- validating the deploy without publishing...
  call "%WRANGLER%" deploy --dry-run
  if errorlevel 1 goto :fail
  echo.
  echo ===== CHECK PASSED. Nothing went live. =====
  echo Run push-live with no arguments to actually release.
  goto :done
)

echo [5/5] Deploying to Cloudflare...
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
if defined PUSHWARN (
  echo.
  echo  !! This code is LIVE but is not on GitHub. See the warning above.
  echo  !! It exists only on this computer. Sort that out before relying on it.
)
goto :done

:trygit
if defined GIT goto :eof
if exist "%LOCALAPPDATA%\GitHubDesktop\%~1\resources\app\git\cmd\git.exe" set "GIT=%LOCALAPPDATA%\GitHubDesktop\%~1\resources\app\git\cmd\git.exe"
goto :eof

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
