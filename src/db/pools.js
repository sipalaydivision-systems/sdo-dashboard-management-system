'use strict';

const { Pool } = require('pg');
const mysql = require('mysql2/promise');
const { QUERY_TIMEOUT_MS } = require('../config');

const pgPools = new Map();
const mysqlPools = new Map();

function getPostgresPool(system) {
  const cached = pgPools.get(system.key);
  if (cached) return cached;

  const pool = new Pool({
    connectionString: system.connectionString,
    ssl: needsSsl(system.connectionString) ? { rejectUnauthorized: false } : undefined,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: QUERY_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
    options: '-c default_transaction_read_only=on',
    application_name: 'sdo-dashboard-readonly',
  });

  pool.on('error', (err) => {
    console.error(`[pool:${system.key}] idle client error: ${err.message}`);
  });

  pgPools.set(system.key, pool);
  return pool;
}

function getMysqlPool(system) {
  const cached = mysqlPools.get(system.key);
  if (cached) return cached;

  const pool = mysql.createPool({
    uri: system.connectionString,
    connectionLimit: 1,
    connectTimeout: QUERY_TIMEOUT_MS,
    waitForConnections: true,
    maxIdle: 1,
    idleTimeout: 300_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    ssl: needsSsl(system.connectionString) ? { rejectUnauthorized: false } : undefined,
  });

  mysqlPools.set(system.key, pool);
  return pool;
}

async function query(system, sql, params = []) {
  if (system.driver === 'postgres') {
    const result = await getPostgresPool(system).query(sql, params);
    return result.rows;
  }

  if (system.driver === 'mysql') {
    const conn = await getMysqlPool(system).getConnection();
    try {
      await markReadOnly(conn);
      const [rows] = await conn.execute(sql, params);
      return Array.isArray(rows) ? rows : [];
    } finally {
      conn.release();
    }
  }

  throw new Error(`Driver "${system.driver}" does not support SQL queries`);
}

async function markReadOnly(conn) {
  if (conn.__readOnly) return;
  await conn.query('SET SESSION transaction_read_only = 1');
  Object.defineProperty(conn, '__readOnly', {
    value: true,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

function needsSsl(connectionString) {
  if (!connectionString) return false;
  if (/sslmode=disable/i.test(connectionString)) return false;
  return !/@(localhost|127\.0\.0\.1)[:/]/i.test(connectionString);
}

async function closeAll() {
  const closings = [
    ...[...pgPools.values()].map((p) => p.end().catch(() => {})),
    ...[...mysqlPools.values()].map((p) => p.end().catch(() => {})),
  ];
  await Promise.allSettled(closings);
  pgPools.clear();
  mysqlPools.clear();
}

module.exports = { query, closeAll };