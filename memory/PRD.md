# PRD — COBRANZAS.XD Command Center

## Problem Statement
CRM de gestión para información de clientes de 4 países (México, Colombia, Perú, Chile). Maneja entre 150 y 300 clientes por día por turno laboral. La versión preliminar (HTML plano) era "muy floja visualmente y demasiado mecánica". Debe verse ejecutivo, ser divertido e intuitivo.

## User Personas
- **Operador de cobranza**: procesa 150-300 contactos/día vía WhatsApp/SMS
- **Supervisor**: revisa reportes por país y tasas de éxito
- **Admin de scripts**: configura URLs de Collection, scripts .py y webhooks WhatsApp por país

## Core Requirements
- 4 países fijos: MX (+52) · CO (+57) · PE (+51) · CL (+56)
- Módulo dedicado WhatsApp Center (conectar, cargar CSV con código de país prepend, revisar, enviar)
- Sin autenticación (acceso directo)
- Webhook configurable de WhatsApp — funciona con cualquier proveedor
- Almacenamiento de archivos (Emergent Object Storage)

## Architecture
- Backend: FastAPI + Motor (MongoDB) + Emergent Object Storage
- Frontend: React 19 + Tailwind + shadcn/ui + Recharts
- Diseño: "Command Center" — dark True Grey (#09090B), acento neón #E1FF00, glassmorphism sutil
- Fuentes: Outfit (headings) · Manrope (body) · JetBrains Mono (mono)

## Implemented Features (as of 2026-07-16)
- Dashboard general con estadísticas agregadas
- **WhatsApp Center** con wizard 4 pasos:
  1. Conectar (QR + Webhook manual)
  2. Cargar CSV con selector de código de país
  3. Revisar contactos con filtros por días de mora
  4. Seleccionar plantilla y enviar
- Contactos: tabla ultra-densa con filtros, importación CSV, seed demo, CRUD manual
- Plantillas: 4 preseleccionadas por país (default/friendly/formal/urgent), editables + variables click-to-insert
- Archivos: Object Storage con drag&drop, categorías, importación de contactos desde CSV almacenado
- Reportes: charts recharts por país, tasa de éxito, exportación CSV
- Configuración por país: Collection URL, scripts folder, WhatsApp webhook + API key + test
- Consola de logs estilo terminal, actualización cada 5s

## Backend Endpoints
- `/api/config/{country}` GET/PUT — configuración por país
- `/api/contacts` GET/POST/PATCH/DELETE — CRUD contactos
- `/api/contacts/import` POST — importar CSV genérico
- `/api/contacts/seed-demo` POST — cargar contactos demo
- `/api/templates/{country}` GET / `/api/templates` PUT — plantillas
- `/api/send` POST — enviar mensajes (webhook)
- `/api/logs` GET/POST/DELETE — consola
- `/api/reports/summary` GET — dashboard stats
- `/api/files` GET / upload / download / delete — object storage
- `/api/whatsapp/import` POST — CSV con código de país
- `/api/whatsapp/qr/{country}` GET — QR de conexión
- `/api/whatsapp/connect/{country}` POST — marcar conectado
- `/api/whatsapp/status/{country}` GET — estado
- `/api/whatsapp/disconnect/{country}` POST — desconectar
- `/api/whatsapp/dial-codes` GET — códigos telefónicos

## Prioritized Backlog
### P0 (blocking)
- ✓ Todos implementados

### P1
- Persistencia del CSV subido en el flujo WhatsApp (para reusar sin re-subir)
- Filtro rápido por app_cliente en tabla WhatsApp Center
- Historial de envíos (dispatches) visible en UI

### P2
- Programación de envíos futuros (schedule)
- Mensajes con imágenes/archivos adjuntos
- Multi-usuario / roles
- Webhook entrante para recibir respuestas de clientes
- Estadísticas en tiempo real con WebSocket
