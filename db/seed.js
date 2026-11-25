// db/seed.js — el CRM Mayoreo empieza con la base VACÍA: no se inventan
// clientes de ejemplo. Solo se asegura el esquema (idempotente).
// Se ejecuta automáticamente al arrancar el servidor (server.js) y
// manualmente con `npm run seed` (requiere DATABASE_URL).
const fs = require('fs');
const path = require('path');

async function ensureSchema(client) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await client.query(sql);
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
