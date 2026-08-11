'use strict';

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { DASHBOARD_DATABASE_URL, QUERY_TIMEOUT_MS } = require('../config');

const BCRYPT_ROUNDS = 12;
const ROLES = Object.freeze(['ADMIN', 'VIEWER']);

let pool = null;

function getPool() {
  if (!DASHBOARD_DATABASE_URL) {
    throw new Error('DASHBOARD_DATABASE_URL is not set');
  }
  if (!pool) {
    pool = new Pool({
      connectionString: DASHBOARD_DATABASE_URL,
      ssl: /@(localhost|127\.0\.0\.1)[:/]/i.test(DASHBOARD_DATABASE_URL)
        ? undefined
        : { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: QUERY_TIMEOUT_MS,
      statement_timeout: QUERY_TIMEOUT_MS,
    });
    pool.on('error', (err) => {
      console.error(`[dashboard-db] idle client error: ${err.message}`);
    });
  }
  return pool;
}

async function init() {
  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS dashboard_users (
      id            BIGSERIAL PRIMARY KEY,
      email         VARCHAR(255) UNIQUE NOT NULL,
      name          VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role          VARCHAR(20)  NOT NULL DEFAULT 'VIEWER',
      allowed_systems TEXT[]     NOT NULL DEFAULT '{}',
      is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      last_login_at TIMESTAMPTZ,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS session (
      sid    VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
      sess   JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    )
  `);
  await db.query(
    'CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire)'
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS dashboard_audit_log (
      id         BIGSERIAL PRIMARY KEY,
      actor_id   BIGINT,
      actor_email VARCHAR(255),
      action     VARCHAR(100) NOT NULL,
      details    TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await seedFirstAdmin();
}

async function seedFirstAdmin() {
  const db = getPool();
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM dashboard_users');
  if (rows[0].n > 0) return;

  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');

  if (!email || !password) {
    console.warn(
      '[dashboard-db] No users exist and ADMIN_EMAIL/ADMIN_PASSWORD are unset — ' +
        'set them and restart to create the first admin.'
    );
    return;
  }

  await createUser({
    email,
    name: String(process.env.ADMIN_NAME || 'Administrator'),
    password,
    role: 'ADMIN',
    allowedSystems: [],
    mustChangePassword: true,
  });
  console.log(`[dashboard-db] Seeded initial admin: ${email}`);
}

async function createUser({
  email,
  name,
  password,
  role = 'VIEWER',
  allowedSystems = [],
  mustChangePassword = true,
}) {
  if (!ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const { rows } = await getPool().query(
    `INSERT INTO dashboard_users
       (email, name, password_hash, role, allowed_systems, must_change_password)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, name, role, allowed_systems, is_active,
               must_change_password, last_login_at, created_at`,
    [
      String(email).trim().toLowerCase(),
      String(name).trim(),
      passwordHash,
      role,
      allowedSystems,
      mustChangePassword,
    ]
  );
  return rows[0];
}

async function findByEmail(email) {
  const { rows } = await getPool().query(
    'SELECT * FROM dashboard_users WHERE email = $1',
    [String(email).trim().toLowerCase()]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await getPool().query(
    `SELECT id, email, name, role, allowed_systems, is_active,
            must_change_password, last_login_at, created_at
       FROM dashboard_users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function listUsers() {
  const { rows } = await getPool().query(
    `SELECT id, email, name, role, allowed_systems, is_active,
            must_change_password, last_login_at, created_at
       FROM dashboard_users ORDER BY created_at ASC`
  );
  return rows;
}

async function verifyLogin(email, password) {
  const user = await findByEmail(email);
  if (!user || !user.is_active) {
    await bcrypt.compare(String(password), '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');
    return null;
  }
  const ok = await bcrypt.compare(String(password), user.password_hash);
  if (!ok) return null;

  await getPool().query(
    'UPDATE dashboard_users SET last_login_at = NOW() WHERE id = $1',
    [user.id]
  );
  return user;
}

async function updateUser(id, { name, role, allowedSystems, isActive }) {
  if (role !== undefined && !ROLES.includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  const { rows } = await getPool().query(
    `UPDATE dashboard_users SET
       name            = COALESCE($2, name),
       role            = COALESCE($3, role),
       allowed_systems = COALESCE($4, allowed_systems),
       is_active       = COALESCE($5, is_active),
       updated_at      = NOW()
     WHERE id = $1
     RETURNING id, email, name, role, allowed_systems, is_active,
               must_change_password, last_login_at, created_at`,
    [
      id,
      name ?? null,
      role ?? null,
      allowedSystems ?? null,
      isActive === undefined ? null : isActive,
    ]
  );
  return rows[0] || null;
}

async function setPassword(id, password, { mustChange = false } = {}) {
  const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const { rowCount } = await getPool().query(
    `UPDATE dashboard_users
        SET password_hash = $2, must_change_password = $3, updated_at = NOW()
      WHERE id = $1`,
    [id, passwordHash, mustChange]
  );
  return rowCount > 0;
}

async function deleteUser(id) {
  const { rowCount } = await getPool().query(
    'DELETE FROM dashboard_users WHERE id = $1',
    [id]
  );
  return rowCount > 0;
}

async function countActiveAdmins() {
  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS n FROM dashboard_users
      WHERE role = 'ADMIN' AND is_active = TRUE`
  );
  return rows[0].n;
}

async function audit(actor, action, details = '') {
  try {
    await getPool().query(
      `INSERT INTO dashboard_audit_log (actor_id, actor_email, action, details)
       VALUES ($1, $2, $3, $4)`,
      [actor?.id ?? null, actor?.email ?? null, action, String(details).slice(0, 2000)]
    );
  } catch (err) {
    console.error(`[audit] failed to record "${action}": ${err.message}`);
  }
}

async function listAuditLog(limit = 100) {
  const { rows } = await getPool().query(
    `SELECT actor_email, action, details, created_at
       FROM dashboard_audit_log ORDER BY created_at DESC LIMIT $1`,
    [Math.min(Number(limit) || 100, 500)]
  );
  return rows;
}

module.exports = {
  ROLES,
  getPool,
  init,
  createUser,
  findByEmail,
  findById,
  listUsers,
  verifyLogin,
  updateUser,
  setPassword,
  deleteUser,
  countActiveAdmins,
  audit,
  listAuditLog,
};