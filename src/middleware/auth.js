'use strict';

const db = require('../db/dashboard');

async function loadUser(req, _res, next) {
  if (!req.session?.userId) return next();
  try {
    const user = await db.findById(req.session.userId);
    if (user && user.is_active) {
      req.user = user;
    } else {
      req.session.destroy(() => {});
    }
  } catch (err) {
    console.error(`[auth] failed to load user: ${err.message}`);
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    if (wantsHtml(req)) return res.redirect('/login');
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } });
  }
  if (req.user.must_change_password && !isPasswordChangePath(req)) {
    if (wantsHtml(req)) return res.redirect('/change-password');
    return res.status(403).json({
      error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'You must change your password first' },
    });
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } });
  }
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Administrator access required' } });
  }
  return next();
}

function wantsHtml(req) {
  if (fullPath(req).startsWith('/api/')) return false;
  return Boolean(req.accepts('html'));
}

function isPasswordChangePath(req) {
  const path = fullPath(req);
  return (
    path === '/change-password' ||
    path === '/api/me/password' ||
    path === '/api/auth/logout'
  );
}

function fullPath(req) {
  return String(req.originalUrl || req.url || '').split('?')[0];
}

module.exports = { loadUser, requireAuth, requireAdmin };