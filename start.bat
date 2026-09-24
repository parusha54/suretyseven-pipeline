@echo off
setlocal
cd /d "%~dp0"

echo ==================================================
echo   Starting SuretySeven Document Processing Pipeline
echo ==================================================
echo.

rem Load the database URL from the current shell, or from backend\.env.
if not defined DATABASE_URL (
  if not exist "backend\.env" (
    echo ERROR: DATABASE_URL is not set and backend\.env was not found.
    echo Create backend\.env with DATABASE_URL, or set DATABASE_URL before running this script.
    exit /b 1
  )
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"DATABASE_URL=" "backend\.env"`) do set "DATABASE_URL=%%B"
)

set "DATABASE_URL=%DATABASE_URL:"=%"
if not defined DATABASE_URL (
  echo ERROR: DATABASE_URL was not found in backend\.env.
  exit /b 1
)

echo [1/3] Starting PostgreSQL database with Docker Compose...
docker compose up -d db
if errorlevel 1 (
  echo ERROR: Could not start the database. Check that Docker Desktop is running.
  exit /b 1
)

echo.
echo Waiting for PostgreSQL to become ready...
set "DB_WAIT_ATTEMPTS=0"
:wait_for_db
docker compose exec -T db pg_isready -U postgres >NUL 2>&1
if not errorlevel 1 goto db_ready
set /a DB_WAIT_ATTEMPTS+=1
if %DB_WAIT_ATTEMPTS% GEQ 30 (
  echo ERROR: PostgreSQL did not become ready within 60 seconds.
  exit /b 1
)
timeout /t 2 /nobreak >NUL
goto wait_for_db

:db_ready
echo PostgreSQL is ready.
echo.

echo [2/3] Applying the Prisma schema...
pushd backend
call npx prisma db push
if errorlevel 1 (
  popd
  echo ERROR: Prisma could not apply the database schema.
  exit /b 1
)
popd

echo.
echo [3/3] Starting the backend and frontend...
start "SuretySeven Backend" cmd /k "cd /d ""%~dp0backend"" && npm run dev"
start "SuretySeven Frontend" cmd /k "cd /d ""%~dp0frontend"" && npm run dev"

echo.
echo ==================================================
echo   Startup commands launched
echo ==================================================
echo Frontend: http://localhost:5173
echo Backend:  http://localhost:3000
echo.
echo Close this window when you no longer need the launcher.
pause
