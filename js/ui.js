/* layout3d — panel, toolbar, modal, shortcut */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var editingProps = false;
  var DEFAULT_HINT = '';
  var serverProjectId = null;   // id project ini di server (null = belum pernah disimpan ke server)

  /* ------------------------------------------------------------------ */
  /* status bar                                                         */
  /* ------------------------------------------------------------------ */
  var msgTimer = null;
  function say(text, kind) {
    var el = $('status-msg');
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
    if (msgTimer) clearTimeout(msgTimer);
    if (text) msgTimer = setTimeout(function () { el.textContent = ''; }, 5000);
  }

  /* ------------------------------------------------------------------ */
  /* modal                                                              */
  /* ------------------------------------------------------------------ */
  function modal(opts) {
    var back = $('modal-backdrop');
    $('modal-title').textContent = opts.title || '';
    $('modal-body').innerHTML = opts.body || '';
    var acts = $('modal-actions');
    acts.innerHTML = '';
    (opts.actions || [{ label: 'Tutup' }]).forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'tb' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '');
      b.textContent = a.label;
      b.onclick = function () {
        if (!a.onClick || a.onClick() !== false) closeModal();
      };
      acts.appendChild(b);
    });
    back.hidden = false;
    if (opts.onOpen) opts.onOpen($('modal-body'));
    return back;
  }
  function closeModal() { $('modal-backdrop').hidden = true; }

  /* ------------------------------------------------------------------ */
  /* library panel                                                      */
  /* ------------------------------------------------------------------ */
  function buildLibrary() {
    var wrap = $('shape-library');
    wrap.innerHTML = '';
    Shapes.LIBRARY.forEach(function (cat) {
      var div = document.createElement('div');
      div.className = 'cat';
      var h = document.createElement('div');
      h.className = 'cat-title';
      h.textContent = cat.category;
      div.appendChild(h);
      var grid = document.createElement('div');
      grid.className = 'cat-items';
      cat.types.forEach(function (type) {
        var d = Shapes.def(type);
        var it = document.createElement('div');
        it.className = 'item';
        var isPoly = type === 'polygon';
        it.title = isPoly
          ? 'Gambar poligon bebas — klik titik demi titik di kanvas'
          : d.name + ' — default ' + d.w + '×' + d.d + '×' + d.h + ' m';
        it.innerHTML = Shapes.icon(type) + '<span>' + (isPoly ? 'Poligon ✎' : d.name) + '</span>';
        it.dataset.type = type;
        it.onclick = isPoly
          ? function () { if (Editor2D.isDrawing()) Editor2D.cancelDraw(); else Editor2D.startDraw(); }
          : function () { addShape(type); };
        grid.appendChild(it);
      });
      div.appendChild(grid);
      wrap.appendChild(div);
    });

    var pw = $('preset-list');
    pw.innerHTML = '';
    var pg = document.createElement('div');
    pg.className = 'cat-items';
    Shapes.PRESETS.forEach(function (p) {
      var it = document.createElement('div');
      it.className = 'item';
      it.title = p.name + ' — ' + p.hint;
      it.innerHTML = Shapes.icon(p.id) + '<span>' + p.name + '</span>';
      it.onclick = function () { addPreset(p.id); };
      pg.appendChild(it);
    });
    pw.appendChild(pg);
  }

  /* ------------------------------------------------------------------ */
  /* tambah shape                                                       */
  /* ------------------------------------------------------------------ */
  function addShape(type) {
    var u = Project.unit();
    var c = Editor2D.center();
    var sel = Project.selectedShapes();
    var over = { x: Units.round(c.x, u), y: Units.round(c.y, u) };

    // item kategori atap otomatis dipasang di atas shape terpilih
    if (Shapes.isRoof(type) && sel.length) {
      var base = sel[sel.length - 1];
      var top = 0, i;
      for (i = 0; i < sel.length; i++) top = Math.max(top, sel[i].elevation + sel[i].height);
      var b = Project.bounds(sel.map(function (s) { return s.id; }));
      over.x = Units.round(b.cx, u);
      over.y = Units.round(b.cy, u);
      over.rotation = base.rotation;
      over.elevation = Units.round(top, u);
      // atap prisma & limas ikut ukuran badan (+ overstek 5%)
      var d = Shapes.def(type);
      if (d.foot === 'rect') {
        over.width = Units.round(base.width * 1.05, u);
        over.depth = Units.round(base.depth * 1.05, u);
      } else {
        var m = Math.min(base.width, base.depth) * 0.6;
        over.width = Units.round(m, u);
        over.depth = Units.round(m, u);
      }
      if (base.meta.group) over.meta = { group: base.meta.group };
    }

    var s = Shapes.create(type, u, over);
    Project.add([s]);
    // bidang tanah = alas referensi; taruh paling belakang supaya tidak
    // menutupi bangunan yang digambar di atasnya
    if (Shapes.isLand(type)) Project.reorder([s.id], -1);
    Project.setSelection([s.id]);
    say(Shapes.isLand(type)
      ? 'Bidang tanah ditambahkan. Pakai "Edit Titik" atau tabel ukuran sisi untuk menyesuaikan dengan data ukur.'
      : 'Ditambahkan: ' + s.meta.label);
  }

  function addPreset(id) {
    var u = Project.unit();
    var c = Editor2D.center();
    var list = Shapes.createPreset(id, u, Units.round(c.x, u), Units.round(c.y, u));
    if (!list.length) return;
    Project.add(list);
    Project.setSelection([list[0].id]);
    Editor2D.fit(list.map(function (s) { return s.id; }));
    say('Preset ditambahkan: ' + list.length + ' objek');
  }

  /* ------------------------------------------------------------------ */
  /* panel properti                                                     */
  /* ------------------------------------------------------------------ */
  var P = {};
  function cacheProps() {
    ['label', 'type', 'color', 'x', 'y', 'rot', 'tiltx', 'tiltz',
     'w', 'd', 'h', 'elev', 'thickness', 'solid', 'locked', 'cut']
      .forEach(function (k) { P[k] = $('p-' + k); });
  }

  function renderProps() {
    var sel = Project.selectedShapes();
    var form = $('props-form'), empty = $('props-empty'), multi = $('props-multi');

    // isi panel grup dikosongkan saat tidak dipakai: kalau dibiarkan, id
    // seperti #g-x tetap ada di DOM walau tersembunyi, dan kode lain bisa
    // salah kira grup sedang aktif
    if (sel.length < 2) multi.innerHTML = '';

    if (!sel.length) {
      form.hidden = true; empty.hidden = false; multi.hidden = true;
      return;
    }
    if (sel.length > 1) {
      form.hidden = true; empty.hidden = true;
      multi.hidden = false;
      var grouped = sel.filter(function (s) { return s.meta.group; }).length;
      multi.innerHTML =
        '<b>' + sel.length + ' objek terpilih</b><br>' +
        (grouped === sel.length && sel.length
          ? 'Sudah satu grup — geser & putar bersama.'
          : 'Gabungkan supaya selalu ikut bergerak bersama.') +
        '<div class="btn-row" style="margin-top:10px">' +
          '<button class="tb primary" id="btn-group">Gabung Grup</button>' +
          '<button class="tb" id="btn-ungroup-multi">Lepas Grup</button>' +
        '</div>' +
        '<div class="btn-row">' +
          '<button class="tb" id="btn-multi-dup">Duplikat</button>' +
          '<button class="tb danger" id="btn-multi-del">Hapus semua</button>' +
        '</div>' +
        '<div class="sep">Rotasi &amp; Kemiringan (grup)</div>' +
        '<div class="btn-row three">' +
          '<button class="tb" id="btn-multi-lay" title="Rebahkan seluruh grup 90&deg; sebagai satu benda kaku, sambil menjaga susunan antar bagiannya">Tidurkan Grup</button>' +
          '<button class="tb" id="btn-multi-stand" title="Tiap anggota kembali tegak di tempatnya masing-masing">Berdiri Tegak</button>' +
          '<button class="tb" id="btn-multi-floor" title="Geser seluruh grup bersama supaya titik terendahnya menyentuh lantai">Ke Lantai</button>' +
        '</div>' +
        '<div class="grp-tip">Tidurkan Grup memutar grup sebagai satu kesatuan (posisi &amp; kemiringan tiap ' +
        'bagian ikut berubah, susunan relatifnya terjaga) &mdash; bukan cuma memiringkan tiap bagian di tempat.</div>' +
        groupFormHtml(sel) +
        '<div class="sep">Pilih satu untuk diedit</div>' +
        '<div class="grp-list">' +
          sel.map(function (s) {
            return '<button class="tb mini" data-pick="' + s.id + '">' +
              '<span class="sw" style="background:' + s.meta.color + '"></span>' +
              escapeHtml(s.meta.label || Shapes.name(s.type)) + '</button>';
          }).join('') +
        '</div>' +
        '<div class="grp-tip">Atau Alt+klik objeknya langsung di kanvas. ' +
        'Ctrl+G gabung &middot; Ctrl+Shift+G lepas.</div>';

      // panel properti hanya tampil untuk seleksi tunggal; tanpa jalan pintas ini
      // anggota grup jadi tidak bisa diedit sama sekali
      multi.querySelectorAll('[data-pick]').forEach(function (b) {
        b.onclick = function () {
          Project.setSelection([b.getAttribute('data-pick')], { raw: true });
        };
      });
      bindGroupForm();
      $('btn-group').onclick = doGroup;
      $('btn-ungroup-multi').onclick = doUngroup;
      $('btn-multi-del').onclick = function () { Project.remove(Project.selection); };
      $('btn-multi-dup').onclick = function () {
        var ids = Project.duplicate(Project.selection);
        Project.setSelection(ids, { raw: true });
      };
      $('btn-multi-lay').onclick = function () { groupTidurkan(Project.selection); };
      $('btn-multi-stand').onclick = function () { groupTegakkan(Project.selection); };
      $('btn-multi-floor').onclick = function () { groupKeLantai(Project.selection); };
      return;
    }

    form.hidden = false; empty.hidden = true; multi.hidden = true;
    var s = sel[0], u = Project.unit(), tag = Units.def(u).label;

    document.querySelectorAll('.unit-tag').forEach(function (e) { e.textContent = tag; });

    P.label.value = s.meta.label || '';
    P.type.value = Shapes.name(s.type) + '  (' + s.type + ')';
    P.color.value = s.meta.color || '#c9b48d';
    P.x.value = Units.round(s.x, u);
    P.y.value = Units.round(s.y, u);
    P.rot.value = Math.round((s.rotation || 0) * 100) / 100;
    P.tiltx.value = Math.round((s.tiltX || 0) * 100) / 100;
    P.tiltz.value = Math.round((s.tiltZ || 0) * 100) / 100;
    P.w.value = Units.round(s.width, u);
    P.d.value = Units.round(s.depth, u);
    P.h.value = Units.round(s.height, u);
    P.elev.value = Units.round(s.elevation || 0, u);
    P.solid.checked = s.meta.solid !== false;
    P.locked.checked = !!s.meta.locked;

    var isOpening = Shapes.isOpening(s.type);
    $('row-cut').hidden = !isOpening;
    if (isOpening) P.cut.checked = s.meta.cut !== false;

    var hasT = typeof s.meta.thickness === 'number';
    $('row-thickness').hidden = !hasT;
    if (hasT) P.thickness.value = Units.round(s.meta.thickness, u);

    var step = Units.def(u).nudge;
    ['x', 'y', 'w', 'd', 'h', 'elev', 'thickness'].forEach(function (k) {
      if (P[k]) P[k].step = step;
    });

    // kotak poligon (hanya untuk shape berdenah poligon)
    var poly = Shapes.def(s.type).foot === 'poly';
    $('poly-box').hidden = !poly;
    if (poly) {
      var can = Editor2D.canVertexEdit(s);
      $('btn-vertex').disabled = !can;
      $('btn-vertex').classList.toggle('active', Editor2D.isVertexEditing());
      $('poly-tip').textContent = can
        ? 'Geser titik biru · klik titik kecil di tengah sisi untuk menambah · Alt+klik untuk menghapus. Esc selesai.'
        : 'Titik tidak bisa diedit selama objek dimiringkan atau dikunci.';

      var crossing = Array.isArray(s.points) && s.points.length >= 3 &&
                     Shapes.selfIntersects(Shapes.polygonLocal(s));
      $('poly-cross').hidden = !crossing;
      renderPolySides(s);
    }

    // kotak info grup (hanya kalau shape ini anggota grup)
    var box = $('group-box');
    if (s.meta.group) {
      var n = Project.shapes.filter(function (o) {
        return o.meta && o.meta.group === s.meta.group;
      }).length;
      box.hidden = false;
      $('group-info').innerHTML = 'Objek ini anggota grup berisi <b>' + n + ' objek</b>. ' +
        'Memilih salah satu akan memilih semuanya.';
    } else {
      box.hidden = true;
    }
  }

  /* ------------------------------------------------------------------ */
  /* poligon: luas, keliling, dan ukuran per sisi                        */
  /*                                                                    */
  /* Ini yang bikin tool-nya kepakai untuk bidang tanah: data sertifikat */
  /* datang sebagai angka per sisi, bukan gambar. Jadi sisi harus bisa   */
  /* DIKETIK, bukan cuma digeser.                                        */
  /* ------------------------------------------------------------------ */

  /** satuan luas menyesuaikan satuan panjang project */
  function fmtArea(v, u) {
    var lbl = Units.def(u).label;
    var txt = v >= 100 ? v.toFixed(1) : v.toFixed(2);
    return txt.replace(/\.?0+$/, '') + ' ' + lbl + '²';
  }

  function renderPolySides(s) {
    var u = Project.unit();
    var local = Shapes.polygonLocal(s);
    var box = $('poly-sides');

    if (!local || local.length < 3) {
      box.innerHTML = '';
      $('poly-area').textContent = '—';
      $('poly-perim').textContent = '—';
      return;
    }

    $('poly-area').textContent = fmtArea(Shapes.polygonArea(local), u);
    $('poly-perim').textContent = Units.fmt(Shapes.polygonPerimeter(local), u);

    // jangan gambar ulang tabel saat user sedang mengetik di dalamnya —
    // kursor akan lompat dan angkanya berebut dengan yang sedang diketik
    if (box.contains(document.activeElement)) {
      refreshSideValues(local);
      return;
    }

    var sides = Shapes.polygonSides(local);
    var n = sides.length;
    var html = '<div class="sides-head"><span>#</span><span>Panjang</span><span>Sudut</span></div>';
    sides.forEach(function (sd, i) {
      // Sisi penutup dan sudut di kedua ujung rantai ditentukan oleh sisi lain
      // — dikunci, bukan disembunyikan, supaya angkanya tetap kebaca.
      var lenOk = Shapes.canSetSide(n, i);
      var angOk = Shapes.canSetAngle(n, i);
      html += '<div class="side-row" data-i="' + i + '">' +
        '<span class="idx">' + (i + 1) + '</span>' +
        '<input type="number" step="any" min="0" data-kind="len" ' +
          (lenOk ? '' : 'disabled ') +
          'value="' + Units.round(sd.len, u) + '" title="' +
          (lenOk ? 'Panjang sisi ' + (i + 1)
                 : 'Sisi penutup — panjangnya mengikuti sisi lain') + '">' +
        '<input type="number" step="any" data-kind="ang" ' +
          (angOk ? '' : 'disabled ') +
          'value="' + (Math.round(sd.angle * 10) / 10) + '" title="' +
          (angOk ? 'Sudut dalam di titik ' + (i + 1)
                 : 'Sudut ujung rantai — ditentukan oleh sisi penutup') + '">' +
        '</div>';
    });
    box.innerHTML = html;

    box.querySelectorAll('input').forEach(function (inp) {
      inp.addEventListener('focus', function () {
        inp.dataset.before = JSON.stringify(Project.serialize());
        inp.parentNode.classList.add('on');
        Editor2D.highlightSide(s.id, Number(inp.parentNode.dataset.i));
      });
      inp.addEventListener('blur', function () {
        inp.parentNode.classList.remove('on');
        Editor2D.highlightSide(null);
      });
      inp.addEventListener('change', function () { applySide(inp); });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      });
    });
  }

  /** perbarui angka di tabel tanpa membangun ulang DOM-nya */
  function refreshSideValues(local) {
    var u = Project.unit();
    var sides = Shapes.polygonSides(local);
    $('poly-sides').querySelectorAll('.side-row').forEach(function (row) {
      var sd = sides[Number(row.dataset.i)];
      if (!sd) return;
      row.querySelectorAll('input').forEach(function (inp) {
        if (inp === document.activeElement) return;   // jangan ganggu yang diketik
        inp.value = inp.dataset.kind === 'len'
          ? Units.round(sd.len, u)
          : Math.round(sd.angle * 10) / 10;
      });
    });
  }

  function applySide(inp) {
    var sel = Project.selection;
    if (sel.length !== 1) return;
    var s = Project.get(sel[0]);
    if (!s) return;

    var idx = Number(inp.parentNode.dataset.i);
    var v = parseFloat(inp.value);
    var u = Project.unit();
    var local = Shapes.polygonLocal(s);

    var next = inp.dataset.kind === 'len'
      ? Shapes.setSideLength(local, idx, v)
      : Shapes.setVertexAngle(local, idx, v);

    if (!next) {
      say('Nilai tidak valid untuk sisi ' + (idx + 1) + '.', 'warn');
      renderPolySides(s);
      return;
    }

    var patch = Shapes.polygonPatchFromLocal(s, next, u);
    if (!patch) {
      say('Hasilnya bikin bidang jadi tanpa luas — diabaikan.', 'warn');
      renderPolySides(s);
      return;
    }

    if (inp.dataset.before) Project.pushHistory(inp.dataset.before);
    Project.update(s.id, patch, { source: 'ui', full: true });
    inp.dataset.before = JSON.stringify(Project.serialize());

    var after = Shapes.polygonLocal(Project.get(s.id));
    if (Shapes.selfIntersects(after)) {
      say('Sisi ' + (idx + 1) + ' diubah, tapi bidangnya jadi menyilang — cek lagi.', 'warn');
    } else {
      say('Sisi ' + (idx + 1) + ' disetel. Luas sekarang ' +
          fmtArea(Shapes.polygonArea(after), u) + '.');
    }
  }

  /* ------------------------------------------------------------------ */
  /* grup                                                               */
  /* ------------------------------------------------------------------ */
  function doGroup() {
    var r = Project.group(Project.selection);
    if (!r) { say('Pilih minimal 2 objek untuk digabung.', 'warn'); return; }
    Project.setSelection(r.ids, { raw: true, force: true });
    say(r.ids.length + ' objek digabung jadi satu grup.');
  }

  function doUngroup() {
    var ids = Project.ungroup(Project.selection);
    if (!ids.length) { say('Objek terpilih tidak ada dalam grup.', 'warn'); return; }
    Project.setSelection(ids, { raw: true, force: true });
    say('Grup dilepas (' + ids.length + ' objek).');
  }

  /* ------------------------------------------------------------------ */
  /* rotasi grup — untuk >1 objek terpilih (biasanya sudah digabung)     */
  /*                                                                     */
  /* "Tidurkan Grup" tidak sekadar men-set tiltX=90 tiap anggota di      */
  /* tempat masing-masing (itu akan mencerai-beraikan susunannya) — ia   */
  /* memutar seluruh grup sebagai satu benda kaku terhadap titik pusat   */
  /* selection, jadi posisi relatif antar bagian tetap terjaga, persis   */
  /* seperti menjatuhkan tumpukan kotak ke sampingnya.                   */
  /* ------------------------------------------------------------------ */

  /** titik terendah gabungan sekelompok shape (satuan project) */
  function groupBottom(shapes) {
    return Math.min.apply(null, shapes.map(function (s) {
      var e = Shapes.planExtents(s);
      return (s.elevation || 0) + e.cy - e.ey;
    }));
  }

  /**
   * Terapkan rotasi rigid `delta` ke seluruh grup terhadap pivot bersama
   * (pusat bounding box, elevasi rata-rata), lalu setel ulang elevasi supaya
   * titik terendah GABUNGAN tidak berubah — grup tidak tenggelam ke lantai
   * atau melayang akibat rotasinya. Dipakai Tidurkan Grup & Berdiri Tegak,
   * supaya keduanya konsisten: susunan relatif antar anggota selalu terjaga.
   */
  function applyGroupRigid(shapes, delta) {
    var u = Project.unit();
    var b = Project.bounds(shapes.map(function (s) { return s.id; }));
    var pivot = {
      x: b.cx, y: b.cy,
      elevation: shapes.reduce(function (s, o) { return s + (o.elevation || 0); }, 0) / shapes.length
    };
    var oldBottom = groupBottom(shapes);

    var list = shapes.map(function (s) {
      var r = Shapes.applyRigidDelta(s, delta, pivot);
      return { id: s.id, patch: r, tmp: Object.assign({}, s, r) };
    });
    var newBottom = groupBottom(list.map(function (item) { return item.tmp; }));
    var shift = oldBottom - newBottom;

    var patchList = list.map(function (item) {
      // pembulatan halus: rotasi rigid tidak boleh menggeser susunan antar
      // anggota, dan kesalahannya menumpuk kalau grup diputar berulang
      return { id: item.id, patch: {
        x: Units.roundFine(item.patch.x, u),
        y: Units.roundFine(item.patch.y, u),
        elevation: Units.roundFine(item.patch.elevation + shift, u),
        rotation: Math.round(item.patch.rotation * 100) / 100,
        tiltX: Math.round(item.patch.tiltX * 100) / 100,
        tiltZ: Math.round(item.patch.tiltZ * 100) / 100
      } };
    });
    Project.updateMany(patchList, { source: 'ui', full: true });
  }

  function groupTidurkan(ids) {
    var shapes = ids.map(Project.get).filter(Boolean);
    if (shapes.length < 2) return;
    applyGroupRigid(shapes, Shapes.mat3RotX(90));
    say(shapes.length + ' objek ditidurkan sebagai satu grup.');
  }

  /**
   * Kebalikan rigid dari kemiringan sekarang — BUKAN reset tiap anggota di
   * tempatnya masing-masing (itu akan mencerai-beraikan susunan grup, karena
   * Tidurkan Grup sudah ikut menggeser posisi tiap anggota). Delta dihitung
   * dari orientasi anggota PERTAMA sebagai acuan: kembali ke yaw-nya semula,
   * tiltX/tiltZ nol. Untuk kasus umum (semua anggota berbagi kemiringan yang
   * sama, seperti hasil Tidurkan Grup), ini membalikkan seluruh grup dengan
   * tepat, apa pun anggota yang dipakai sebagai acuan.
   */
  function groupTegakkan(ids) {
    var shapes = ids.map(Project.get).filter(Boolean);
    if (!shapes.length) return;
    var ref = shapes[0];
    var cur = Shapes.composeRotation(ref.rotation || 0, ref.tiltX || 0, ref.tiltZ || 0);
    var target = Shapes.composeRotation(ref.rotation || 0, 0, 0);
    var delta = Shapes.mat3Mul(target, Shapes.mat3Transpose(cur));
    applyGroupRigid(shapes, delta);
    say('Grup ditegakkan kembali — susunan antar anggota tetap terjaga.');
  }

  /* ------------------------------------------------------------------ */
  /* properti grup: X/Y, rotasi, kemiringan, elevasi, ukuran            */
  /*                                                                    */
  /* Semua bekerja pada grup sebagai SATU benda: menggeser memindahkan   */
  /* semua anggota, memutar memutar rigid terhadap pusat, dan mengubah   */
  /* ukuran menskalakan proporsional — posisi maupun dimensi tiap        */
  /* anggota — sehingga susunan relatifnya tidak pernah berubah.         */
  /* ------------------------------------------------------------------ */

  /** form properti grup — sama susunannya dengan panel objek tunggal */
  function groupFormHtml(shapes) {
    var u = Project.unit();
    var tag = Units.def(u).label;
    var g = groupBox(shapes);
    var ref = shapes[0];
    var f = function (v) { return Units.round(v, u); };
    var deg = function (v) { return Math.round((v || 0) * 100) / 100; };

    return '<div class="sep">Posisi &amp; Rotasi (grup) <span class="unit-tag">' + tag + '</span></div>' +
      '<div class="row2">' +
        '<div><label>X</label><input type="number" step="any" id="g-x" value="' + f(g.cx) + '"></div>' +
        '<div><label>Y</label><input type="number" step="any" id="g-y" value="' + f(g.cy) + '"></div>' +
      '</div>' +
      '<div class="row"><label>Rotasi denah / yaw (°)</label>' +
        '<input type="number" step="any" id="g-rot" value="' + deg(ref.rotation) + '"></div>' +
      '<div class="row2">' +
        '<div><label>Miring X (°)</label><input type="number" step="any" id="g-tiltx" value="' + deg(ref.tiltX) + '"></div>' +
        '<div><label>Miring Z (°)</label><input type="number" step="any" id="g-tiltz" value="' + deg(ref.tiltZ) + '"></div>' +
      '</div>' +
      '<div class="sep">Ukuran grup <span class="unit-tag">' + tag + '</span></div>' +
      '<div class="row2">' +
        '<div><label>Lebar (X)</label><input type="number" step="any" min="0" id="g-w" value="' + f(g.w) + '"></div>' +
        '<div><label>Dalam (Y)</label><input type="number" step="any" min="0" id="g-d" value="' + f(g.d) + '"></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div><label>Tinggi</label><input type="number" step="any" min="0" id="g-h" value="' + f(g.height) + '"></div>' +
        '<div><label>Elevasi dasar</label><input type="number" step="any" id="g-elev" value="' + f(g.bottom) + '"></div>' +
      '</div>' +
      '<div class="grp-tip">Ukuran diskalakan <b>proporsional</b> — mengubah satu ' +
      'ikut mengubah dua lainnya, supaya anggota yang diputar miring tidak gepeng. ' +
      'Rotasi &amp; kemiringan diputar rigid terhadap pusat grup.</div>';
  }

  /** pasang handler untuk form properti grup */
  function bindGroupForm() {
    var ids = ['g-x', 'g-y', 'g-rot', 'g-tiltx', 'g-tiltz', 'g-w', 'g-d', 'g-h', 'g-elev'];
    ids.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('focus', function () {
        el.dataset.before = JSON.stringify(Project.serialize());
      });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      });
      el.addEventListener('change', function () { applyGroupField(id, el); });
    });
  }

  function applyGroupField(id, el) {
    var shapes = Project.selectedShapes();
    if (shapes.length < 2) return;
    var v = parseFloat(el.value);
    if (!isFinite(v)) { renderProps(); return; }

    var g = groupBox(shapes);
    var ref = shapes[0];
    if (el.dataset.before) Project.pushHistory(el.dataset.before);

    switch (id) {
      case 'g-x':    groupMove(shapes, v - g.cx, 0, 0); break;
      case 'g-y':    groupMove(shapes, 0, v - g.cy, 0); break;
      case 'g-elev': groupMove(shapes, 0, 0, v - g.bottom); break;

      case 'g-rot':   groupOrient(shapes, v, ref.tiltX || 0, ref.tiltZ || 0); break;
      case 'g-tiltx': groupOrient(shapes, ref.rotation || 0, v, ref.tiltZ || 0); break;
      case 'g-tiltz': groupOrient(shapes, ref.rotation || 0, ref.tiltX || 0, v); break;

      case 'g-w':
      case 'g-d':
      case 'g-h': {
        var base = id === 'g-w' ? g.w : (id === 'g-d' ? g.d : g.height);
        if (!(base > 1e-9) || !(v > 0)) { renderProps(); return; }
        groupScale(shapes, v / base);
        break;
      }
    }
    say('Grup diperbarui (' + shapes.length + ' objek ikut).');
  }

  /** kotak grup: pusat denah, lebar/dalam, titik terendah, tinggi total */
  function groupBox(shapes) {
    var b = Project.bounds(shapes.map(function (s) { return s.id; }));
    var bottom = groupBottom(shapes);
    var top = Math.max.apply(null, shapes.map(function (s) {
      var e = Shapes.planExtents(s);
      return (s.elevation || 0) + e.cy + e.ey;
    }));
    return { cx: b.cx, cy: b.cy, w: b.w, d: b.h, bottom: bottom, height: top - bottom };
  }

  /** geser seluruh grup (satuan project) */
  function groupMove(shapes, dx, dy, dElev) {
    var u = Project.unit();
    Project.updateMany(shapes.map(function (s) {
      return { id: s.id, patch: {
        x: Units.round(s.x + (dx || 0), u),
        y: Units.round(s.y + (dy || 0), u),
        elevation: Units.round((s.elevation || 0) + (dElev || 0), u)
      } };
    }), { source: 'ui', full: true });
  }

  /**
   * Skala grup secara PROPORSIONAL dengan faktor k.
   *
   * Sengaja uniform (ketiga sumbu sekaligus), bukan per-sumbu: menskalakan
   * satu sumbu saja akan menggepengkan anggota yang diputar miring — bentuknya
   * tidak lagi bisa diwakili oleh width/depth/height. Uniform selalu eksak,
   * berapa pun rotasi tiap anggotanya.
   */
  function groupScale(shapes, k) {
    if (!(k > 0) || Math.abs(k - 1) < 1e-9) return;
    var u = Project.unit();
    var g = groupBox(shapes);
    Project.updateMany(shapes.map(function (s) {
      var e = Shapes.planExtents(s);
      var bottom = (s.elevation || 0) + e.cy - e.ey;
      return { id: s.id, patch: {
        x: Units.roundFine(g.cx + (s.x - g.cx) * k, u),
        y: Units.roundFine(g.cy + (s.y - g.cy) * k, u),
        // elevasi diskalakan relatif terhadap dasar grup, supaya grup tetap
        // bertumpu di tempat yang sama, bukan melayang
        elevation: Units.roundFine((s.elevation || 0) + (g.bottom + (bottom - g.bottom) * k - bottom), u),
        width: Units.roundFine(s.width * k, u),
        depth: Units.roundFine(s.depth * k, u),
        height: Units.roundFine(s.height * k, u)
      } };
    }), { source: 'ui', full: true });
  }

  /** putar grup rigid sampai orientasi acuannya jadi (yaw, tiltX, tiltZ) */
  function groupOrient(shapes, yaw, tx, tz) {
    var ref = shapes[0];
    var cur = Shapes.composeRotation(ref.rotation || 0, ref.tiltX || 0, ref.tiltZ || 0);
    var target = Shapes.composeRotation(yaw, tx, tz);
    applyGroupRigid(shapes, Shapes.mat3Mul(target, Shapes.mat3Transpose(cur)));
  }

  function groupKeLantai(ids) {
    var shapes = ids.map(Project.get).filter(Boolean);
    if (!shapes.length) return;
    var u = Project.unit();
    var shift = -groupBottom(shapes);
    var list = shapes.map(function (s) {
      return { id: s.id, patch: { elevation: Units.round((s.elevation || 0) + shift, u) } };
    });
    Project.updateMany(list, { source: 'ui', full: true });
    say('Grup digeser bersama — titik terendahnya kini menyentuh lantai.');
  }

  function bindProps() {
    /* Mengetik di panel properti = banyak event input beruntun. Supaya undo
     * mengembalikan nilai SEBELUM diedit (bukan sesudah), snapshot diambil saat
     * field difokus lalu didorong ke history tepat pada keystroke pertama. */
    function editable(el, apply) {
      var pending = null;
      el.addEventListener('focus', function () { pending = JSON.stringify(Project.serialize()); });
      el.addEventListener('blur', function () { pending = null; });
      el.addEventListener('input', function () {
        var sel = Project.selection;
        if (sel.length !== 1) return;
        var patch = apply(el.value);
        if (!patch) return;
        if (pending) { Project.pushHistory(pending); pending = null; }
        editingProps = true;
        Project.update(sel[0], patch.value, { nohistory: true, source: 'ui', full: !!patch.full });
        editingProps = false;
      });
    }

    function numberField(key, field, positiveOnly) {
      editable(P[key], function (raw) {
        var v = parseFloat(raw);
        if (!isFinite(v)) return null;
        if (positiveOnly && v <= 0) return null;
        var patch = {};
        patch[field] = v;
        return { value: patch };
      });
    }

    numberField('x', 'x');
    numberField('y', 'y');
    numberField('rot', 'rotation');
    numberField('tiltx', 'tiltX');
    numberField('tiltz', 'tiltZ');
    numberField('w', 'width', true);
    numberField('d', 'depth', true);
    numberField('h', 'height', true);
    numberField('elev', 'elevation');

    editable(P.thickness, function (raw) {
      var v = parseFloat(raw);
      return (isFinite(v) && v > 0) ? { value: { meta: { thickness: v } }, full: true } : null;
    });

    editable(P.label, function (raw) { return { value: { meta: { label: raw } } }; });

    editable(P.color, function (raw) { return { value: { meta: { color: raw } }, full: true }; });

    P.solid.addEventListener('change', function () {
      var sel = Project.selection;
      if (sel.length !== 1) return;
      Project.update(sel[0], { meta: { solid: P.solid.checked } }, { source: 'ui', full: true });
    });

    P.locked.addEventListener('change', function () {
      var sel = Project.selection;
      if (sel.length !== 1) return;
      Project.update(sel[0], { meta: { locked: P.locked.checked } }, { source: 'ui', full: true });
    });

    P.cut.addEventListener('change', function () {
      var sel = Project.selection;
      if (sel.length !== 1) return;
      Project.update(sel[0], { meta: { cut: P.cut.checked } }, { source: 'ui', full: true });
      say(P.cut.checked ? 'Bukaan melubangi dinding.' : 'Bukaan hanya ditempel, dinding utuh.');
    });

    /* Mengubah kemiringan mengubah juga di mana dasar objek berada. Elevasi
     * ikut disesuaikan supaya titik terendah objek tetap di ketinggian semula —
     * silinder yang ditidurkan tidak amblas separuh ke dalam lantai. */
    function setTilt(tx, tz) {
      var sel = Project.selection;
      if (sel.length !== 1) return;
      var s = Project.get(sel[0]);
      if (!s) return;
      var u = Project.unit();
      var before = Shapes.planExtents(s);
      var bottom = (s.elevation || 0) + before.cy - before.ey;
      var after = Shapes.planExtents({
        width: s.width, depth: s.depth, height: s.height, tiltX: tx, tiltZ: tz
      });
      Project.update(sel[0], {
        tiltX: tx, tiltZ: tz,
        elevation: Units.round(bottom - after.cy + after.ey, u)
      }, { source: 'ui', full: true });
    }

    $('btn-lay').onclick = function () { setTilt(90, 0); say('Objek ditidurkan (miring X 90°).'); };
    $('btn-stand').onclick = function () { setTilt(0, 0); say('Objek ditegakkan.'); };

    $('btn-floor').onclick = function () {
      var sel = Project.selection;
      if (sel.length !== 1) return;
      var s = Project.get(sel[0]);
      var e = Shapes.planExtents(s);
      var u = Project.unit();
      Project.update(sel[0], { elevation: Units.round(e.ey - e.cy, u) }, { source: 'ui', full: true });
      say('Elevasi disetel supaya dasar objek menyentuh lantai.');
    };

    $('btn-dup').onclick = function () {
      var ids = Project.duplicate(Project.selection);
      if (ids.length) Project.setSelection(ids, { raw: true });
    };
    $('btn-del').onclick = function () { Project.remove(Project.selection); };
    $('btn-front').onclick = function () { Project.reorder(Project.selection, 1); };
    $('btn-back').onclick = function () { Project.reorder(Project.selection, -1); };
    $('btn-ungroup').onclick = doUngroup;

    $('btn-vertex').onclick = function () {
      if (Editor2D.isVertexEditing()) { Editor2D.exitVertexEdit(); return; }
      var sel = Project.selection;
      if (sel.length !== 1) return;
      if (Editor2D.startVertexEdit(sel[0])) say('Mode edit titik aktif. Esc untuk selesai.');
    };

    $('btn-poly-fix').onclick = function () {
      var sel = Project.selection;
      if (sel.length !== 1) return;
      var s = Project.get(sel[0]);
      if (!s) return;
      var fixed = Shapes.autoFixPolygon(Shapes.polygonLocal(s));
      if (!fixed) {
        say('Tidak bisa diperbaiki otomatis — bentuknya bukan "star-shaped" dari pusatnya. Rapikan manual lewat Edit Titik.', 'warn');
        return;
      }
      var patch = Shapes.polygonPatchFromLocal(s, fixed, Project.unit());
      if (!patch) { say('Gagal menerapkan perbaikan.', 'err'); return; }
      Project.update(s.id, patch, { source: 'ui', full: true });
      if (Editor2D.isVertexEditing()) Editor2D.exitVertexEdit();
      say('Poligon diperbaiki — titik yang sama, diurutkan ulang jadi bentuk yang tidak menyilang.');
    };
  }

  /* ------------------------------------------------------------------ */
  /* daftar objek                                                       */
  /* ------------------------------------------------------------------ */
  var EYE_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M10.6 5.1A11.7 11.7 0 0 1 12 5c7 0 11 7 11 7a19.6 19.6 0 0 1-3.7 4.6M6.4 6.6C3.5 8.3 1 12 1 12' +
    's4 7 11 7c1.6 0 3-.3 4.3-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M2 2l20 20"/></svg>';

  /** toggle tampil/sembunyi — objek tersembunyi juga dilewati saat export STL */
  function setVisible(ids, visible) {
    if (!ids.length) return;
    Project.updateMany(ids.map(function (id) {
      return { id: id, patch: { meta: { visible: visible } } };
    }), { source: 'ui', full: true });
  }

  function renderLayers() {
    var wrap = $('layer-list');
    var sel = Project.selection;
    var shapes = Project.shapes;
    wrap.innerHTML = '';
    $('layer-count').textContent = shapes.length;

    for (var i = shapes.length - 1; i >= 0; i--) {
      (function (s) {
        var on = Shapes.isVisible(s);
        var row = document.createElement('div');
        row.className = 'layer' + (sel.indexOf(s.id) >= 0 ? ' sel' : '') + (on ? '' : ' off');

        var eye = document.createElement('button');
        eye.className = 'eye';
        eye.innerHTML = on ? EYE_ON : EYE_OFF;
        eye.title = on ? 'Sembunyikan objek' : 'Tampilkan objek';
        eye.onclick = function (e) {
          e.stopPropagation();          // klik mata jangan ikut memilih baris
          setVisible([s.id], !on);
        };
        row.appendChild(eye);

        var rest = document.createElement('span');
        rest.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0';
        rest.innerHTML =
          '<span class="sw" style="background:' + s.meta.color + '"></span>' +
          (s.meta.group ? '<span class="lk" title="Bagian dari grup">&#9741;</span>' : '') +
          '<span class="nm">' + escapeHtml(s.meta.label || Shapes.name(s.type)) + '</span>' +
          '<span class="ty">' + Shapes.name(s.type) + '</span>';
        row.appendChild(rest);

        row.onclick = function (e) {
          if (e.shiftKey || e.ctrlKey) Project.toggleSelection(s.id);
          else Project.setSelection([s.id]);
        };
        row.ondblclick = function () { Editor2D.fit([s.id]); };
        wrap.appendChild(row);
      })(shapes[i]);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }


  /* ------------------------------------------------------------------ */
  /* penyimpanan server (opsional)                                       */
  /*                                                                    */
  /* Backend boleh tidak ada sama sekali — kalau probe gagal, seluruh    */
  /* tombol server disembunyikan dan aplikasi tetap penuh fungsi dengan  */
  /* localStorage. Itu yang menjaga deploy statis tetap sah.             */
  /* ------------------------------------------------------------------ */

  function serverReady() { return API.state.available && API.state.authed; }

  function refreshServerButton() {
    var b = $('btn-server');
    var st = API.state;
    b.hidden = !st.available;
    if (!st.available) return;
    if (!st.configured) {
      b.textContent = 'Server: belum disetel';
      b.title = 'Password server belum diset. Di VPS jalankan: npm run set-password';
      b.classList.remove('active');
    } else if (st.authed) {
      b.textContent = 'Server ✓';
      b.title = 'Tersambung ke penyimpanan server — klik untuk keluar';
      b.classList.add('active');
    } else {
      b.textContent = 'Server: login';
      b.title = 'Klik untuk login ke penyimpanan server';
      b.classList.remove('active');
    }
  }

  /** tampilkan dialog login; onDone dipanggil kalau berhasil */
  function askLogin(onDone) {
    modal({
      title: 'Login ke server',
      body: '<p>Masukkan password penyimpanan server.</p>' +
            '<label>Password</label><input type="password" id="m-pw" autocomplete="current-password">' +
            '<div id="m-pw-err" style="color:#e2564a;font-size:11.5px;min-height:15px"></div>',
      actions: [
        { label: 'Batal' },
        { label: 'Login', primary: true, onClick: function () {
            var pw = $('m-pw').value;
            if (!pw) { $('m-pw-err').textContent = 'Password belum diisi.'; return false; }
            API.login(pw).then(function () {
              closeModal();
              refreshServerButton();
              say('Tersambung ke penyimpanan server.');
              if (onDone) onDone();
            }).catch(function (e) {
              var el = $('m-pw-err');
              if (el) el.textContent = e.message;
            });
            return false;   // modal ditutup manual setelah request selesai
          } }
      ],
      onOpen: function () {
        setTimeout(function () { $('m-pw').focus(); }, 30);
        $('m-pw').addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            $('modal-actions').lastChild.click();
          }
        });
      }
    });
  }

  function bindServerButton() {
    $('btn-server').onclick = function () {
      if (!API.state.available) return;
      if (!API.state.configured) {
        modal({
          title: 'Password server belum diset',
          body: '<p>Backend-nya jalan, tapi passwordnya belum pernah diset. ' +
                'Di server jalankan:</p><p><code>cd server &amp;&amp; npm run set-password</code></p>'
        });
        return;
      }
      if (API.state.authed) {
        API.logout().then(function () {
          refreshServerButton();
          say('Keluar dari penyimpanan server.');
        }).catch(function (e) { say(e.message, 'err'); });
      } else {
        askLogin();
      }
    };
  }

  /** render daftar project server ke dalam elemen box */
  function renderServerList(box, onPick) {
    box.innerHTML = '<div class="empty">Memuat…</div>';
    API.list().then(function (list) {
      if (!list.length) {
        box.innerHTML = '<div class="empty">Belum ada project di server.</div>';
        return;
      }
      box.innerHTML = '';
      list.forEach(function (it) {
        var row = document.createElement('div');
        row.className = 'mrow';
        row.innerHTML = '<span class="mnm">' + escapeHtml(it.name) + '</span>' +
                        '<span class="mdt">' + new Date(it.updated).toLocaleString('id-ID') + '</span>' +
                        '<button class="mdel" title="Hapus dari server">&times;</button>';
        row.onclick = function (e) {
          if (e.target.classList.contains('mdel')) {
            API.remove(it.id).then(function () {
              row.remove();
              say('Project "' + it.name + '" dihapus dari server.');
            }).catch(function (err) { say(err.message, 'err'); });
            return;
          }
          onPick(it);
        };
        box.appendChild(row);
      });
    }).catch(function (e) {
      box.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>';
      if (e.status === 401) refreshServerButton();
    });
  }

  /* ------------------------------------------------------------------ */
  /* toolbar                                                            */
  /* ------------------------------------------------------------------ */
  function bindToolbar() {
    $('project-name').addEventListener('input', function () {
      Project.state.name = $('project-name').value;
    });

    $('btn-new').onclick = function () {
      modal({
        title: 'Project baru',
        body: '<p>Semua objek di kanvas akan dihapus. Project yang belum disimpan akan hilang.</p>',
        actions: [
          { label: 'Batal' },
          { label: 'Buat Baru', danger: true, onClick: function () {
              Project.reset();
              serverProjectId = null;
              $('project-name').value = Project.state.name;
              Editor2D.fit();
              say('Project baru dibuat.');
            } }
        ]
      });
    };

    $('btn-save').onclick = function () {
      var toServer = serverReady();
      modal({
        title: 'Simpan project',
        body: '<label>Nama project</label><input type="text" id="m-save-name" value="' +
              escapeHtml(Project.state.name) + '">' +
              (API.state.available
                ? '<label>Simpan ke</label>' +
                  '<div class="seg loc" id="m-loc">' +
                    '<button class="tb' + (toServer ? '' : ' active') + '" data-loc="local">Browser ini</button>' +
                    '<button class="tb' + (toServer ? ' active' : '') + '" data-loc="server">Server</button>' +
                  '</div>'
                : '') +
              '<p style="color:#6b7a8d;font-size:11.5px;margin:8px 0 0" id="m-save-note"></p>',
        actions: [
          { label: 'Batal' },
          { label: 'Simpan', primary: true, onClick: function () {
              var n = ($('m-save-name').value || '').trim();
              if (!n) { say('Nama project tidak boleh kosong.', 'err'); return false; }

              if (currentLoc() !== 'server') {
                try {
                  Project.saveNamed(n);
                  $('project-name').value = n;
                  say('Tersimpan di browser ini sebagai "' + n + '".');
                } catch (e) { say('Gagal menyimpan: ' + e.message, 'err'); }
                return;
              }

              API.save(n, Project.serialize(), serverProjectId).then(function (pr) {
                serverProjectId = pr.id;
                Project.state.name = n;
                $('project-name').value = n;
                closeModal();
                say('Tersimpan di server sebagai "' + n + '".');
              }).catch(function (e) {
                if (e.status === 401) {
                  refreshServerButton();
                  closeModal();
                  askLogin();
                  say('Sesi server berakhir — login lagi lalu simpan ulang.', 'warn');
                } else {
                  say('Gagal menyimpan ke server: ' + e.message, 'err');
                }
              });
              return false;   // tunggu jawaban server dulu
            } }
        ],
        onOpen: function () {
          setTimeout(function () { $('m-save-name').select(); }, 30);
          wireLocToggle(updateSaveNote);
          updateSaveNote();
        }
      });
    };

    function currentLoc() {
      var active = document.querySelector('#m-loc .tb.active');
      return active ? active.dataset.loc : 'local';
    }

    function wireLocToggle(onChange) {
      var seg = $('m-loc');
      if (!seg) return;
      seg.querySelectorAll('.tb').forEach(function (b) {
        b.onclick = function (e) {
          e.preventDefault();
          // pilih Server tapi belum login -> minta login dulu
          if (b.dataset.loc === 'server' && !serverReady()) {
            closeModal();
            askLogin();
            return;
          }
          seg.querySelectorAll('.tb').forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          if (onChange) onChange();
        };
      });
    }

    function updateSaveNote() {
      var el = $('m-save-note');
      if (!el) return;
      el.innerHTML = currentLoc() === 'server'
        ? 'Disimpan di server, bisa dibuka dari komputer mana pun. Nama yang sama akan menimpa project yang sudah ada.'
        : 'Disimpan di browser ini saja (localStorage). Untuk backup atau pindah komputer, pakai <b>Export JSON</b>.';
    }

    $('btn-open').onclick = function () {
      var startServer = serverReady();
      modal({
        title: 'Buka project',
        body: (API.state.available
                ? '<div class="seg loc" id="m-loc">' +
                    '<button class="tb' + (startServer ? '' : ' active') + '" data-loc="local">Browser ini</button>' +
                    '<button class="tb' + (startServer ? ' active' : '') + '" data-loc="server">Server</button>' +
                  '</div>'
                : '') +
              '<div class="mlist" id="m-list" style="margin-top:10px"></div>',
        actions: [{ label: 'Tutup' }],
        onOpen: function () {
          wireLocToggle(renderOpenList);
          renderOpenList();
        }
      });
    };

    function renderOpenList() {
      var box = $('m-list');
      if (!box) return;

      if (currentLoc() === 'server') {
        renderServerList(box, function (it) {
          API.load(it.id).then(function (pr) {
            var skipped = Project.load(pr.data);
            Project.state.name = pr.name;
            serverProjectId = pr.id;
            $('project-name').value = pr.name;
            syncToolbarFromProject();
            Editor2D.fit();
            Viewer3D.fit();
            closeModal();
            say('Dibuka dari server: ' + pr.name +
                (skipped ? ' (' + skipped + ' objek tidak dikenali dilewati)' : ''));
          }).catch(function (e) { say('Gagal memuat: ' + e.message, 'err'); });
        });
        return;
      }

      var list = Project.listSaved();
      if (!list.length) {
        box.innerHTML = '<div class="empty">Belum ada project tersimpan di browser ini.</div>';
        return;
      }
      box.innerHTML = '';
      list.forEach(function (it) {
        var row = document.createElement('div');
        row.className = 'mrow';
        row.innerHTML = '<span class="mnm">' + escapeHtml(it.name) + '</span>' +
                        '<span class="mdt">' + new Date(it.updated).toLocaleString('id-ID') + '</span>' +
                        '<button class="mdel" title="Hapus">&times;</button>';
        row.onclick = function (e) {
          if (e.target.classList.contains('mdel')) {
            Project.deleteNamed(it.key);
            row.remove();
            say('Project "' + it.name + '" dihapus.');
            return;
          }
          try {
            var skipped = Project.loadNamed(it.key);
            serverProjectId = null;
            $('project-name').value = Project.state.name;
            syncToolbarFromProject();
            Editor2D.fit();
            Viewer3D.fit();
            closeModal();
            say('Dibuka: ' + it.name + (skipped ? ' (' + skipped + ' objek dilewati)' : ''));
          } catch (err) { say('Gagal membuka: ' + err.message, 'err'); }
        };
        box.appendChild(row);
      });
    }

    $('btn-import').onclick = function () { $('file-input').click(); };
    $('file-input').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var skipped = Project.load(JSON.parse(rd.result));
          serverProjectId = null;
          $('project-name').value = Project.state.name;
          syncToolbarFromProject();
          Editor2D.fit();
          Viewer3D.fit();
          say('Import berhasil: ' + Project.shapes.length + ' objek' +
              (skipped ? ', ' + skipped + ' dilewati' : ''));
        } catch (err) {
          say('Import gagal: ' + err.message, 'err');
        }
      };
      rd.readAsText(f);
      e.target.value = '';
    });

    $('btn-export-json').onclick = function () {
      var data = JSON.stringify(Project.serialize(), null, 2);
      STL.download(new Blob([data], { type: 'application/json' }), safeName(Project.state.name) + '.json');
      say('JSON diexport.');
    };

    $('btn-undo').onclick = function () { Project.undo(); };
    $('btn-redo').onclick = function () { Project.redo(); };

    $('unit-select').addEventListener('change', function () {
      Project.setUnit($('unit-select').value);
      renderProps();
      Editor2D.drawGrid();
      Editor2D.refreshLabels();
      say('Satuan diganti ke ' + $('unit-select').value + ' (ukuran fisik tetap).');
    });

    $('btn-rescale').onclick = function () {
      modal({
        title: 'Skala ulang project',
        body: '<p>Semua ukuran dikalikan faktor berikut — <b>ukuran fisik ikut berubah</b>. ' +
              'Untuk sekadar ganti satuan tanpa mengubah ukuran, pakai dropdown Satuan.</p>' +
              '<label>Faktor</label><input type="number" id="m-scale" value="2" step="0.1" min="0.01">',
        actions: [
          { label: 'Batal' },
          { label: 'Terapkan', primary: true, onClick: function () {
              var k = parseFloat($('m-scale').value);
              if (!(k > 0)) { say('Faktor harus lebih dari 0.', 'err'); return false; }
              Project.rescale(k);
              Editor2D.fit();
              Viewer3D.fit();
              say('Project diskala ×' + k + '.');
            } }
        ]
      });
    };

    $('btn-zoom-in').onclick = function () { Editor2D.zoomBy(1); };
    $('btn-zoom-out').onclick = function () { Editor2D.zoomBy(-1); };
    $('btn-zoom-fit').onclick = function () { Editor2D.fit(); };
    $('btn-3d-fit').onclick = function () { Viewer3D.fit(Project.selection); };

    $('chk-snap-grid').addEventListener('change', function () {
      Project.state.grid.snap = this.checked;
      say('Snap grid ' + (this.checked ? 'aktif' : 'mati') + '.');
    });

    $('chk-snap-angle').addEventListener('change', function () {
      Project.state.snapAngle.on = this.checked;
      $('snap-angle-step').disabled = !this.checked;
      Editor2D.applySnapAngle();
      say('Snap sudut ' + (this.checked ? 'aktif (' + Project.state.snapAngle.step + '°)' : 'mati') + '.');
    });

    $('chk-cursor').addEventListener('change', function () {
      Project.state.cursorTip = this.checked;
      Editor2D.refreshCursorTip();
      say('Penunjuk koordinat ' + (this.checked ? 'aktif' : 'dimatikan') + '.');
    });

    $('snap-angle-step').addEventListener('change', function () {
      Project.state.snapAngle.step = parseFloat(this.value);
      Editor2D.applySnapAngle();
    });

    document.querySelectorAll('#view-mode .tb').forEach(function (b) {
      b.onclick = function () { setView(b.dataset.view); };
    });

    bindSplitter();
    bindRSplitter();

    $('btn-stl-all').onclick = function () { doExportSTL(null); };
    $('btn-stl-sel').onclick = function () {
      if (!Project.selection.length) { say('Pilih dulu objek yang mau diexport.', 'warn'); return; }
      doExportSTL(Project.selection);
    };

    $('modal-backdrop').addEventListener('mousedown', function (e) {
      if (e.target === $('modal-backdrop')) closeModal();
    });
  }

  /* ------------------------------------------------------------------ */
  /* mode tampilan & pembatas panel yang bisa digeser                   */
  /* ------------------------------------------------------------------ */
  var KEY_SPLIT = 'layout3d:split';

  function setView(mode) {
    document.querySelectorAll('#view-mode .tb').forEach(function (x) {
      x.classList.toggle('active', x.dataset.view === mode);
    });
    document.body.setAttribute('data-view', mode);
    $('btn-hide-3d').innerHTML = mode === '2d' ? '&lsaquo;&lsaquo;' : '&rsaquo;&rsaquo;';
    setTimeout(function () { Editor2D.resize(); Viewer3D.resize(); }, 30);
  }

  function setSplit(pct) {
    pct = Math.max(15, Math.min(85, pct));
    // lewat CSS variable, bukan inline style, supaya aturan mode 2D/3D
    // di stylesheet masih bisa menimpanya
    document.documentElement.style.setProperty('--split', pct + '%');
    try { localStorage.setItem(KEY_SPLIT, String(pct)); } catch (e) { /* private mode */ }
    return pct;
  }

  /** pembatas Properti / Objek di panel kanan — tingginya bisa digeser */
  var KEY_RSPLIT = 'layout3d:rsplit';

  function setRSplit(pct) {
    pct = Math.max(18, Math.min(82, pct));
    document.documentElement.style.setProperty('--rsplit', pct + '%');
    try { localStorage.setItem(KEY_RSPLIT, String(pct)); } catch (e) { /* mode privat */ }
    return pct;
  }

  function bindRSplitter() {
    var sp = $('rsplit');
    var right = $('right');
    var dragging = false;

    try {
      var saved = parseFloat(localStorage.getItem(KEY_RSPLIT));
      if (isFinite(saved)) setRSplit(saved);
    } catch (e) { /* abaikan */ }

    sp.addEventListener('mousedown', function (e) {
      e.preventDefault();
      dragging = true;
      sp.classList.add('dragging');
      document.body.style.cursor = 'row-resize';
    });

    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var r = right.getBoundingClientRect();
      // dikurangi tinggi judul "Properti" supaya kursor pas di garis pembatas
      var head = right.querySelector('.panel-head');
      var top = r.top + (head ? head.offsetHeight : 0);
      setRSplit(((e.clientY - top) / (r.height - (head ? head.offsetHeight : 0))) * 100);
    });

    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      sp.classList.remove('dragging');
      document.body.style.cursor = '';
    });

    sp.addEventListener('dblclick', function () {
      setRSplit(52);
      say('Tinggi panel diseimbangkan.');
    });
  }

  function bindSplitter() {
    var sp = $('splitter');
    var center = $('center');
    var dragging = false;

    try {
      var saved = parseFloat(localStorage.getItem(KEY_SPLIT));
      if (isFinite(saved)) setSplit(saved);
    } catch (e) { /* abaikan */ }

    sp.addEventListener('mousedown', function (e) {
      if (e.target.id === 'btn-hide-3d') return;   // tombol collapse punya aksinya sendiri
      e.preventDefault();
      dragging = true;
      sp.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
    });

    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var r = center.getBoundingClientRect();
      setSplit(((e.clientX - r.left) / r.width) * 100);
      Editor2D.resize();
      Viewer3D.resize();
    });

    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      sp.classList.remove('dragging');
      document.body.style.cursor = '';
      Editor2D.resize();
      Viewer3D.resize();
    });

    sp.addEventListener('dblclick', function (e) {
      if (e.target.id === 'btn-hide-3d') return;
      setSplit(50);
      Editor2D.resize();
      Viewer3D.resize();
      say('Panel dibagi sama rata.');
    });

    $('btn-hide-3d').onclick = function (e) {
      e.stopPropagation();
      setView(document.body.getAttribute('data-view') === '2d' ? 'split' : '2d');
    };
  }

  function safeName(n) {
    return (n || 'layout3d').replace(/[^a-zA-Z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '') || 'layout3d';
  }

  function doExportSTL(ids) {
    var objs = Viewer3D.exportables(ids);
    if (!objs.length) {
      say('Tidak ada objek solid untuk diexport (cek centang "Sertakan di export STL").', 'warn');
      return;
    }
    var ps = parseFloat($('print-scale').value) || 1;
    try {
      var r = STL.exportSTL(objs, {
        printScale: ps,
        filename: safeName(Project.state.name) + (ids ? '_terpilih' : '') + '_1-' + ps + '.stl',
        title: Project.state.name
      });
      say('STL: ' + objs.length + ' objek, ' + r.triangles.toLocaleString('id-ID') + ' segitiga, ' +
          'ukuran cetak ' + fmtMm(r.size.x) + ' × ' + fmtMm(r.size.y) + ' × ' + fmtMm(r.size.z) + ' mm.');
    } catch (e) {
      say('Export STL gagal: ' + e.message, 'err');
    }
  }

  function fmtMm(v) { return (Math.round(v * 10) / 10).toString(); }

  /* ------------------------------------------------------------------ */
  /* shortcut keyboard                                                  */
  /* ------------------------------------------------------------------ */
  function bindKeys() {
    window.addEventListener('keydown', function (e) {
      var t = e.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

      if (e.code === 'Space' && !typing) { Editor2D.setSpace(true); e.preventDefault(); return; }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) Project.redo(); else Project.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); Project.redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); $('btn-save').click(); return;
      }
      if (typing) return;

      // mode gambar poligon menyerap tombol-tombol ini lebih dulu
      if (Editor2D.isDrawing()) {
        if (e.key === 'Escape') { e.preventDefault(); Editor2D.cancelDraw(); return; }
        if (e.key === 'Enter')  { e.preventDefault(); Editor2D.finishDraw(); return; }
        if (e.key === 'Backspace') { e.preventDefault(); Editor2D.undoDrawPoint(); return; }
        return;
      }
      if (Editor2D.isVertexEditing() && e.key === 'Escape') {
        e.preventDefault(); Editor2D.exitVertexEdit(); return;
      }
      if (e.key === 'p' || e.key === 'P') { Editor2D.startDraw(); return; }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        Project.setSelection(Project.shapes.map(function (s) { return s.id; }), { raw: true });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        var ids = Project.duplicate(Project.selection);
        if (ids.length) Project.setSelection(ids, { raw: true });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) doUngroup(); else doGroup();
        return;
      }
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        var modes = { '1': '2d', '2': 'split', '3': '3d' };
        var btn = document.querySelector('#view-mode .tb[data-view="' + modes[e.key] + '"]');
        if (btn) btn.click();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (Project.selection.length) { e.preventDefault(); Project.remove(Project.selection); }
        return;
      }
      if (e.key === 'Escape') { Project.setSelection([]); closeModal(); return; }
      if ((e.key === 'h' || e.key === 'H') && Project.selection.length) {
        var shown = Project.selectedShapes().some(Shapes.isVisible);
        setVisible(Project.selection, !shown);
        say(shown ? 'Objek disembunyikan (H untuk tampilkan lagi).' : 'Objek ditampilkan.');
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        Editor2D.fit(Project.selection);
        Viewer3D.fit(Project.selection);
        return;
      }

      var arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key] && Project.selection.length) {
        e.preventDefault();
        var u = Project.unit();
        var step = Units.def(u).nudge * (e.shiftKey ? 10 : 1);
        var d = arrows[e.key];
        var list = Project.selectedShapes().map(function (s) {
          return { id: s.id, patch: {
            x: Units.round(s.x + d[0] * step, u),
            y: Units.round(s.y + d[1] * step, u)
          } };
        });
        Project.updateMany(list, { source: 'ui' });
      }
    });

    window.addEventListener('keyup', function (e) {
      if (e.code === 'Space') Editor2D.setSpace(false);
    });
  }

  /* ------------------------------------------------------------------ */
  function syncToolbarFromProject() {
    $('unit-select').value = Project.state.scale.unit;
    $('chk-snap-grid').checked = !!Project.state.grid.snap;
    $('chk-snap-angle').checked = !!Project.state.snapAngle.on;
    $('snap-angle-step').value = String(Project.state.snapAngle.step);
    $('chk-cursor').checked = Project.state.cursorTip !== false;
    $('snap-angle-step').disabled = !Project.state.snapAngle.on;
    $('project-name').value = Project.state.name;
    Editor2D.applySnapAngle();
  }

  function syncHistoryButtons() {
    $('btn-undo').disabled = !Project.canUndo();
    $('btn-redo').disabled = !Project.canRedo();
  }

  /* ------------------------------------------------------------------ */
  function init() {
    DEFAULT_HINT = $('status-hint').textContent;
    cacheProps();
    buildLibrary();
    bindProps();
    bindToolbar();
    bindServerButton();
    bindKeys();

    Project.on('change', function (info) {
      // load / undo / ganti satuan bisa mengubah setting project itu sendiri,
      // jadi toolbar harus ikut menyesuaikan
      if (info && (info.reason === 'load' || info.reason === 'undo' ||
                   info.reason === 'redo' || info.reason === 'unit')) {
        syncToolbarFromProject();
      }
      if (!editingProps) renderProps();
      renderLayers();
      syncHistoryButtons();
    });
    Project.on('select', function () {
      renderProps();
      renderLayers();
    });
    Project.on('history', syncHistoryButtons);

    /* Objek yang keluar batas tanah tidak diblokir — cuma ditandai. Bidang
     * tanah sering dipakai sebagai acuan sementara, dan menolak penempatan
     * justru menghalangi saat orang memang sedang menata kasar dulu. */
    Project.on('land-warn', function (e) {
      var el = $('status-land');
      var list = (e && e.list) || [];
      el.hidden = !list.length;
      if (!list.length) return;
      var full = list.filter(function (b) { return b.status === 'out'; }).length;
      el.textContent = '⚠ ' + list.length + ' objek di luar batas tanah' +
        (full ? ' (' + full + ' sepenuhnya)' : '');
      el.title = 'Klik untuk memilih objek yang keluar batas';
      el.onclick = function () {
        Project.setSelection(list.map(function (b) { return b.id; }), { raw: true });
        Editor2D.fit(list.map(function (b) { return b.id; }));
      };
    });
    Project.on('zoom', function (e) {
      $('zoom-label').textContent = Math.round(e.zoom * 100) + '%';
    });

    Project.on('draw', function (e) {
      var item = document.querySelector('#shape-library .item[data-type="polygon"]');
      if (item) item.classList.toggle('active', !!e.active);
      $('pane-2d-badge').textContent = e.active
        ? 'Gambar poligon — ' + e.count + ' titik'
        : '2D — Denah / Site';
      $('status-hint').textContent = e.active
        ? 'Klik = tambah titik · Shift = kunci 45° · Enter atau klik titik awal = selesai · Backspace = batal 1 titik · Esc = batal'
        : DEFAULT_HINT;
      if (e.message) say(e.message, e.kind);
    });

    Project.on('vertexedit', function (e) {
      $('btn-vertex').classList.toggle('active', !!e.active);
      $('pane-2d-badge').textContent = e.active ? 'Edit titik poligon' : '2D — Denah / Site';
      $('status-hint').textContent = e.active
        ? 'Geser titik · klik titik tengah sisi = tambah · Alt+klik = hapus · Esc = selesai'
        : DEFAULT_HINT;
    });

    // cek backend sekali di awal; kalau tidak ada, fitur server tetap tersembunyi
    API.probe().then(refreshServerButton);

    syncToolbarFromProject();
    renderProps();
    renderLayers();
    syncHistoryButtons();
    $('zoom-label').textContent = Math.round(Editor2D.getZoom() * 100) + '%';
  }

  global.UI = {
    init: init,
    say: say,
    modal: modal,
    closeModal: closeModal,
    syncToolbarFromProject: syncToolbarFromProject,
    addShape: addShape,
    addPreset: addPreset
  };
})(window);
