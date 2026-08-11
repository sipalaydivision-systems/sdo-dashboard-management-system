'use strict';

require('dotenv').config();

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

const STATS_CACHE_TTL_MS = Number(process.env.STATS_CACHE_TTL_MS || 60_000);
const QUERY_TIMEOUT_MS = Number(process.env.QUERY_TIMEOUT_MS || 8_000);

const DASHBOARD_DATABASE_URL = trimmed(process.env.DASHBOARD_DATABASE_URL);
const SESSION_SECRET = trimmed(process.env.SESSION_SECRET);

const SYSTEMS = [
  {
    key: 'cpes',
    name: 'CPES',
    fullName: 'Conceptualized Partnership Engagement System',
    driver: 'postgres',
    connectionString: trimmed(process.env.CPES_DATABASE_URL),
    url: trimmed(process.env.CPES_URL),
    accent: 'violet',
  },
  {
    key: 'dcpms',
    name: 'DCPMS',
    fullName: 'DCP Monitoring System',
    driver: 'http',
    statsUrl: trimmed(process.env.DCPMS_STATS_URL),
    statsToken: trimmed(process.env.DCPMS_STATS_TOKEN),
    url: trimmed(process.env.DCPMS_URL),
    accent: 'amber',
  },
  {
    key: 'sdo',
    name: 'SDO Website',
    fullName: 'Schools Division Office Website',
    driver: 'mysql',
    connectionString: trimmed(process.env.SDO_DATABASE_URL),
    url: trimmed(process.env.SDO_URL),
    accent: 'sky',
  },
  {
    key: 'srq',
    name: 'SRQ',
    fullName: 'Online Service Request Queueing System',
    driver: 'postgres',
    connectionString: trimmed(process.env.SRQ_DATABASE_URL),
    url: trimmed(process.env.SRQ_URL),
    accent: 'emerald',
  },
  {
    key: 'provident',
    name: 'Provident Loan',
    fullName: 'Provident Loan Application System',
    driver: 'mysql',
    connectionString: trimmed(process.env.PROVIDENT_DATABASE_URL),
    url: trimmed(process.env.PROVIDENT_URL),
    accent: 'cyan',
  },
  {
    key: 'leave',
    name: 'Leave App',
    fullName: 'Leave Form No. 6 System',
    driver: 'http',
    statsUrl: trimmed(process.env.LEAVE_STATS_URL),
    statsToken: trimmed(process.env.LEAVE_STATS_TOKEN),
    url: trimmed(process.env.LEAVE_URL),
    accent: 'rose',
  },
];

function isConfigured(system) {
  if (system.driver === 'http') return Boolean(system.statsUrl);
  return Boolean(system.connectionString);
}

function getSystem(key) {
  return SYSTEMS.find((s) => s.key === key) || null;
}

function trimmed(value) {
  return String(value || '').trim();
}

module.exports = {
  PORT,
  NODE_ENV,
  IS_PROD,
  STATS_CACHE_TTL_MS,
  QUERY_TIMEOUT_MS,
  DASHBOARD_DATABASE_URL,
  SESSION_SECRET,
  SYSTEMS,
  isConfigured,
  getSystem,
};