/* layout3d server — penyimpanan challenge & submission
 *
 * Model aksesnya sengaja TANPA akun.
 *
 * Backend ini dibangun untuk satu orang dengan satu password (admin). Mode
 * challenge butuh banyak peserta yang masing-masing hanya boleh menyunting
 * karyanya sendiri — kalau dijawab dengan tabel user, ikut terseret
 * registrasi, verifikasi email, lupa password, dan moderasi. Itu proyek
 * tersendiri, bukan tempelan.
 *
 * Yang dipakai di sini: kapabilitas berbentuk tautan.
 *   - admin      : sesi password yang sudah ada — bikin/tutup challenge
 *   - peserta    : tautan undangan berisi token challenge -> boleh mengirim
 *   - penyunting : tiap submission dapat token sendiri -> hanya pemegang
 *                  tautan itu yang bisa mengubahnya
 *   - publik     : galeri bisa dilihat siapa saja tanpa token
 *
 * Token disimpan sebagai hash SHA-256, bukan apa adanya. Token 128-bit acak
 * tidak perlu KDF lambat (tidak bisa ditebak), tapi menyimpan hash berarti
 * salinan backup atau log yang bocor tidak langsung memberi hak sunting.
 * Konsekuensinya token tidak bisa ditampilkan ulang — peserta yang kehilangan
 * tautannya minta admin menerbitkan yang baru.
 *
 *   data/
 *     challenges/<slug>.json                 <- brief, constraint, template
 *     submissions/<slug>/<sid>.meta.json     <- {id,slug,author,created,updated,report}
 *     submissions/<slug>/<sid>.data.json     <- project JSON peserta
 */
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const store = require('./db');

const CH_DIR = path.join(store.DATA_DIR, 'challenges');
const SUB_DIR = path.join(store.DATA_DIR, 'submissions');

fs.mkdirSync(CH_DIR, { recursive: true });
fs.mkdirSync(SUB_DIR, { recursive: true });

/* ------------------------------------------------------------- util ----- */

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn('[layout3d] gagal membaca ' + path.basename(file) + ':', e.message);
    }
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
  fs.renameSync(tmp, file);
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;
const SID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const okSlug = (s) => SLUG_RE.test(String(s || ''));
const okSid = (s) => SID_RE.test(String(s || ''));

const chPath = (slug) => path.join(CH_DIR, slug + '.json');
const subDir = (slug) => path.join(SUB_DIR, slug);
const subMeta = (slug, sid) => path.join(subDir(slug), sid + '.meta.json');
const subData = (slug, sid) => path.join(subDir(slug), sid + '.data.json');

const newToken = () => crypto.randomBytes(16).toString('hex');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

/** perbandingan waktu-tetap: token salah tidak boleh bocor lewat lama respons */
function sameToken(raw, hash) {
  if (!raw || !hash) return false;
  const a = Buffer.from(hashToken(raw), 'hex');
  const b = Buffer.from(String(hash), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize("NFKD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

const err = (status, message) => Object.assign(new Error(message), { status });

/* -------------------------------------------------------- challenge ----- */

/** bentuk yang aman dipublikasikan: tanpa hash token apa pun */
function publicChallenge(c) {
  if (!c) return null;
  return {
    slug: c.slug,
    title: c.title,
    brief: c.brief,
    constraints: c.constraints,
    open: !!c.open,
    created: c.created,
    updated: c.updated,
    deadline: c.deadline || null,
    submissions: countSubmissions(c.slug)
  };
}

function listChallenges() {
  let names;
  try { names = fs.readdirSync(CH_DIR); } catch (e) { return []; }
  const out = [];
  for (const f of names) {
    if (!f.endsWith('.json') || f.endsWith('.tmp')) continue;
    const c = readJson(path.join(CH_DIR, f), null);
    if (c && c.slug) out.push(publicChallenge(c));
  }
  out.sort((a, b) => b.created - a.created);
  return out;
}

function getChallenge(slug) {
  if (!okSlug(slug)) return null;
  return readJson(chPath(slug), null);
}

function createChallenge({ slug, title, brief, constraints, template, deadline }) {
  title = String(title || '').trim();
  if (!title) throw err(400, 'Judul challenge wajib diisi.');
  if (title.length > 120) throw err(400, 'Judul terlalu panjang.');

  const s = okSlug(slug) ? slug : slugify(slug || title);
  if (!okSlug(s)) throw err(400, 'Slug tidak valid (huruf kecil, angka, tanda hubung).');
  if (fs.existsSync(chPath(s))) throw err(409, 'Slug "' + s + '" sudah dipakai.');

  if (!template || typeof template !== 'object' || !Array.isArray(template.shapes)) {
    throw err(400, 'Template tidak valid (tidak ada array "shapes").');
  }

  const invite = newToken();
  const now = Date.now();
  const c = {
    slug: s,
    title,
    brief: String(brief || '').slice(0, 4000),
    constraints: cleanConstraints(constraints),
    template,
    deadline: deadline ? Number(deadline) : null,
    open: true,
    inviteHash: hashToken(invite),
    created: now,
    updated: now
  };
  writeJson(chPath(s), c);
  fs.mkdirSync(subDir(s), { recursive: true });
  return { challenge: publicChallenge(c), inviteToken: invite };
}

function cleanConstraints(c) {
  c = c || {};
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    maxKdb: Math.min(100, num(c.maxKdb)),
    maxHeight: num(c.maxHeight),
    maxObjects: Math.round(num(c.maxObjects))
  };
}

function updateChallenge(slug, patch) {
  const c = getChallenge(slug);
  if (!c) throw err(404, 'Challenge tidak ditemukan.');

  if (typeof patch.title === 'string' && patch.title.trim()) c.title = patch.title.trim().slice(0, 120);
  if (typeof patch.brief === 'string') c.brief = patch.brief.slice(0, 4000);
  if (patch.constraints) c.constraints = cleanConstraints(patch.constraints);
  if (typeof patch.open === 'boolean') c.open = patch.open;
  if ('deadline' in patch) c.deadline = patch.deadline ? Number(patch.deadline) : null;
  if (patch.template && Array.isArray(patch.template.shapes)) c.template = patch.template;

  c.updated = Date.now();
  writeJson(chPath(slug), c);
  return publicChallenge(c);
}

/** terbitkan tautan undangan baru — yang lama langsung mati */
function rotateInvite(slug) {
  const c = getChallenge(slug);
  if (!c) throw err(404, 'Challenge tidak ditemukan.');
  const t = newToken();
  c.inviteHash = hashToken(t);
  c.updated = Date.now();
  writeJson(chPath(slug), c);
  return t;
}

function deleteChallenge(slug) {
  if (!okSlug(slug)) return false;
  let removed = false;
  try { fs.unlinkSync(chPath(slug)); removed = true; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  try { fs.rmSync(subDir(slug), { recursive: true, force: true }); }
  catch (e) { /* submission ikut hilang bersama challenge-nya */ }
  return removed;
}

/* ------------------------------------------------------- submission ----- */

function countSubmissions(slug) {
  try {
    return fs.readdirSync(subDir(slug)).filter((f) => f.endsWith('.meta.json')).length;
  } catch (e) {
    return 0;
  }
}

function publicSubmission(m) {
  return {
    id: m.id,
    slug: m.slug,
    author: m.author,
    note: m.note || '',
    created: m.created,
    updated: m.updated,
    report: m.report || null
  };
}

function listSubmissions(slug) {
  let names;
  try { names = fs.readdirSync(subDir(slug)); } catch (e) { return []; }
  const out = [];
  for (const f of names) {
    if (!f.endsWith('.meta.json')) continue;
    const m = readJson(path.join(subDir(slug), f), null);
    if (m && m.id) out.push(publicSubmission(m));
  }
  out.sort((a, b) => b.updated - a.updated);
  return out;
}

function getSubmission(slug, sid) {
  if (!okSlug(slug) || !okSid(sid)) return null;
  const m = readJson(subMeta(slug, sid), null);
  if (!m) return null;
  const data = readJson(subData(slug, sid), null);
  if (data === null) return null;
  return { meta: m, data };
}

const newSid = () => 's' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

/**
 * Kirim submission baru. Butuh token undangan challenge — galeri boleh dilihat
 * siapa saja, tapi mengisinya tidak.
 */
function addSubmission(slug, { author, note, data, invite, report }) {
  const c = getChallenge(slug);
  if (!c) throw err(404, 'Challenge tidak ditemukan.');
  if (!c.open) throw err(403, 'Challenge ini sudah ditutup.');
  if (c.deadline && Date.now() > c.deadline) throw err(403, 'Batas waktu pengiriman sudah lewat.');
  if (!sameToken(invite, c.inviteHash)) throw err(403, 'Tautan undangan tidak berlaku.');

  author = String(author || '').trim();
  if (!author) throw err(400, 'Nama peserta wajib diisi.');
  if (author.length > 80) throw err(400, 'Nama peserta terlalu panjang.');
  if (!data || typeof data !== 'object' || !Array.isArray(data.shapes)) {
    throw err(400, 'Isi submission tidak valid.');
  }

  const sid = newSid();
  const edit = newToken();
  const now = Date.now();
  const m = {
    id: sid, slug, author,
    note: String(note || '').slice(0, 500),
    created: now, updated: now,
    editHash: hashToken(edit),
    report: report || null
  };

  fs.mkdirSync(subDir(slug), { recursive: true });
  writeJson(subData(slug, sid), data);
  writeJson(subMeta(slug, sid), m);
  return { submission: publicSubmission(m), editToken: edit };
}

/** ubah submission — hanya pemegang token sunting, atau admin */
function updateSubmission(slug, sid, { data, note, author, edit, report, isAdmin }) {
  const row = getSubmission(slug, sid);
  if (!row) throw err(404, 'Submission tidak ditemukan.');

  if (!isAdmin) {
    const c = getChallenge(slug);
    if (!c || !c.open) throw err(403, 'Challenge ini sudah ditutup.');
    if (c.deadline && Date.now() > c.deadline) throw err(403, 'Batas waktu pengiriman sudah lewat.');
    if (!sameToken(edit, row.meta.editHash)) throw err(403, 'Tautan sunting tidak berlaku.');
  }

  const m = row.meta;
  if (typeof note === 'string') m.note = note.slice(0, 500);
  if (typeof author === 'string' && author.trim()) m.author = author.trim().slice(0, 80);

  if (data) {
    if (typeof data !== 'object' || !Array.isArray(data.shapes)) {
      throw err(400, 'Isi submission tidak valid.');
    }
    writeJson(subData(slug, sid), data);
    if (report) m.report = report;
  }

  m.updated = Date.now();
  writeJson(subMeta(slug, sid), m);
  return publicSubmission(m);
}

/** terbitkan tautan sunting baru untuk peserta yang kehilangan tautannya */
function rotateEdit(slug, sid) {
  const row = getSubmission(slug, sid);
  if (!row) throw err(404, 'Submission tidak ditemukan.');
  const t = newToken();
  row.meta.editHash = hashToken(t);
  writeJson(subMeta(slug, sid), row.meta);
  return t;
}

function deleteSubmission(slug, sid) {
  if (!okSlug(slug) || !okSid(sid)) return false;
  let removed = false;
  for (const f of [subMeta(slug, sid), subData(slug, sid)]) {
    try { fs.unlinkSync(f); removed = true; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return removed;
}

module.exports = {
  slugify, publicChallenge, publicSubmission,
  listChallenges, getChallenge, createChallenge, updateChallenge,
  rotateInvite, deleteChallenge,
  listSubmissions, getSubmission, addSubmission, updateSubmission,
  rotateEdit, deleteSubmission, countSubmissions
};
