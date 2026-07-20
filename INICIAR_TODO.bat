@echo off
title Lanzador Maestro del CRM
color 0A

echo ========================================================
echo               INICIANDO SISTEMA CRM COMPLETO            
echo ========================================================
echo.
echo [1/2] Encendiendo el Cerebro (Backend de Python)...
start "Cerebro CRM (Python)" cmd /c "cd backend && start_backend.bat"

:: Esperar 3 segundos para asegurar que Python arranco
timeout /t 3 /nobreak > nul

echo [2/2] Encendiendo el Puente (Túnel Cloudflare)...
:: Arranca Cloudflared apuntando al puerto 8001 (que es el que usa start_backend.bat)
start "Puente Nube (Cloudflare)" cmd /k "cloudflared.cmd tunnel --url http://127.0.0.1:8001"

echo.
echo ========================================================
echo   ¡TODO LISTO! 
echo   Se abrieron dos ventanas nuevas. NO LAS CIERRES.
echo.
echo   - La ventana "Cerebro CRM" maneja tu base de datos.
echo   - La ventana "Puente Nube" te da el enlace publico.
echo.
echo   Busca en la ventana del Puente el enlace que dice:
echo   https://xxxx-xxxx-xxxx.trycloudflare.com
echo   y actualizalo en Vercel si ha cambiado.
echo ========================================================
echo.
pause
