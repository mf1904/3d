/* layout3d — dialog export STL: skala cetak + alas (base plate)
 *
 * Dulu export STL sekali klik: pakai skala di toolbar, unduh, lalu ukuran
 * hasilnya baru diberitahu SESUDAH berkasnya jadi. Untuk cetak 3D urutan itu
 * terbalik — yang pertama ingin diketahui justru "muat tidak di meja printer
 * saya", dan itu tergantung skala yang belum dipilih.
 *
 * Jadi dialognya menghitung ukuran cetak secara langsung sambil skala dan
 * tebal alas diubah. Pilihan terakhir diingat, supaya export berikutnya tetap
 * cepat.
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'layout3d:stl';

  var setelan = {
    scale: 100,
    alas: 'none',     // none | rect | land
    tebal: 2,         // mm hasil cetak
    margin: 3         // mm hasil cetak
  };

  try {
    var simpan = JSON.parse(global.localStorage.getItem(KEY) || 'null');
    if (simpan && typeof simpan === 'object') Object.assign(setelan, simpan);
  } catch (e) { /* mode privat: pakai bawaan */ }

  function ingat() {
    try { global.localStorage.setItem(KEY, JSON.stringify(setelan)); }
    catch (e) { /* tidak apa-apa, cuma kenyamanan */ }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var mm1 = function (v) { return (Math.round(v * 10) / 10).toString(); };

  /* ------------------------------------------------------- bentuk alas -- */

  /** kotak pembatas objek yang akan diexport, dalam meter dunia (x, z) */
  function bounds(objs) {
    var box = new THREE.Box3();
    var ada = false;
    for (var i = 0; i < objs.length; i++) {
      if (!ada) { box.setFromObject(objs[i]); ada = true; }
      else box.expandByObject(objs[i]);
    }
    return ada ? box : null;
  }

  /**
   * Poligon alas dalam meter dunia, koordinat denah (x, y2d = z dunia).
   *
   * Mode "land" hanya dipakai kalau bidang tanahnya PERSIS satu. Dengan dua
   * bidang atau lebih, alas harus menggabungkan keduanya — dan union poligon
   * bukan sesuatu yang pantas dikira-kira di jalur cetak, karena kesalahannya
   * baru ketahuan setelah 6 jam nge-print. Jadi jatuh ke kotak.
   */
  function outline(objs, mode, marginM, seluruhScene) {
    var b = bounds(objs);
    if (!b) return null;

    if (mode === 'land') {
      var tanah = Project.shapes.filter(function (s) {
        return Shapes.isLand(s.type) && Shapes.isVisible(s);
      });
      if (tanah.length === 1) {
        var poly = Shapes.landPolygon(tanah[0]);          // satuan project
        if (poly.length >= 3) {
          var u = Project.state.scale.unit;
          var m = poly.map(function (p) {
            return [Units.toM(p[0], u), Units.toM(p[1], u)];
          });
          return { pts: Geometry3D.growPolygon(m, marginM), jenis: 'tanah' };
        }
      }
    }

    /* Bidang tanah TIDAK ikut export STL (ia layer acuan, bukan massa).
     * Kalau kotak alas hanya mengikuti bangunan, mencetak seluruh site
     * menghasilkan alas yang memotong tapaknya — padahal alas justru
     * mewakili tanahnya. Jadi saat seluruh scene dicetak, batas tanah ikut
     * diperhitungkan; saat hanya seleksi yang dicetak, alas merapat ke
     * benda yang dipilih. */
    if (seluruhScene) {
      var u2 = Project.state.scale.unit;
      Project.shapes.forEach(function (s) {
        if (!Shapes.isLand(s.type) || !Shapes.isVisible(s)) return;
        Shapes.landPolygon(s).forEach(function (pt) {
          var x = Units.toM(pt[0], u2), z = Units.toM(pt[1], u2);
          if (x < b.min.x) b.min.x = x;
          if (x > b.max.x) b.max.x = x;
          if (z < b.min.z) b.min.z = z;
          if (z > b.max.z) b.max.z = z;
        });
      });
    }

    return {
      pts: [
        [b.min.x - marginM, b.min.z - marginM],
        [b.max.x + marginM, b.min.z - marginM],
        [b.max.x + marginM, b.max.z + marginM],
        [b.min.x - marginM, b.max.z + marginM]
      ],
      jenis: 'kotak'
    };
  }

  /** mesh alas siap ikut diexport (tidak pernah masuk scene) */
  function meshAlas(objs, mode, tebalMm, marginMm, printScale, seluruhScene) {
    if (mode !== 'rect' && mode !== 'land') return null;
    var perMm = printScale / 1000;                 // 1 mm hasil cetak = sekian meter dunia
    var o = outline(objs, mode, marginMm * perMm, seluruhScene);
    if (!o) return null;

    var g = Geometry3D.basePlate(o.pts, tebalMm * perMm);
    if (!g) return null;

    var mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    mesh.userData.alasJenis = o.jenis;
    return mesh;
  }

  /* ---------------------------------------------------------- pratinjau -- */

  /* Ukuran pratinjau dihitung dari outline yang SAMA dengan yang nanti
   * benar-benar dibangun. Kalau dihitung terpisah (mis. sekadar bounding box
   * + margin), angka di dialog bisa berbeda dari berkas yang keluar — dan
   * itu justru angka yang dipakai orang untuk memutuskan skala. */
  function hitung(objs, v, seluruhScene) {
    var bb = bounds(objs);
    if (!bb) return null;
    var mmPerM = 1000 / v.scale;
    var perMm = v.scale / 1000;

    var lebar = bb.max.x - bb.min.x;
    var dalam = bb.max.z - bb.min.z;
    var tinggi = bb.max.y - bb.min.y;

    if (v.alas !== 'none') {
      var o = outline(objs, v.alas, v.margin * perMm, seluruhScene);
      if (o) {
        var x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        o.pts.forEach(function (p) {
          if (p[0] < x0) x0 = p[0];
          if (p[0] > x1) x1 = p[0];
          if (p[1] < z0) z0 = p[1];
          if (p[1] > z1) z1 = p[1];
        });
        lebar = Math.max(lebar, x1 - x0);
        dalam = Math.max(dalam, z1 - z0);
      }
      tinggi += v.tebal * perMm;
    }
    return { x: lebar * mmPerM, y: dalam * mmPerM, z: tinggi * mmPerM };
  }

  function refreshPratinjau(objs, seluruhScene) {
    var el = $('sx-size');
    if (!el) return;
    var v = baca();
    var s = hitung(objs, v, seluruhScene);
    if (!s) { el.textContent = '—'; return; }

    el.innerHTML =
      '<b>' + mm1(s.x) + ' × ' + mm1(s.y) + ' × ' + mm1(s.z) + ' mm</b>' +
      '<span class="sx-note">' + (s.z > 250 || s.x > 250 || s.y > 250
        ? 'Lebih besar dari meja printer 250 mm yang umum — perkecil skalanya.'
        : 'Muat di meja printer 250 mm.') + '</span>';

    var m = $('sx-alas-opt');
    if (m) m.hidden = v.alas === 'none';
  }

  /* ------------------------------------------------------------- dialog -- */

  function baca() {
    return {
      scale: parseFloat(($('sx-scale') || {}).value) || 1,
      alas: ($('sx-alas') || {}).value || 'none',
      tebal: Math.max(0.2, parseFloat(($('sx-tebal') || {}).value) || 2),
      margin: Math.max(0, parseFloat(($('sx-margin') || {}).value) || 0)
    };
  }

  var SKALA = [1, 20, 50, 100, 200, 500, 1000];

  function dialog(ids) {
    var objs = Viewer3D.exportables(ids);
    if (!objs.length) {
      UI.say('Tidak ada objek solid untuk diexport (cek centang "Sertakan di export STL").', 'warn');
      return;
    }

    var opsiSkala = SKALA.map(function (s) {
      return '<option value="' + s + '"' + (s === setelan.scale ? ' selected' : '') + '>1:' + s + '</option>';
    }).join('');

    var punyaTanah = Project.shapes.filter(function (s) {
      return Shapes.isLand(s.type) && Shapes.isVisible(s);
    }).length === 1;

    UI.modal({
      title: 'Export STL' + (ids ? ' — objek terpilih' : ''),
      body:
        '<div class="sx-grid">' +
          '<div><label>Skala cetak</label>' +
            '<select id="sx-scale">' + opsiSkala + '</select></div>' +
          '<div><label>Alas (base plate)</label>' +
            '<select id="sx-alas">' +
              '<option value="none">Tanpa alas</option>' +
              '<option value="rect">Kotak</option>' +
              '<option value="land"' + (punyaTanah ? '' : ' disabled') + '>Ikut bentuk tanah' +
                (punyaTanah ? '' : ' (perlu tepat 1 bidang tanah)') + '</option>' +
            '</select></div>' +
        '</div>' +

        '<div class="sx-grid" id="sx-alas-opt" hidden>' +
          '<div><label>Tebal alas (mm cetak)</label>' +
            '<input type="number" id="sx-tebal" min="0.2" step="0.2"></div>' +
          '<div><label>Margin tepi (mm cetak)</label>' +
            '<input type="number" id="sx-margin" min="0" step="0.5"></div>' +
        '</div>' +

        '<label>Ukuran hasil cetak</label>' +
        '<div id="sx-size" class="sx-size">—</div>' +

        '<div class="ch-hint">Tebal dan margin dalam <b>milimeter benda jadi</b>, ' +
        'bukan meter di denah — jadi angkanya tidak ikut berubah waktu skala diganti. ' +
        'Alas menyatu dengan modelnya dalam satu berkas STL.</div>',

      actions: [
        { label: 'Batal' },
        { label: 'Export', primary: true, onClick: function () { jalankan(objs, ids); return false; } }
      ],

      onOpen: function () {
        $('sx-alas').value = punyaTanah || setelan.alas !== 'land' ? setelan.alas : 'rect';
        $('sx-tebal').value = setelan.tebal;
        $('sx-margin').value = setelan.margin;

        ['sx-scale', 'sx-alas', 'sx-tebal', 'sx-margin'].forEach(function (id) {
          var el = $(id);
          el.addEventListener('input', function () { refreshPratinjau(objs, !ids); });
          el.addEventListener('change', function () { refreshPratinjau(objs, !ids); });
        });
        refreshPratinjau(objs, !ids);
      }
    });
  }

  /* ------------------------------------------------------------ export -- */

  function safeName(n) {
    return (n || 'layout3d').replace(/[^a-zA-Z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '') || 'layout3d';
  }

  function jalankan(objs, ids) {
    var v = baca();
    Object.assign(setelan, v);
    ingat();

    var alas = null;
    var kirim = objs;
    try {
      alas = meshAlas(objs, v.alas, v.tebal, v.margin, v.scale, !ids);
      if (alas) kirim = objs.concat([alas]);

      var r = STL.exportSTL(kirim, {
        printScale: v.scale,
        zeroBase: !!alas,          // alas ada di bawah y=0; naikkan supaya mulai dari 0
        filename: safeName(Project.state.name) + (ids ? '_terpilih' : '') +
                  (alas ? '_beralas' : '') + '_1-' + v.scale + '.stl',
        title: Project.state.name
      });

      UI.closeModal();
      UI.say('STL: ' + objs.length + ' objek' +
        (alas ? ' + alas ' + alas.userData.alasJenis + ' ' + v.tebal + ' mm' : '') +
        ', ' + r.triangles.toLocaleString('id-ID') + ' segitiga, ' +
        mm1(r.size.x) + ' × ' + mm1(r.size.y) + ' × ' + mm1(r.size.z) + ' mm.');
    } catch (e) {
      var el = $('sx-size');
      if (el) el.innerHTML = '<span class="sx-err">' + esc(e.message) + '</span>';
      else UI.say('Export STL gagal: ' + e.message, 'err');
    } finally {
      if (alas) alas.geometry.dispose();
    }
  }

  global.ExportSTL = { dialog: dialog, meshAlas: meshAlas, outline: outline };
})(window);
