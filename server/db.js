/* layout3d server — penyimpanan berbasis file JSON
 *
 * Kenapa bukan SQLite (yang tertulis di rencana awal): satu-satunya paket
 * SQLite yang layak untuk Node butuh modul native. Saat diuji, `npm install`
 * gagal karena tidak ada prebuild untuk versi Node yang dipakai, lalu jatuh ke
 * kompilasi C++ — yang berarti VPS wajib punya toolchain build. Itu jadi satu-
 * satunya titik rapuh di proyek yang selebihnya tanpa build step sama sekali.
 *
 * Yang sebenarnya dibutuhkan cuma: simpan blob JSON, ambil per id, daftar, dan
 * hapus — untuk satu pengguna. File biasa memenuhi itu tanpa dependensi apa
 * pun, datanya bisa dibaca mata telanjang, dan backup cukup menyalin folder.
 *
 * Tulis selalu lewat file sementara lalu rename: rename bersifat atomik, jadi
 * mati listrik di tengah penyimpanan tidak meninggalkan file separuh jadi.
 *
 * Metadata dipisah dari isi project supaya menampilkan daftar tidak perlu
 * membaca seluruh isi tiap project.
 *
 *   data/
 *     meta.json                  <- hash password
 *     sessions.json
 *     projects/<id>.meta.json    <- {id,name,created,updated,size}
 *     projects/<id>.data.json    <- blob project
 */
'use strict';

const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.LAYOUT3D_DATA || path.join(__dirname, 'data');
const PROJ_DIR = path.join(DATA_DIR, 'projects');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const SESS_FILE = path.join(DATA_DIR, 'sessions.json');

fs.mkdirSync(PROJ_DIR, { recursive: true });

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

/** tulis atomik: file sementara -> rename */
function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
  fs.renameSync(tmp, file);
}

const safeId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(String(id || ''));
const metaPath = (id) => path.join(PROJ_DIR, id + '.meta.json');
const dataPath = (id) => path.join(PROJ_DIR, id + '.data.json');

function newId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ------------------------------------------------------------- meta ----- */

/* Sengaja TIDAK di-cache di memori: `npm run set-password` jalan di proses
 * terpisah dari server. Kalau nilainya disimpan di memori, server yang sedang
 * jalan (mis. di bawah PM2) tidak akan pernah melihat password baru sampai
 * di-restart. File-nya kecil dan hanya dibaca saat login/probe. */
function getMeta(k) {
  const m = readJson(META_FILE, {});
  return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null;
}

function setMeta(k, v) {
  const m = readJson(META_FILE, {});   // baca-ubah-tulis, jangan timpa kunci lain
  m[k] = v;
  writeJson(META_FILE, m);
}

/* --------------------------------------------------------- projects ----- */

function listProjects() {
  let names;
  try { names = fs.readdirSync(PROJ_DIR); } catch (e) { return []; }
  const out = [];
  for (const f of names) {
    if (!f.endsWith('.meta.json')) continue;
    const m = readJson(path.join(PROJ_DIR, f), null);
    if (m && m.id) out.push(m);
  }
  out.sort((a, b) => b.updated - a.updated);
  return out;
}

function getProject(id) {
  if (!safeId(id)) return null;
  const m = readJson(metaPath(id), null);
  if (!m) return null;
  const data = readJson(dataPath(id), null);
  if (data === null) return null;
  return { id: m.id, name: m.name, created: m.created, updated: m.updated, data };
}

function findByName(name) {
  return listProjects().find((m) => m.name === name) || null;
}

/**
 * Simpan project. Nama bersifat unik: menyimpan dengan nama yang sudah ada
 * akan menimpa project itu — mencerminkan arti tombol "Simpan" di frontend,
 * di mana nama adalah identitas project bagi user.
 */
function saveProject({ id, name, data }) {
  const now = Date.now();
  const json = JSON.stringify(data);

  const byName = findByName(name);
  const current = (id && safeId(id)) ? readJson(metaPath(id), null) : null;

  let targetId;
  let created = now;

  if (current) {
    if (byName && byName.id !== current.id) {
      const err = new Error('Nama project sudah dipakai.');
      err.status = 409;
      throw err;
    }
    targetId = current.id;
    created = current.created;
  } else if (byName) {
    targetId = byName.id;
    created = byName.created;
  } else {
    targetId = (id && safeId(id)) ? id : newId();
  }

  const m = { id: targetId, name, created, updated: now, size: Buffer.byteLength(json) };
  // isi dulu, baru metadata: kalau mati di tengah, metadata lama masih cocok
  // dengan data lama dan tidak ada entri yang menunjuk ke file yang belum ada
  fs.writeFileSync(dataPath(targetId) + '.tmp', json, 'utf8');
  fs.renameSync(dataPath(targetId) + '.tmp', dataPath(targetId));
  writeJson(metaPath(targetId), m);
  return m;
}

function deleteProject(id) {
  if (!safeId(id)) return false;
  let removed = false;
  for (const f of [metaPath(id), dataPath(id)]) {
    try { fs.unlinkSync(f); removed = true; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return removed;
}

/* --------------------------------------------------------- sessions ----- */

let sessions = readJson(SESS_FILE, {});
const flushSessions = () => writeJson(SESS_FILE, sessions);

function sessionPrune() {
  const now = Date.now();
  let changed = false;
  for (const k of Object.keys(sessions)) {
    if (sessions[k].expires < now) { delete sessions[k]; changed = true; }
  }
  if (changed) flushSessions();
}

function sessionAdd(hash, created, expires) {
  sessions[hash] = { created, expires };
  flushSessions();
}

const sessionGet = (hash) =>
  sessions[hash] ? { token_hash: hash, ...sessions[hash] } : undefined;

function sessionDelete(hash) {
  if (sessions[hash]) { delete sessions[hash]; flushSessions(); }
}

module.exports = {
  DATA_DIR,
  getMeta, setMeta,
  listProjects, getProject, saveProject, deleteProject,
  sessionAdd, sessionGet, sessionDelete, sessionPrune
};
