/* layout3d — state project, undo/redo, storage
 *
 * Bentuk data yang disimpan (persis ini yang jadi isi file .json):
 *   {
 *     version: 1,
 *     name: "Untitled",
 *     scale: { unit: "m", pxPerMeter: 40 },
 *     grid:  { show: true, snap: false },
 *     snapAngle: { on: false, step: 15 },
 *     shapes: [ { id, type, x, y, width, depth, rotation, height, elevation,
 *                 points?, meta:{label,color,solid,locked,group,thickness} } ]
 *   }
 */
(function (global) {
  'use strict';

  var KEY_AUTOSAVE = 'layout3d:autosave';
  var KEY_PROJECTS = 'layout3d:projects';
  var HISTORY_MAX = 60;

  var listeners = {};
  var undoStack = [];
  var redoStack = [];

  var state = blank();
  var selection = [];

  function blank() {
    return {
      version: 1,
      name: 'Untitled',
      scale: { unit: 'm', pxPerMeter: 40 },
      grid: { show: true, snap: false },
      snapAngle: { on: false, step: 15 },
      cursorTip: true,        // penunjuk koordinat yang mengikuti kursor
      label3d: true,          // nama objek tampil di panel 3D
      shapes: []
    };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ------------------------------------------------------------------ */
  /* events                                                             */
  /* ------------------------------------------------------------------ */
  function on(evt, fn) { (listeners[evt] || (listeners[evt] = [])).push(fn); }
  function emit(evt, payload) {
    var l = listeners[evt];
    if (!l) return;
    for (var i = 0; i < l.length; i++) {
      try { l[i](payload || {}); }
      catch (e) { console.error('[layout3d] listener ' + evt + ':', e); }
    }
  }
  function changed(info) {
    emit('change', info || {});
    scheduleAutosave();
  }

  /* ------------------------------------------------------------------ */
  /* history                                                            */
  /* ------------------------------------------------------------------ */
  /** @param snapshot JSON state tertentu (untuk edit bertahap seperti ketik di
   *                  panel properti, di mana snapshot harus diambil SEBELUM
   *                  keystroke pertama) — default: state saat ini */
  function pushHistory(snapshot) {
    undoStack.push(snapshot || JSON.stringify(state));
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack.length = 0;
    emit('history');
  }

  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(JSON.stringify(state));
    state = JSON.parse(undoStack.pop());
    pruneSelection();
    emit('history');
    changed({ reason: 'undo', full: true });
    emit('select', { ids: selection.slice() });
    return true;
  }

  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(JSON.stringify(state));
    state = JSON.parse(redoStack.pop());
    pruneSelection();
    emit('history');
    changed({ reason: 'redo', full: true });
    emit('select', { ids: selection.slice() });
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* akses shape                                                        */
  /* ------------------------------------------------------------------ */
  function get(id) {
    for (var i = 0; i < state.shapes.length; i++) if (state.shapes[i].id === id) return state.shapes[i];
    return null;
  }
  function indexOf(id) {
    for (var i = 0; i < state.shapes.length; i++) if (state.shapes[i].id === id) return i;
    return -1;
  }

  function add(shapes, opts) {
    opts = opts || {};
    if (!Array.isArray(shapes)) shapes = [shapes];
    if (!opts.nohistory) pushHistory();
    var ids = [];
    for (var i = 0; i < shapes.length; i++) {
      state.shapes.push(shapes[i]);
      ids.push(shapes[i].id);
    }
    changed({ reason: 'add', ids: ids, full: true, source: opts.source });
    return ids;
  }

  function remove(ids, opts) {
    opts = opts || {};
    if (!Array.isArray(ids)) ids = [ids];
    if (!ids.length) return;
    if (!opts.nohistory) pushHistory();
    state.shapes = state.shapes.filter(function (s) { return ids.indexOf(s.id) < 0; });
    pruneSelection();
    changed({ reason: 'remove', ids: ids, full: true, source: opts.source });
    emit('select', { ids: selection.slice() });
  }

  function update(id, patch, opts) {
    opts = opts || {};
    var s = get(id);
    if (!s) return null;
    if (!opts.nohistory) pushHistory();
    Shapes.assign(s, patch);
    changed({ reason: 'update', ids: [id], full: !!opts.full, source: opts.source });
    return s;
  }

  /** update banyak shape sekaligus: list = [{id, patch}, ...] */
  function updateMany(list, opts) {
    opts = opts || {};
    if (!list.length) return;
    if (!opts.nohistory) pushHistory();
    var ids = [];
    for (var i = 0; i < list.length; i++) {
      var s = get(list[i].id);
      if (!s) continue;
      Shapes.assign(s, list[i].patch);
      ids.push(s.id);
    }
    changed({ reason: 'update', ids: ids, full: !!opts.full, source: opts.source });
  }

  function duplicate(ids) {
    if (!ids || !ids.length) return [];
    pushHistory();
    var k = Units.factor('m', state.scale.unit) * 0.5; // offset 0.5 m
    var groupMap = {};
    var copies = [];
    for (var i = 0; i < ids.length; i++) {
      var src = get(ids[i]);
      if (!src) continue;
      var c = clone(src);
      c.id = Shapes.uid();
      c.x = Units.round(c.x + k, state.scale.unit);
      c.y = Units.round(c.y + k, state.scale.unit);
      if (c.meta && c.meta.group) {
        if (!groupMap[c.meta.group]) groupMap[c.meta.group] = Shapes.uid();
        c.meta.group = groupMap[c.meta.group];
      }
      state.shapes.push(c);
      copies.push(c.id);
    }
    changed({ reason: 'add', ids: copies, full: true });
    return copies;
  }

  /* ------------------------------------------------------------------ */
  /* grup                                                               */
  /* ------------------------------------------------------------------ */

  /** semua id yang segrup dengan salah satu dari `ids` (termasuk ids sendiri) */
  function expandGroups(ids) {
    var groups = {}, out = ids.slice(), i;
    for (i = 0; i < ids.length; i++) {
      var s = get(ids[i]);
      if (s && s.meta && s.meta.group) groups[s.meta.group] = true;
    }
    for (i = 0; i < state.shapes.length; i++) {
      var o = state.shapes[i];
      if (o.meta && o.meta.group && groups[o.meta.group] && out.indexOf(o.id) < 0) out.push(o.id);
    }
    return out;
  }

  /** gabungkan jadi satu grup; anggota grup lama ikut terbawa */
  function group(ids) {
    var all = expandGroups(ids || []);
    if (all.length < 2) return null;
    pushHistory();
    var g = Shapes.uid();
    // kalau salah satu grup lama sudah punya nama, nama itu dibawa —
    // menggabung grup bernama ke seleksi lain tidak menghapus namanya
    var inherited = '';
    for (var i = 0; i < all.length; i++) {
      var o = get(all[i]);
      if (o && o.meta && o.meta.groupName) { inherited = o.meta.groupName; break; }
    }
    for (i = 0; i < all.length; i++) {
      var s = get(all[i]);
      if (!s) continue;
      s.meta.group = g;
      if (inherited) s.meta.groupName = inherited;
    }
    changed({ reason: 'group', ids: all, full: true });
    return { id: g, ids: all };
  }

  /** lepas grup dari shape terpilih (seluruh grupnya dibubarkan) */
  function ungroup(ids) {
    var all = expandGroups(ids || []).filter(function (id) {
      var s = get(id);
      return s && s.meta && s.meta.group;
    });
    if (!all.length) return [];
    pushHistory();
    for (var i = 0; i < all.length; i++) {
      var s = get(all[i]);
      if (s) { delete s.meta.group; delete s.meta.groupName; }
    }
    changed({ reason: 'ungroup', ids: all, full: true });
    return all;
  }

  /**
   * Susun ulang seluruh daftar sesuai urutan gambar yang diberikan
   * (indeks awal = paling belakang, indeks akhir = paling depan).
   * Id yang tidak disebut tetap di urutan relatifnya, ditaruh di belakang.
   */
  function setOrder(ids) {
    pushHistory();
    var map = {}, i;
    for (i = 0; i < state.shapes.length; i++) map[state.shapes[i].id] = state.shapes[i];
    var out = [];
    for (i = 0; i < ids.length; i++) {
      if (map[ids[i]]) { out.push(map[ids[i]]); delete map[ids[i]]; }
    }
    for (i = 0; i < state.shapes.length; i++) {
      if (map[state.shapes[i].id]) out.push(state.shapes[i]);
    }
    state.shapes = out;
    changed({ reason: 'reorder', full: true });
  }

  function reorder(ids, dir) {
    if (!ids.length) return;
    pushHistory();
    var moving = state.shapes.filter(function (s) { return ids.indexOf(s.id) >= 0; });
    var rest = state.shapes.filter(function (s) { return ids.indexOf(s.id) < 0; });
    state.shapes = dir > 0 ? rest.concat(moving) : moving.concat(rest);
    changed({ reason: 'reorder', full: true });
  }

  /* ------------------------------------------------------------------ */
  /* seleksi                                                            */
  /* ------------------------------------------------------------------ */
  function pruneSelection() {
    selection = selection.filter(function (id) { return !!get(id); });
  }

  function setSelection(ids, opts) {
    opts = opts || {};
    if (!Array.isArray(ids)) ids = ids ? [ids] : [];
    // pilih satu anggota grup -> pilih seluruh grup (kecuali ditahan)
    if (!opts.raw && ids.length === 1) {
      var s = get(ids[0]);
      if (s && s.meta && s.meta.group) {
        var g = s.meta.group;
        ids = state.shapes.filter(function (o) { return o.meta && o.meta.group === g; })
                          .map(function (o) { return o.id; });
      }
    }
    var same = ids.length === selection.length &&
               ids.every(function (id, i) { return selection[i] === id; });
    selection = ids.slice();
    if (!same || opts.force) emit('select', { ids: selection.slice(), source: opts.source });
  }

  function toggleSelection(id, opts) {
    var i = selection.indexOf(id);
    if (i >= 0) { var n = selection.slice(); n.splice(i, 1); setSelection(n, { raw: true, source: (opts || {}).source }); }
    else setSelection(selection.concat([id]), { raw: true, source: (opts || {}).source });
  }

  function selectedShapes() {
    return selection.map(get).filter(Boolean);
  }

  /* ------------------------------------------------------------------ */
  /* satuan & skala                                                     */
  /* ------------------------------------------------------------------ */
  var NUM_FIELDS = ['x', 'y', 'width', 'depth', 'height', 'elevation'];

  function scaleAllNumbers(k) {
    var u = state.scale.unit;
    for (var i = 0; i < state.shapes.length; i++) {
      var s = state.shapes[i];
      for (var f = 0; f < NUM_FIELDS.length; f++) {
        s[NUM_FIELDS[f]] = Units.round(s[NUM_FIELDS[f]] * k, u);
      }
      if (s.meta && typeof s.meta.thickness === 'number') {
        s.meta.thickness = Units.round(s.meta.thickness * k, u);
      }
    }
  }

  /** Ganti satuan tanpa mengubah ukuran fisik (4 m -> 400 cm). */
  function setUnit(unit) {
    if (!Units.UNITS[unit] || unit === state.scale.unit) return;
    pushHistory();
    var k = Units.factor(state.scale.unit, unit);
    state.scale.unit = unit;
    scaleAllNumbers(k);
    changed({ reason: 'unit', full: true });
  }

  /** Skala ulang proyek: ukuran fisik berubah proporsional (mis. k=2 -> 2x besar). */
  function rescale(k) {
    if (!(k > 0) || k === 1) return;
    pushHistory();
    scaleAllNumbers(k);
    changed({ reason: 'rescale', full: true });
  }

  /* ------------------------------------------------------------------ */
  /* bounding box denah (satuan project)                                */
  /* ------------------------------------------------------------------ */
  function bounds(ids) {
    var list = ids
      ? ids.map(get).filter(Boolean)
      : state.shapes.filter(Shapes.isVisible);
    if (!list.length) return null;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      // pakai proyeksi denah supaya objek yang dimiringkan tetap terhitung benar
      var p = Shapes.planExtents(s);
      var o = Shapes.planOffset(s);
      var a = (s.rotation || 0) * Math.PI / 180;
      var ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
      var ex = p.ex * ca + p.ez * sa;
      var ey = p.ex * sa + p.ez * ca;
      var cx = s.x + o.x, cy = s.y + o.y;
      minX = Math.min(minX, cx - ex); maxX = Math.max(maxX, cx + ex);
      minY = Math.min(minY, cy - ey); maxY = Math.max(maxY, cy + ey);
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY,
             w: maxX - minX, h: maxY - minY,
             cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }

  /* ------------------------------------------------------------------ */
  /* serialisasi & storage                                              */
  /* ------------------------------------------------------------------ */
  function serialize() { return clone(state); }

  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.shapes)) {
      throw new Error('Format project tidak dikenali (tidak ada array "shapes").');
    }
    var p = blank();
    if (typeof raw.name === 'string') p.name = raw.name;
    if (raw.scale) {
      if (Units.UNITS[raw.scale.unit]) p.scale.unit = raw.scale.unit;
      if (raw.scale.pxPerMeter > 0) p.scale.pxPerMeter = raw.scale.pxPerMeter;
    }
    if (raw.grid) {
      p.grid.show = raw.grid.show !== false;
      p.grid.snap = !!raw.grid.snap;
    }
    if (raw.snapAngle) {
      p.snapAngle.on = !!raw.snapAngle.on;
      if (raw.snapAngle.step > 0) p.snapAngle.step = raw.snapAngle.step;
    }
    if (typeof raw.cursorTip === 'boolean') p.cursorTip = raw.cursorTip;
    if (typeof raw.label3d === 'boolean') p.label3d = raw.label3d;
    var skipped = 0;
    for (var i = 0; i < raw.shapes.length; i++) {
      var s = raw.shapes[i];
      if (!s || !Shapes.isKnown(s.type)) { skipped++; continue; }
      var d = Shapes.def(s.type);
      var o = {
        id: s.id || Shapes.uid(),
        type: s.type,
        x: num(s.x, 0), y: num(s.y, 0),
        width: Math.max(1e-6, num(s.width, d.w)),
        depth: Math.max(1e-6, num(s.depth, d.d)),
        rotation: num(s.rotation, 0),
        tiltX: num(s.tiltX, d.tiltX || 0),
        tiltZ: num(s.tiltZ, d.tiltZ || 0),
        height: Math.max(0, num(s.height, d.h)),
        elevation: num(s.elevation, 0),
        meta: {
          label: (s.meta && s.meta.label) || d.name,
          color: (s.meta && s.meta.color) || d.color,
          solid: !(s.meta && s.meta.solid === false),
          locked: !!(s.meta && s.meta.locked),
          noOverlap: !!(s.meta && s.meta.noOverlap),
          visible: !(s.meta && s.meta.visible === false)
        }
      };
      if (s.meta && s.meta.group) o.meta.group = s.meta.group;
      if (s.meta && s.meta.group && s.meta.groupName) o.meta.groupName = String(s.meta.groupName);
      if (d.opening) o.meta.cut = !(s.meta && s.meta.cut === false);
      if (s.meta && typeof s.meta.thickness === 'number') o.meta.thickness = s.meta.thickness;
      else if (d.thickness) o.meta.thickness = d.thickness * Units.factor('m', p.scale.unit);
      if (d.foot === 'poly') {
        o.points = Array.isArray(s.points) && s.points.length >= 3
          ? s.points.map(function (q) { return [num(q[0], 0), num(q[1], 0)]; })
          : (d.poly ? d.poly() : [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]);
      }
      p.shapes.push(o);
    }
    return { project: p, skipped: skipped };
  }

  function num(v, fb) { return (typeof v === 'number' && isFinite(v)) ? v : fb; }

  function load(raw, opts) {
    opts = opts || {};
    var r = sanitize(raw);
    if (!opts.nohistory) pushHistory();
    state = r.project;
    selection = [];
    changed({ reason: 'load', full: true });
    emit('select', { ids: [] });
    emit('history');
    return r.skipped;
  }

  function reset() {
    pushHistory();
    state = blank();
    selection = [];
    changed({ reason: 'load', full: true });
    emit('select', { ids: [] });
  }

  /* --- localStorage --- */
  var autosaveTimer = null;
  var autosaveBroken = false;

  /** tulis sekarang juga; mengembalikan true kalau berhasil */
  function writeAutosave() {
    try {
      localStorage.setItem(KEY_AUTOSAVE, JSON.stringify(state));
      autosaveBroken = false;
      emit('autosave', { ok: true, at: Date.now() });
      return true;
    } catch (e) {
      // Paling sering: kuota localStorage penuh. Ini HARUS sampai ke user —
      // kalau cuma jadi warning di console, dia akan mengira kerjaannya aman
      // padahal sejak tadi tidak ada yang tersimpan.
      autosaveBroken = true;
      console.warn('[layout3d] autosave gagal:', e);
      emit('autosave', { ok: false, error: e });
      return false;
    }
  }

  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () {
      autosaveTimer = null;
      writeAutosave();
    }, 600);
  }

  /**
   * Tulis tunggakan autosave segera. Dipanggil saat halaman mau ditutup /
   * disembunyikan: tanpa ini, perubahan dalam 600 ms terakhir hilang begitu
   * user menekan refresh — persis saat perubahan itu paling baru dan paling
   * mudah terlupa.
   */
  function flushAutosave() {
    if (!autosaveTimer) return true;      // tidak ada tunggakan
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    return writeAutosave();
  }

  if (typeof window !== 'undefined') {
    // pagehide lebih bisa diandalkan daripada beforeunload (terutama di
    // ponsel, di mana tab bisa dimatikan tanpa beforeunload sama sekali)
    window.addEventListener('pagehide', flushAutosave);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushAutosave();
    });
  }

  function restoreAutosave() {
    try {
      var raw = localStorage.getItem(KEY_AUTOSAVE);
      if (!raw) return false;
      load(JSON.parse(raw), { nohistory: true });
      undoStack.length = 0; redoStack.length = 0;
      emit('history');
      return true;
    } catch (e) {
      console.warn('[layout3d] autosave rusak, diabaikan:', e);
      return false;
    }
  }

  function listSaved() {
    try {
      var m = JSON.parse(localStorage.getItem(KEY_PROJECTS) || '{}');
      return Object.keys(m).map(function (k) {
        return { key: k, name: m[k].name, updated: m[k].updated };
      }).sort(function (a, b) { return b.updated - a.updated; });
    } catch (e) { return []; }
  }

  function saveNamed(name) {
    var m = {};
    try { m = JSON.parse(localStorage.getItem(KEY_PROJECTS) || '{}'); } catch (e) { m = {}; }
    state.name = name;
    m[name] = { name: name, updated: Date.now(), data: clone(state) };
    localStorage.setItem(KEY_PROJECTS, JSON.stringify(m));
    scheduleAutosave();
    return true;
  }

  function loadNamed(key) {
    var m = JSON.parse(localStorage.getItem(KEY_PROJECTS) || '{}');
    if (!m[key]) throw new Error('Project "' + key + '" tidak ditemukan.');
    return load(m[key].data);
  }

  function deleteNamed(key) {
    var m = {};
    try { m = JSON.parse(localStorage.getItem(KEY_PROJECTS) || '{}'); } catch (e) { return; }
    delete m[key];
    localStorage.setItem(KEY_PROJECTS, JSON.stringify(m));
  }

  /* ------------------------------------------------------------------ */

  global.Project = {
    get state() { return state; },
    get shapes() { return state.shapes; },
    get selection() { return selection.slice(); },
    unit: function () { return state.scale.unit; },

    on: on, emit: emit,
    get: get, indexOf: indexOf,
    add: add, remove: remove, update: update, updateMany: updateMany,
    duplicate: duplicate, reorder: reorder, setOrder: setOrder,
    group: group, ungroup: ungroup, expandGroups: expandGroups,
    setSelection: setSelection, toggleSelection: toggleSelection, selectedShapes: selectedShapes,
    setUnit: setUnit, rescale: rescale,
    bounds: bounds,
    pushHistory: pushHistory, undo: undo, redo: redo,
    canUndo: function () { return undoStack.length > 0; },
    canRedo: function () { return redoStack.length > 0; },
    serialize: serialize, load: load, reset: reset, sanitize: sanitize,
    restoreAutosave: restoreAutosave,
    flushAutosave: flushAutosave,
    autosaveBroken: function () { return autosaveBroken; },
    listSaved: listSaved, saveNamed: saveNamed, loadNamed: loadNamed, deleteNamed: deleteNamed
  };
})(window);
