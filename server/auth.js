/* layout3d server — password tunggal + sesi berbasis cookie
 *
 * Password tidak pernah disimpan apa adanya: yang tersimpan hanya hash scrypt
 * beserta salt acaknya. Token sesi pun disimpan dalam bentuk hash, jadi isi
 * database saja tidak cukup untuk membajak sesi yang sedang aktif.
 */
'use strict';

const crypto = require('crypto');
const store = require('./db');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 30;
const COOKIE = 'l3d_session';

/* ------------------------------------------------------------ password -- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p,
          salt.toString('hex'), key.toString('hex')].join('$');
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, N, r, p, saltHex, keyHex] = parts;
  const expected = Buffer.from(keyHex, 'hex');
  let actual;
  try {
    actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length,
      { N: Number(N), r: Number(r), p: Number(p) });
  } catch (e) {
    return false;
  }
  // panjangnya selalu sama, tapi tetap dijaga supaya timingSafeEqual tidak lempar
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const isConfigured = () => !!store.getMeta('password');
const setPassword = (pw) => store.setMeta('password', hashPassword(pw));

/* ------------------------------------------------------------- sessions -- */

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  store.sessionPrune();
  store.sessionAdd(sha256(token), now, now + SESSION_DAYS * 864e5);
  return token;
}

function validSession(token) {
  if (!token) return false;
  const row = store.sessionGet(sha256(token));
  if (!row) return false;
  if (row.expires < Date.now()) { store.sessionDelete(row.token_hash); return false; }
  return true;
}

const destroySession = (token) => { if (token) store.sessionDelete(sha256(token)); };

/* --------------------------------------------------------------- cookie -- */

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

function setCookie(req, res, token) {
  const bits = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`
  ];
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

/* -------------------------------------------------- pembatas percobaan -- */

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 10;

function tooManyAttempts(ip) {
  const rec = attempts.get(ip);
  if (!rec || rec.until < Date.now()) return false;
  return rec.count >= MAX_TRIES;
}

function noteFailure(ip) {
  const rec = attempts.get(ip);
  if (!rec || rec.until < Date.now()) attempts.set(ip, { count: 1, until: Date.now() + WINDOW_MS });
  else rec.count++;
}

const clearAttempts = (ip) => attempts.delete(ip);

/* ---------------------------------------------------------- middleware -- */

function requireAuth(req, res, next) {
  if (validSession(readCookie(req, COOKIE))) return next();
  res.status(401).json({ error: 'Belum login.' });
}

module.exports = {
  COOKIE,
  hashPassword, verifyPassword, isConfigured, setPassword,
  createSession, validSession, destroySession,
  readCookie, setCookie, clearCookie,
  tooManyAttempts, noteFailure, clearAttempts,
  requireAuth
};
