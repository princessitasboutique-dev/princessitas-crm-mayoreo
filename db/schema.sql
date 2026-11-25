-- Princessitas Ceremonias — CRM Mayoreo: esquema PostgreSQL
-- Se aplica de forma idempotente (CREATE TABLE IF NOT EXISTS).
-- Todas las tablas llevan prefijo crm_ para convivir con las tablas de la
-- app de asistencia si se comparte la misma base de Neon. NO se toca
-- ninguna tabla de asistencia.

CREATE TABLE IF NOT EXISTS crm_clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'Otra'
    CHECK (branch IN ('Medrano 58', 'Medrano 60', 'Zapotlanejo', 'Otra')),
  carrier TEXT NOT NULL DEFAULT 'Otra'
    CHECK (carrier IN ('Paquetexpress', 'Coordinadora', 'Estafeta', 'FedEx', 'Skydropx', 'Otra')),
  -- Nombre libre cuando carrier = 'Otra' (se muestra como la paquetería).
  carrier_other TEXT,
  -- Ciudad del cliente (opcional).
  city TEXT,
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

CREATE TABLE IF NOT EXISTS crm_messages (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  text TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'WhatsApp'
    CHECK (channel IN ('WhatsApp', 'llamada', 'otro')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_purchases (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_clients_name ON crm_clients(name);
CREATE INDEX IF NOT EXISTS idx_crm_clients_phone ON crm_clients(phone);
CREATE INDEX IF NOT EXISTS idx_crm_clients_followup ON crm_clients(next_followup_date);
CREATE INDEX IF NOT EXISTS idx_crm_clients_city ON crm_clients(city);
CREATE INDEX IF NOT EXISTS idx_crm_messages_client ON crm_messages(client_id);
CREATE INDEX IF NOT EXISTS idx_crm_purchases_client ON crm_purchases(client_id);

-- Tabla settings: MISMA forma que en la app de asistencia (key TEXT PRIMARY
-- KEY, value TEXT NOT NULL). El CRM solo la LEE para reutilizar el PIN de
-- administración de asistencia (clave 'admin_pin_hash', hash bcrypt): el
-- PIN se crea y se cambia en la app de asistencia, no aquí. En la base
-- compartida de Neon esta tabla ya existe; el CREATE es idempotente. Si el
-- CRM se despliega con una base nueva, la tabla se crea vacía y el modo
-- administrador queda sin configurar hasta que se cree el PIN en asistencia.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
