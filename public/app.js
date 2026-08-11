'use strict';

const el = {
  grid: document.getElementById('grid'),
  meta: document.getElementById('meta'),
  logout: document.getElementById('logoutBtn'),
  whoName: document.getElementById('whoName'),
  whoRole: document.getElementById('whoRole'),
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('unauthenticated');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Request failed (${res.status})`);
  return body.data;
}

async function loadMe() {
  const me = await api('/api/me');
  el.whoName.textContent = me.name;
  el.whoRole.textContent = me.role === 'ADMIN' ? 'Administrator' : 'Viewer';
}

async function loadStats() {
  try {
    const data = await api('/api/stats');
    el.grid.replaceChildren();
    data.systems.forEach((sys) => {
      const card = document.createElement('article');
      card.className = 'card';
      card.innerHTML = `<h2>${sys.name}</h2><p>${sys.status}</p>`;
      el.grid.append(card);
    });
    el.meta.textContent = `${data.systems.filter((s) => s.status === 'ok').length}/${data.systems.length} systems online`;
  } catch (err) {
    el.meta.textContent = `Error: ${err.message}`;
  }
}

el.logout.addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.href = '/login';
  }
});

loadMe().then(loadStats).catch(() => {});