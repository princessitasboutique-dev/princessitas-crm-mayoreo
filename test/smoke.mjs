// test/smoke.mjs — prueba de humo sin base real.
// Levanta la app Express con pg-mem (PostgreSQL en memoria), aplica el
// esquema y prueba los endpoints principales. No toca ningún dato real.
// Uso: npm test
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { newDb } = require('pg-mem');
const { createApp } = require('../src/app.js');
const { ensureSchema, seed } = require('../db/seed.js');

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name} ${extra}`); }
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
    // 1. Salud
    let r = await req('/api/health');
    check('GET /api/health -> {ok:true}', r.status === 200 && r.json?.ok === true, JSON.stringify(r.json));

    // 2. Lista vacía al inicio (sin clientes de ejemplo)
    r = await req('/api/clients');
    check('GET /api/clients -> lista vacía', r.status === 200 && Array.isArray(r.json?.clients) && r.json.clients.length === 0, JSON.stringify(r.json));

    // 3. Validaciones al crear cliente
    r = await req('/api/clients', { method: 'POST', body: { phone: '3311112222' } });
    check('POST /api/clients sin nombre -> 400', r.status === 400 && /nombre/.test(r.json?.error || ''), JSON.stringify(r.json));
    r = await req('/api/clients', { method: 'POST', body: { name: 'Boutique Luna' } });
    check('POST /api/clients sin teléfono -> 400', r.status === 400 && /teléfono/.test(r.json?.error || ''), JSON.stringify(r.json));
    r = await req('/api/clients', { method: 'POST', body: { name: 'Boutique Luna', phone: '3311112222', branch: 'Medrano 99' } });
    check('POST /api/clients sucursal inválida -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req('/api/clients', { method: 'POST', body: { name: 'Boutique Luna', phone: '3311112222', carrier: 'DHL' } });
    check('POST /api/clients paquetería inválida -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req('/api/clients', { method: 'POST', body: { name: 'Boutique Luna', phone: '3311112222', next_followup_date: '2026-13-40' } });
    check('POST /api/clients fecha de seguimiento inválida -> 400', r.status === 400, JSON.stringify(r.json));

    // 4. Crear cliente: valores por defecto
    r = await req('/api/clients', { method: 'POST', body: { name: 'Boutique Luna', phone: '3311112222', branch: 'Medrano 58', carrier: 'Paquetexpress', notes: 'Compra ropones' } });
    check('POST /api/clients -> 201, estado nuevo, total 0, wa.me con 52', r.status === 201 && r.json?.client?.status === 'nuevo' && r.json?.client?.total_purchased === 0 && r.json?.client?.whatsapp_url === 'https://wa.me/523311112222', JSON.stringify(r.json));
    const lunaId = r.json?.client?.id;

    // 5. Crear segundo cliente (para filtros y seguimientos)
    r = await req('/api/clients', { method: 'POST', body: { name: 'Ceremonias Sol', phone: '3322223333', branch: 'Zapotlanejo', carrier: 'Estafeta', status: 'activo', next_followup_date: '2026-11-20' } });
    check('POST segundo cliente -> 201', r.status === 201 && r.json?.client?.status === 'activo', JSON.stringify(r.json));
    const solId = r.json?.client?.id;

    // 6. Búsqueda y filtros
    r = await req('/api/clients?search=luna');
    check('GET /api/clients?search=luna -> 1 resultado', r.json?.clients?.length === 1 && r.json.clients[0].name === 'Boutique Luna', JSON.stringify(r.json));
    r = await req('/api/clients?search=3322223333');
    check('GET /api/clients?search=teléfono -> 1 resultado', r.json?.clients?.length === 1 && r.json.clients[0].name === 'Ceremonias Sol', JSON.stringify(r.json));
    r = await req('/api/clients?branch=Zapotlanejo');
    check('GET /api/clients?branch=Zapotlanejo -> 1 resultado', r.json?.clients?.length === 1, JSON.stringify(r.json));
    r = await req('/api/clients?carrier=Paquetexpress');
    check('GET /api/clients?carrier=Paquetexpress -> 1 resultado', r.json?.clients?.length === 1, JSON.stringify(r.json));
    r = await req('/api/clients?status=activo');
    check('GET /api/clients?status=activo -> 1 resultado', r.json?.clients?.length === 1, JSON.stringify(r.json));
    r = await req('/api/clients?branch=Medrano 60');
    check('GET /api/clients?branch=Medrano 60 -> 0 resultados', r.json?.clients?.length === 0, JSON.stringify(r.json));
    r = await req('/api/clients?status=otro');
    check('GET /api/clients?status=otro -> 400', r.status === 400, JSON.stringify(r.json));

    // 7. Ficha de cliente: sin mensajes ni compras al inicio
    r = await req(`/api/clients/${lunaId}`);
    check('GET /api/clients/:id -> cliente con historial vacío', r.status === 200 && r.json?.client?.name === 'Boutique Luna' && r.json?.messages?.length === 0 && r.json?.purchases?.length === 0, JSON.stringify(r.json));
    r = await req('/api/clients/99999');
    check('GET /api/clients/99999 -> 404', r.status === 404, JSON.stringify(r.json));

    // 8. Registrar mensaje: actualiza el último mensaje del cliente
    r = await req(`/api/clients/${lunaId}/messages`, { method: 'POST', body: { date: '2026-11-24', text: 'Le mandé el catálogo nuevo por WhatsApp', channel: 'WhatsApp' } });
    check('POST mensaje -> 201', r.status === 201 && r.json?.message?.text?.includes('catálogo'), JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}`);
    check('Ficha tras mensaje -> último mensaje actualizado', r.json?.client?.last_message_text === 'Le mandé el catálogo nuevo por WhatsApp' && r.json?.client?.last_message_date === '2026-11-24', JSON.stringify(r.json?.client));
    r = await req(`/api/clients/${lunaId}/messages`, { method: 'POST', body: { text: '' } });
    check('POST mensaje vacío -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}/messages`, { method: 'POST', body: { text: 'Hola', channel: 'paloma' } });
    check('POST mensaje canal inválido -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req('/api/clients/99999/messages', { method: 'POST', body: { text: 'Hola' } });
    check('POST mensaje a cliente inexistente -> 404', r.status === 404, JSON.stringify(r.json));

    // 9. Registrar compras: actualizan última compra y total acumulado
    r = await req(`/api/clients/${lunaId}/purchases`, { method: 'POST', body: { date: '2026-11-20', description: '10 ropones desmontables', amount: 8500 } });
    check('POST compra $8,500 -> 201', r.status === 201 && r.json?.purchase?.amount === 8500, JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}`);
    check('Ficha tras 1a compra -> última compra y total $8,500', r.json?.client?.total_purchased === 8500 && r.json?.client?.last_purchase_description === '10 ropones desmontables' && r.json?.client?.last_purchase_amount === 8500, JSON.stringify(r.json?.client));
    r = await req(`/api/clients/${lunaId}/purchases`, { method: 'POST', body: { date: '2026-11-25', description: '5 crinolinas', amount: 1200 } });
    check('POST compra $1,200 -> 201', r.status === 201, JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}`);
    check('Ficha tras 2a compra -> total $9,700 y última compra es la más reciente', r.json?.client?.total_purchased === 9700 && r.json?.client?.last_purchase_description === '5 crinolinas', JSON.stringify(r.json?.client));
    r = await req(`/api/clients/${lunaId}/purchases`, { method: 'POST', body: { description: 'Sin monto', amount: 0 } });
    check('POST compra $0 -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}/purchases`, { method: 'POST', body: { description: 'Sin monto' } });
    check('POST compra sin monto -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req('/api/clients/99999/purchases', { method: 'POST', body: { description: 'X', amount: 100 } });
    check('POST compra a cliente inexistente -> 404', r.status === 404, JSON.stringify(r.json));

    // 10. Editar cliente (PUT parcial)
    r = await req(`/api/clients/${lunaId}`, { method: 'PUT', body: { status: 'activo', next_followup_date: '2026-11-26' } });
    check('PUT cliente -> 200, estado y seguimiento actualizados', r.status === 200 && r.json?.client?.status === 'activo' && r.json?.client?.next_followup_date === '2026-11-26' && r.json?.client?.name === 'Boutique Luna', JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}`, { method: 'PUT', body: { branch: 'Mal' } });
    check('PUT sucursal inválida -> 400', r.status === 400, JSON.stringify(r.json));
    r = await req('/api/clients/99999', { method: 'PUT', body: { status: 'activo' } });
    check('PUT cliente inexistente -> 404', r.status === 404, JSON.stringify(r.json));

    // 11. Seguimientos: vencido (Sol, 2026-11-20), hoy y próximos
    // Hoy en México es 2026-11-25; Luna quedó para 2026-11-26 (próximo).
    r = await req('/api/followups');
    const fups = r.json?.followups || [];
    const sol = fups.find((c) => c.id === solId);
    const luna = fups.find((c) => c.id === lunaId);
    check('GET /api/followups -> Sol vencido, Luna próximo', r.status === 200 && sol?.followup_status === 'vencido' && luna?.followup_status === 'próximo', JSON.stringify(fups));
    check('GET /api/followups -> vencidos primero', fups.length >= 2 && fups[0].id === solId, JSON.stringify(fups.map((c) => c.name)));
    // Cliente con seguimiento a más de 7 días no aparece.
    await req(`/api/clients/${lunaId}`, { method: 'PUT', body: { next_followup_date: '2026-12-20' } });
    r = await req('/api/followups');
    check('Seguimiento a 25 días -> ya no aparece en /api/followups', !(r.json?.followups || []).some((c) => c.id === lunaId), JSON.stringify(r.json?.followups));
    await req(`/api/clients/${lunaId}`, { method: 'PUT', body: { next_followup_date: null } });
    r = await req('/api/followups');
    check('Sin fecha de seguimiento -> no aparece en /api/followups', !(r.json?.followups || []).some((c) => c.id === lunaId), JSON.stringify(r.json?.followups));

    // 12. Borrar cliente: también borra su historial
    r = await req(`/api/clients/${lunaId}`, { method: 'DELETE' });
    check('DELETE cliente -> 200', r.status === 200, JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}`);
    check('GET cliente borrado -> 404', r.status === 404, JSON.stringify(r.json));
    r = await req('/api/clients');
    check('Lista tras borrar -> queda 1 cliente', r.json?.clients?.length === 1, JSON.stringify(r.json));
    r = await req(`/api/clients/${lunaId}`, { method: 'DELETE' });
    check('DELETE cliente inexistente -> 404', r.status === 404, JSON.stringify(r.json));
  } finally {
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(`\nResultado: ${pass} pasaron, ${fail} fallaron.`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => { console.error('Error en smoke test:', err); process.exit(1); });
