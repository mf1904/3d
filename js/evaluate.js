/* layout3d — penilaian project terhadap brief challenge
 *
 * Berkas ini dipakai DUA sisi: editor memanggilnya untuk memberi umpan balik
 * seketika saat peserta menggambar, dan server memuatnya lewat `vm` untuk
 * menghitung ulang angka yang benar-benar disimpan. Satu implementasi, jadi
 * peserta tidak pernah melihat "hijau" di editor lalu ditolak saat mengirim.
 *
 * Karena itu isinya harus tetap murni: tidak boleh menyentuh document, Konva,
 * THREE, atau Project. Masukannya project JSON apa adanya.
 */
(function (global) {
  'use strict';

  var Shapes = global.Shapes;

  var isLand = function (s) { return Shapes.isLand(s.type); };
  var isBuilding = function (s) { return !isLand(s) && Shapes.isVisible(s); };

  /** poligon tiap bidang tanah, koordinat dunia */
  function landPolys(shapes) {
    return shapes
      .filter(function (s) { return isLand(s) && Shapes.isVisible(s); })
      .map(Shapes.landPolygon)
      .filter(function (p) { return p.length >= 3; });
  }

  function landArea(shapes) {
    return landPolys(shapes).reduce(function (t, p) {
      return t + Shapes.polygonArea(p);
    }, 0);
  }

  /**
   * Luas tapak bangunan, DIGABUNG — bukan dijumlah.
   *
   * Menjumlah luas tiap objek salah begitu ada dua massa yang bertumpuk
   * sebagian (badan + teras, atau atap yang lebih lebar dari badannya): satu
   * meter persegi tanah yang sama terhitung dua kali, dan peserta terlihat
   * melanggar KDB padahal tidak.
   *
   * Union poligon secara eksak butuh pustaka clipping — berat untuk sesuatu
   * yang dipakai sekali per pengiriman. Yang dipakai di sini: raster. Tanah
   * dibagi kisi halus, sel ditandai kalau tertutup bangunan mana pun. Galatnya
   * hanya di sel tepi; dengan 600 sel pada sisi terpanjang, tanah 100 m punya
   * galat tepi sekitar 17 cm.
   *
   * Sel di luar batas tanah tidak dihitung: tapak yang menjorok keluar tidak
   * boleh menaikkan KDB — pelanggarannya diurus aturan batas tanah.
   */
  function builtArea(shapes) {
    var polys = landPolys(shapes);
    if (!polys.length) return 0;

    var builds = shapes.filter(isBuilding).map(Shapes.footprintCorners);
    if (!builds.length) return 0;

    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    polys.forEach(function (p) {
      p.forEach(function (pt) {
        if (pt[0] < x0) x0 = pt[0];
        if (pt[0] > x1) x1 = pt[0];
        if (pt[1] < y0) y0 = pt[1];
        if (pt[1] > y1) y1 = pt[1];
      });
    });

    var w = x1 - x0, h = y1 - y0;
    if (!(w > 0) || !(h > 0)) return 0;

    var N = 600;
    var cell = Math.max(w, h) / N;
    var nx = Math.max(1, Math.ceil(w / cell));
    var ny = Math.max(1, Math.ceil(h / cell));
    var grid = new Uint8Array(nx * ny);

    var cx = function (i) { return x0 + (i + 0.5) * cell; };
    var cy = function (j) { return y0 + (j + 0.5) * cell; };

    builds.forEach(function (rect) {
      var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      rect.forEach(function (pt) {
        if (pt[0] < bx0) bx0 = pt[0];
        if (pt[0] > bx1) bx1 = pt[0];
        if (pt[1] < by0) by0 = pt[1];
        if (pt[1] > by1) by1 = pt[1];
      });
      var i0 = Math.max(0, Math.floor((bx0 - x0) / cell));
      var i1 = Math.min(nx - 1, Math.ceil((bx1 - x0) / cell));
      var j0 = Math.max(0, Math.floor((by0 - y0) / cell));
      var j1 = Math.min(ny - 1, Math.ceil((by1 - y0) / cell));

      for (var j = j0; j <= j1; j++) {
        for (var i = i0; i <= i1; i++) {
          var k = j * nx + i;
          if (grid[k]) continue;
          if (Shapes.pointInPolygon([cx(i), cy(j)], rect)) grid[k] = 1;
        }
      }
    });

    var n = 0;
    for (var j2 = 0; j2 < ny; j2++) {
      for (var i2 = 0; i2 < nx; i2++) {
        if (!grid[j2 * nx + i2]) continue;
        var p = [cx(i2), cy(j2)];
        for (var q = 0; q < polys.length; q++) {
          if (Shapes.pointInPolygon(p, polys[q])) { n++; break; }
        }
      }
    }
    return n * cell * cell;
  }

  /** puncak tertinggi bangunan (elevasi + tinggi), satuan project */
  function peakHeight(shapes) {
    var top = 0;
    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      if (!isBuilding(s)) continue;
      var t = (Number(s.elevation) || 0) + (Number(s.height) || 0);
      if (t > top) top = t;
    }
    return top;
  }

  var round2 = function (v) { return Math.round(v * 100) / 100; };

  /**
   * Nilai sebuah project terhadap constraint challenge.
   *
   * Selalu mengembalikan laporan lengkap, bukan sekadar lolos/tidak: peserta
   * perlu tahu seberapa jauh melesetnya supaya bisa memperbaiki, dan juri
   * perlu angkanya. `ok` false berarti ada pelanggaran keras.
   */
  function evaluate(project, c) {
    c = c || {};
    var shapes = (project && Array.isArray(project.shapes)) ? project.shapes : [];
    var unit = (project && project.scale && project.scale.unit) || 'm';

    var land = landArea(shapes);
    var built = land > 0 ? builtArea(shapes) : 0;
    var kdb = land > 0 ? (built / land) * 100 : 0;
    var peak = peakHeight(shapes);
    var nBuild = shapes.filter(isBuilding).length;

    var v = [];
    if (!land) v.push({ rule: 'land', pesan: 'Tidak ada bidang tanah di project ini.' });
    if (!nBuild) v.push({ rule: 'empty', pesan: 'Belum ada objek bangunan yang digambar.' });

    var luar = Shapes.outsideLand(shapes);
    if (luar.length) {
      var nama = luar.slice(0, 4).map(function (o) {
        var s = shapes.filter(function (x) { return x.id === o.id; })[0];
        return (s && s.meta && s.meta.label) || o.id;
      });
      v.push({
        rule: 'boundary',
        pesan: luar.length + ' objek keluar dari batas tanah: ' + nama.join(', ') +
               (luar.length > nama.length ? ', dan lainnya' : ''),
        ids: luar.map(function (o) { return o.id; })
      });
    }

    if (c.maxKdb > 0 && kdb > c.maxKdb + 0.05) {
      v.push({ rule: 'kdb', pesan: 'KDB ' + round2(kdb) + '% melebihi batas ' + c.maxKdb + '%.' });
    }
    if (c.maxHeight > 0 && peak > c.maxHeight + 1e-6) {
      v.push({
        rule: 'height',
        pesan: 'Puncak tertinggi ' + round2(peak) + ' ' + unit +
               ' melebihi batas ' + c.maxHeight + ' ' + unit + '.'
      });
    }
    if (c.maxObjects > 0 && nBuild > c.maxObjects) {
      v.push({
        rule: 'objects',
        pesan: nBuild + ' objek melebihi batas ' + c.maxObjects + ' objek.'
      });
    }

    return {
      ok: v.length === 0,
      unit: unit,
      land: round2(land),
      built: round2(built),
      kdb: round2(kdb),
      peak: round2(peak),
      objects: nBuild,
      violations: v
    };
  }

  global.Evaluate = {
    evaluate: evaluate,
    landArea: landArea,
    builtArea: builtArea,
    peakHeight: peakHeight
  };
})(window);
