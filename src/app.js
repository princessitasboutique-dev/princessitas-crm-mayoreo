// src/app.js — API Express del CRM Mayoreo de Princessitas Ceremonias.
// Un solo servicio: /api/* + frontend React (build servido desde server.js).
// Zona horaria de referencia: America/Mexico_City.
// Sin login en esta versión: la usan todos los colaboradores por el enlace.
// (Un PIN de acceso se puede agregar después; ver RUNBOOK.md.)
const express = require('express');

const TZ = 'America/Mexico_City';

const BRANCHES = ['Medrano 58', 'Medrano 60', 'Zapotlanejo', 'Otra'];
const CARRIERS = ['Paquetexpress', 'Coordinadora', 'Estafeta', 'FedEx', 'Skydropx', 'Otra'];
const STATUSES = ['nuevo', 'activo', 'inactivo'];
const CHANNELS = ['WhatsApp', 'llamada', 'otro'];

// Normaliza un valor DATE de pg (Date o 'YYYY-MM-DD...') a 'YYYY-MM-DD'.
function toISODate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function toISODateTime(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function isValidDateStr(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// pg devuelve NUMERIC como string: normaliza a número con 2 decimales.
function money(v) {
  const n = parseFloat(v);
  return Number.isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

// Fecha actual en México (YYYY-MM-DD).
function mexicoToday() {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function addDaysISO(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Teléfono a enlace de WhatsApp: 10 dígitos -> México (+52).
// Si ya trae 52 al inicio (12 dígitos), se usa tal cual.
function waLink(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `https://wa.me/52${digits}`;
  if (digits.length === 12 && digits.startsWith('52')) return `https://wa.me/${digits}`;
  return `https://wa.me/${digits}`;
}

function createApp(pool) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // ---- Normalizadores de filas ----
  const normClient = (r) => ({
    ...r,
    total_purchased: money(r.total_purchased),
    last_purchase_amount: r.last_purchase_amount == null ? null : money(r.last_purchase_amount),
    last_purchase_date: toISODate(r.last_purchase_date),
    last_message_date: toISODate(r.last_message_date),
    next_followup_date: toISODate(r.next_followup_date),
    created_at: toISODateTime(r.created_at),
    updated_at: toISODateTime(r.updated_at),
    whatsapp_url: waLink(r.phone),
  });
  const normMessage = (r) => ({ ...r, date: toISODate(r.date), created_at: toISODateTime(r.created_at) });
  const normPurchase = (r) => ({
    ...r, date: toISODate(r.date), amount: money(r.amount), created_at: toISODateTime(r.created_at),
  });

  async function getClient(id) {
    const r = await pool.query('SELECT * FROM crm_clients WHERE id = $1', [id]);
    return r.rows[0] ? normClient(r.rows[0]) : null;
  }

  function parseClientId(req, res) {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      res.status(400).json({ ok: false, error: 'ID de cliente inválido.' });
      return null;
    }
    return id;
  }

  // ================= Salud =================
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // ================= Clientes =================
  // GET /api/clients?search=&branch=&carrier=&status=
  // search: por nombre o teléfono. Filtros exactos por sucursal, paquetería y estado.
  app.get('/api/clients', async (req, res, next) => {
    try {
      const conditions = [];
      const vals = [];
      let i = 1;
      const search = String(req.query.search || '').trim();
      if (search) {
        conditions.push(`(LOWER(name) LIKE LOWER($${i}) OR LOWER(phone) LIKE LOWER($${i + 1}))`);
        vals.push(`%${search}%`, `%${search}%`);
        i += 2;
      }
      if (req.query.branch) {
        if (!BRANCHES.includes(req.query.branch)) {
          return res.status(400).json({ ok: false, error: 'Sucursal no válida.' });
        }
        conditions.push(`branch = $${i}`);
        vals.push(req.query.branch);
        i += 1;
      }
      if (req.query.carrier) {
        if (!CARRIERS.includes(req.query.carrier)) {
          return res.status(400).json({ ok: false, error: 'Paquetería no válida.' });
        }
        conditions.push(`carrier = $${i}`);
        vals.push(req.query.carrier);
        i += 1;
      }
      if (req.query.status) {
        if (!STATUSES.includes(req.query.status)) {
          return res.status(400).json({ ok: false, error: 'Estado no válido.' });
        }
        conditions.push(`status = $${i}`);
        vals.push(req.query.status);
        i += 1;
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const r = await pool.query(
        `SELECT * FROM crm_clients ${where} ORDER BY name ASC`,
        vals
      );
      return res.json({ ok: true, clients: r.rows.map(normClient) });
    } catch (err) { next(err); }
  });

  // POST /api/clients
  app.post('/api/clients', async (req, res, next) => {
    try {
      const b = req.body || {};
      const name = String(b.name || '').trim();
      const phone = String(b.phone || '').trim();
      if (!name) return res.status(400).json({ ok: false, error: 'Falta el nombre del cliente.' });
      if (!phone) return res.status(400).json({ ok: false, error: 'Falta el teléfono del cliente.' });
      const branch = b.branch || 'Otra';
      const carrier = b.carrier || 'Otra';
      const status = b.status || 'nuevo';
      if (!BRANCHES.includes(branch)) return res.status(400).json({ ok: false, error: 'Sucursal no válida.' });
      if (!CARRIERS.includes(carrier)) return res.status(400).json({ ok: false, error: 'Paquetería no válida.' });
      if (!STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'Estado no válido.' });
      let nextFollowup = null;
      if (b.next_followup_date) {
        if (!isValidDateStr(b.next_followup_date)) {
          return res.status(400).json({ ok: false, error: 'Próxima fecha de seguimiento inválida (usa YYYY-MM-DD).' });
        }
        nextFollowup = b.next_followup_date;
      }
      const r = await pool.query(
        `INSERT INTO crm_clients (name, phone, branch, carrier, status, next_followup_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [name, phone, branch, carrier, status, nextFollowup, b.notes || null]
      );
      return res.status(201).json({ ok: true, client: normClient(r.rows[0]) });
    } catch (err) { next(err); }
  });

  // GET /api/clients/:id (con mensajes y compras)
  app.get('/api/clients/:id', async (req, res, next) => {
    try {
      const id = parseClientId(req, res);
      if (!id) return;
      const client = await getClient(id);
      if (!client) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
      const messages = await pool.query(
        'SELECT * FROM crm_messages WHERE client_id = $1 ORDER BY date DESC, id DESC', [id]
      );
      const purchases = await pool.query(
        'SELECT * FROM crm_purchases WHERE client_id = $1 ORDER BY date DESC, id DESC', [id]
      );
      return res.json({
        ok: true,
        client,
        messages: messages.rows.map(normMessage),
        purchases: purchases.rows.map(normPurchase),
      });
    } catch (err) { next(err); }
  });

  // PUT /api/clients/:id (actualización parcial)
  const CLIENT_FIELDS = ['name', 'phone', 'branch', 'carrier', 'status', 'next_followup_date', 'notes'];
  app.put('/api/clients/:id', async (req, res, next) => {
    try {
      const id = parseClientId(req, res);
      if (!id) return;
      const existing = await getClient(id);
      if (!existing) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
      const b = req.body || {};
      const sets = [];
      const vals = [];
      let i = 1;
      for (const f of CLIENT_FIELDS) {
        if (b[f] === undefined) continue;
        let v = b[f];
        if (f === 'name' || f === 'phone') {
          v = String(v || '').trim();
          if (!v) return res.status(400).json({ ok: false, error: `El campo ${f} no puede quedar vacío.` });
        }
        if (f === 'branch' && !BRANCHES.includes(v)) {
          return res.status(400).json({ ok: false, error: 'Sucursal no válida.' });
        }
        if (f === 'carrier' && !CARRIERS.includes(v)) {
          return res.status(400).json({ ok: false, error: 'Paquetería no válida.' });
        }
        if (f === 'status' && !STATUSES.includes(v)) {
          return res.status(400).json({ ok: false, error: 'Estado no válido.' });
        }
        if (f === 'next_followup_date') {
          if (v === '' || v === null) v = null;
          else if (!isValidDateStr(v)) {
            return res.status(400).json({ ok: false, error: 'Próxima fecha de seguimiento inválida (usa YYYY-MM-DD).' });
          }
        }
        if (f === 'notes' && v === '') v = null;
        sets.push(`${f} = $${i}`);
        vals.push(v);
        i += 1;
      }
      if (!sets.length) return res.json({ ok: true, client: existing });
      sets.push('updated_at = now()');
      vals.push(id);
      const r = await pool.query(
        `UPDATE crm_clients SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        vals
      );
      return res.json({ ok: true, client: normClient(r.rows[0]) });
    } catch (err) { next(err); }
  });

  // DELETE /api/clients/:id (borra también sus mensajes y compras)
  app.delete('/api/clients/:id', async (req, res, next) => {
    try {
      const id = parseClientId(req, res);
      if (!id) return;
      const existing = await getClient(id);
      if (!existing) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
      await pool.query('DELETE FROM crm_clients WHERE id = $1', [id]);
      return res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // POST /api/clients/:id/messages — registra un mensaje y actualiza el
  // último mensaje del cliente.
  app.post('/api/clients/:id/messages', async (req, res, next) => {
    try {
      const id = parseClientId(req, res);
      if (!id) return;
      const client = await getClient(id);
      if (!client) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
      const b = req.body || {};
      const text = String(b.text || '').trim();
      if (!text) return res.status(400).json({ ok: false, error: 'Falta el texto del mensaje.' });
      const channel = b.channel || 'WhatsApp';
      if (!CHANNELS.includes(channel)) return res.status(400).json({ ok: false, error: 'Canal no válido.' });
      const date = b.date ? toISODate(b.date) : mexicoToday();
      if (!isValidDateStr(date)) return res.status(400).json({ ok: false, error: 'Fecha del mensaje inválida (usa YYYY-MM-DD).' });
      const r = await pool.query(
        'INSERT INTO crm_messages (client_id, date, text, channel) VALUES ($1,$2,$3,$4) RETURNING *',
        [id, date, text, channel]
      );
      await pool.query(
        `UPDATE crm_clients SET last_message_text = $1, last_message_date = $2, updated_at = now()
         WHERE id = $3`,
        [text, date, id]
      );
      return res.status(201).json({ ok: true, message: normMessage(r.rows[0]) });
    } catch (err) { next(err); }
  });

  // POST /api/clients/:id/purchases — registra una compra y actualiza la
  // última compra del cliente y su total comprado acumulado.
  app.post('/api/clients/:id/purchases', async (req, res, next) => {
    try {
      const id = parseClientId(req, res);
      if (!id) return;
      const client = await getClient(id);
      if (!client) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
      const b = req.body || {};
      const description = String(b.description || '').trim();
      if (!description) return res.status(400).json({ ok: false, error: 'Falta la descripción de la compra.' });
      const amount = money(b.amount);
      if (!amount || amount <= 0) {
        return res.status(400).json({ ok: false, error: 'El monto de la compra debe ser mayor a 0.' });
      }
      const date = b.date ? toISODate(b.date) : mexicoToday();
      if (!isValidDateStr(date)) return res.status(400).json({ ok: false, error: 'Fecha de la compra inválida (usa YYYY-MM-DD).' });
      const r = await pool.query(
        'INSERT INTO crm_purchases (client_id, date, description, amount) VALUES ($1,$2,$3,$4) RETURNING *',
        [id, date, description, amount]
      );
      // La última compra es la de fecha más reciente (desempate: la última registrada).
      const last = await pool.query(
        `SELECT * FROM crm_purchases WHERE client_id = $1
         ORDER BY date DESC, id DESC LIMIT 1`,
        [id]
      );
      const total = await pool.query(
        'SELECT COALESCE(SUM(amount),0) AS total FROM crm_purchases WHERE client_id = $1',
        [id]
      );
      await pool.query(
        `UPDATE crm_clients
         SET last_purchase_date = $1, last_purchase_description = $2,
             last_purchase_amount = $3, total_purchased = $4, updated_at = now()
         WHERE id = $5`,
        [toISODate(last.rows[0].date), last.rows[0].description, money(last.rows[0].amount), money(total.rows[0].total), id]
      );
      return res.status(201).json({ ok: true, purchase: normPurchase(r.rows[0]) });
    } catch (err) { next(err); }
  });

  // GET /api/followups — clientes con próxima fecha de seguimiento vencida
  // o de hoy, y los próximos 7 días. Orden: vencidos primero, luego hoy,
  // luego próximos. Cada cliente lleva followup_status.
  // Nota: el filtro por fecha se hace en JS (no en SQL) porque pg-mem no
  // resuelve la comparación fecha-parámetro; así el comportamiento es
  // idéntico en las pruebas y en Postgres real. Las fechas son 'YYYY-MM-DD',
  // así que la comparación de cadenas equivale a la cronológica.
  app.get('/api/followups', async (req, res, next) => {
    try {
      const today = mexicoToday();
      const limit = addDaysISO(today, 7);
      const r = await pool.query(
        `SELECT * FROM crm_clients
         WHERE next_followup_date IS NOT NULL
         ORDER BY next_followup_date ASC, name ASC`
      );
      const followups = r.rows
        .map((row) => {
          const c = normClient(row);
          const d = c.next_followup_date;
          const status = d < today ? 'vencido' : (d === today ? 'hoy' : 'próximo');
          return { ...c, followup_status: status };
        })
        .filter((c) => c.next_followup_date <= limit);
      return res.json({ ok: true, date: today, followups });
    } catch (err) { next(err); }
  });

  // ---- Manejo de errores ----
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('API error:', err.message);
    res.status(500).json({ ok: false, error: 'Error interno del servidor.' });
  });

  return app;
}

module.exports = { createApp, mexicoToday, waLink, BRANCHES, CARRIERS, STATUSES, CHANNELS };
