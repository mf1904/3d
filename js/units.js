/* layout3d — satuan & skala
 *
 * Semua angka shape disimpan dalam SATUAN PROJECT (project.scale.unit).
 * Konversi ke meter dipakai untuk: render 3D, grid, dan export STL.
 * Ganti satuan  = angka dikonversi, ukuran fisik tetap.
 * Skala ulang   = ukuran fisik ikut berubah (fungsi terpisah, lihat Project.rescale).
 */
(function (global) {
  'use strict';

  var UNITS = {
    mm: { label: 'mm', toM: 0.001, dec: 0, nudge: 10, minGridM: 0.005 },
    cm: { label: 'cm', toM: 0.01,  dec: 1, nudge: 1,  minGridM: 0.01 },
    m:  { label: 'm',  toM: 1,     dec: 2, nudge: 0.1, minGridM: 0.05 }
  };

  // langkah grid "cantik" dalam meter
  var GRID_STEPS_M = [
    0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5,
    1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 500, 1000
  ];

  // langkah zoom diskrit (bukan pinch kontinu) — step kecil di ujung bawah
  // supaya site plan besar masih muat di layar
  var ZOOM_STEPS = [0.02, 0.035, 0.05, 0.075, 0.1, 0.15, 0.25, 0.4, 0.5, 0.75,
                    1, 1.5, 2, 3, 4, 6, 8, 12];

  var Units = {
    UNITS: UNITS,
    ZOOM_STEPS: ZOOM_STEPS,

    def: function (u) { return UNITS[u] || UNITS.m; },

    /** faktor untuk mengubah angka dari satuan `from` ke satuan `to` */
    factor: function (from, to) {
      return Units.def(from).toM / Units.def(to).toM;
    },

    /** nilai (satuan project) -> meter */
    toM: function (v, unit) { return v * Units.def(unit).toM; },

    /** meter -> nilai (satuan project) */
    fromM: function (v, unit) { return v / Units.def(unit).toM; },

    /** pembulatan tampilan sesuai satuan */
    round: function (v, unit) {
      var d = Units.def(unit).dec;
      var f = Math.pow(10, d);
      return Math.round(v * f) / f;
    },

    /**
     * Pembulatan halus untuk hasil transformasi geometris (rotasi rigid,
     * penskalaan grup).
     *
     * Pembulatan ke presisi TAMPILAN (1 cm untuk meter) cukup untuk angka yang
     * diketik user, tapi merusak kalau dipakai menyimpan hasil rotasi: tiap
     * putaran menggeser tiap titik sampai setengah satuan terakhir, dan
     * kesalahannya menumpuk kalau grup diputar berulang kali. Dua digit ekstra
     * (0,1 mm untuk meter) membuat penyimpangan itu tidak berarti, sementara
     * angka di file tetap bersih — tanpa ekor 3.0000000000004.
     */
    roundFine: function (v, unit) {
      var f = Math.pow(10, Units.def(unit).dec + 2);
      return Math.round(v * f) / f;
    },

    /** format angka + satuan, mis. "4.20 m" */
    fmt: function (v, unit, withUnit) {
      var d = Units.def(unit);
      var s = v.toFixed(d.dec);
      // buang trailing nol yang tidak perlu (4.20 -> 4.2, 4.00 -> 4)
      if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
      return withUnit === false ? s : s + ' ' + d.label;
    },

    /**
     * Pilih langkah grid supaya jarak antar garis minimal `minPx` di layar.
     * @param pxPerM px per meter pada zoom saat ini
     * @returns {{stepM:number, majorEvery:number}}
     */
    gridStep: function (pxPerM, minPx) {
      minPx = minPx || 22;
      for (var i = 0; i < GRID_STEPS_M.length; i++) {
        if (GRID_STEPS_M[i] * pxPerM >= minPx) {
          var s = GRID_STEPS_M[i];
          // garis tebal tiap 5 atau 10 langkah, pilih yang "bulat"
          var major = (String(s).indexOf('2.5') >= 0 || String(s).indexOf('25') === 0) ? 4 : 5;
          return { stepM: s, majorEvery: major };
        }
      }
      return { stepM: GRID_STEPS_M[GRID_STEPS_M.length - 1], majorEvery: 5 };
    },

    /** label ukuran untuk garis grid, otomatis pakai satuan yang enak dibaca */
    gridLabel: function (valueM, unit) {
      var v = Units.fromM(valueM, unit);
      var s = Math.abs(v) < 1e-9 ? '0' : Units.fmt(v, unit, false);
      return s + Units.def(unit).label;
    },

    nextZoom: function (z, dir) {
      var i, best = 0;
      for (i = 0; i < ZOOM_STEPS.length; i++) {
        if (Math.abs(ZOOM_STEPS[i] - z) < Math.abs(ZOOM_STEPS[best] - z)) best = i;
      }
      var n = Math.min(ZOOM_STEPS.length - 1, Math.max(0, best + (dir > 0 ? 1 : -1)));
      return ZOOM_STEPS[n];
    }
  };

  global.Units = Units;
})(window);
