/* layout3d server — Express: menyajikan aplikasi + API save/load
 *
 * Satu proses menangani dua hal sekaligus (file statis + API) supaya frontend
 * dan backend berbagi origin yang sama. Dengan begitu tidak perlu CORS, cookie
 * sesi jalan apa adanya, dan frontend tetap bisa memakai path API relatif —
 * yang menjaga sifat portabelnya (root domain maupun sub-folder).
 *
 * File statis TIDAK disajikan dari root folder project, melainkan hanya
 * direktori yang disebut satu per satu. Kalau tidak, folder server/ (berisi
 * database) ikut terekspos.
 */
'use strict';

const path = require('path');
const express = require('express');

const store = require('./db');
const auth = require('./auth');

const PORT = Number(process.env.PORT || 8130);
const HOST = process.env.HOST || '127.0.0.1';
const APP_DIR = process.env.LAYOUT3D_PUBLIC || path.join(__dirname, '..');
const MAX_BODY = process.env.LAYOUT3D_MAX_BODY || '12mb';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);          // di belakang Caddy/nginx
app.use(express.json({ limit: MAX_BODY }));

/* ----------------------------------------------------------- statis ----- */

const STATIC_OPTS = { maxAge: '1h', index: false, dotfiles: 'ignore' };
for (const dir of ['css', 'js', 'vendor']) {
  app.use('/' + dir, express.static(path.join(APP_DIR, dir), STATIC_OPTS));
}
app.get('/', (req, res) => res.sendFile(path.join(APP_DIR, 'index.html')));

/* -------------------------------------------------------------- auth ---- */

app.get('/api/me', (req, res) => {
  res.json({
    ok: true,
    configured: auth.isConfigured(),
    authed: auth.validSession(auth.readCookie(req, auth.COOKIE))
  });
});

app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';

  if (!auth.isConfigured()) {
    return res.status(503).json({ error: 'Password server belum diset. Jalankan: npm run set-password' });
  }
  if (auth.tooManyAttempts(ip)) {
    return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' });
  }

  const password = (req.body && req.body.password) || '';
  if (!auth.verifyPassword(password, store.getMeta('password'))) {
    auth.noteFailure(ip);
    return res.status(401).json({ error: 'Password salah.' });
  }

  auth.clearAttempts(ip);
  auth.setCookie(req, res, auth.createSession());
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  auth.destroySession(auth.readCookie(req, auth.COOKIE));
  auth.clearCookie(res);
  res.json({ ok: true });
});

/* ---------------------------------------------------------- projects ---- */

app.get('/api/projects', auth.requireAuth, (req, res) => {
  res.json({ ok: true, projects: store.listProjects() });
});

app.get('/api/projects/:id', auth.requireAuth, (req, res) => {
  const row = store.getProject(req.params.id);
  if (!row) return res.status(404).json({ error: 'Project tidak ditemukan.' });
  res.json({ ok: true, project: { id: row.id, name: row.name, updated: row.updated, data: row.data } });
});

app.post('/api/projects', auth.requireAuth, (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();

  if (!name) return res.status(400).json({ error: 'Nama project wajib diisi.' });
  if (name.length > 120) return res.status(400).json({ error: 'Nama project terlalu panjang.' });
  if (!body.data || typeof body.data !== 'object' || !Array.isArray(body.data.shapes)) {
    return res.status(400).json({ error: 'Isi project tidak valid (tidak ada array "shapes").' });
  }

  try {
    const m = store.saveProject({ id: body.id, name, data: body.data });
    res.json({ ok: true, project: { id: m.id, name: m.name, updated: m.updated } });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Gagal menyimpan.' });
  }
});

app.delete('/api/projects/:id', auth.requireAuth, (req, res) => {
  if (!store.deleteProject(req.params.id)) {
    return res.status(404).json({ error: 'Project tidak ditemukan.' });
  }
  res.json({ ok: true });
});

/* ------------------------------------------------------------ fallback -- */

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak dikenal.' }));

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Project terlalu besar untuk dikirim.' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON tidak valid.' });
  }
  console.error('[layout3d]', err);
  res.status(500).json({ error: 'Kesalahan server.' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[layout3d] jalan di http://${HOST}:${PORT}`);
  console.log(`[layout3d] menyajikan aplikasi dari ${APP_DIR}`);
  if (!auth.isConfigured()) {
    console.warn('[layout3d] PASSWORD BELUM DISET — jalankan: npm run set-password');
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}

module.exports = app;
