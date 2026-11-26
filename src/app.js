// src/app.js — API Express del CRM Mayoreo de Princessitas Ceremonias.
// Un solo servicio: /api/* + frontend React (build servido desde server.js).
// Zona horaria de referencia: America/Mexico_City.
// Segmentación por sucursal a nivel de dispositivo: cada colaboradora elige
// su sucursal al abrir la app (se guarda en el dispositivo) y solo ve los
// clientes de esa sucursal; el modo administrador ("Ver todas") se desbloquea
// con el MISMO PIN de la app de asistencia (tabla settings, clave
// admin_pin_hash, hash bcrypt, en la misma base Neon compartida; el PIN se
// crea y se cambia en la app de asistencia, no aquí). Esto NO son cuentas de
// usuario con contraseña: quien conozca el PIN o cambie la sucursal en su
// dispositivo puede ver otra sucursal. Los clientes con sucursal 'Otra' solo
// se ven en modo administrador.
const express = require('express');
const bcrypt = require('bcrypt');

const TZ = 'America/Mexico_City';

const BRANCHES = ['Medrano 58', 'Medrano 60', 'Zapotlanejo', 'Otra'];
// Sucursales con vista propia (una colaboradora elige una de estas).
const REAL_BRANCHES = ['Medrano 58', 'Medrano 60', 'Zapotlanejo'];
const CARRIERS = ['Paquetexpress', 'Coordinadora', 'Estafeta', 'FedEx', 'Skydropx', 'Otra'];
const STATUSES = ['nuevo', 'activo', 'inactivo'];
const CHANNELS = ['WhatsApp', 'llamada', 'otro'];

// Niveles de cliente (aprobados por Ulises 2026-11-25). Se calculan solos
// a partir del historial de compras de los últimos 365 días:
// M12 = monto comprado en los últimos 365 días; P12 = número de compras
// en los últimos 365 días; primera compra = fecha de su primera compra.
// Orden de evaluación (el primero que coincida gana): Top, Constante,
// Esporádico, Nuevo, Ocasional.
const LEVELS = ['top', 'constante', 'esporadico', 'ocasional', 'nuevo'];
const LEVEL_LABELS = { top: 'Top', constante: 'Constante', esporadico: 'Esporádico', ocasional: 'Ocasional', nuevo: 'Nuevo' };
const LEVEL_TOP_MIN_M12 = 100000;      // Top: $100,000+ en los últimos 365 días
const LEVEL_CONSTANTE_MIN_P12 = 6;      // Constante: 6+ compras en los últimos 365 días
const LEVEL_NUEVO_MAX_DAYS = 90;        // Nuevo: primera compra hace 90 días o menos

function computeLevel({ m12, p12, firstPurchase }) {
  if (m12 >= LEVEL_TOP_MIN_M12) return 'top';
  if (p12 >= LEVEL_CONSTANTE_MIN_P12) return 'constante';
  if (p12 >= 2 && p12 <= 3) return 'esporadico';
  if (!firstPurchase) return 'nuevo';
  const first = new Date(`${firstPurchase}T12:00:00Z`);
  const today = new Date(`${mexicoToday()}T12:00:00Z`);
  const days = Math.floor((today - first) / 86400000);
  if (days <= LEVEL_NUEVO_MAX_DAYS) return 'nuevo';
  return 'ocasional';
}

// Nivel efectivo de un cliente: si tiene nivel fijado a mano
// (level_override), ese manda; si no, el calculado de su historial.
function effectiveLevel(r) {
  if (r.level_override && LEVELS.includes(r.level_override)) return r.level_override;
  return computeLevel({
    m12: money(r.m12),
    p12: parseInt(r.p12, 10) || 0,
    firstPurchase: toISODate(r.first_purchase),
  });
}

// Agregados de compras por cliente en una sola consulta (LEFT JOIN con
// subconsulta sobre crm_purchases): M12, P12 y primera compra. `param` es
// el placeholder ($N) de la fecha de inicio de la ventana (YYYY-MM-DD).
// Se usa CASE (no FILTER) porque pg-mem ignora el FILTER de los agregados;
// el parámetro de fecha sí se resuelve dentro del CASE.
function levelAggJoin(param) {
  return `LEFT JOIN (
    SELECT client_id,
      COALESCE(SUM(CASE WHEN date >= ${param} THEN amount ELSE 0 END), 0) AS m12,
      COALESCE(SUM(CASE WHEN date >= ${param} THEN 1 ELSE 0 END), 0) AS p12,
      MIN(date) AS first_purchase
    FROM crm_purchases GROUP BY client_id
  ) agg ON agg.client_id = c.id`;
}
const CLIENT_LEVEL_COLUMNS = 'c.*, COALESCE(agg.m12, 0) AS m12, COALESCE(agg.p12, 0) AS p12, agg.first_purchase';

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
  // La fila trae los agregados de nivel (m12, p12, first_purchase) que se
  // calculan con el LEFT JOIN; no se devuelven tal cual: solo se usan para
  // calcular `level` (efectivo) y se quitan de la respuesta. Si una fila
  // no trae los agregados (no debería pasar: todas las lecturas usan el
  // JOIN), el nivel cae en 'nuevo' por defecto.
  const normClient = (r) => {
    const level = effectiveLevel(r);
    const { m12, p12, first_purchase, ...rest } = r;
    return {
      ...rest,
      level,
      level_override: r.level_override || null,
      // Paquetería a mostrar: si es 'Otra', el nombre libre que se escribió.
      carrier_display: r.carrier === 'Otra' && r.carrier_other ? r.carrier_other : r.carrier,
      total_purchased: money(r.total_purchased),
      last_purchase_amount: r.last_purchase_amount == null ? null : money(r.last_purchase_amount),
      last_purchase_date: toISODate(r.last_purchase_date),
      last_message_date: toISODate(r.last_message_date),
      next_followup_date: toISODate(r.next_followup_date),
      created_at: toISODateTime(r.created_at),
      updated_at: toISODateTime(r.updated_at),
      whatsapp_url: waLink(r.phone),
    };
  };
  const normMessage = (r) => ({ ...r, date: toISODate(r.date), created_at: toISODateTime(r.created_at) });
  const normPurchase = (r) => ({
    ...r, date: toISODate(r.date), amount: money(r.amount), created_at: toISODateTime(r.created_at),
  });

  async function getClient(id) {
    const windowStart = addDaysISO(mexicoToday(), -365);
    const r = await pool.query(
      `SELECT ${CLIENT_LEVEL_COLUMNS} FROM crm_clients c
       ${levelAggJoin('$2')}
       WHERE c.id = $1`,
      [id, windowStart]
    );
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

  // ---- PIN de administración (reutilizado de la app de asistencia) ----
  // La tabla settings vive en la misma base Neon compartida; la app de
  // asistencia guarda ahí 'admin_pin_hash' (bcrypt). Si la tabla no existe
  // (base nueva sin asistencia), no hay PIN configurado.
  async function getPinHash() {
    try {
      const r = await pool.query("SELECT value FROM settings WHERE key = 'admin_pin_hash'");
      return r.rows[0] ? r.rows[0].value : null;
    } catch (err) {
      if (/does not exist|no existe/i.test(err.message)) return null;
      throw err;
    }
  }

  // Resuelve el alcance de la petición:
  // - Encabezado x-admin-pin con el PIN correcto -> { admin: true } (ve todo).
  // - Encabezado x-branch con una sucursal real -> { branch } (ve solo esa).
  // - Sin ninguno de los dos -> null (la ruta responde 400).
  // El PIN incorrecto responde 401 directamente.
  async function resolveScope(req, res) {
    const pin = req.headers['x-admin-pin'];
    if (pin) {
      const hash = await getPinHash();
      if (!hash) {
        res.status(401).json({ ok: false, error: 'PIN de administración no configurado todavía. Se crea en la app de asistencia.' });
        return undefined;
      }
      const ok = await bcrypt.compare(String(pin), hash);
      if (!ok) {
        res.status(401).json({ ok: false, error: 'PIN incorrecto.' });
        return undefined;
      }
      return { admin: true };
    }
    const branch = req.headers['x-branch'];
    if (branch && REAL_BRANCHES.includes(branch)) return { branch };
    return null;
  }

  // ¿Puede este alcance ver/editar un cliente de esta sucursal?
  // 'Otra' solo la ve el administrador.
  function scopeAllows(scope, clientBranch) {
    if (!scope) return false;
    if (scope.admin) return true;
    return clientBranch === scope.branch;
  }

  // ================= Salud =================
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // ================= PIN de administración =================
  // POST /api/admin/verify-pin { pin } -> { ok, pinSet, verified }.
  // Mismo comportamiento que la app de asistencia: siempre HTTP 200 con
  // ok:true; pinSet indica si ya existe un PIN y verified si el enviado
  // coincide. Sin PIN (o con pin vacío) no verifica nada.
  app.post('/api/admin/verify-pin', async (req, res, next) => {
    try {
      const pin = String((req.body && req.body.pin) || '');
      const hash = await getPinHash();
      if (!hash) return res.json({ ok: true, pinSet: false, verified: false });
      if (!pin) return res.json({ ok: true, pinSet: true, verified: false });
      const verified = await bcrypt.compare(pin, hash);
      return res.json({ ok: true, pinSet: true, verified });
    } catch (err) { next(err); }
  });

  // ================= Clientes =================
  // GET /api/clients?search=&branch=&carrier=&status=&level=
  // search: por nombre, teléfono o ciudad. Filtros exactos por sucursal,
  // paquetería y estado. Alcance obligatorio (encabezado x-branch con la
  // sucursal, o x-admin-pin para el administrador): sin alcance -> 400.
  // Sin ser administrador, la lista siempre es la de la sucursal propia
  // (el parámetro branch se ignora); el administrador puede filtrar por
  // cualquier sucursal, incluida 'Otra'.
  // level: filtra por nivel efectivo (top/constante/esporadico/ocasional/
  // nuevo). El nivel se calcula de los agregados, así que el filtro se
  // aplica en JS sobre la lista ya filtrada (igual que el filtro por fecha
  // de /api/followups).
  app.get('/api/clients', async (req, res, next) => {
    try {
      const scope = await resolveScope(req, res);
      if (scope === undefined) return; // 401 ya respondido
      if (!scope) {
        return res.status(400).json({ ok: false, error: 'Falta la sucursal. Elige tu sucursal para ver sus clientes.' });
      }
      if (req.query.level && !LEVELS.includes(req.query.level)) {
        return res.status(400).json({ ok: false, error: 'Nivel no válido.' });
      }
      const conditions = [];
      const vals = [];
      let i = 1;
      const search = String(req.query.search || '').trim();
      if (search) {
        conditions.push(`(LOWER(name) LIKE LOWER($${i}) OR LOWER(phone) LIKE LOWER($${i + 1}) OR LOWER(city) LIKE LOWER($${i + 2}))`);
        vals.push(`%${search}%`, `%${search}%`, `%${search}%`);
        i += 3;
      }
      let branchFilter = null;
      if (scope.admin) {
        if (req.query.branch) {
          if (!BRANCHES.includes(req.query.branch)) {
            return res.status(400).json({ ok: false, error: 'Sucursal no válida.' });
          }
          branchFilter = req.query.branch;
        }
      } else {
        branchFilter = scope.branch;
      }
      if (branchFilter) {
        conditions.push(`branch = $${i}`);
        vals.push(branchFilter);
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
      const windowStart = addDaysISO(mexicoToday(), -365);
      vals.push(windowStart);
      const r = await pool.query(
        `SELECT ${CLIENT_LEVEL_COLUMNS} FROM crm_clients c ${levelAggJoin(`$${vals.length}`)} ${where} ORDER BY c.name ASC`,
        vals
      );
      let clients = r.rows.map(normClient);
      if (req.query.level) clients = clients.filter((c) => c.level === req.query.level);
      return res.json({ ok: true, clients });
    } catch (err) { next(err); }
  });

  // POST /api/clients
  app.post('/api/clients', async (req, res, next) => {
    try {
      const b = req.body || {};
      const name = String(b.name || '').trim();
      // El teléfono es opcional (hay clientes del reporte de ventas solo
      // con nombre): ausente o vacío -> NULL, sin botón de WhatsApp.
      const phone = String(b.phone || '').trim() || null;
      if (!name) return res.status(400).json({ ok: false, error: 'Falta el nombre del cliente.' });
      const branch = b.branch || 'Otra';
      const carrier = b.carrier || 'Otra';
      const status = b.status || 'nuevo';
      if (!BRANCHES.includes(branch)) return res.status(400).json({ ok: false, error: 'Sucursal no válida.' });
      if (!CARRIERS.includes(carrier)) return res.status(400).json({ ok: false, error: 'Paquetería no válida.' });
      if (!STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'Estado no válido.' });
      // Paquetería 'Otra' exige escribir cuál es; con cualquier otra se
      // ignora (queda en NULL).
      let carrierOther = null;
      if (carrier === 'Otra') {
        carrierOther = String(b.carrier_other || '').trim();
        if (!carrierOther) return res.status(400).json({ ok: false, error: 'Escribe qué paquetería es (elegiste "Otra").' });
      }
      const city = String(b.city || '').trim() || null;
      let nextFollowup = null;
      if (b.next_followup_date) {
        if (!isValidDateStr(b.next_followup_date)) {
          return res.status(400).json({ ok: false, error: 'Próxima fecha de seguimiento inválida (usa YYYY-MM-DD).' });
        }
        nextFollowup = b.next_followup_date;
      }
      const r = await pool.query(
        `INSERT INTO crm_clients (name, phone, branch, carrier, carrier_other, city, status, next_followup_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [name, phone, branch, carrier, carrierOther, city, status, nextFollowup, b.notes || null]
      );
      // Se relee con getClient para devolver el nivel calculado (nuevo,
      // sin compras) en vez de la fila cruda del INSERT.
      const created = await getClient(r.rows[0].id);
      return res.status(201).json({ ok: true, client: created });
    } catch (err) { next(err); }
  });

  // GET /api/clients/:id (con mensajes y compras)
  // Solo se ve si el cliente pertenece al alcance (sucursal propia o admin).
  // Fuera del alcance se responde 404 para no revelar que existe.
  app.get('/api/clients/:id', async (req, res, next) => {
    try {
      const id = parseClientId(req, res);
      if (!id) return;
      const scope = await resolveScope(req, res);
      if (scope === undefined) return; // 401 ya respondido
      if (!scope) {
        return res.status(400).json({ ok: false, error: 'Falta la sucursal. Elige tu sucursal para ver sus clientes.' });
      }
      const client = await getClient(id);
      if (!client || !scopeAllows(scope, client.branch)) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
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
  // Solo se edita si el cliente pertenece al alcance. Cambiar la sucursal
  // mueve al cliente a la vista de la otra sucursal; cambiar la paquetería
  // a 'Otra' exige carrier_other, y al salir de 'Otra' se limpia.
  const CLIENT_FIELDS = ['name', 'phone', 'branch', 'carrier', 'carrier_other', 'city', 'status', 'next_followup_date', 'notes', 'level_override'];
  app.put('/api/clients/:id', async (req, res, next) => {
    try {
      const id = parseClientId(req, res);
      if (!id) return;
      const scope = await resolveScope(req, res);
      if (scope === undefined) return; // 401 ya respondido
      if (!scope) {
        return res.status(400).json({ ok: false, error: 'Falta la sucursal. Elige tu sucursal para ver sus clientes.' });
      }
      const existing = await getClient(id);
      if (!existing || !scopeAllows(scope, existing.branch)) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
      const b = req.body || {};
      // Paquetería final y su nombre libre final (para validar y limpiar).
      const finalCarrier = b.carrier !== undefined ? b.carrier : existing.carrier;
      if (b.carrier !== undefined && !CARRIERS.includes(finalCarrier)) {
        return res.status(400).json({ ok: false, error: 'Paquetería no válida.' });
      }
      let finalCarrierOther = b.carrier_other !== undefined
        ? (String(b.carrier_other || '').trim() || null)
        : existing.carrier_other;
      if (finalCarrier === 'Otra' && !finalCarrierOther) {
        return res.status(400).json({ ok: false, error: 'Escribe qué paquetería es (elegiste "Otra").' });
      }
      if (finalCarrier !== 'Otra') finalCarrierOther = null;
      const sets = [];
      const vals = [];
      let i = 1;
      for (const f of CLIENT_FIELDS) {
        if (b[f] === undefined) continue;
        let v = b[f];
        if (f === 'name') {
          v = String(v || '').trim();
          if (!v) return res.status(400).json({ ok: false, error: 'El campo name no puede quedar vacío.' });
        }
        if (f === 'phone') {
          // El teléfono es opcional: vacío -> NULL (se quita el teléfono).
          v = String(v || '').trim() || null;
        }
        if (f === 'branch' && !BRANCHES.includes(v)) {
          return res.status(400).json({ ok: false, error: 'Sucursal no válida.' });
        }
        if (f === 'carrier' && !CARRIERS.includes(v)) {
          return res.status(400).json({ ok: false, error: 'Paquetería no válida.' });
        }
        if (f === 'carrier_other') v = finalCarrierOther;
        if (f === 'city') v = String(v || '').trim() || null;
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
        // Nivel fijado a mano: '' o null = Automático (se limpia el
        // override y vuelve a mandar el calculado); si no, uno de los 5.
        if (f === 'level_override') {
          if (v === '' || v === null) v = null;
          else if (!LEVELS.includes(v)) {
            return res.status(400).json({ ok: false, error: 'Nivel no válido.' });
          }
        }
        sets.push(`${f} = $${i}`);
        vals.push(v);
        i += 1;
      }
      // Si cambió la paquetería (y no se mandó carrier_other), el nombre
      // libre final igual debe quedar guardado/limpiado.
      if (b.carrier !== undefined && b.carrier_other === undefined) {
        sets.push(`carrier_other = $${i}`);
        vals.push(finalCarrierOther);
        i += 1;
      }
      if (!sets.length) return res.json({ ok: true, client: existing });
      sets.push('updated_at = now()');
      vals.push(id);
      const r = await pool.query(
        `UPDATE crm_clients SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        vals
      );
      // Se relee con getClient para devolver el nivel efectivo actualizado
      // (el override, si se fijó, o el calculado).
      const updated = await getClient(r.rows[0].id);
      return res.json({ ok: true, client: updated });
    } catch (err) { next(err); }
  });

  // DELETE /api/clients/:id (borra también sus mensajes y compras)
  app.delete('/api/clients/:id', async (req, res, next) => {
    try {
      const id = parseClientId(req, res);
      if (!id) return;
      const scope = await resolveScope(req, res);
      if (scope === undefined) return; // 401 ya respondido
      if (!scope) {
        return res.status(400).json({ ok: false, error: 'Falta la sucursal. Elige tu sucursal para ver sus clientes.' });
      }
      const existing = await getClient(id);
      if (!existing || !scopeAllows(scope, existing.branch)) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
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
      const scope = await resolveScope(req, res);
      if (scope === undefined) return; // 401 ya respondido
      if (!scope) {
        return res.status(400).json({ ok: false, error: 'Falta la sucursal. Elige tu sucursal para ver sus clientes.' });
      }
      const client = await getClient(id);
      if (!client || !scopeAllows(scope, client.branch)) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
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
      const scope = await resolveScope(req, res);
      if (scope === undefined) return; // 401 ya respondido
      if (!scope) {
        return res.status(400).json({ ok: false, error: 'Falta la sucursal. Elige tu sucursal para ver sus clientes.' });
      }
      const client = await getClient(id);
      if (!client || !scopeAllows(scope, client.branch)) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
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

  // DELETE /api/clients/:id/purchases/:purchaseId — elimina una compra y
  // recalcula la última compra del cliente y su total comprado acumulado.
  // Sirve para quitar del CRM los "Abono a crédito" que el reporte anual
  // mezcla con las ventas y que duplican el ingreso: son cobros, no
  // mercancía, así que no deben contar en el total ni en el nivel.
  app.delete('/api/clients/:id/purchases/:purchaseId', async (req, res, next) => {
    try {
      const id = parseClientId(req, res);
      if (!id) return;
      const purchaseId = parseInt(req.params.purchaseId, 10);
      if (!purchaseId) {
        return res.status(400).json({ ok: false, error: 'ID de compra inválido.' });
      }
      const scope = await resolveScope(req, res);
      if (scope === undefined) return; // 401 ya respondido
      if (!scope) {
        return res.status(400).json({ ok: false, error: 'Falta la sucursal. Elige tu sucursal para ver sus clientes.' });
      }
      const client = await getClient(id);
      if (!client || !scopeAllows(scope, client.branch)) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
      const existing = await pool.query(
        'SELECT * FROM crm_purchases WHERE id = $1 AND client_id = $2',
        [purchaseId, id]
      );
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Compra no encontrada.' });
      const deleted = existing.rows[0];
      await pool.query('DELETE FROM crm_purchases WHERE id = $1', [purchaseId]);
      // La última compra es la de fecha más reciente (desempate: la última
      // registrada); si ya no quedan compras, los campos quedan en NULL y
      // el total en 0.
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
        [last.rows.length ? toISODate(last.rows[0].date) : null,
         last.rows.length ? last.rows[0].description : null,
         last.rows.length ? money(last.rows[0].amount) : null,
         money(total.rows[0].total), id]
      );
      return res.json({ ok: true, purchase: normPurchase(deleted) });
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
      const scope = await resolveScope(req, res);
      if (scope === undefined) return; // 401 ya respondido
      if (!scope) {
        return res.status(400).json({ ok: false, error: 'Falta la sucursal. Elige tu sucursal para ver sus clientes.' });
      }
      const today = mexicoToday();
      const limit = addDaysISO(today, 7);
      const vals = [];
      let where = 'WHERE next_followup_date IS NOT NULL';
      let branchFilter = null;
      if (scope.admin) {
        if (req.query.branch) {
          if (!BRANCHES.includes(req.query.branch)) {
            return res.status(400).json({ ok: false, error: 'Sucursal no válida.' });
          }
          branchFilter = req.query.branch;
        }
      } else {
        branchFilter = scope.branch;
      }
      if (branchFilter) {
        vals.push(branchFilter);
        where += ` AND branch = $${vals.length}`;
      }
      const windowStart = addDaysISO(today, -365);
      vals.push(windowStart);
      const r = await pool.query(
        `SELECT ${CLIENT_LEVEL_COLUMNS} FROM crm_clients c
         ${levelAggJoin(`$${vals.length}`)}
         ${where}
         ORDER BY c.next_followup_date ASC, c.name ASC`,
        vals
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

module.exports = { createApp, mexicoToday, waLink, BRANCHES, REAL_BRANCHES, CARRIERS, STATUSES, CHANNELS, LEVELS, LEVEL_LABELS };
