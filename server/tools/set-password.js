#!/usr/bin/env node
/* Set / ganti password server.
 *
 *   npm run set-password                 -> ketik password lewat prompt (tidak masuk history shell)
 *   echo "rahasia" | npm run set-password
 *   npm run set-password -- "rahasia"    -> lewat argumen (TERCATAT di history shell, hindari)
 */
'use strict';

const auth = require('../auth');

const ETX = String.fromCharCode(3);     // Ctrl+C
const DEL = String.fromCharCode(127);   // Backspace

function apply(password) {
  const pw = String(password || '').replace(/\r?\n$/, '');
  if (pw.length < 8) {
    console.error('Password minimal 8 karakter.');
    process.exit(1);
  }
  auth.setPassword(pw);
  console.log('Password server tersimpan (hash scrypt).');
  console.log('Sesi yang sudah login tetap berlaku — untuk memutus semuanya,');
  console.log('kosongkan isi data/sessions.json (jadi "{}").');
}

const arg = process.argv[2];
if (arg) {
  apply(arg);
  process.exit(0);
}

if (process.stdin.isTTY) {
  process.stdout.write('Password baru (tidak ditampilkan): ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  let buf = '';
  process.stdin.on('data', (chunk) => {
    for (const ch of chunk) {
      if (ch === '\r' || ch === '\n') {
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        apply(buf);
        process.exit(0);
      } else if (ch === ETX) {
        process.stdin.setRawMode(false);
        process.stdout.write('\nDibatalkan.\n');
        process.exit(1);
      } else if (ch === DEL || ch === '\b') {
        buf = buf.slice(0, -1);
      } else {
        buf += ch;
      }
    }
  });
} else {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { data += c; });
  process.stdin.on('end', () => apply(data));
}
