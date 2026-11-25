// Cliente mínimo de la API del CRM Mayoreo.
// Alcance por sucursal: cada petición lleva el encabezado x-branch con la
// sucursal del dispositivo, o x-admin-pin cuando está activo el modo
// administrador ("Ver todas las sucursales"). Sin login de cuentas: esto es
// segmentación a nivel de dispositivo, no control de acceso por usuario.
let scopeHeaders = {};

export function setApiScope(headers) {
  scopeHeaders = { ...headers };
}

export async function api(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...scopeHeaders, ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Error ${res.status}`);
  }
  return data;
}
