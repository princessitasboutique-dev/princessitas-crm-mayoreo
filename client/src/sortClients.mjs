// Ordenamiento de la lista de clientes del CRM Mayoreo.
// Módulo ESM puro (sin JSX ni React) para poder importarlo tanto en el
// cliente Vite (App.jsx) como en las pruebas de Node (test/smoke.mjs).
// Por eso el archivo es .mjs: Node trataría un .js como CommonJS porque
// ningún package.json declara "type": "module".

// Orden de niveles que pidió Ulises: Top primero y Nuevo al final.
export const LEVEL_ORDER = ['top', 'constante', 'esporadico', 'ocasional', 'nuevo'];

export const SORT_OPTIONS = [
  { value: 'level', label: 'Nivel (Top, Constante, Esporádico, Ocasional, Nuevo)' },
  { value: 'name', label: 'Nombre (A–Z)' },
  { value: 'total', label: 'Total comprado (mayor a menor)' },
  { value: 'lastPurchase', label: 'Última compra (más reciente primero)' },
];

export const DEFAULT_SORT = 'level';

export const SORT_STORAGE_KEY = 'crm_sort';

export function isValidSort(value) {
  return SORT_OPTIONS.some((o) => o.value === value);
}

function levelRank(level) {
  const i = LEVEL_ORDER.indexOf(level);
  // Nivel desconocido o sin nivel: después de 'nuevo'.
  return i === -1 ? LEVEL_ORDER.length : i;
}

function byName(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' });
}

function byLevel(a, b) {
  const d = levelRank(a.level) - levelRank(b.level);
  return d !== 0 ? d : byName(a, b);
}

function byTotal(a, b) {
  const ta = Number(a.total_purchased) || 0;
  const tb = Number(b.total_purchased) || 0;
  if (tb !== ta) return tb - ta;
  return byName(a, b);
}

function byLastPurchase(a, b) {
  const da = a.last_purchase_date || '';
  const db = b.last_purchase_date || '';
  // Sin última compra: al final.
  if (!da && !db) return byName(a, b);
  if (!da) return 1;
  if (!db) return -1;
  // Las fechas son 'YYYY-MM-DD', así que la comparación de cadenas
  // equivale a la cronológica; la más reciente va primero.
  if (db !== da) return db < da ? -1 : 1;
  return byName(a, b);
}

const SORTERS = {
  level: byLevel,
  name: byName,
  total: byTotal,
  lastPurchase: byLastPurchase,
};

// Ordena una copia de la lista (no muta el arreglo original). Un valor de
// orden desconocido cae al orden por defecto (Nivel).
export function sortClients(clients, sortBy) {
  const sorter = SORTERS[sortBy] || SORTERS[DEFAULT_SORT];
  return [...(clients || [])].sort(sorter);
}
