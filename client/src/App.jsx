// CRM Mayoreo — Princessitas Ceremonias.
// Seguimiento a clientes de mayoreo: datos, última compra, último mensaje,
// próxima fecha de seguimiento, historial de mensajes y compras, y botón
// de WhatsApp.
//
// Segmentación por sucursal (a nivel de dispositivo): al abrir la app por
// primera vez se elige la sucursal y se guarda en el dispositivo; cada
// colaboradora solo ve los clientes de su sucursal. El botón "Ver todas"
// desbloquea el modo administrador con el MISMO PIN de la app de asistencia
// (se verifica en el servidor; el PIN se crea y se cambia en asistencia).
// Esto NO son cuentas de usuario con contraseña: quien cambie la sucursal
// en su dispositivo o conozca el PIN puede ver otra sucursal.
import React, { useState, useEffect, useCallback } from 'react';
import { api, setApiScope } from './api.js';

const BRANCHES = ['Medrano 58', 'Medrano 60', 'Zapotlanejo', 'Otra'];
const REAL_BRANCHES = ['Medrano 58', 'Medrano 60', 'Zapotlanejo'];
const CARRIERS = ['Paquetexpress', 'Coordinadora', 'Estafeta', 'FedEx', 'Skydropx', 'Otra'];
const STATUSES = [
  { value: 'nuevo', label: 'Nuevo' },
  { value: 'activo', label: 'Activo' },
  { value: 'inactivo', label: 'Inactivo' },
];
const CHANNELS = ['WhatsApp', 'llamada', 'otro'];

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function todayMX() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${parseInt(day, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

function fmtMoney(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

function statusLabel(s) {
  return (STATUSES.find((x) => x.value === s) || {}).label || s;
}

function carrierLabel(c) {
  return c && c.carrier_display ? c.carrier_display : c.carrier;
}

function ClientCard({ client, onOpen }) {
  const fup = client.next_followup_date;
  const overdue = fup && fup < todayMX();
  const today = fup === todayMX();
  return (
    <div className={`card client ${overdue ? 'overdue' : ''}`}>
      <div className="client-head">
        <div>
          <div className="name">{client.name}</div>
          <div className="muted">{client.phone}{client.city ? ` · ${client.city}` : ''}</div>
        </div>
        <span className={`badge ${client.status === 'activo' ? 'ok' : client.status === 'nuevo' ? 'info' : 'pending'}`}>
          {statusLabel(client.status)}
        </span>
      </div>
      <div className="client-meta">
        <span>📍 {client.branch}</span>
        {client.city && <span>🏙️ {client.city}</span>}
        <span>📦 {carrierLabel(client)}</span>
        <span>💰 Total: <b>{fmtMoney(client.total_purchased)}</b></span>
      </div>
      <div className="client-lines">
        <div>
          <b>Última compra:</b>{' '}
          {client.last_purchase_date
            ? `${fmtDate(client.last_purchase_date)} · ${client.last_purchase_description} · ${fmtMoney(client.last_purchase_amount)}`
            : 'sin compras registradas'}
        </div>
        <div>
          <b>Último mensaje:</b>{' '}
          {client.last_message_date
            ? `${fmtDate(client.last_message_date)} · ${client.last_message_text}`
            : 'sin mensajes registrados'}
        </div>
        <div>
          <b>Próximo seguimiento:</b>{' '}
          {fup
            ? <span className={overdue ? 'danger' : today ? 'warn' : ''}>{fmtDate(fup)}{overdue ? ' (vencido)' : today ? ' (hoy)' : ''}</span>
            : 'sin fecha'}
        </div>
      </div>
      <div className="btnrow">
        {client.whatsapp_url && (
          <a className="btn wa" href={client.whatsapp_url} target="_blank" rel="noreferrer">WhatsApp</a>
        )}
        <button className="secondary small" onClick={onOpen}>Ver ficha</button>
      </div>
    </div>
  );
}

const EMPTY_NEW = { name: '', phone: '', branch: 'Medrano 58', carrier: 'Paquetexpress', carrier_other: '', city: '', status: 'nuevo', next_followup_date: '', notes: '' };

export default function App() {
  const [myBranch, setMyBranch] = useState(() => {
    try { return localStorage.getItem('crm_branch') || null; } catch { return null; }
  });
  const [adminPin, setAdminPin] = useState(() => {
    try { return sessionStorage.getItem('crm_admin_pin') || ''; } catch { return ''; }
  });
  const adminMode = adminPin !== '';
  const [showPinForm, setShowPinForm] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinSet, setPinSet] = useState(null);
  const [adminBranch, setAdminBranch] = useState('');
  const [tab, setTab] = useState('clientes');
  const [clients, setClients] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [followupDate, setFollowupDate] = useState('');
  const [search, setSearch] = useState('');
  const [carrier, setCarrier] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null); // {type:'ok'|'err', text}
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ ...EMPTY_NEW, branch: myBranch || 'Medrano 58' });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [msgForm, setMsgForm] = useState({ date: todayMX(), text: '', channel: 'WhatsApp' });
  const [purForm, setPurForm] = useState({ date: todayMX(), description: '', amount: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Alcance de las peticiones: sucursal propia o PIN de administrador.
  useEffect(() => {
    setApiScope(adminMode ? { 'x-admin-pin': adminPin } : (myBranch ? { 'x-branch': myBranch } : {}));
  }, [adminMode, adminPin, myBranch]);

  // Al elegir sucursal, el formulario de cliente nuevo la prellena.
  useEffect(() => {
    if (myBranch) setNewForm((f) => ({ ...f, branch: myBranch }));
  }, [myBranch]);

  const loadClients = useCallback(async () => {
    if (!myBranch && !adminMode) return;
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (search.trim()) q.set('search', search.trim());
      if (adminMode && adminBranch) q.set('branch', adminBranch);
      if (carrier) q.set('carrier', carrier);
      if (status) q.set('status', status);
      const data = await api(`/api/clients?${q.toString()}`);
      setClients(data.clients || []);
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [search, adminMode, adminBranch, carrier, status, myBranch]);

  const loadFollowups = useCallback(async () => {
    if (!myBranch && !adminMode) return;
    try {
      const q = new URLSearchParams();
      if (adminMode && adminBranch) q.set('branch', adminBranch);
      const data = await api(`/api/followups?${q.toString()}`);
      setFollowups(data.followups || []);
      setFollowupDate(data.date || '');
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    }
  }, [adminMode, adminBranch, myBranch]);

  useEffect(() => { loadClients(); }, [loadClients]);
  useEffect(() => { if (tab === 'seguimientos') loadFollowups(); }, [tab, loadFollowups]);

  const chooseBranch = (b) => {
    try { localStorage.setItem('crm_branch', b); } catch { /* sin almacenamiento */ }
    setMyBranch(b);
    setMsg({ type: 'ok', text: `Sucursal: ${b}. Solo ves los clientes que atiende esta sucursal.` });
  };

  const changeBranch = () => {
    try {
      localStorage.removeItem('crm_branch');
      sessionStorage.removeItem('crm_admin_pin');
    } catch { /* sin almacenamiento */ }
    setMyBranch(null);
    setAdminPin('');
    setAdminBranch('');
    setShowPinForm(false);
    setClients([]);
    setFollowups([]);
    setSelectedId(null);
    setDetail(null);
  };

  const openPinForm = async () => {
    setShowPinForm(true);
    setPinInput('');
    setPinSet(null);
    try {
      const data = await api('/api/admin/verify-pin', { method: 'POST', body: {} });
      setPinSet(data.pinSet);
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    }
  };

  const submitPin = async (e) => {
    e.preventDefault();
    try {
      const data = await api('/api/admin/verify-pin', { method: 'POST', body: { pin: pinInput } });
      if (!data.pinSet) {
        setMsg({ type: 'err', text: 'Todavía no hay PIN de administración. Se crea en la app de asistencia.' });
        return;
      }
      if (!data.verified) {
        setMsg({ type: 'err', text: 'PIN incorrecto.' });
        return;
      }
      try { sessionStorage.setItem('crm_admin_pin', pinInput); } catch { /* sin almacenamiento */ }
      setAdminPin(pinInput);
      setShowPinForm(false);
      setAdminBranch('');
      setMsg({ type: 'ok', text: 'Modo administrador: ahora ves todas las sucursales.' });
      loadClients();
      if (tab === 'seguimientos') loadFollowups();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    }
  };

  const exitAdmin = () => {
    try { sessionStorage.removeItem('crm_admin_pin'); } catch { /* sin almacenamiento */ }
    setAdminPin('');
    setAdminBranch('');
    setShowPinForm(false);
    setMsg({ type: 'ok', text: 'Saliste del modo administrador.' });
    loadClients();
    if (tab === 'seguimientos') loadFollowups();
  };

  const loadDetail = useCallback(async (id) => {
    try {
      const data = await api(`/api/clients/${id}`);
      setDetail(data);
      setEditForm({
        name: data.client.name,
        phone: data.client.phone,
        branch: data.client.branch,
        carrier: data.client.carrier,
        carrier_other: data.client.carrier_other || '',
        city: data.client.city || '',
        status: data.client.status,
        next_followup_date: data.client.next_followup_date || '',
        notes: data.client.notes || '',
      });
      setMsgForm({ date: todayMX(), text: '', channel: 'WhatsApp' });
      setPurForm({ date: todayMX(), description: '', amount: '' });
      setConfirmDelete(false);
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    }
  }, []);

  const openClient = (id) => {
    setSelectedId(id);
    loadDetail(id);
  };

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
    loadClients();
    if (tab === 'seguimientos') loadFollowups();
  };

  async function createClient(e) {
    e.preventDefault();
    try {
      const body = { ...newForm };
      if (!body.next_followup_date) delete body.next_followup_date;
      if (!body.notes) delete body.notes;
      if (!body.city.trim()) delete body.city;
      if (body.carrier !== 'Otra') delete body.carrier_other;
      const data = await api('/api/clients', { method: 'POST', body });
      setMsg({ type: 'ok', text: `Cliente ${data.client.name} agregado.` });
      setNewForm({ ...EMPTY_NEW, branch: myBranch || 'Medrano 58' });
      setShowNew(false);
      loadClients();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    try {
      const body = { ...editForm };
      if (body.carrier !== 'Otra') body.carrier_other = '';
      const data = await api(`/api/clients/${selectedId}`, { method: 'PUT', body });
      setDetail((d) => ({ ...d, client: data.client }));
      setMsg({ type: 'ok', text: 'Datos del cliente actualizados.' });
      loadClients();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    }
  }

  async function addMessage(e) {
    e.preventDefault();
    try {
      await api(`/api/clients/${selectedId}/messages`, { method: 'POST', body: msgForm });
      setMsg({ type: 'ok', text: 'Mensaje registrado.' });
      loadDetail(selectedId);
      loadClients();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    }
  }

  async function addPurchase(e) {
    e.preventDefault();
    try {
      await api(`/api/clients/${selectedId}/purchases`, {
        method: 'POST',
        body: { ...purForm, amount: parseFloat(purForm.amount) },
      });
      setMsg({ type: 'ok', text: 'Compra registrada.' });
      loadDetail(selectedId);
      loadClients();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    }
  }

  async function deleteClient() {
    try {
      await api(`/api/clients/${selectedId}`, { method: 'DELETE' });
      setMsg({ type: 'ok', text: 'Cliente eliminado.' });
      closeDetail();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    }
  }

  const overdueCount = followups.filter((c) => c.followup_status === 'vencido').length;
  const todayCount = followups.filter((c) => c.followup_status === 'hoy').length;
  const groups = [
    { key: 'vencido', title: `Vencidos (${overdueCount})`, items: followups.filter((c) => c.followup_status === 'vencido') },
    { key: 'hoy', title: `Hoy (${todayCount})`, items: followups.filter((c) => c.followup_status === 'hoy') },
    { key: 'próximo', title: 'Próximos 7 días', items: followups.filter((c) => c.followup_status === 'próximo') },
  ];

  // Puerta de sucursal: primera vez que se abre la app en este dispositivo.
  if (!myBranch) {
    return (
      <div className="app">
        <header>
          <h1>CRM Mayoreo — Princessitas</h1>
        </header>
        <div className="card branch-gate">
          <h2>¿De qué sucursal eres?</h2>
          <p className="muted">
            Cada sucursal solo ve los clientes que atiende. Tu elección se guarda
            en este dispositivo y la puedes cambiar después.
          </p>
          <div className="btnrow column">
            {REAL_BRANCHES.map((b) => (
              <button key={b} onClick={() => chooseBranch(b)}>{b}</button>
            ))}
          </div>
        </div>
        <footer>Princessitas Ceremonias · CRM Mayoreo</footer>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>CRM Mayoreo — Princessitas</h1>
      </header>
      <p className="muted">
        {adminMode
          ? 'Modo administrador: ves todas las sucursales.'
          : `Sucursal: ${myBranch} · Solo ves los clientes que atiende esta sucursal.`}
      </p>
      <div className="btnrow">
        <button className="secondary small" onClick={changeBranch}>Cambiar sucursal</button>
        {adminMode
          ? <button className="secondary small" onClick={exitAdmin}>Salir de administrador</button>
          : <button className="secondary small" onClick={openPinForm}>Ver todas las sucursales</button>}
      </div>

      {showPinForm && !adminMode && (
        <form className="card" onSubmit={submitPin}>
          <h2>Ver todas las sucursales</h2>
          <p className="muted">
            {pinSet === false
              ? 'Todavía no hay PIN de administración. El PIN se crea en la app de asistencia (es el mismo).'
              : 'Escribe el PIN de administración (el mismo de la app de asistencia).'}
          </p>
          <label>PIN *</label>
          <input
            required
            type="password"
            inputMode="numeric"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            placeholder="PIN de administración"
            autoComplete="off"
          />
          <div className="btnrow">
            <button type="submit">Entrar como administrador</button>
            <button type="button" className="secondary" onClick={() => setShowPinForm(false)}>Cancelar</button>
          </div>
        </form>
      )}

      <p className="muted">Seguimiento a clientes de mayoreo: compras, mensajes y próximos contactos.</p>

      {msg && <div className={`msg ${msg.type === 'ok' ? 'ok' : 'err'}`}>{msg.text}</div>}

      {!selectedId && (
        <>
          <div className="tabs">
            <button className={tab === 'clientes' ? 'active' : ''} onClick={() => setTab('clientes')}>Clientes</button>
            <button className={tab === 'seguimientos' ? 'active' : ''} onClick={() => setTab('seguimientos')}>
              Seguimientos {overdueCount + todayCount > 0 ? `(${overdueCount + todayCount})` : ''}
            </button>
          </div>

          {tab === 'clientes' && (
            <>
              <div className="filters">
                <input
                  type="search"
                  placeholder="Buscar por nombre, teléfono o ciudad…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="grid3">
                  {adminMode && (
                    <select value={adminBranch} onChange={(e) => setAdminBranch(e.target.value)}>
                      <option value="">Todas las sucursales</option>
                      {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  )}
                  <select value={carrier} onChange={(e) => setCarrier(e.target.value)}>
                    <option value="">Todas las paqueterías</option>
                    {CARRIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">Todos los estados</option>
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="btnrow">
                <button onClick={() => setShowNew(!showNew)}>{showNew ? 'Cerrar formulario' : '+ Nuevo cliente'}</button>
              </div>

              {showNew && (
                <form className="card" onSubmit={createClient}>
                  <h2>Nuevo cliente</h2>
                  <label>Nombre *</label>
                  <input required value={newForm.name} onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} placeholder="Nombre del cliente o boutique" />
                  <label>Teléfono (WhatsApp) *</label>
                  <input required value={newForm.phone} onChange={(e) => setNewForm({ ...newForm, phone: e.target.value })} placeholder="10 dígitos" inputMode="tel" />
                  <div className="grid2">
                    <div>
                      <label>Ciudad</label>
                      <input value={newForm.city} onChange={(e) => setNewForm({ ...newForm, city: e.target.value })} placeholder="Ej. Guadalajara" />
                    </div>
                    <div>
                      <label>Estado</label>
                      <select value={newForm.status} onChange={(e) => setNewForm({ ...newForm, status: e.target.value })}>
                        {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid2">
                    <div>
                      <label>Sucursal que lo atiende</label>
                      <select value={newForm.branch} onChange={(e) => setNewForm({ ...newForm, branch: e.target.value })}>
                        {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div>
                      <label>Paquetería habitual</label>
                      <select value={newForm.carrier} onChange={(e) => setNewForm({ ...newForm, carrier: e.target.value })}>
                        {CARRIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  {newForm.carrier === 'Otra' && (
                    <>
                      <label>¿Qué paquetería? *</label>
                      <input required value={newForm.carrier_other} onChange={(e) => setNewForm({ ...newForm, carrier_other: e.target.value })} placeholder="Escribe el nombre de la paquetería" />
                    </>
                  )}
                  <div className="grid2">
                    <div>
                      <label>Próxima fecha de seguimiento</label>
                      <input type="date" value={newForm.next_followup_date} onChange={(e) => setNewForm({ ...newForm, next_followup_date: e.target.value })} />
                    </div>
                  </div>
                  <label>Notas</label>
                  <textarea rows={2} value={newForm.notes} onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })} placeholder="Notas sobre el cliente (opcional)" />
                  <button type="submit">Guardar cliente</button>
                </form>
              )}

              {loading && <p className="muted">Cargando…</p>}
              {!loading && clients.length === 0 && (
                <p className="muted">
                  {adminMode
                    ? 'No hay clientes todavía. Agrega el primero con el botón de arriba.'
                    : `No hay clientes de ${myBranch} todavía. Agrega el primero con el botón de arriba.`}
                </p>
              )}
              {clients.map((c) => (
                <ClientCard key={c.id} client={c} onOpen={() => openClient(c.id)} />
              ))}
            </>
          )}

          {tab === 'seguimientos' && (
            <>
              <p className="muted">
                {followupDate ? `Hoy es ${fmtDate(followupDate)}. ` : ''}
                Vencidos y de hoy primero; también se muestran los próximos 7 días.
              </p>
              {followups.length === 0 && <p className="muted">No hay seguimientos pendientes. 🎉</p>}
              {groups.map((g) => g.items.length > 0 && (
                <div key={g.key}>
                  <h2>{g.title}</h2>
                  {g.items.map((c) => (
                    <ClientCard key={c.id} client={c} onOpen={() => openClient(c.id)} />
                  ))}
                </div>
              ))}
            </>
          )}
        </>
      )}

      {selectedId && detail && (
        <div>
          <button className="secondary small" onClick={closeDetail}>← Volver a la lista</button>
          <h2>{detail.client.name}</h2>
          <p className="muted">
            {detail.client.phone}
            {detail.client.city ? ` · ${detail.client.city}` : ''}
            {' · '}{detail.client.branch} · {carrierLabel(detail.client)} · {statusLabel(detail.client.status)}
            {' · '}Total comprado: <b>{fmtMoney(detail.client.total_purchased)}</b>
          </p>
          {detail.client.whatsapp_url && (
            <div className="btnrow">
              <a className="btn wa" href={detail.client.whatsapp_url} target="_blank" rel="noreferrer">Abrir WhatsApp</a>
            </div>
          )}

          <form className="card" onSubmit={saveEdit}>
            <h3>Datos del cliente</h3>
            <label>Nombre *</label>
            <input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            <label>Teléfono (WhatsApp) *</label>
            <input required value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} inputMode="tel" />
            <div className="grid2">
              <div>
                <label>Ciudad</label>
                <input value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} placeholder="Ej. Guadalajara" />
              </div>
              <div>
                <label>Estado</label>
                <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid2">
              <div>
                <label>Sucursal que lo atiende</label>
                <select value={editForm.branch} onChange={(e) => setEditForm({ ...editForm, branch: e.target.value })}>
                  {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label>Paquetería habitual</label>
                <select value={editForm.carrier} onChange={(e) => setEditForm({ ...editForm, carrier: e.target.value })}>
                  {CARRIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            {editForm.carrier === 'Otra' && (
              <>
                <label>¿Qué paquetería? *</label>
                <input required value={editForm.carrier_other} onChange={(e) => setEditForm({ ...editForm, carrier_other: e.target.value })} placeholder="Escribe el nombre de la paquetería" />
              </>
            )}
            <div className="grid2">
              <div>
                <label>Próxima fecha de seguimiento</label>
                <input type="date" value={editForm.next_followup_date} onChange={(e) => setEditForm({ ...editForm, next_followup_date: e.target.value })} />
              </div>
            </div>
            <label>Notas</label>
            <textarea rows={2} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
            <button type="submit">Guardar cambios</button>
          </form>

          <form className="card" onSubmit={addMessage}>
            <h3>Registrar mensaje</h3>
            <div className="grid2">
              <div>
                <label>Fecha</label>
                <input type="date" value={msgForm.date} onChange={(e) => setMsgForm({ ...msgForm, date: e.target.value })} />
              </div>
              <div>
                <label>Canal</label>
                <select value={msgForm.channel} onChange={(e) => setMsgForm({ ...msgForm, channel: e.target.value })}>
                  {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <label>Mensaje enviado *</label>
            <textarea rows={2} required value={msgForm.text} onChange={(e) => setMsgForm({ ...msgForm, text: e.target.value })} placeholder="¿Qué le escribiste o le dijiste?" />
            <button type="submit">Guardar mensaje</button>
          </form>

          <form className="card" onSubmit={addPurchase}>
            <h3>Registrar compra</h3>
            <div className="grid2">
              <div>
                <label>Fecha</label>
                <input type="date" value={purForm.date} onChange={(e) => setPurForm({ ...purForm, date: e.target.value })} />
              </div>
              <div>
                <label>Monto ($) *</label>
                <input required type="number" min="0.01" step="0.01" value={purForm.amount} onChange={(e) => setPurForm({ ...purForm, amount: e.target.value })} placeholder="0.00" />
              </div>
            </div>
            <label>Descripción *</label>
            <input required value={purForm.description} onChange={(e) => setPurForm({ ...purForm, description: e.target.value })} placeholder="Ej. 10 ropones desmontables" />
            <button type="submit">Guardar compra</button>
          </form>

          <div className="card">
            <h3>Historial de mensajes</h3>
            {detail.messages.length === 0 && <p className="muted">Sin mensajes registrados.</p>}
            {detail.messages.map((m) => (
              <div key={m.id} className="history-row">
                <b>{fmtDate(m.date)}</b> <span className="muted">({m.channel})</span> — {m.text}
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Historial de compras</h3>
            {detail.purchases.length === 0 && <p className="muted">Sin compras registradas.</p>}
            {detail.purchases.map((p) => (
              <div key={p.id} className="history-row">
                <b>{fmtDate(p.date)}</b> — {p.description} · <b>{fmtMoney(p.amount)}</b>
              </div>
            ))}
          </div>

          <div className="card danger-zone">
            <h3>Eliminar cliente</h3>
            <p className="muted">Se borran también su historial de mensajes y compras.</p>
            {!confirmDelete
              ? <button className="secondary" onClick={() => setConfirmDelete(true)}>Eliminar cliente</button>
              : (
                <div className="btnrow">
                  <button onClick={deleteClient}>Sí, eliminar</button>
                  <button className="secondary" onClick={() => setConfirmDelete(false)}>Cancelar</button>
                </div>
              )}
          </div>
        </div>
      )}

      <footer>Princessitas Ceremonias · CRM Mayoreo</footer>
    </div>
  );
}
