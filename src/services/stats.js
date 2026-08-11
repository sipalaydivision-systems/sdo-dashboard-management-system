'use strict';

const { SYSTEMS, isConfigured, STATS_CACHE_TTL_MS, QUERY_TIMEOUT_MS } = require('../config');
const { COLLECTORS } = require('./collectors');

const cache = new Map();

async function collectSystem(system, { force = false } = {}) {
  const base = {
    key: system.key,
    name: system.name,
    fullName: system.fullName,
    accent: system.accent,
    url: system.url || null,
    driver: system.driver,
  };

  if (!isConfigured(system)) {
    return {
      ...base,
      status: 'unconfigured',
      message:
        system.driver === 'http'
          ? `Set ${system.key.toUpperCase()}_STATS_URL to enable this panel.`
          : `Set ${system.key.toUpperCase()}_DATABASE_URL to enable this panel.`,
      headline: [],
      breakdowns: [],
    };
  }

  const cached = cache.get(system.key);
  if (!force && cached && Date.now() - cached.at < STATS_CACHE_TTL_MS) {
    return { ...cached.payload, cached: true };
  }

  const startedAt = Date.now();
  try {
    const collector = COLLECTORS[system.key];
    if (!collector) throw new Error(`No collector registered for "${system.key}"`);

    const data = await withTimeout(collector(system), QUERY_TIMEOUT_MS, system.name);

    const payload = {
      ...base,
      status: 'ok',
      latencyMs: Date.now() - startedAt,
      fetchedAt: new Date().toISOString(),
      headline: data.headline || [],
      breakdowns: data.breakdowns || [],
    };
    cache.set(system.key, { at: Date.now(), payload });
    return payload;
  } catch (err) {
    console.error(`[stats:${system.key}] ${err.message}`);
    return {
      ...base,
      status: 'error',
      latencyMs: Date.now() - startedAt,
      fetchedAt: new Date().toISOString(),
      message: sanitize(err.message),
      headline: [],
      breakdowns: [],
    };
  }
}

async function collectAll(user, { force = false } = {}) {
  const visible = SYSTEMS.filter((s) => canView(user, s.key));
  const results = await Promise.allSettled(
    visible.map((s) => collectSystem(s, { force }))
  );
  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          key: visible[i].key,
          name: visible[i].name,
          status: 'error',
          message: sanitize(r.reason?.message || 'Unknown error'),
          headline: [],
          breakdowns: [],
        }
  );
}

function canView(user, systemKey) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  const allowed = user.allowed_systems || [];
  return allowed.length === 0 || allowed.includes(systemKey);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function sanitize(message) {
  return String(message)
    .replace(/(postgres(ql)?|mysql|https?):\\/\\/[^\\s"']+/gi, '[redacted-connection]')
    .replace(/password=[^\\s&"']+/gi, 'password=[redacted]')
    .slice(0, 300);
}

function invalidate() {
  cache.clear();
}

module.exports = { collectSystem, collectAll, canView, invalidate };