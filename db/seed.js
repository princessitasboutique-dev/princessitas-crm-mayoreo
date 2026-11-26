// db/seed.js — el CRM Mayoreo empieza con la base VACÍA: no se inventan
// clientes de ejemplo. Solo se asegura el esquema (idempotente).
// Se ejecuta automáticamente al arrancar el servidor (server.js) y
// manualmente con `npm run seed` (requiere DATABASE_URL).
const fs = require('fs');
const path = require('path');

async function ensureSchema(client) {
  // Migración para bases que ya existen (la de producción en Neon): agrega
  // las columnas nuevas si faltan. Se aplica ANTES de schema.sql porque
  // schema.sql crea un índice sobre city: si la columna aún no existe, ese
  // CREATE INDEX falla, la consulta multi-sentencia se aborta y las
  // migraciones que iban después nunca corrían. La base en vivo se quedaba
  // sin carrier_other ni city y POST /api/clients fallaba con 500
  // ("Error interno del servidor."). Así, aunque schema.sql falle a medias,
  // las columnas ya están agregadas. Idempotente y sin tocar los datos.
  await addMissingColumns(client);
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await client.query(sql);
}

// Agrega carrier_other, city y level_override a crm_clients si faltan.
// Idempotente: si la columna ya existe se ignora el error, y si la tabla
// aún no existe (base nueva: la crea schema.sql después, ya con las
// columnas) también se ignora. Cualquier otro error sí se propaga.
async function addMissingColumns(client) {
  for (const col of ['carrier_other TEXT', 'city TEXT', 'level_override TEXT']) {
    try {
      await client.query(`ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS ${col}`);
    } catch (err) {
      if (!/already exists|duplicate|does not exist/i.test(err.message)) throw err;
    }
  }
}

async function count(client, table) {
  const r = await client.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
  return r.rows[0].c;
}

async function seed(client) {
  // Sin datos semilla: los clientes los dan de alta los colaboradores.
  const n = await count(client, 'crm_clients');
  console.log(`seed: crm_clients tiene ${n} clientes (la base empieza vacía, sin ejemplos).`);
  return { clients: n };
}

if (require.main === module) {
  (async () => {
    const { pool } = require('../src/db');
    try {
      await ensureSchema(pool);
      await seed(pool);
      console.log('seed completado.');
    } catch (err) {
      console.error('Error en seed:', err.message);
      process.exitCode = 1;
    } finally {
      await pool.end().catch(() => {});
    }
  })();
}

module.exports = { seed, ensureSchema };
