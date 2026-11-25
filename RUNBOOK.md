# Runbook: publicar el CRM Mayoreo en Render + Neon (gratis, permanente)

Código listo en: `~/workspace/crm-mayoreo/` (NO es un repo git).
Cuenta a usar en todo: Google **princessitasboutique@gmail.com** (la misma de
la app de asistencia).

> Espejo del RUNBOOK de la app de asistencia
> (`~/workspace/migracion-render/RUNBOOK.md`): mismo stack
> (Node/Express + React/Vite + Postgres), misma forma de probar
> (`npm test` con pg-mem, sin base real) y de desplegar (GitHub → Render).
> Diferencias: sin PIN en esta versión (la usan todos los colaboradores por
> el enlace), la base empieza vacía (sin clientes de ejemplo) y las tablas
> llevan prefijo `crm_`.

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

1. Abrir la URL en el celular: debe verse el encabezado
   "CRM Mayoreo — Princessitas" con las pestañas Clientes y Seguimientos,
   y el mensaje "No hay clientes todavía".
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

## Sin login (versión actual) — PIN opcional después

Cualquiera con el enlace puede ver y editar el CRM. Si más adelante se
quiere restringir el acceso, se puede agregar un PIN compartido como el de
la app de asistencia:

- Tabla `settings` (`admin_pin_hash`, bcrypt) + endpoints
  `POST /api/admin/pin` y `POST /api/admin/verify-pin`.
- Middleware que exija el PIN en el encabezado `x-admin-pin` en las rutas
  de escritura (o en todas).
- El PIN lo crean Ulises y Yareli al primer uso y lo guardan entre ellos;
  el agente nunca lo pide ni lo guarda.

## Verificación local (ya hecha el 2026-11-25)

- `npm test`: **41/41 pruebas pasan** (pg-mem, sin base real).
- `npm run build`: build de Vite OK (32 módulos, `dist/` generado).
- Smoke test con curl contra la app corriendo en local (pg-mem): todos
  los endpoints responden — health, lista vacía, crear, buscar, ficha,
  mensaje, compra, seguimientos, PUT y DELETE.
- `node server.js` (sin `DATABASE_URL`): arranca, `/api/health` responde
  `{"ok":true}` y sirve el frontend compilado.
