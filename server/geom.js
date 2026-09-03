/* layout3d server — jembatan ke kode geometri frontend
 *
 * Aturan challenge ("bangunan harus di dalam batas tanah", KDB, tinggi) sudah
 * punya satu implementasi yang dipakai editor: js/shapes.js + js/evaluate.js.
 * Menyalinnya ke server berarti dua salinan yang pasti berbeda pelan-pelan,
 * dan peserta akan melihat "memenuhi brief" di editor tapi ditolak saat
 * mengirim — persis jenis bug yang paling membingungkan pengguna.
 *
 * Ketiga berkas itu kebetulan murni: tidak menyentuh document, Konva, maupun
 * THREE. Satu-satunya sentuhan browser adalah `})(window)` di ujungnya, jadi
 * cukup disediakan sandbox yang punya `window`.
 *
 * Hasil hitungan klien tetap tidak dipercaya. Klien menghitung untuk umpan
 * balik seketika; angka yang disimpan selalu hasil pemanggilan di sini.
 */
'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const APP_DIR = process.env.LAYOUT3D_PUBLIC || path.join(__dirname, '..');
const FILES = ['js/units.js', 'js/shapes.js', 'js/evaluate.js'];

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const f of FILES) {
  const file = path.join(APP_DIR, f);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}

const { Shapes, Units, Evaluate } = sandbox;
if (!Shapes || !Units || !Evaluate) {
  throw new Error('Gagal memuat kode geometri frontend — evaluasi challenge tidak bisa jalan.');
}

module.exports = {
  Shapes,
  Units,
  evaluate: Evaluate.evaluate,
  landArea: Evaluate.landArea,
  builtArea: Evaluate.builtArea,
  peakHeight: Evaluate.peakHeight
};
