// test/smoke.mjs — prueba de humo sin base real.
// Levanta la app Express con pg-mem (PostgreSQL en memoria), aplica el
// esquema y prueba los endpoints principales. No toca ningún dato real.
// Uso: npm test
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { newDb } = require('pg-mem');
const bcrypt = require('bcrypt');
const { createApp } = require('../src/app.js');
const { ensureSchema, seed } = require('../db/seed.js');

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name} ${extra}`); }
}

// 13. Migración desde esquema v1 (regresión del error 500 al guardar).
// La base en vivo se creó con el esquema v1, cuya tabla crm_clients NO
// tenía carrier_other ni city. ensureSchema debe agregar esas columnas al
// arrancar aunque schema.sql falle a medias (antes, el CREATE INDEX sobre
// city abortaba la consulta multi-sentencia y el bucle ALTER nunca corría,
// así que POST /api/clients fallaba con 500 "Error interno del servidor.").
async function testV1Migration() {
  console.log('Migración v1 -> actual (pg-mem, sin base real)');
  // Esquema v1: igual que schema.sql pero sin carrier_other, sin city y
  // sin el índice sobre city, con un cliente ya guardado.
  const V1_TABLES = `
CREATE TABLE crm_clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'Otra'
    CHECK (branch IN ('Medrano 58', 'Medrano 60', 'Zapotlanejo', 'Otra')),
  carrier TEXT NOT NULL DEFAULT 'Otra'
    CHECK (carrier IN ('Paquetexpress', 'Coordinadora', 'Estafeta', 'FedEx', 'Skydropx', 'Otra')),
  status TEXT NOT NULL DEFAULT 'nuevo'
    CHECK (status IN ('nuevo', 'activo', 'inactivo')),
  total_purchased NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_purchase_date DATE,
  last_purchase_description TEXT,
  last_purchase_amount NUMERIC(12,2),
  last_message_text TEXT,
  last_message_date DATE,
  next_followup_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE crm_messages (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  text TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'WhatsApp'
    CHECK (channel IN ('WhatsApp', 'llamada', 'otro')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE crm_purchases (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX idx_crm_clients_name ON crm_clients(name);
CREATE INDEX idx_crm_clients_phone ON crm_clients(phone);
CREATE INDEX idx_crm_clients_followup ON crm_clients(next_followup_date);
CREATE INDEX idx_crm_messages_client ON crm_messages(client_id);
CREATE INDEX idx_crm_purchases_client ON crm_purchases(client_id);
INSERT INTO crm_clients (name, phone, branch, carrier, status)
VALUES ('Cliente Viejo', '3300000000', 'Medrano 58', 'Paquetexpress', 'activo');
`;
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await pool.query(V1_TABLES);

  const columns = async () => {
    const r = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'crm_clients' AND column_name IN ('carrier_other', 'city')"
    );
    return r.rows.map((x) => x.column_name);
  };
  check('v1: antes de ensureSchema faltan carrier_other y city', (await columns()).length === 0);

  // En pg-mem, ensureSchema sobre una base v1 lanza un error propio de
  // pg-mem en el CREATE TABLE IF NOT EXISTS (la tabla ya existe); en
  // Postgres real esa sentencia es un no-op y no falla. Lo que se verifica
  // es el resultado: las columnas quedan agregadas aunque schema.sql
  // falle a medias, porque la migración corre ANTES que schema.sql.
  try {
    await ensureSchema(pool);
  } catch (err) {
    console.log(`  (ensureSchema lanzó en pg-mem, se tolera: ${String(err.message).split('\n')[0].slice(0, 120)})`);
  }
  const cols = await columns();
  check('v1: tras ensureSchema existen carrier_other y city', cols.includes('carrier_other') && cols.includes('city'), cols.join(','));
  const old = await pool.query('SELECT COUNT(*)::int AS c FROM crm_clients WHERE name = $1', ['Cliente Viejo']);
  check('v1: el cliente guardado con el esquema viejo sigue ahí', old.rows[0].c === 1);

  // El caso exacto que fallaba en vivo: guardar un cliente nuevo.
  const app = createApp(pool);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function req(path, opts = {}) {
    const res = await fetch(base + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* texto plano */ }
    return { status: res.status, json, text };
  }
  try {
    let r = await req('/api/clients', { method: 'POST', headers: { 'x-branch': 'Medrano 58' }, body: { name: 'Clara Esthela', phone: '331767 8012', branch: 'Medrano 58', carrier: 'Paquetexpress' } });
    check('v1: POST /api/clients (Clara Esthela) -> 201', r.status === 201 && r.json?.client?.name === 'Clara Esthela', JSON.stringify(r.json));
    r = await req('/api/clients?search=clara', { headers: { 'x-branch': 'Medrano 58' } });
    check('v1: GET /api/clients?search=clara -> 200 y la encuentra', r.status === 200 && r.json?.clients?.length === 1 && r.json.clients[0].name === 'Clara Esthela', JSON.stringify(r.json));
    // Idempotencia: correr ensureSchema otra vez no rompe nada.
    try { await ensureSchema(pool); } catch { /* mismo error propio de pg-mem, se tolera */ }
    const cols2 = await columns();
    check('v1: segundo ensureSchema deja las columnas y no borra datos', cols2.includes('carrier_other') && cols2.includes('city'), cols2.join(','));
    r = await req('/api/clients', { method: 'POST', headers: { 'x-branch': 'Zapotlanejo' }, body: { name: 'Boutique Rosa', phone: '3344445555', branch: 'Zapotlanejo', carrier: 'Estafeta', city: 'Guadalajara' } });
    check('v1: tras segundo ensureSchema, POST con ciudad -> 201', r.status === 201 && r.json?.client?.city === 'Guadalajara', JSON.stringify(r.json));
  } finally {
    server.close();
    await pool.end().catch(() => {});
  }
}

async function main() {
  console.log('Smoke test — CRM Mayoreo (pg-mem, sin base real)');
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await ensureSchema(pool);
  await seed(pool);

  const app = createApp(pool);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  // Alcances: sucursal propia (encabezado x-branch) o administrador
  // (encabezado x-admin-pin con el PIN de asistencia, '1234' en pruebas).
  const H58 = { 'x-branch': 'Medrano 58' };
  const HZ = { 'x-branch': 'Zapotlanejo' };
  const HADMIN = { 'x-admin-pin': '1234' };

  async function req(path, opts = {}) {
    const res = await fetch(base + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* texto plano */ }
    return { status: res.status, json, text };
  }

  try {
    // 0. PIN de administración (reutilizado de asistencia, tabla settings)
    let r = await req('/api/admin/verify-pin', { method: 'POST', body: {} });
    check('verify-pin sin PIN configurado -> pinSet false', r.status === 200 && r.json?.pinSet === false && r.json?.verified === false, JSON.stringify(r.json));
    const hash = await bcrypt.hash('1234', 10);
    await pool.query("INSERT INTO settings (key, value) VALUES ('admin_pin_hash', $1)", [hash]);
    r = await req('/api/admin/verify-pin', { method: 'POST', body: {} });
    check('verify-pin con PIN configurado y vacío -> pinSet true, verified false', r.status === 200 && r.json?.pinSet === true && r.json?.verified === false, JSON.stringify(r.json));
    r = await req('/api/admin/verify-pin', { method: 'POST', body: { pin: '9999' } });
    check('verify-pin PIN incorrecto -> verified false', r.status === 200 && r.json?.verified === false, JSON.stringify(r.json));
    r = await req('/api/admin/verify-pin', { method: 'POST', body: { pin: '1234' } });
    check('verify-pin PIN correcto -> verified true', r.status === 200 && r.json?.verified === true, JSON.stringify(r.json));

    // 1. Salud
    r = await req('/api/health');
    check('GET /api/health -> {ok:true}', r.status === 200 && r.json?.ok === true, JSON.stringify(r.json));

    // 2. Lista: sin alcance -> 400; con sucursal -> vacía al inicio
    r = await req('/api/clients');
    check('GET /api/clients sin sucursal ni PIN -> 400', r.status === 400 && /sucursal/i.test(r.json?.error || ''), JSON.stringify(r.json));
    r = await req('/api/followups');
    check('GET /api/followups sin sucursal ni PIN -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req('/api/clients', { headers: H58 });
    check('GET /api/clients (Medrano 58) -> lista vacía', r.status === 200 && Array.isArray(r.json?.clients) && r.json.clients.length === 0, JSON.stringify(r.json));

    // 3. Validaciones al crear cliente
    r = await req('/api/clients', { method: 'POST', headers: H58, body: { phone: '3311112222' } });
    check('POST /api/clients sin nombre -> 400', r.status === 400 && /nombre/.test(r.json?.error || ''), JSON.stringify(r.json));
    r = await req('/api/clients', { method: 'POST', headers: H58, body: { name: 'Boutique Luna' } });
    check('POST /api/clients sin teléfono -> 400', r.status === 400 && /teléfono/.test(r.json?.error || ''), JSON.stringify(r.json));
    r = await req('/api/clients', { method: 'POST', headers: H58, body: { name: 'Boutique Luna', phone: '3311112222', branch: 'Medrano 99' } });
    check('POST /api/clients sucursal inválida -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req('/api/clients', { method: 'POST', headers: H58, body: { name: 'Boutique Luna', phone: '3311112222', carrier: 'DHL' } });
    check('POST /api/clients paquetería inválida -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req('/api/clients', { method: 'POST', headers: H58, body: { name: 'Boutique Luna', phone: '3311112222', next_followup_date: '2026-13-40' } });
    check('POST /api/clients fecha de seguimiento inválida -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req('/api/clients', { method: 'POST', headers: H58, body: { name: 'Boutique Luna', phone: '3311112222', carrier: 'Otra' } });
    check('POST /api/clients paquetería Otra sin nombre -> 400', r.status === 400 && /paquetería/i.test(r.json?.error || ''), JSON.stringify(r.json));

    // 4. Crear cliente: valores por defecto, con ciudad
    r = await req('/api/clients', { method: 'POST', headers: H58, body: { name: 'Boutique Luna', phone: '3311112222', branch: 'Medrano 58', carrier: 'Paquetexpress', city: 'Zapopan', notes: 'Compra ropones' } });
    check('POST /api/clients -> 201, estado nuevo, total 0, wa.me con 52, ciudad', r.status === 201 && r.json?.client?.status === 'nuevo' && r.json?.client?.total_purchased === 0 && r.json?.client?.whatsapp_url === 'https://wa.me/523311112222' && r.json?.client?.city === 'Zapopan', JSON.stringify(r.json));
    const lunaId = r.json?.client?.id;

    // 5. Crear segundo cliente (para filtros y seguimientos) y tercero
    // (sucursal 'Otra', paquetería 'Otra' con nombre libre, ciudad).
    r = await req('/api/clients', { method: 'POST', headers: HZ, body: { name: 'Ceremonias Sol', phone: '3322223333', branch: 'Zapotlanejo', carrier: 'Estafeta', city: 'Guadalajara', status: 'activo', next_followup_date: '2026-11-20' } });
    check('POST segundo cliente -> 201', r.status === 201 && r.json?.client?.status === 'activo', JSON.stringify(r.json));
    const solId = r.json?.client?.id;
    r = await req('/api/clients', { method: 'POST', headers: HADMIN, body: { name: 'Boutique Mar', phone: '3333334444', branch: 'Otra', carrier: 'Otra', carrier_other: 'Tresguerras', city: 'Guadalajara' } });
    check('POST cliente Otra/Tresguerras -> 201, carrier_display es el nombre libre', r.status === 201 && r.json?.client?.carrier === 'Otra' && r.json?.client?.carrier_other === 'Tresguerras' && r.json?.client?.carrier_display === 'Tresguerras' && r.json?.client?.city === 'Guadalajara', JSON.stringify(r.json));
    const marId = r.json?.client?.id;

    // 6. Búsqueda y filtros (con alcance)
    r = await req('/api/clients?search=luna', { headers: H58 });
    check('GET /api/clients?search=luna -> 1 resultado', r.json?.clients?.length === 1 && r.json.clients[0].name === 'Boutique Luna', JSON.stringify(r.json));
    r = await req('/api/clients?search=3322223333', { headers: HZ });
    check('GET /api/clients?search=teléfono -> 1 resultado', r.json?.clients?.length === 1 && r.json.clients[0].name === 'Ceremonias Sol', JSON.stringify(r.json));
    r = await req('/api/clients?search=zapopan', { headers: H58 });
    check('GET /api/clients?search=ciudad (zapopan) -> 1 resultado', r.json?.clients?.length === 1 && r.json.clients[0].name === 'Boutique Luna', JSON.stringify(r.json));
    r = await req('/api/clients?search=guadalajara', { headers: HZ });
    check('GET /api/clients?search=ciudad (guadalajara, Zapotlanejo) -> 1 resultado', r.json?.clients?.length === 1 && r.json.clients[0].name === 'Ceremonias Sol', JSON.stringify(r.json));
    r = await req('/api/clients?search=guadalajara', { headers: HADMIN });
    check('GET /api/clients?search=ciudad (guadalajara, admin) -> 2 resultados', r.json?.clients?.length === 2, JSON.stringify(r.json?.clients?.map((c) => c.name)));
    r = await req('/api/clients', { headers: HZ });
    check('GET /api/clients (Zapotlanejo) -> 1 resultado', r.json?.clients?.length === 1, JSON.stringify(r.json));
    r = await req('/api/clients', { headers: H58 });
    check('GET /api/clients (Medrano 58) no ve a Sol ni a Mar -> 1 resultado', r.json?.clients?.length === 1 && r.json.clients[0].name === 'Boutique Luna', JSON.stringify(r.json));
    r = await req('/api/clients', { headers: HADMIN });
    check('GET /api/clients (admin) -> 3 resultados', r.json?.clients?.length === 3, JSON.stringify(r.json?.clients?.map((c) => c.name)));
    r = await req('/api/clients?branch=Zapotlanejo', { headers: H58 });
    check('GET /api/clients?branch=Zapotlanejo con sucursal Medrano 58 -> se fuerza la propia (0 Sol)', r.json?.clients?.length === 1 && r.json.clients[0].name === 'Boutique Luna', JSON.stringify(r.json));
    r = await req('/api/clients?branch=Zapotlanejo', { headers: HADMIN });
    check('GET /api/clients?branch=Zapotlanejo (admin) -> 1 resultado', r.json?.clients?.length === 1 && r.json.clients[0].name === 'Ceremonias Sol', JSON.stringify(r.json));
    r = await req('/api/clients?branch=Otra', { headers: HADMIN });
    check('GET /api/clients?branch=Otra (admin) -> 1 resultado (Mar)', r.json?.clients?.length === 1 && r.json.clients[0].name === 'Boutique Mar', JSON.stringify(r.json));
    r = await req('/api/clients?carrier=Paquetexpress', { headers: H58 });
    check('GET /api/clients?carrier=Paquetexpress -> 1 resultado', r.json?.clients?.length === 1, JSON.stringify(r.json));
    r = await req('/api/clients?carrier=Otra', { headers: HADMIN });
    check('GET /api/clients?carrier=Otra (admin) -> 1 resultado (Mar)', r.json?.clients?.length === 1 && r.json.clients[0].name === 'Boutique Mar', JSON.stringify(r.json));
    r = await req('/api/clients?status=activo', { headers: HZ });
    check('GET /api/clients?status=activo -> 1 resultado', r.json?.clients?.length === 1, JSON.stringify(r.json));
    r = await req('/api/clients?status=otro', { headers: H58 });
    check('GET /api/clients?status=otro -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req('/api/clients', { headers: { 'x-admin-pin': '9999' } });
    check('GET /api/clients con PIN incorrecto -> 401', r.status === 401, JSON.stringify(r.json));

    // 7. Ficha de cliente: sin mensajes ni compras al inicio; alcance
    r = await req(`/api/clients/${lunaId}`, { headers: H58 });
    check('GET /api/clients/:id -> cliente con historial vacío', r.status === 200 && r.json?.client?.name === 'Boutique Luna' && r.json?.messages?.length === 0 && r.json?.purchases?.length === 0, JSON.stringify(r.json));
    r = await req(`/api/clients/${solId}`, { headers: H58 });
    check('GET ficha de otra sucursal sin ser admin -> 404', r.status === 404, JSON.stringify(r.json));
    r = await req(`/api/clients/${solId}`, { headers: HADMIN });
    check('GET ficha de otra sucursal como admin -> 200', r.status === 200 && r.json?.client?.name === 'Ceremonias Sol', JSON.stringify(r.json));
    r = await req('/api/clients/99999', { headers: H58 });
    check('GET /api/clients/99999 -> 404', r.status === 404, JSON.stringify(r.json));

    // 8. Registrar mensaje: actualiza el último mensaje del cliente
    r = await req(`/api/clients/${lunaId}/messages`, { method: 'POST', headers: H58, body: { date: '2026-11-24', text: 'Le mandé el catálogo nuevo por WhatsApp', channel: 'WhatsApp' } });
    check('POST mensaje -> 201', r.status === 201 && r.json?.message?.text?.includes('catálogo'), JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}`, { headers: H58 });
    check('Ficha tras mensaje -> último mensaje actualizado', r.json?.client?.last_message_text === 'Le mandé el catálogo nuevo por WhatsApp' && r.json?.client?.last_message_date === '2026-11-24', JSON.stringify(r.json?.client));
    r = await req(`/api/clients/${lunaId}/messages`, { method: 'POST', headers: H58, body: { text: '' } });
    check('POST mensaje vacío -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}/messages`, { method: 'POST', headers: H58, body: { text: 'Hola', channel: 'paloma' } });
    check('POST mensaje canal inválido -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req('/api/clients/99999/messages', { method: 'POST', headers: H58, body: { text: 'Hola' } });
    check('POST mensaje a cliente inexistente -> 404', r.status === 404, JSON.stringify(r.json));
    r = await req(`/api/clients/${solId}/messages`, { method: 'POST', headers: H58, body: { text: 'Hola' } });
    check('POST mensaje a cliente de otra sucursal -> 404', r.status === 404, JSON.stringify(r.json));

    // 9. Registrar compras: actualizan última compra y total acumulado
    r = await req(`/api/clients/${lunaId}/purchases`, { method: 'POST', headers: H58, body: { date: '2026-11-20', description: '10 ropones desmontables', amount: 8500 } });
    check('POST compra $8,500 -> 201', r.status === 201 && r.json?.purchase?.amount === 8500, JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}`, { headers: H58 });
    check('Ficha tras 1a compra -> última compra y total $8,500', r.json?.client?.total_purchased === 8500 && r.json?.client?.last_purchase_description === '10 ropones desmontables' && r.json?.client?.last_purchase_amount === 8500, JSON.stringify(r.json?.client));
    r = await req(`/api/clients/${lunaId}/purchases`, { method: 'POST', headers: H58, body: { date: '2026-11-25', description: '5 crinolinas', amount: 1200 } });
    check('POST compra $1,200 -> 201', r.status === 201, JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}`, { headers: H58 });
    check('Ficha tras 2a compra -> total $9,700 y última compra es la más reciente', r.json?.client?.total_purchased === 9700 && r.json?.client?.last_purchase_description === '5 crinolinas', JSON.stringify(r.json?.client));
    r = await req(`/api/clients/${lunaId}/purchases`, { method: 'POST', headers: H58, body: { description: 'Sin monto', amount: 0 } });
    check('POST compra $0 -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}/purchases`, { method: 'POST', headers: H58, body: { description: 'Sin monto' } });
    check('POST compra sin monto -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req('/api/clients/99999/purchases', { method: 'POST', headers: H58, body: { description: 'X', amount: 100 } });
    check('POST compra a cliente inexistente -> 404', r.status === 404, JSON.stringify(r.json));

    // 10. Editar cliente (PUT parcial): ciudad, paquetería Otra y alcance
    r = await req(`/api/clients/${lunaId}`, { method: 'PUT', headers: H58, body: { status: 'activo', next_followup_date: '2026-11-26', city: 'Tlaquepaque' } });
    check('PUT cliente -> 200, estado, seguimiento y ciudad actualizados', r.status === 200 && r.json?.client?.status === 'activo' && r.json?.client?.next_followup_date === '2026-11-26' && r.json?.client?.city === 'Tlaquepaque' && r.json?.client?.name === 'Boutique Luna', JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}`, { method: 'PUT', headers: H58, body: { branch: 'Mal' } });
    check('PUT sucursal inválida -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req(`/api/clients/${solId}`, { method: 'PUT', headers: H58, body: { status: 'activo' } });
    check('PUT cliente de otra sucursal -> 404', r.status === 404, JSON.stringify(r.json));
    r = await req('/api/clients/99999', { method: 'PUT', headers: H58, body: { status: 'activo' } });
    check('PUT cliente inexistente -> 404', r.status === 404, JSON.stringify(r.json));
    // Paquetería 'Otra': al salir se limpia el nombre libre; al entrar sin
    // nombre se rechaza; al entrar con nombre se guarda y se muestra.
    r = await req(`/api/clients/${marId}`, { method: 'PUT', headers: HADMIN, body: { carrier: 'Estafeta' } });
    check('PUT paquetería Otra -> Estafeta limpia carrier_other', r.status === 200 && r.json?.client?.carrier === 'Estafeta' && r.json?.client?.carrier_other === null && r.json?.client?.carrier_display === 'Estafeta', JSON.stringify(r.json));
    r = await req(`/api/clients/${marId}`, { method: 'PUT', headers: HADMIN, body: { carrier: 'Otra' } });
    check('PUT paquetería a Otra sin nombre -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req(`/api/clients/${marId}`, { method: 'PUT', headers: HADMIN, body: { carrier: 'Otra', carrier_other: 'Paquete Express' } });
    check('PUT paquetería a Otra con nombre -> 200 y carrier_display actualizado', r.status === 200 && r.json?.client?.carrier_display === 'Paquete Express', JSON.stringify(r.json));

    // 11. Seguimientos: vencido (Sol, 2026-11-20), hoy y próximos
    // Hoy en México es 2026-11-25; Luna quedó para 2026-11-26 (próximo).
    r = await req('/api/followups', { headers: HADMIN });
    let fups = r.json?.followups || [];
    let sol = fups.find((c) => c.id === solId);
    let luna = fups.find((c) => c.id === lunaId);
    check('GET /api/followups (admin) -> Sol vencido, Luna próximo', r.status === 200 && sol?.followup_status === 'vencido' && luna?.followup_status === 'próximo', JSON.stringify(fups));
    check('GET /api/followups -> vencidos primero', fups.length >= 2 && fups[0].id === solId, JSON.stringify(fups.map((c) => c.name)));
    r = await req('/api/followups', { headers: H58 });
    check('GET /api/followups (Medrano 58) -> solo Luna, sin Sol', r.status === 200 && (r.json?.followups || []).length === 1 && r.json.followups[0].id === lunaId, JSON.stringify(r.json?.followups));
    r = await req('/api/followups', { headers: HZ });
    check('GET /api/followups (Zapotlanejo) -> solo Sol', r.status === 200 && (r.json?.followups || []).length === 1 && r.json.followups[0].id === solId, JSON.stringify(r.json?.followups));
    // Cliente con seguimiento a más de 7 días no aparece.
    await req(`/api/clients/${lunaId}`, { method: 'PUT', headers: H58, body: { next_followup_date: '2026-12-20' } });
    r = await req('/api/followups', { headers: HADMIN });
    check('Seguimiento a 25 días -> ya no aparece en /api/followups', !(r.json?.followups || []).some((c) => c.id === lunaId), JSON.stringify(r.json?.followups));
    await req(`/api/clients/${lunaId}`, { method: 'PUT', headers: H58, body: { next_followup_date: null } });
    r = await req('/api/followups', { headers: HADMIN });
    check('Sin fecha de seguimiento -> no aparece en /api/followups', !(r.json?.followups || []).some((c) => c.id === lunaId), JSON.stringify(r.json?.followups));

    // 12. Borrar cliente: también borra su historial; con alcance
    r = await req(`/api/clients/${solId}`, { method: 'DELETE', headers: H58 });
    check('DELETE cliente de otra sucursal -> 404', r.status === 404, JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}`, { method: 'DELETE', headers: H58 });
    check('DELETE cliente -> 200', r.status === 200, JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}`, { headers: H58 });
    check('GET cliente borrado -> 404', r.status === 404, JSON.stringify(r.json));
    r = await req('/api/clients', { headers: HADMIN });
    check('Lista tras borrar (admin) -> quedan 2 clientes (Sol y Mar)', r.json?.clients?.length === 2, JSON.stringify(r.json?.clients?.map((c) => c.name)));
    r = await req('/api/clients', { headers: H58 });
    check('Lista tras borrar (Medrano 58) -> 0 clientes', r.json?.clients?.length === 0, JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}`, { method: 'DELETE', headers: H58 });
    check('DELETE cliente inexistente -> 404', r.status === 404, JSON.stringify(r.json));

    // 13. Migración desde esquema v1 (regresión del 500 al guardar).
    await testV1Migration();
  } finally {
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(`\nResultado: ${pass} pasaron, ${fail} fallaron.`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => { console.error('Error en smoke test:', err); process.exit(1); });
