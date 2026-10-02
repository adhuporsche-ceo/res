const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
});

const initializeDatabase = async () => {
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set to connect to Supabase PostgreSQL.');
  }
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  if (process.env.INITIAL_ADMIN_EMAIL && process.env.INITIAL_ADMIN_PASSWORD) {
    const { rows } = await pool.query('SELECT EXISTS (SELECT 1 FROM users) AS has_users');
    if (!rows[0].has_users) {
      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash(process.env.INITIAL_ADMIN_PASSWORD, 12);
      await pool.query(
        `INSERT INTO users (name, email, password_hash, role, department)
         VALUES ($1, $2, $3, 'SUPER_ADMIN', 'General')`,
        [process.env.INITIAL_ADMIN_NAME || 'System Administrator', process.env.INITIAL_ADMIN_EMAIL.trim().toLowerCase(), passwordHash]
      );
    }
  }
};

module.exports = { pool, initializeDatabase };