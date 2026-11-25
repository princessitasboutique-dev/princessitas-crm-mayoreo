# CRM Mayoreo — Princessitas Ceremonias

App web para darle seguimiento a los **clientes de mayoreo** de Princessitas
Ceremonias (Ulises, México): base de datos de clientes con nombre, teléfono,
sucursal que los atiende, paquetería habitual, última compra, último mensaje,
próxima fecha de seguimiento, historial de mensajes y compras, total comprado
acumulado y botón de WhatsApp. Todo en español, mobile-first. La usan todos
los colaboradores por el enlace (sin login en esta versión).

Stack: **Node.js + Express + PostgreSQL (`pg`) + React con Vite**.
Un solo servicio web: Express sirve `/api/*` y el build de React
(`client/dist`). Sin servicios de pago.

## Variables de entorno

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `DATABASE_URL` | Sí (en producción) | Cadena de conexión **pool** de Neon, con SSL. Ej.: `postgresql://usuario:contraseña@host/basedatos?sslmode=require` |
| `PORT` | No | Render lo inyecta. Local: `3000` por defecto. |
| `NODE_ENV` | No | `production` en Render. |

Copia `.env.example` como `.env` para desarrollo local. **Nunca subas `.env`
a Git** (está en `.gitignore`, junto con `node_modules/` y `client/dist/`).

El pool de `pg` está configurado con `min: 0, max: 5,
idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000` y
`ssl: { rejectUnauthorized: false }`: sin conexiones permanentes abiertas,
para no agotar las 100 CU-horas mensuales del plan gratuito de Neon.

**Ojo — base compartida:** las tablas del CRM llevan prefijo `crm_`
(`crm_clients`, `crm_messages`, `crm_purchases`) para convivir con las
tablas de la app de asistencia en la misma base de Neon sin tocarlas. Se
puede usar la misma `DATABASE_URL` de la app de asistencia o una base Neon
nueva; el esquema se crea solo al arrancar.

## Despliegue en Render (desde un repo GitHub)

Ver `RUNBOOK.md` para los pasos completos (GitHub + Neon + Render).

1. Sube este proyecto a un repositorio de GitHub (el repo **no** debe incluir
   `node_modules/` ni `client/dist/`; `.gitignore` ya los excluye).
2. En [Neon](https://neon.tech) crea un proyecto (plan gratuito) o reutiliza
   la base de la app de asistencia; copia su cadena de conexión **pool**
   (la que termina en `-pooler`, con `sslmode=require`).
3. En [Render](https://render.com) → **New → Web Service** → conecta el repo.
   Render detecta `render.yaml` (plan free):
   - **Build Command:** `npm install && npm --prefix client install --include=dev && npm --prefix client run build`
   - **Start Command:** `node server.js`
   - **Health Check Path:** `/api/health`
4. En el servicio, pestaña **Environment**, agrega:
   - `DATABASE_URL` = la cadena pool de Neon
   - `NODE_ENV` = `production`
5. Despliega. Al arrancar, el servidor crea las tablas (`db/schema.sql`).
   La base empieza **vacía**: no hay clientes de ejemplo; los colaboradores
   dan de alta a sus clientes desde la app.

## Uso

- **Pestaña Clientes:** buscador por nombre o teléfono + filtros por
  sucursal, paquetería y estado (nuevo / activo / inactivo). Cada tarjeta
  muestra nombre, teléfono, sucursal, paquetería, estado, última compra
  (fecha + descripción + monto), último mensaje, próxima fecha de
  seguimiento (resaltada si está vencida o es hoy) y botón de **WhatsApp**
  (abre el chat con el teléfono del cliente).
- **Pestaña Seguimientos:** clientes con próxima fecha de seguimiento
  vencida, de hoy y de los próximos 7 días, en ese orden. El número en la
  pestaña es vencidos + hoy.
- **Ficha del cliente:** editar datos, registrar mensaje (fecha, canal:
  WhatsApp / llamada / otro, texto), registrar compra (fecha, descripción,
  monto) y ver el historial de mensajes y compras. Al registrar un mensaje
  se actualiza el último mensaje del cliente; al registrar una compra se
  actualizan su última compra y su total comprado acumulado. También se
  puede eliminar el cliente (borra su historial).
- **Nuevo cliente:** nombre y teléfono obligatorios; sucursal, paquetería,
  estado, próxima fecha de seguimiento y notas opcionales.

## Sin login (versión actual)

Cualquiera con el enlace puede ver y editar el CRM. Si más adelante se
quiere restringir el acceso, se puede agregar un PIN compartido como el de
la app de asistencia (tabla `settings` + encabezado `x-admin-pin`); ver
`RUNBOOK.md`.

## Desarrollo local

```bash
npm install
npm run build        # construye el frontend (client/dist)
npm start            # levanta el servidor en http://localhost:3000
```

Sin `DATABASE_URL`, el servidor arranca pero las rutas de datos necesitan
una base PostgreSQL. Prueba de humo (sin base real, con `pg-mem`):

```bash
npm test
```

## Endpoints principales (`/api`)

- `GET /api/health` → `{ok:true}`
- `GET /api/clients?search=&branch=&carrier=&status=` → lista con búsqueda y filtros
- `POST /api/clients` · `GET /api/clients/:id` (con mensajes y compras) · `PUT /api/clients/:id` · `DELETE /api/clients/:id`
- `POST /api/clients/:id/messages` · `POST /api/clients/:id/purchases`
- `GET /api/followups` → seguimientos vencidos, de hoy y próximos 7 días
