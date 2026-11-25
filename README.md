# CRM Mayoreo — Princessitas Ceremonias

App web para darle seguimiento a los **clientes de mayoreo** de Princessitas
Ceremonias (Ulises, México): base de datos de clientes con nombre, teléfono,
ciudad, sucursal que los atiende, paquetería habitual (con nombre libre
cuando es "Otra"), última compra, último mensaje, próxima fecha de
seguimiento, historial de mensajes y compras, total comprado acumulado y
botón de WhatsApp. Todo en español, mobile-first.

**Segmentación por sucursal:** al abrir la app por primera vez cada
colaboradora elige su sucursal (Medrano 58, Medrano 60 o Zapotlanejo) y
solo ve los clientes que atiende esa sucursal; la elección se guarda en el
dispositivo. El botón **"Ver todas las sucursales"** desbloquea el modo
administrador con el **mismo PIN de la app de asistencia** (se verifica en
el servidor contra la tabla `settings` de la base Neon compartida; el PIN
se crea y se cambia en la app de asistencia). Los clientes con sucursal
"Otra" solo se ven en modo administrador.

> Con honestidad: esto es segmentación a nivel de dispositivo, **no**
> cuentas de usuario con contraseña. Quien cambie la sucursal en su
> dispositivo o conozca el PIN de administración puede ver otra sucursal.
> Para control estricto por persona harían falta cuentas con contraseña.

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

- **Al abrir la app:** si es la primera vez en ese dispositivo, pregunta
  "¿De qué sucursal eres?" (Medrano 58, Medrano 60 o Zapotlanejo). El
  encabezado muestra la sucursal actual con "Cambiar sucursal" y el botón
  "Ver todas las sucursales" (pide el PIN de administración; el modo
  administrador se guarda solo en esa pestaña y se cierra con "Salir de
  administrador").
- **Pestaña Clientes:** buscador por nombre, teléfono **o ciudad** + filtros
  por paquetería y estado (nuevo / activo / inactivo); en modo administrador
  también hay filtro por sucursal. Cada tarjeta muestra nombre, teléfono,
  ciudad, sucursal, paquetería (si es "Otra", el nombre que se escribió),
  estado, última compra (fecha + descripción + monto), último mensaje,
  próxima fecha de seguimiento (resaltada si está vencida o es hoy) y botón
  de **WhatsApp** (abre el chat con el teléfono del cliente).
- **Pestaña Seguimientos:** clientes con próxima fecha de seguimiento
  vencida, de hoy y de los próximos 7 días, en ese orden. El número en la
  pestaña es vencidos + hoy.
- **Ficha del cliente:** editar datos, registrar mensaje (fecha, canal:
  WhatsApp / llamada / otro, texto), registrar compra (fecha, descripción,
  monto) y ver el historial de mensajes y compras. Al registrar un mensaje
  se actualiza el último mensaje del cliente; al registrar una compra se
  actualizan su última compra y su total comprado acumulado. También se
  puede eliminar el cliente (borra su historial).
- **Nuevo cliente:** nombre y teléfono obligatorios; ciudad opcional;
  sucursal (se prellena con la sucursal del dispositivo), paquetería
  (si es "Otra" hay que escribir cuál es), estado, próxima fecha de
  seguimiento y notas opcionales.

## Acceso: sin cuentas, con PIN solo para "Ver todas"

Cualquiera con el enlace entra y elige su sucursal. El único acceso
protegido es el modo administrador, con el PIN de la app de asistencia
(tabla `settings`, clave `admin_pin_hash`, hash bcrypt, en la misma base
Neon). El PIN se crea y se cambia en la app de asistencia, no en el CRM.
Si el CRM se despliega con una base nueva (sin asistencia), no hay PIN
configurado y el modo administrador queda sin usar hasta que se cree el
PIN en asistencia. El agente nunca pide ni guarda el PIN.

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

Alcance obligatorio en las rutas de datos: encabezado `x-branch` con la
sucursal del dispositivo, o `x-admin-pin` con el PIN de administración.
Sin alcance → 400; PIN incorrecto → 401. Sin ser administrador, la lista
y los seguimientos son siempre los de la sucursal propia (el parámetro
`branch` se ignora); el administrador puede filtrar por cualquier
sucursal, incluida "Otra". La ficha, la edición, el borrado y el registro
de mensajes/compras de un cliente fuera del alcance responden 404.

- `GET /api/health` → `{ok:true}`
- `POST /api/admin/verify-pin` → `{ok, pinSet, verified}` (mismo
  comportamiento que la app de asistencia)
- `GET /api/clients?search=&branch=&carrier=&status=` → lista con búsqueda
  (nombre, teléfono o ciudad) y filtros
- `POST /api/clients` · `GET /api/clients/:id` (con mensajes y compras) · `PUT /api/clients/:id` · `DELETE /api/clients/:id`
- `POST /api/clients/:id/messages` · `POST /api/clients/:id/purchases`
- `GET /api/followups` → seguimientos vencidos, de hoy y próximos 7 días

Migración: al arrancar, el servidor aplica `db/schema.sql` y agrega las
columnas `carrier_other` y `city` a `crm_clients` si faltan (`ALTER TABLE
... ADD COLUMN IF NOT EXISTS`), así la base en vivo se actualiza sola al
desplegar sin tocar los datos.
