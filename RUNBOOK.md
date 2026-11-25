# Runbook: publicar el CRM Mayoreo en Render + Neon (gratis, permanente)

Código listo en: `~/workspace/crm-mayoreo/` (NO es un repo git).
Cuenta a usar en todo: Google **princessitasboutique@gmail.com** (la misma de
la app de asistencia).

> Espejo del RUNBOOK de la app de asistencia
> (`~/workspace/migracion-render/RUNBOOK.md`): mismo stack
> (Node/Express + React/Vite + Postgres), misma forma de probar
> (`npm test` con pg-mem, sin base real) y de desplegar (GitHub → Render).
> Diferencias: segmentación por sucursal a nivel de dispositivo (el modo
> administrador usa el MISMO PIN de asistencia, verificado en el servidor),
> la base empieza vacía (sin clientes de ejemplo) y las tablas llevan
> prefijo `crm_`.

## Paso 1 — Neon: base de datos (reutilizar la de asistencia o crear una nueva)

Opción A (recomendada): reutilizar el proyecto Neon `princessitas-asistencia`
que ya usa la app de asistencia. Las tablas del CRM (`crm_clients`,
`crm_messages`, `crm_purchases`) llevan prefijo `crm_` y no tocan ninguna
tabla de asistencia. Usar la misma cadena de conexión pool.

Opción B: crear un proyecto Neon nuevo (gratis, sin tarjeta):

1. Abrir https://console.neon.tech y entrar con Google →
   **princessitasboutique@gmail.com**.
2. **Create project**:
   - Name: `princessitas-crm-mayoreo`
   - Region: **AWS US East (N. Virginia) `us-east-1`** (NO usar regiones
     Azure: East US 2, West US 3 ni Germany West Central — en esas, los
     proyectos gratis inactivos 90+ días se pueden borrar).
   - Postgres version: la que venga por defecto.
   - Compute size: el mínimo (0.25 CU).
3. Al crear el proyecto, Neon muestra la cadena de conexión. En el Dashboard
   → **Connection string** → activar **Pooled connection** (la cadena debe
   contener `-pooler` y `sslmode=require`).
4. **Copiar la cadena completa** (formato
   `postgresql://usuario:contraseña@ep-xxx-pooler.us-east-1.aws.neon.tech/nombrebd?sslmode=require`).
   La contraseña solo se muestra una vez; si se pierde, en el mismo panel
   se puede resetear.
5. No crear tablas manualmente: la app crea el esquema sola al arrancar
   (`db/schema.sql`). La base empieza vacía: no hay clientes de ejemplo.

## Paso 2 — GitHub: subir el código (repo público)

Repo: `princessitasboutique-dev/princessitas-crm-mayoreo`
(org `princessitasboutique-dev`, la misma de la app de asistencia).

1. Abrir https://github.com con la cuenta de Ulises → **New repository**:
   - Owner: `princessitasboutique-dev`
   - Name: `princessitas-crm-mayoreo`
   - Visibility: **Public** (Render puede desplegar desde un repo público
     sin conectar la cuenta).
   - No marcar "Add a README" (el proyecto ya trae uno).
2. En el repo vacío → **uploading an existing file** → arrastrar el
   contenido de `~/workspace/crm-mayoreo/` **EXCEPTO** `node_modules/` y
   `client/dist/` (el `.gitignore` ya los excluye; si la subida web los
   incluye por error, borrarlos del repo).
3. Confirmar que en el repo queden: `package.json`, `package-lock.json`,
   `server.js`, `render.yaml`, `README.md`, `RUNBOOK.md`, `.env.example`,
   `.gitignore`, carpetas `client/`, `db/`, `src/`, `test/`.

> Nota: la CLI `gh` NO está autenticada en esta máquina (`gh auth status`
> dice "not logged into any GitHub hosts"), así que la subida se hace por
> el navegador, igual que se hizo con la app de asistencia. Si alguien
> autentica `gh` después, el equivalente sería:
> `gh repo create princessitasboutique-dev/princessitas-crm-mayoreo --public`
> y subir con git (el proyecto no es un repo git todavía).

## Paso 3 — Render: crear el servicio web gratis (sin tarjeta)

1. Abrir https://dashboard.render.com y entrar con Google →
   **princessitasboutique@gmail.com** (la cuenta ya existe por la app de
   asistencia; el plan Hobby es $0 y no pide tarjeta — la verificación de
   identidad ya se hizo para la app de asistencia).
2. **New + → Web Service** → elegir el repo:
   - Si se conectó la cuenta de GitHub: seleccionar
     `princessitas-crm-mayoreo`.
   - Si no: **Public Git Repository** → pegar
     `https://github.com/princessitasboutique-dev/princessitas-crm-mayoreo`.
3. Configuración:
   - Name: `princessitas-crm-mayoreo`
   - Region: **Oregon (US West)** (la más cercana a México).
   - Branch: `main`
   - Runtime: **Node**
   - Build Command: `npm install && npm --prefix client install --include=dev && npm --prefix client run build`
   - Start Command: `node server.js`
   - Plan: **Free** (512 MB RAM; se duerme tras 15 min sin uso y tarda
     ~1 min en despertar — es lo aceptado, igual que la app de asistencia).
   - Health Check Path: `/api/health`
4. **Environment Variables** (Add Environment Variable):
   - `DATABASE_URL` = la cadena con pool de Neon copiada en el Paso 1
     (con `-pooler` y `sslmode=require`).
   - `NODE_ENV` = `production`
   - (NO poner nada más; `PORT` lo inyecta Render solo.)
5. **Create Web Service** → esperar a que el deploy termine en "Live"
   (tarda unos minutos; el primer build compila el frontend).
6. Copiar la URL: `https://princessitas-crm-mayoreo.onrender.com`
   (si Render sugiere otro nombre, anotar el real).

> El Build Command del panel ya incluye `--include=dev`: con
> `NODE_ENV=production` npm omite devDependencies y vite es devDependency
> del cliente; sin ese flag el build falla con `vite: not found` (misma
> lección que con la app de asistencia). El `render.yaml` del repo ya trae
> el comando correcto.

> El auto-deploy de Render NO se disparó solo con los pushes de la app de
> asistencia aunque estaba en "On Commit". Si el push no despliega solo,
> usar **Deploy latest commit** (manual) en el dashboard de Render.

## Paso 4 — Primer uso (lo hacen los colaboradores, no el agente)

1. Abrir la URL en el celular: primero pregunta "¿De qué sucursal eres?"
   (Medrano 58, Medrano 60 o Zapotlanejo); al elegirla se ve el encabezado
   "CRM Mayoreo — Princessitas" con las pestañas Clientes y Seguimientos,
   y el mensaje "No hay clientes de <sucursal> todavía".
2. Probar el alta de un cliente real: nombre, teléfono, sucursal,
   paquetería, y registrarle un mensaje y una compra para confirmar el
   flujo. La base empieza vacía; no hay clientes de ejemplo que borrar.
3. Compartir el enlace por WhatsApp a los colaboradores: entran desde el
   celular y lo guardan como acceso directo.

## Qué NO hacer

- NO crear la base de datos en Render (su Postgres gratis expira a los 30
  días y borra los datos a los 44).
- NO poner la cadena de conexión directa de Neon (sin `-pooler`): el pool
  de conexiones abiertas puede agotar las 100 CU-horas mensuales de Neon
  en ~17 días. Usar siempre la cadena con pool.
- NO subir `node_modules/` ni `client/dist/` al repo.
- NO poner valores reales de `DATABASE_URL` en el repo ni en `render.yaml`.

## Segmentación por sucursal y PIN de administración

- Cada colaboradora elige su sucursal la primera vez que abre la app (se
  guarda en `localStorage` del dispositivo). La API exige el alcance en el
  encabezado `x-branch` (o `x-admin-pin`); sin alcance responde 400.
- El modo administrador ("Ver todas las sucursales") se desbloquea con el
  **mismo PIN de la app de asistencia**: el CRM lee la tabla `settings`
  (clave `admin_pin_hash`, hash bcrypt) de la misma base Neon compartida y
  lo verifica con `bcrypt.compare` (`POST /api/admin/verify-pin`). El PIN
  **se crea y se cambia en la app de asistencia, no en el CRM**; el agente
  nunca lo pide ni lo guarda. El PIN queda guardado solo en
  `sessionStorage` (se pide de nuevo al cerrar la pestaña).
- Con honestidad: esto es segmentación a nivel de dispositivo, **no**
  cuentas de usuario con contraseña. Quien cambie la sucursal en su
  dispositivo o conozca el PIN puede ver otra sucursal.
- Migración de base: al arrancar, el servidor aplica `db/schema.sql` y
  además ejecuta `ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS` para
  `carrier_other` y `city`, así la base en vivo se actualiza sola al
  desplegar, sin tocar los datos ni a los clientes ya registrados.

## Actualizar un despliegue existente (nueva versión)

1. En el repo de GitHub, subir **solo los archivos cambiados** (misma
   ruta que en local; la subida web reemplaza el archivo):
   - `package.json`, `package-lock.json` (se agregó `bcrypt`)
   - `server.js` (sin cambios de lógica; no hace falta si ya está)
   - `src/app.js`, `src/db.js` (sin cambios; no hace falta si ya está)
   - `db/schema.sql`, `db/seed.js` (migración de columnas nuevas)
   - `client/src/App.jsx`, `client/src/api.js`, `client/src/styles.css`
   - `test/smoke.mjs`, `README.md`, `RUNBOOK.md`
   - NO subir `node_modules/` ni `client/dist/`.
2. En Render, si el auto-deploy no se dispara solo, usar **Deploy latest
   commit** (manual). Al arrancar, el servidor corre la migración y la app
   sigue funcionando con los datos existentes.

## Sin cuentas de usuario (versión actual)

Cualquiera con el enlace entra y elige su sucursal. El único acceso
protegido es el modo administrador, con el PIN de asistencia (ver arriba).
Si más adelante se quieren cuentas por persona, haría falta un sistema de
usuarios con contraseña (fuera del alcance actual).

## Verificación local (actualizada el 2026-11-25)

- `npm test`: **69/69 pruebas pasan** (pg-mem, sin base real). Incluyen:
  verificación del PIN (sin configurar, incorrecto y correcto), alcance
  obligatorio (lista y seguimientos sin sucursal ni PIN → 400), filtrado
  por sucursal (cada sucursal solo ve la suya; el administrador ve todas
  y puede filtrar por 'Otra'), ficha/edición/borrado/mensajes/compras
  fuera del alcance → 404, paquetería 'Otra' (sin nombre → 400; con
  nombre se guarda y se muestra como `carrier_display`; al salir de
  'Otra' se limpia) y ciudad (alta, edición y búsqueda por ciudad).
- `npm run build`: build de Vite OK (32 módulos, `dist/` generado).
- Smoke test con curl contra la app corriendo en local (sin
  `DATABASE_URL`): `/api/health` responde `{"ok":true}`, `/api/clients`
  sin alcance responde 400 y el frontend compilado carga (incluye los
  textos "¿De qué sucursal eres?", "Ver todas las sucursales" y
  "¿Qué paquetería?"). Las rutas de datos necesitan la base real.
- `node server.js` (sin `DATABASE_URL`): arranca, `/api/health` responde
  `{"ok":true}` y sirve el frontend compilado.
