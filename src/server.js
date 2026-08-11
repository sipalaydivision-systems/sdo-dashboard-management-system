'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const config = require('./config');
const db = require('./db/dashboard');
const pools = require('./db/pools');
const apiRoutes = require('./routes/api');
const { loadUser, requireAuth } = require('./middleware/auth');
const { withVersionedAssets } = require('./assets');

const app = express();
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    hsts: config.IS_PROD ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.use(
  session({
    store: new PgSession({ pool: db.getPool(), tableName: 'session' }),
    name: 'sdo_dashboard_sid',
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: config.IS_PROD,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
);

app.use(loadUser);

app.get('/healthz', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.use('/api', apiRoutes);

function sendPage(res, file) {
  res.set('Cache-Control', 'no-cache');
  res.type('html');
  try {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    res.send(withVersionedAssets(html));
  } catch (err) {
    console.error(`[pages] failed to send ${file}: ${err.message}`);
    res.status(500).type('text/plain').send('Page unavailable');
  }
}

app.get('/login', (req, res) => {
  if (req.user && !req.user.must_change_password) return res.redirect('/');
  sendPage(res, 'login.html');
});

app.get('/change-password', (req, res) => {
  if (!req.user) return res.redirect('/login');
  sendPage(res, 'change-password.html');
});

app.get('/demographics', requireAuth, (_req, res) => {
  sendPage(res, 'demographics.html');
});

app.get('/users', requireAuth, (req, res) => {
  if (req.user.role !== 'ADMIN') return res.redirect('/');
  sendPage(res, 'users.html');
});

app.get('/', requireAuth, (_req, res) => {
  sendPage(res, 'index.html');
});

app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    etag: true,
    lastModified: true,
    setHeaders(res, filePath, _stat) {
      if (/\.(html|js|css)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    },
  })
);

app.use((req, res) => {
  if (req.accepts('html') && !req.path.startsWith('/api/')) {
    return sendPage(res.status(404), '404.html');
  }
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
});

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
});

async function start() {
  if (!config.SESSION_SECRET) {
    console.error('FATAL: SESSION_SECRET is not set. Refusing to start.');
    process.exit(1);
  }
  if (!config.DASHBOARD_DATABASE_URL) {
    console.error('FATAL: DASHBOARD_DATABASE_URL is not set. Refusing to start.');
    process.exit(1);
  }

  await db.init();

  const configured = config.SYSTEMS.filter(config.isConfigured).map((s) => s.name);
  const missing = config.SYSTEMS.filter((s) => !config.isConfigured(s)).map((s) => s.name);
  console.log(`[boot] Monitoring: ${configured.join(', ') || 'none'}`);
  if (missing.length) console.log(`[boot] Not configured: ${missing.join(', ')}`);

  const server = app.listen(config.PORT, () => {
    console.log(`[boot] Dashboard listening on port ${config.PORT}`);
  });

  const shutdown = async (signal) => {
    console.log(`[shutdown] ${signal} received, closing connections`);
    server.close(async () => {
      await pools.closeAll();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('FATAL: failed to start', err);
  process.exit(1);
});

module.exports = app;