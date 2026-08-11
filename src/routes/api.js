'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/dashboard');
const stats = require('../services/stats');
const { SYSTEMS } = require('../config');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } },
});

const MIN_PASSWORD_LENGTH = 10;

router.post('/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'Email and password are required' },
      });
    }

    const user = await db.verifyLogin(email, password);
    if (!user) {
      await db.audit(null, 'LOGIN_FAILED', `email=${String(email).slice(0, 120)}`);
      return res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password' },
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      db.audit(user, 'LOGIN_SUCCESS');
      res.json({
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          mustChangePassword: user.must_change_password,
        },
      });
    });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/logout', (req, res) => {
  const actor = req.user;
  req.session.destroy(() => {
    if (actor) db.audit(actor, 'LOGOUT');
    res.json({ data: { ok: true } });
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    data: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      allowedSystems: req.user.allowed_systems || [],
    },
  });
});

router.post('/me/password', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } });
    }
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'Current and new password are required' },
      });
    }
    if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: {
          code: 'WEAK_PASSWORD',
          message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        },
      });
    }

    const verified = await db.verifyLogin(req.user.email, currentPassword);
    if (!verified) {
      return res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' },
      });
    }

    await db.setPassword(req.user.id, newPassword, { mustChange: false });
    await db.audit(req.user, 'PASSWORD_CHANGED_SELF');
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const force = req.query.refresh === '1';
    const systems = await stats.collectAll(req.user, { force });
    res.json({ data: { systems, generatedAt: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

router.get('/stats/:key', requireAuth, async (req, res, next) => {
  try {
    const system = SYSTEMS.find((s) => s.key === req.params.key);
    if (!system) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown system' } });
    }
    if (!stats.canView(req.user, system.key)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access to this system' } });
    }
    const data = await stats.collectSystem(system, { force: req.query.refresh === '1' });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get('/users', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    res.json({ data: await db.listUsers() });
  } catch (err) {
    next(err);
  }
});

router.post('/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { email, name, password, role, allowedSystems } = req.body || {};
    if (!email || !name || !password) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'Email, name and password are required' },
      });
    }
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: {
          code: 'WEAK_PASSWORD',
          message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        },
      });
    }
    if (await db.findByEmail(email)) {
      return res.status(409).json({
        error: { code: 'EMAIL_TAKEN', message: 'An account with that email already exists' },
      });
    }

    const user = await db.createUser({
      email,
      name,
      password,
      role: role === 'ADMIN' ? 'ADMIN' : 'VIEWER',
      allowedSystems: sanitizeSystems(allowedSystems),
      mustChangePassword: true,
    });
    await db.audit(req.user, 'USER_CREATED', `email=${user.email} role=${user.role}`);
    res.status(201).json({ data: user });
  } catch (err) {
    next(err);
  }
});

router.get('/audit', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    res.json({ data: await db.listAuditLog(req.query.limit) });
  } catch (err) {
    next(err);
  }
});

function sanitizeSystems(list) {
  if (!Array.isArray(list)) return [];
  const valid = new Set(SYSTEMS.map((s) => s.key));
  return [...new Set(list.filter((k) => valid.has(k)))];
}

module.exports = router;