@echo off
title Lanzador Maestro del CRM
color 0A

echo ========================================================
echo               INICIANDO SISTEMA CRM COMPLETO            
echo ========================================================
echo.

:: ---------- 1. Cerebro (Python Backend) ----------
echo [1/3] Encendiendo el Cerebro (Backend de Python)...
start "Cerebro CRM (Python)" cmd /k "cd /d %~dp0backend && start_backend.bat"

:: Esperar que Python arranque
timeout /t 5 /nobreak > nul

:: ---------- 2. Tunel SSH Serveo (sin instalacion, funciona con Windows SSH) ----------
echo [2/3] Encendiendo el Tunel publico (via SSH/Serveo)...
start "Tunel Publico (Serveo)" cmd /k "ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:8001 serveo.net"

:: Esperar que el tunel arranque y obtenga URL
timeout /t 12 /nobreak > nul

:: ---------- 3. Registrar Webhook en Evolution API ----------
echo [3/3] Registrando webhook en Evolution API...
echo.
echo INSTRUCCION IMPORTANTE:
echo ============================================================
echo  Mira la ventana "Tunel Publico" y busca una linea que dice:
echo  "Forwarding HTTP traffic from https://xxxxxxx.serveousercontent.com"
echo.
echo  Copia esa URL y ejecuta el script SET_WEBHOOK.ps1 con ella:
echo  .\SET_WEBHOOK.ps1 -TunnelUrl "https://xxxxxxx.serveousercontent.com"
echo ============================================================
echo.
echo ========================================================
echo   TODO LISTO! Se abrieron ventanas nuevas. NO LAS CIERRES.
echo.
echo   - "Cerebro CRM" = Base de datos local (puerto 8001)
echo   - "Tunel Publico" = Puente a internet (Serveo)
echo.
echo   Para verificar que todo funciona, abre el CRM en Vercel:
echo   La seccion de Chats mostrara mensajes en tiempo real.
echo ========================================================
echo.
pause
