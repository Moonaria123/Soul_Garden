@echo off
chcp 65001 >nul
:: ============================================
:: Soul Upload - One-Click Docker Deploy Script
:: ============================================

setlocal enabledelayedexpansion

set APP_NAME=soul-upload
set DEFAULT_PORT=3002

echo.
echo ╔══════════════════════════════════════════╗
echo ║       Soul Upload - Docker Deploy        ║
echo ╚══════════════════════════════════════════╝
echo.

:: ------- Check prerequisites -------
echo [1/5] Checking prerequisites...

where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed.
    echo Please install Docker: https://docs.docker.com/get-docker/
    pause
    exit /b 1
)

docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker daemon is not running.
    echo Please start Docker Desktop.
    pause
    exit /b 1
)

echo   Docker is ready.

:: ------- Configure port -------
echo [2/5] Configuring...

if "%1"=="" (
    set PORT=%DEFAULT_PORT%
) else (
    set PORT=%1
)
echo   Port: %PORT%

:: ------- Stop old container -------
echo [3/5] Stopping old container (if any)...

docker compose down >nul 2>&1
docker stop %APP_NAME% >nul 2>&1
docker rm %APP_NAME% >nul 2>&1
echo   Done.

:: ------- Build -------
echo [4/5] Building Docker image (this may take a few minutes)...

docker compose version >nul 2>&1
if %errorlevel% equ 0 (
    set "PORT=%PORT%" && docker compose build --no-cache
    if %errorlevel% neq 0 (
        echo [ERROR] Build failed.
        pause
        exit /b 1
    )
) else (
    docker build -t %APP_NAME% .
    if %errorlevel% neq 0 (
        echo [ERROR] Build failed.
        pause
        exit /b 1
    )
)
echo   Build complete.

:: ------- Run -------
echo [5/5] Starting container...

docker compose version >nul 2>&1
if %errorlevel% equ 0 (
    set "PORT=%PORT%" && docker compose up -d
) else (
    docker run -d --name %APP_NAME% -p %PORT%:3000 -e NODE_ENV=production -e NEXT_TELEMETRY_DISABLED=1 --restart unless-stopped %APP_NAME%
)

:: ------- Wait for health -------
echo   Waiting for app to start...
timeout /t 5 /nobreak >nul

echo.
echo ╔══════════════════════════════════════════╗
echo ║         Deployment Successful!           ║
echo ╠══════════════════════════════════════════╣
echo ║  URL: http://localhost:%PORT%              ║
echo ╚══════════════════════════════════════════╝
echo.
echo   Useful commands:
echo     View logs:   docker logs -f %APP_NAME%
echo     Stop:        docker stop %APP_NAME%
echo     Restart:     docker restart %APP_NAME%
echo     Remove:      docker rm -f %APP_NAME%
echo.
pause
