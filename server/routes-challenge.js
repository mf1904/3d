/* layout3d server — rute mode design challenge
 *
 * Dipisah dari server.js karena bagian ini punya model akses sendiri: bukan
 * "login atau tidak", melainkan tiga tingkat — publik (lihat galeri), pemegang
 * token undangan (boleh mengirim), pemegang token sunting (boleh mengubah
 * karyanya sendiri) — di atas admin yang memakai sesi password yang sudah ada.
 *
 * Laporan constraint SELALU dihitung ulang di sini. Klien juga menghitungnya
 * supaya peserta dapat umpan balik seketika, tapi angka yang disimpan dan
 * ditampilkan di galeri tidak boleh berasal dari kiriman klien — kalau tidak,
 * peserta cukup menyunting request-nya untuk terlihat patuh.
 */
'use strict';

const auth = require('./auth');
const ch = require('./challenges');
const geom = require('./geom');

const isAdmin = (req) => auth.validSession(auth.readCookie(req, auth.COOKIE));

/** kirim error yang sudah membawa status, sisanya jadi 500 */
function fail(res, e) {
  const status = e && e.status ? e.status : 500;
  if (status === 500) console.error('[layout3d]', e);
  res.status(status).json({ error: (e && e.message) || 'Kesalahan server.' });
}

module.exports = function mount(app) {
  /* ---------------------------------------------------------- daftar ---- */

  app.get('/api/challenges', (req, res) => {
    res.json({ ok: true, admin: isAdmin(req), challenges: ch.listChallenges() });
  });

  app.get('/api/challenges/:slug', (req, res) => {
    const c = ch.getChallenge(req.params.slug);
    if (!c) return res.status(404).json({ error: 'Challenge tidak ditemukan.' });
    res.json({
      ok: true,
      admin: isAdmin(req),
      challenge: ch.publicChallenge(c),
      template: c.template
    });
  });

  /* ----------------------------------------------------------- admin ---- */

  app.post('/api/challenges', auth.requireAuth, (req, res) => {
    try {
      const r = ch.createChallenge(req.body || {});
      res.json({ ok: true, challenge: r.challenge, inviteToken: r.inviteToken });
    } catch (e) { fail(res, e); }
  });

  app.patch('/api/challenges/:slug', auth.requireAuth, (req, res) => {
    try {
      res.json({ ok: true, challenge: ch.updateChallenge(req.params.slug, req.body || {}) });
    } catch (e) { fail(res, e); }
  });

  app.delete('/api/challenges/:slug', auth.requireAuth, (req, res) => {
    if (!ch.deleteChallenge(req.params.slug)) {
      return res.status(404).json({ error: 'Challenge tidak ditemukan.' });
    }
    res.json({ ok: true });
  });

  /* Menerbitkan tautan undangan baru mematikan yang lama — itu memang
   * gunanya (undangan tersebar ke orang yang tidak diinginkan), jadi
   * jangan dibuat mudah terpencet: harus POST, bukan GET. */
  app.post('/api/challenges/:slug/invite', auth.requireAuth, (req, res) => {
    try {
      res.json({ ok: true, inviteToken: ch.rotateInvite(req.params.slug) });
    } catch (e) { fail(res, e); }
  });

  /* ------------------------------------------------------ submission ---- */

  app.get('/api/challenges/:slug/submissions', (req, res) => {
    if (!ch.getChallenge(req.params.slug)) {
      return res.status(404).json({ error: 'Challenge tidak ditemukan.' });
    }
    res.json({ ok: true, submissions: ch.listSubmissions(req.params.slug) });
  });

  app.get('/api/challenges/:slug/submissions/:sid', (req, res) => {
    const row = ch.getSubmission(req.params.slug, req.params.sid);
    if (!row) return res.status(404).json({ error: 'Submission tidak ditemukan.' });
    res.json({ ok: true, submission: ch.publicSubmission(row.meta), data: row.data });
  });

  app.post('/api/challenges/:slug/submissions', (req, res) => {
    const body = req.body || {};
    const c = ch.getChallenge(req.params.slug);
    if (!c) return res.status(404).json({ error: 'Challenge tidak ditemukan.' });

    try {
      const report = geom.evaluate(body.data, c.constraints);
      const r = ch.addSubmission(req.params.slug, {
        author: body.author,
        note: body.note,
        data: body.data,
        invite: body.invite,
        report
      });
      res.json({ ok: true, submission: r.submission, editToken: r.editToken, report });
    } catch (e) { fail(res, e); }
  });

  app.put('/api/challenges/:slug/submissions/:sid', (req, res) => {
    const body = req.body || {};
    const c = ch.getChallenge(req.params.slug);
    if (!c) return res.status(404).json({ error: 'Challenge tidak ditemukan.' });

    try {
      const report = body.data ? geom.evaluate(body.data, c.constraints) : null;
      const m = ch.updateSubmission(req.params.slug, req.params.sid, {
        data: body.data,
        note: body.note,
        author: body.author,
        edit: body.edit,
        report,
        isAdmin: isAdmin(req)
      });
      res.json({ ok: true, submission: m, report });
    } catch (e) { fail(res, e); }
  });

  app.post('/api/challenges/:slug/submissions/:sid/reset', auth.requireAuth, (req, res) => {
    try {
      res.json({ ok: true, editToken: ch.rotateEdit(req.params.slug, req.params.sid) });
    } catch (e) { fail(res, e); }
  });

  app.delete('/api/challenges/:slug/submissions/:sid', auth.requireAuth, (req, res) => {
    if (!ch.deleteSubmission(req.params.slug, req.params.sid)) {
      return res.status(404).json({ error: 'Submission tidak ditemukan.' });
    }
    res.json({ ok: true });
  });

  /* --------------------------------------------------------- periksa ---- */

  /* Cek constraint tanpa menyimpan apa pun. Dipakai editor untuk menunjukkan
   * status "patuh / melanggar" sebelum peserta menekan Kirim. */
  app.post('/api/challenges/:slug/check', (req, res) => {
    const c = ch.getChallenge(req.params.slug);
    if (!c) return res.status(404).json({ error: 'Challenge tidak ditemukan.' });
    const body = req.body || {};
    if (!body.data || !Array.isArray(body.data.shapes)) {
      return res.status(400).json({ error: 'Isi project tidak valid.' });
    }
    res.json({ ok: true, report: geom.evaluate(body.data, c.constraints) });
  });
};
