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
CREATE INDEX IF NOT EXISTS idx_crm_messages_client ON crm_messages(client_id);
CREATE INDEX IF NOT EXISTS idx_crm_purchases_client ON crm_purchases(client_id);
