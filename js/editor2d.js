/* layout3d — editor denah 2D (Konva)
 *
 * Koordinat dunia = SATUAN PROJECT. Stage di-scale dengan
 *   s = pxPerMeter * zoom * unitToM
 * jadi angka x/y/width/depth shape dipakai apa adanya, tanpa konversi px
 * berserak di mana-mana. Zoom = transform stage (bukan render ulang shape).
 */
(function (global) {
  'use strict';

  var stage, gridLayer, shapeLayer, overlayLayer, tr, rubber;
  var nodes = {};          // id -> Konva node
  var labels = {};         // id -> Konva.Label group
  var zoom = 1;
  var container;
  var suppressSelect = false;
  var dragStartPos = null;
  var spaceDown = false;
  var panning = null;
  var rubberStart = null;
  var dragOrigShape = {};   // posisi shape (bukan node) saat drag mulai
  var dragCollide = false;  // cek tabrakan aktif untuk drag ini?

  /* ------------------------------------------------------------------ */
  function unit() { return Project.state.scale.unit; }
  function pxPerMeter() { return Project.state.scale.pxPerMeter; }

  /** px per satu satuan project pada zoom sekarang */
  function scaleFactor() {
    return pxPerMeter() * zoom * Units.def(unit()).toM;
  }

  function screenToWorld(px, py) {
    var s = scaleFactor();
    return { x: (px - stage.x()) / s, y: (py - stage.y()) / s };
  }

  function viewportCenterWorld() {
    return screenToWorld(stage.width() / 2, stage.height() / 2);
  }

  /* ------------------------------------------------------------------ */
  /* init                                                               */
  /* ------------------------------------------------------------------ */
  function init(containerId) {
    container = document.getElementById(containerId);
    stage = new Konva.Stage({
      container: containerId,
      width: container.clientWidth || 800,
      height: container.clientHeight || 600
    });

    gridLayer = new Konva.Layer({ listening: false });
    shapeLayer = new Konva.Layer();
    overlayLayer = new Konva.Layer();
    stage.add(gridLayer, shapeLayer, overlayLayer);

    tr = new Konva.Transformer({
      rotateEnabled: true,
      keepRatio: false,
      ignoreStroke: true,
      borderStroke: '#4da3ff',
      borderStrokeWidth: 1.5,
      anchorStroke: '#4da3ff',
      anchorFill: '#12161c',
      anchorSize: 8,
      anchorCornerRadius: 2,
      rotateAnchorOffset: 26,
      padding: 2,
      boundBoxFunc: function (oldBox, newBox) {
        if (Math.abs(newBox.width) < 2 || Math.abs(newBox.height) < 2) return oldBox;
        return newBox;
      }
    });
    overlayLayer.add(tr);

    rubber = new Konva.Rect({
      fill: 'rgba(77,163,255,0.12)',
      stroke: '#4da3ff',
      strokeWidth: 1,
      strokeScaleEnabled: false,
      visible: false,
      listening: false
    });
    overlayLayer.add(rubber);

    stage.scale({ x: scaleFactor(), y: scaleFactor() });
    stage.position({ x: stage.width() / 2, y: stage.height() / 2 });

    wireStageEvents();
    wireTransformer();

    Project.on('change', onProjectChange);
    Project.on('select', onProjectSelect);

    rebuild();
    drawGrid();
  }

  /* ------------------------------------------------------------------ */
  /* grid                                                               */
  /* ------------------------------------------------------------------ */
  var gridRaf = null;
  function drawGrid() {
    if (gridRaf) return;
    gridRaf = requestAnimationFrame(function () { gridRaf = null; drawGridNow(); });
  }
  function drawGridNow() {
    gridLayer.destroyChildren();
    if (!Project.state.grid.show) { gridLayer.batchDraw(); return; }

    var s = scaleFactor();
    var u = unit();
    var pxM = s / Units.def(u).toM;          // px per meter di layar
    var g = Units.gridStep(pxM, 22);
    var stepU = Units.fromM(g.stepM, u);     // langkah grid dalam satuan project

    var tl = screenToWorld(0, 0);
    var br = screenToWorld(stage.width(), stage.height());
    var x0 = Math.floor(tl.x / stepU) * stepU;
    var y0 = Math.floor(tl.y / stepU) * stepU;

    var maxLines = 400;
    var nx = Math.min(maxLines, Math.ceil((br.x - x0) / stepU) + 1);
    var ny = Math.min(maxLines, Math.ceil((br.y - y0) / stepU) + 1);
    var i, v, major, isAxis;

    var COL_MINOR = '#232c37', COL_MAJOR = '#31404f', COL_AXIS = '#4a6274';

    for (i = 0; i <= nx; i++) {
      v = x0 + i * stepU;
      major = Math.abs(Math.round(v / stepU) % g.majorEvery) === 0;
      isAxis = Math.abs(v) < stepU * 1e-6;
      gridLayer.add(new Konva.Line({
        points: [v, tl.y, v, br.y],
        stroke: isAxis ? COL_AXIS : (major ? COL_MAJOR : COL_MINOR),
        strokeWidth: isAxis ? 1.6 : 1,
        strokeScaleEnabled: false,
        listening: false
      }));
      if (major) addGridLabel(v, tl.y, Units.gridLabel(Units.toM(v, u), u), s, 'x');
    }

    for (i = 0; i <= ny; i++) {
      v = y0 + i * stepU;
      major = Math.abs(Math.round(v / stepU) % g.majorEvery) === 0;
      isAxis = Math.abs(v) < stepU * 1e-6;
      gridLayer.add(new Konva.Line({
        points: [tl.x, v, br.x, v],
        stroke: isAxis ? COL_AXIS : (major ? COL_MAJOR : COL_MINOR),
        strokeWidth: isAxis ? 1.6 : 1,
        strokeScaleEnabled: false,
        listening: false
      }));
      if (major) addGridLabel(tl.x, v, Units.gridLabel(Units.toM(v, u), u), s, 'y');
    }

    gridLayer.batchDraw();

    var el = document.getElementById('status-grid');
    if (el) el.textContent = 'Grid ' + Units.gridLabel(g.stepM, u);
    stepCache = stepU;
  }

  var stepCache = 1;

  function addGridLabel(x, y, text, s, axis) {
    gridLayer.add(new Konva.Text({
      x: x + (axis === 'x' ? 3 / s : 4 / s),
      y: y + (axis === 'x' ? 4 / s : 3 / s),
      text: text,
      fontSize: 10,
      fontFamily: 'Segoe UI, sans-serif',
      fill: '#54677c',
      scaleX: 1 / s,
      scaleY: 1 / s,
      listening: false
    }));
  }

  /* ------------------------------------------------------------------ */
  /* node shape                                                         */
  /* ------------------------------------------------------------------ */
  function polyPoints(shape) {
    var pts = shape.points || [];
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      out.push(pts[i][0] * shape.width, pts[i][1] * shape.depth);
    }
    return out;
  }

  function hexToRgba(hex, a) {
    var h = (hex || '#888888').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /** posisi node di kanvas = titik jangkar shape + pergeseran akibat kemiringan */
  function nodeCenter(shape) {
    var o = Shapes.planOffset(shape);
    return { x: shape.x + o.x, y: shape.y + o.y };
  }

  /** kebalikan nodeCenter: dari posisi & yaw node, balik ke titik jangkar */
  function anchorFromNode(node, shape) {
    var e = Shapes.planExtents(shape);
    if (Math.abs(e.cx) < 1e-9 && Math.abs(e.cz) < 1e-9) return { x: node.x(), y: node.y() };
    var t = node.rotation() * Math.PI / 180;
    var c = Math.cos(t), n = Math.sin(t);
    return { x: node.x() - (e.cx * c - e.cz * n), y: node.y() - (e.cx * n + e.cz * c) };
  }

  function makeNode(shape) {
    var def = Shapes.def(shape.type);
    var tilted = Shapes.isTilted(shape);
    var c = nodeCenter(shape);
    var common = {
      id: shape.id,
      name: 'shape',
      x: c.x,
      y: c.y,
      rotation: shape.rotation || 0,
      fill: hexToRgba(shape.meta.color, def.decorative ? 0.65 : 0.42),
      stroke: shape.meta.color,
      strokeWidth: def.roof ? 1.4 : 1.8,
      strokeScaleEnabled: false,
      draggable: !shape.meta.locked,
      dash: tilted ? [3, 3] : (def.roof ? [6, 4] : undefined),
      dashEnabled: tilted || !!def.roof,
      opacity: shape.meta.locked ? 0.55 : 1,
      visible: Shapes.isVisible(shape),
      listening: Shapes.isVisible(shape)
    };

    var node;
    if (tilted) {
      // objek miring: denah = proyeksi kotak pembatasnya, jadi luasan yang
      // benar-benar dipakai di lantai tetap kelihatan akurat
      var e = Shapes.planExtents(shape);
      node = new Konva.Rect(Object.assign({}, common, {
        width: e.ex * 2, height: e.ez * 2,
        offsetX: e.ex, offsetY: e.ez
      }));
    } else {
      switch (def.foot) {
        case 'ellipse':
          node = new Konva.Ellipse(Object.assign({}, common, {
            radiusX: shape.width / 2, radiusY: shape.depth / 2
          }));
          break;
        case 'poly':
          node = new Konva.Line(Object.assign({}, common, {
            points: polyPoints(shape), closed: true
          }));
          break;
        default:
          node = new Konva.Rect(Object.assign({}, common, {
            width: shape.width, height: shape.depth,
            offsetX: shape.width / 2, offsetY: shape.depth / 2
          }));
      }
    }
    node.setAttr('shapeType', shape.type);
    node.setAttr('tilted', tilted);
    wireNode(node);
    return node;
  }

  /** ganti node in-place (dipakai saat kemiringan berubah: bentuk denahnya beda) */
  function replaceNode(shape) {
    var old = nodes[shape.id];
    var wasSelected = old && tr.nodes().indexOf(old) >= 0;
    if (old) old.destroy();
    var n = makeNode(shape);
    nodes[shape.id] = n;
    shapeLayer.add(n);
    var idx = Project.indexOf(shape.id);
    if (idx >= 0 && idx < shapeLayer.getChildren().length) n.zIndex(idx);
    updateLabel(shape);
    if (wasSelected) syncTransformer();
    shapeLayer.batchDraw();
  }

  function applyToNode(shape) {
    var node = nodes[shape.id];
    if (!node) return;
    if (!!node.getAttr('tilted') !== Shapes.isTilted(shape)) { replaceNode(shape); return; }

    var def = Shapes.def(shape.type);
    var c = nodeCenter(shape);
    node.x(c.x);
    node.y(c.y);
    node.rotation(shape.rotation || 0);
    node.fill(hexToRgba(shape.meta.color, def.decorative ? 0.65 : 0.42));
    node.stroke(shape.meta.color);
    node.draggable(!shape.meta.locked);
    node.opacity(shape.meta.locked ? 0.55 : 1);
    node.visible(Shapes.isVisible(shape));
    node.listening(Shapes.isVisible(shape));
    node.scaleX(1); node.scaleY(1);

    if (node.getAttr('tilted')) {
      var e = Shapes.planExtents(shape);
      node.width(e.ex * 2); node.height(e.ez * 2);
      node.offsetX(e.ex); node.offsetY(e.ez);
    } else if (node instanceof Konva.Ellipse) {
      node.radiusX(shape.width / 2);
      node.radiusY(shape.depth / 2);
    } else if (node instanceof Konva.Line) {
      node.points(polyPoints(shape));
    } else {
      node.width(shape.width);
      node.height(shape.depth);
      node.offsetX(shape.width / 2);
      node.offsetY(shape.depth / 2);
    }
    updateLabel(shape);
  }

  /* ------------------------------------------------------------------ */
  /* label shape                                                        */
  /* ------------------------------------------------------------------ */
  function updateLabel(shape) {
    var s = scaleFactor();
    var t = labels[shape.id];
    var e = Shapes.planExtents(shape);
    var wPx = e.ex * 2 * s, dPx = e.ez * 2 * s;
    var show = wPx > 44 && dPx > 20 && Shapes.isVisible(shape);

    // Anggota grup bernama tidak dilabeli sendiri-sendiri — grup itu dapat
    // SATU label di tengahnya (lihat syncGroupLabels). Tanpa ini, badan,
    // atap, dan isinya saling menimpa persis di titik yang sama.
    if (Shapes.groupName(shape)) show = false;

    if (!show) { if (t) t.visible(false); return; }

    var txt = shape.meta.label || Shapes.name(shape.type);
    if (wPx > 90 && dPx > 34) {
      txt += '\n' + Units.fmt(shape.width, unit(), false) + ' × ' +
             Units.fmt(shape.depth, unit(), false) + ' ' + Units.def(unit()).label;
    }
    if (!t) {
      t = new Konva.Text({
        text: txt, fontSize: 11, fontFamily: 'Segoe UI, sans-serif',
        fill: '#dfe8f2', align: 'center', listening: false,
        shadowColor: '#0b0e12', shadowBlur: 3, shadowOpacity: 0.9
      });
      labels[shape.id] = t;
      overlayLayer.add(t);
    } else {
      t.text(txt);
    }
    t.visible(true);
    t.scaleX(1 / s); t.scaleY(1 / s);
    t.offsetX(t.width() / 2);
    t.offsetY(t.height() / 2);

    // atap biasanya menutupi badan bangunan di denah — geser labelnya ke tepi
    // atas footprint (mengikuti rotasi) supaya tidak bertumpuk dengan label badan
    var off = Shapes.isRoof(shape.type) ? e.ez - (t.height() / 2 + 4) / s : 0;
    if (off < 0) off = 0;
    var a = (shape.rotation || 0) * Math.PI / 180;
    var c = nodeCenter(shape);
    t.x(c.x + off * Math.sin(a));
    t.y(c.y - off * Math.cos(a));
    t.rotation(0);
  }

  function refreshLabels() {
    var shapes = Project.shapes;
    for (var i = 0; i < shapes.length; i++) updateLabel(shapes[i]);
    syncGroupLabels();
    overlayLayer.batchDraw();
  }

  /* satu label per grup bernama, ditaruh di tengah kumpulan anggotanya */
  var groupLabels = {};

  function syncGroupLabels() {
    var s = scaleFactor();
    var groups = {}, i;
    var shapes = Project.shapes;

    for (i = 0; i < shapes.length; i++) {
      var nm = Shapes.groupName(shapes[i]);
      if (!nm || !Shapes.isVisible(shapes[i])) continue;
      var g = shapes[i].meta.group;
      (groups[g] || (groups[g] = { name: nm, ids: [] })).ids.push(shapes[i].id);
    }

    // buang label grup yang sudah tidak ada lagi
    for (var key in groupLabels) {
      if (!groups[key]) { groupLabels[key].destroy(); delete groupLabels[key]; }
    }

    for (var gid in groups) {
      var info = groups[gid];
      var b = Project.bounds(info.ids);
      if (!b) continue;

      var t = groupLabels[gid];
      if (!t) {
        t = new Konva.Text({
          fontSize: 12, fontStyle: 'bold', fontFamily: 'Segoe UI, sans-serif',
          fill: '#ffd479', align: 'center', listening: false,
          shadowColor: '#0b0e12', shadowBlur: 4, shadowOpacity: 0.95
        });
        groupLabels[gid] = t;
        overlayLayer.add(t);
      }
      t.text(info.name);
      t.visible(b.w * s > 40);
      t.scaleX(1 / s); t.scaleY(1 / s);
      t.offsetX(t.width() / 2);
      t.offsetY(t.height() / 2);
      t.position({ x: b.cx, y: b.cy });
    }
  }

  /* ------------------------------------------------------------------ */
  /* penanda objek yang keluar batas tanah                              */
  /*                                                                    */
  /* Digambar sebagai lapisan terpisah, bukan dengan mengubah warna node */
  /* aslinya — supaya tidak berebut dengan gaya normal shape saat        */
  /* di-rebuild, dan warna asli objek tetap kebaca.                      */
  /* ------------------------------------------------------------------ */
  var warnShapes = [];
  var lastWarnIds = '';

  function syncLandWarnings() {
    var bad = Shapes.outsideLand(Project.shapes);

    // hanya gambar ulang kalau daftarnya benar-benar berubah
    var key = bad.map(function (b) { return b.id + b.status; }).join(',');
    var moved = bad.length > 0;   // posisi bisa berubah walau daftarnya sama
    if (key === lastWarnIds && !moved) return;
    lastWarnIds = key;

    while (warnShapes.length) warnShapes.pop().destroy();

    for (var i = 0; i < bad.length; i++) {
      var s = Project.get(bad[i].id);
      if (!s) continue;
      var corners = Shapes.footprintCorners(s);
      var flat = [];
      for (var k = 0; k < corners.length; k++) flat.push(corners[k][0], corners[k][1]);
      var ln = new Konva.Line({
        points: flat,
        closed: true,
        stroke: bad[i].status === 'out' ? '#e2564a' : '#e8b84b',
        strokeWidth: 2,
        dash: [7, 4],
        strokeScaleEnabled: false,
        listening: false
      });
      warnShapes.push(ln);
      overlayLayer.add(ln);
    }
    overlayLayer.batchDraw();
    Project.emit('land-warn', { list: bad });
  }

  /* ------------------------------------------------------------------ */
  /* rebuild penuh                                                      */
  /* ------------------------------------------------------------------ */
  function rebuild() {
    shapeLayer.destroyChildren();
    for (var k in labels) labels[k].destroy();
    for (var gk in groupLabels) groupLabels[gk].destroy();
    nodes = {}; labels = {}; groupLabels = {};

    var shapes = Project.shapes;
    for (var i = 0; i < shapes.length; i++) {
      var n = makeNode(shapes[i]);
      nodes[shapes[i].id] = n;
      shapeLayer.add(n);
      updateLabel(shapes[i]);
    }
    syncGroupLabels();
    shapeLayer.batchDraw();
    syncTransformer();
    syncLandWarnings();
    overlayLayer.batchDraw();
  }

  /* ------------------------------------------------------------------ */
  /* snap                                                               */
  /* ------------------------------------------------------------------ */
  function snapWorld(v) {
    if (!Project.state.grid.snap) return v;
    return Math.round(v / stepCache) * stepCache;
  }

  /* ------------------------------------------------------------------ */
  /* interaksi node                                                     */
  /* ------------------------------------------------------------------ */
  function wireNode(node) {
    node.on('mousedown touchstart', function (e) {
      var id = node.id();
      if (e.evt.shiftKey || e.evt.ctrlKey) {
        e.cancelBubble = true;
        suppressSelect = true;
        Project.toggleSelection(id, { source: 'editor2d' });
        suppressSelect = false;
        return;
      }
      // Alt+klik = pilih satu anggota saja, abaikan grupnya
      if (e.evt.altKey) {
        e.cancelBubble = true;
        Project.setSelection([id], { raw: true, source: 'editor2d' });
        return;
      }
      if (Project.selection.indexOf(id) < 0) {
        Project.setSelection([id], { source: 'editor2d' });
      }
    });

    node.on('dragstart', function () {
      hideCursorTip();
      Project.pushHistory();
      // titik awal dibaca dari data project, bukan dari posisi node: Konva bisa
      // sudah menggeser node yang di-drag sebelum handler ini jalan, dan itu
      // bikin delta untuk anggota seleksi lain meleset
      dragStartPos = {};
      dragOrigShape = {};
      var sel = Project.selection;
      if (sel.indexOf(node.id()) < 0) sel = [node.id()];
      for (var i = 0; i < sel.length; i++) {
        var s = Project.get(sel[i]);
        if (s && nodes[sel[i]] && Shapes.isVisible(s)) {
          dragStartPos[sel[i]] = nodeCenter(s);
          dragOrigShape[sel[i]] = { x: s.x, y: s.y };
        }
      }

      // Cek tabrakan hanya kalau ada yang menolak ditumpuk DAN posisi awalnya
      // memang sudah bebas. Kalau dari awal sudah bertindih, memblokir justru
      // mengurung objeknya — user tidak akan bisa merapikannya.
      var ids = Object.keys(dragStartPos);
      var others = Project.shapes.filter(function (o) { return ids.indexOf(o.id) < 0; });
      var adaAturan = ids.some(function (id) {
        var sh = Project.get(id);
        return sh && (Shapes.noOverlap(sh) ||
          others.some(function (o) { return Shapes.noOverlap(o) && Shapes.canCollide(sh); }));
      });
      dragCollide = adaAturan && !dragHits(0, 0);
      setBlocked(false);
    });

    node.dragBoundFunc(function (pos) {
      if (!Project.state.grid.snap) return pos;
      var s = scaleFactor();
      var wx = snapWorld((pos.x - stage.x()) / s);
      var wy = snapWorld((pos.y - stage.y()) / s);
      return { x: wx * s + stage.x(), y: wy * s + stage.y() };
    });

    node.on('dragmove', function () {
      if (!dragStartPos) return;
      var origin = dragStartPos[node.id()];
      if (!origin) return;
      var dx = node.x() - origin.x, dy = node.y() - origin.y;

      // Tertahan objek lain? Coba geser satu sumbu saja supaya bisa
      // "meluncur" menyusuri sisi benda yang ditabrak — kalau langsung
      // dibekukan, menempatkan mesin rapat ke tetangganya jadi menyiksa.
      var res = resolveDrag(dx, dy);
      dx = res.dx; dy = res.dy;
      node.x(origin.x + dx);
      node.y(origin.y + dy);

      for (var id in dragStartPos) {
        if (id === node.id()) continue;
        var n = nodes[id];
        if (!n) continue;
        n.x(dragStartPos[id].x + dx);
        n.y(dragStartPos[id].y + dy);
      }
      commitNodes(Object.keys(dragStartPos), true);
      syncLandWarnings();
      shapeLayer.batchDraw();
      overlayLayer.batchDraw();
    });

    node.on('dragend', function () {
      commitNodes(Object.keys(dragStartPos || {}), true);
      dragStartPos = null;
      dragOrigShape = {};
      dragCollide = false;
      setBlocked(false);
    });
  }

  /* ------------------------------------------------------------------ */
  /* tabrakan saat menggeser                                             */
  /* ------------------------------------------------------------------ */
  var dragBlocked = false;

  /** apakah kumpulan yang digeser menabrak sesuatu pada pergeseran (dx,dy)? */
  function dragHits(dx, dy) {
    var moving = Object.keys(dragStartPos);
    var others = Project.shapes.filter(function (s) { return moving.indexOf(s.id) < 0; });

    for (var i = 0; i < moving.length; i++) {
      var s = Project.get(moving[i]);
      if (!s) continue;
      var probe = Object.assign({}, s, {
        x: dragOrigShape[s.id].x + dx,
        y: dragOrigShape[s.id].y + dy
      });
      if (Shapes.firstHit(probe, others)) return true;
    }
    return false;
  }

  /**
   * Pergeseran terbesar yang masih bebas tabrakan. Urutannya: coba penuh,
   * lalu satu sumbu saja (meluncur), lalu diam.
   */
  function resolveDrag(dx, dy) {
    if (!dragCollide) return { dx: dx, dy: dy };
    if (!dragHits(dx, dy)) { setBlocked(false); return { dx: dx, dy: dy }; }
    if (!dragHits(dx, 0))  { setBlocked(true);  return { dx: dx, dy: 0 }; }
    if (!dragHits(0, dy))  { setBlocked(true);  return { dx: 0,  dy: dy }; }
    setBlocked(true);
    return { dx: 0, dy: 0 };
  }

  function setBlocked(on) {
    if (on === dragBlocked) return;
    dragBlocked = on;
    stage.container().style.cursor = on ? 'not-allowed' : 'default';
  }

  /** baca attr node -> patch shape */
  function readNode(node) {
    var id = node.id();
    var shape = Project.get(id);
    if (!shape) return null;
    var u = unit();
    var sx = Math.abs(node.scaleX()), sy = Math.abs(node.scaleY());
    var anchor = anchorFromNode(node, shape);
    var patch = {
      x: Units.round(anchor.x, u),
      y: Units.round(anchor.y, u),
      rotation: Math.round(node.rotation() * 100) / 100
    };
    // objek miring tidak bisa di-resize dari kanvas (proyeksinya ambigu):
    // ukuran w/d/h diedit lewat panel properti
    if (node.getAttr('tilted')) return patch;
    if (node instanceof Konva.Ellipse) {
      patch.width = Units.round(node.radiusX() * 2 * sx, u);
      patch.depth = Units.round(node.radiusY() * 2 * sy, u);
    } else if (node instanceof Konva.Line) {
      patch.width = Units.round(shape.width * sx, u);
      patch.depth = Units.round(shape.depth * sy, u);
    } else {
      patch.width = Units.round(node.width() * sx, u);
      patch.depth = Units.round(node.height() * sy, u);
    }
    return patch;
  }

  /** tulis attr node yang sedang di-drag/transform ke Project */
  function commitNodes(ids, nohistory) {
    var list = [];
    for (var i = 0; i < ids.length; i++) {
      var n = nodes[ids[i]];
      if (!n) continue;
      var patch = readNode(n);
      if (patch) list.push({ id: ids[i], patch: patch });
    }
    if (!list.length) return;
    Project.updateMany(list, { nohistory: !!nohistory, source: 'editor2d' });
  }

  /** normalisasi scale node kembali ke 1 setelah transform */
  function normalizeNode(id) {
    var shape = Project.get(id);
    if (shape) applyToNode(shape);
  }

  function wireTransformer() {
    tr.on('transformstart', function () { Project.pushHistory(); });

    tr.on('transform', function () {
      var ns = tr.nodes();
      for (var i = 0; i < ns.length; i++) {
        var sh = Project.get(ns[i].id());
        if (sh) updateLabel(sh);
      }
      overlayLayer.batchDraw();
    });

    tr.on('transformend', function () {
      var ids = tr.nodes().map(function (n) { return n.id(); });
      commitNodes(ids, true);
      for (var i = 0; i < ids.length; i++) normalizeNode(ids[i]);
      shapeLayer.batchDraw();
      overlayLayer.batchDraw();
      Project.emit('select', { ids: Project.selection, source: 'editor2d-transform' });
    });
  }

  function syncTransformer() {
    if (draw || vedit) { tr.nodes([]); overlayLayer.batchDraw(); return; }
    var sel = Project.selection;
    var ns = [], anyTilted = false;
    for (var i = 0; i < sel.length; i++) {
      var n = nodes[sel[i]];
      var sh = Project.get(sel[i]);
      if (!n || !sh || sh.meta.locked || !Shapes.isVisible(sh)) continue;
      if (Shapes.isTilted(sh)) anyTilted = true;
      ns.push(n);
    }
    tr.nodes(ns);
    tr.resizeEnabled(!anyTilted);
    applySnapAngle();
    overlayLayer.batchDraw();
  }

  function applySnapAngle() {
    var sa = Project.state.snapAngle;
    if (sa.on) {
      var snaps = [], a;
      for (a = 0; a < 360; a += sa.step) snaps.push(a);
      tr.rotationSnaps(snaps);
      tr.rotationSnapTolerance(Math.max(4, sa.step / 2.2));
    } else {
      tr.rotationSnaps([]);
      tr.rotationSnapTolerance(0);
    }
  }

  /* ================================================================== */
  /* MODE GAMBAR POLIGON                                                */
  /* ================================================================== */
  var draw = null;
  var HANDLE_PX = 5;      // radius pegangan titik, dalam pixel layar
  var CLOSE_PX = 12;      // jarak untuk dianggap "klik titik awal"

  function drawStatus(message, kind) {
    Project.emit('draw', {
      active: !!draw,
      count: draw ? draw.pts.length : 0,
      message: message,
      kind: kind
    });
  }

  /* ------------------------------------------------------------------ */
  /* penunjuk koordinat yang mengikuti kursor                            */
  /*                                                                    */
  /* Status bar sudah menampilkan koordinat, tapi letaknya jauh dari     */
  /* kursor — mata harus bolak-balik saat menempatkan objek. Penunjuk    */
  /* ini menempel di kursor, dan kalau sedang menunjuk objek, sekalian   */
  /* menampilkan titik jangkarnya (yang ada di TENGAH denah, bukan di    */
  /* pojok — gampang keliru kalau tidak ditunjukkan).                    */
  /* ------------------------------------------------------------------ */
  var cursorTip = null;

  function ensureCursorTip() {
    if (cursorTip) return cursorTip;
    var g = new Konva.Group({ listening: false });
    var bg = new Konva.Rect({
      fill: 'rgba(18,22,28,0.88)', stroke: '#3d4a5c', strokeWidth: 1,
      cornerRadius: 3, listening: false
    });
    var tx = new Konva.Text({
      fontSize: 11, fontFamily: 'Segoe UI, sans-serif', fill: '#dfe8f2',
      padding: 5, lineHeight: 1.35, listening: false
    });
    g.add(bg, tx);
    overlayLayer.add(g);
    cursorTip = { group: g, bg: bg, text: tx };
    return cursorTip;
  }

  function hideCursorTip() {
    if (cursorTip && cursorTip.group.visible()) {
      cursorTip.group.visible(false);
      overlayLayer.batchDraw();
    }
  }

  function showCursorTip(world, hoverShape) {
    if (!Project.state.cursorTip) { hideCursorTip(); return; }
    var t = ensureCursorTip();
    var s = scaleFactor(), u = unit();

    var lines = ['X ' + Units.fmt(world.x, u) + '   Y ' + Units.fmt(world.y, u)];
    if (hoverShape) {
      lines.push((hoverShape.meta.label || Shapes.name(hoverShape.type)) +
                 ' — jangkar ' + Units.fmt(hoverShape.x, u, false) + ' ; ' +
                 Units.fmt(hoverShape.y, u, false));
    }
    t.text.text(lines.join('\n'));
    t.bg.width(t.text.width());
    t.bg.height(t.text.height());

    // dipasang kanan-bawah kursor; kalau mepet tepi layar, dibalik arahnya
    var padPx = 14;
    var wPx = t.text.width(), hPx = t.text.height();
    var scrX = world.x * s + stage.x(), scrY = world.y * s + stage.y();
    var flipX = scrX + padPx + wPx > stage.width();
    var flipY = scrY + padPx + hPx > stage.height();

    t.group.scaleX(1 / s);
    t.group.scaleY(1 / s);
    t.group.position({
      x: world.x + (flipX ? -(padPx + wPx) : padPx) / s,
      y: world.y + (flipY ? -(padPx + hPx) : padPx) / s
    });
    t.group.visible(true);
    t.group.moveToTop();
    overlayLayer.batchDraw();
  }

  /**
   * Sorot satu sisi poligon di kanvas — dipakai saat kolom ukuran sisi
   * difokus di panel, supaya jelas sisi mana yang sedang diubah angkanya.
   * @param id  id shape, atau null untuk mematikan sorotan
   */
  var sideHi = null;
  function highlightSide(id, idx) {
    if (sideHi) { sideHi.destroy(); sideHi = null; }
    var s = id ? Project.get(id) : null;
    if (s) {
      var local = Shapes.polygonLocal(s);
      if (local.length >= 3 && idx >= 0 && idx < local.length) {
        var a = local[idx], b = local[(idx + 1) % local.length];
        var rot = (s.rotation || 0) * Math.PI / 180;
        var c = Math.cos(rot), n = Math.sin(rot);
        var w = function (p) {
          return [s.x + (p[0] * c - p[1] * n), s.y + (p[0] * n + p[1] * c)];
        };
        var wa = w(a), wb = w(b);
        sideHi = new Konva.Line({
          points: [wa[0], wa[1], wb[0], wb[1]],
          stroke: '#e8b84b', strokeWidth: 4, strokeScaleEnabled: false,
          lineCap: 'round', listening: false, opacity: 0.9
        });
        overlayLayer.add(sideHi);
      }
    }
    overlayLayer.batchDraw();
  }

  function startDraw() {
    if (draw) cancelDraw();
    exitVertexEdit();
    Project.setSelection([]);

    draw = { pts: [], dots: [] };
    draw.group = new Konva.Group({ listening: false });
    draw.fill = new Konva.Line({
      points: [], closed: true, fill: 'rgba(77,163,255,0.13)', listening: false
    });
    draw.line = new Konva.Line({
      points: [], stroke: '#4da3ff', strokeWidth: 2,
      strokeScaleEnabled: false, listening: false
    });
    draw.rubber = new Konva.Line({
      points: [], stroke: '#4da3ff', strokeWidth: 1.4, dash: [5, 4],
      strokeScaleEnabled: false, listening: false
    });
    draw.group.add(draw.fill, draw.line, draw.rubber);
    overlayLayer.add(draw.group);

    shapeLayer.listening(false);      // klik harus jatuh ke stage, bukan ke shape
    tr.nodes([]);
    stage.container().style.cursor = 'crosshair';
    syncDraw();
    drawStatus();
  }

  function endDraw() {
    if (!draw) return;
    draw.group.destroy();
    draw = null;
    shapeLayer.listening(true);
    stage.container().style.cursor = spaceDown ? 'grab' : 'default';
    overlayLayer.batchDraw();
  }

  function cancelDraw() {
    if (!draw) return;
    endDraw();
    drawStatus('Gambar poligon dibatalkan.');
  }

  /** posisi kursor di dunia, sudah menerapkan snap */
  function drawPoint(evt) {
    var p = stage.getPointerPosition();
    if (!p) return null;
    var w = screenToWorld(p.x, p.y);
    // Shift mengunci arah ke kelipatan 45° dari titik sebelumnya;
    // snap grid dilewati karena keduanya tidak bisa berlaku bersamaan
    if (evt && evt.shiftKey && draw.pts.length) {
      var last = draw.pts[draw.pts.length - 1];
      var dx = w.x - last[0], dy = w.y - last[1];
      var len = Math.sqrt(dx * dx + dy * dy);
      var ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      return { x: last[0] + Math.cos(ang) * len, y: last[1] + Math.sin(ang) * len };
    }
    return { x: snapWorld(w.x), y: snapWorld(w.y) };
  }

  function nearFirst(w) {
    if (draw.pts.length < 3) return false;
    var s = scaleFactor();
    var dx = (w.x - draw.pts[0][0]) * s, dy = (w.y - draw.pts[0][1]) * s;
    return Math.sqrt(dx * dx + dy * dy) < CLOSE_PX;
  }

  function syncDraw(cursor) {
    if (!draw) return;
    var s = scaleFactor(), flat = [], i;
    for (i = 0; i < draw.pts.length; i++) flat.push(draw.pts[i][0], draw.pts[i][1]);
    draw.line.points(flat);
    draw.fill.points(draw.pts.length >= 3 ? flat : []);

    if (cursor && draw.pts.length) {
      var last = draw.pts[draw.pts.length - 1];
      draw.rubber.points([last[0], last[1], cursor.x, cursor.y]);
      draw.rubber.visible(true);
    } else {
      draw.rubber.visible(false);
    }

    // pegangan titik: radius dijaga tetap segitu di layar berapa pun zoom-nya
    while (draw.dots.length < draw.pts.length) {
      var c = new Konva.Circle({
        fill: '#12161c', stroke: '#4da3ff', strokeWidth: 2,
        strokeScaleEnabled: false, listening: false
      });
      draw.dots.push(c);
      draw.group.add(c);
    }
    while (draw.dots.length > draw.pts.length) draw.dots.pop().destroy();

    var snap = cursor && nearFirst(cursor);
    for (i = 0; i < draw.pts.length; i++) {
      var first = i === 0 && snap;
      draw.dots[i].position({ x: draw.pts[i][0], y: draw.pts[i][1] });
      draw.dots[i].radius((first ? HANDLE_PX + 3 : HANDLE_PX) / s);
      draw.dots[i].fill(first ? '#4da3ff' : '#12161c');
    }

    syncDrawLabels(cursor, s);
    overlayLayer.batchDraw();
  }

  /**
   * Label panjang tiap sisi + sudut di tiap titik, tampil sambil menggambar.
   * Sisi yang sedang ditarik kursor ikut dilabeli, jadi panjangnya kelihatan
   * SEBELUM titiknya ditaruh — itu yang bikin bisa menggambar sesuai angka
   * ukur, bukan cuma kira-kira lalu dikoreksi belakangan.
   */
  function syncDrawLabels(cursor, s) {
    if (!draw) return;
    draw.labels = draw.labels || [];

    var u = unit();
    var segs = [];                       // {x, y, text} dalam koordinat dunia
    var pts = draw.pts.slice();
    if (cursor && pts.length && !nearFirst(cursor)) pts.push([cursor.x, cursor.y]);

    var i;
    for (i = 0; i + 1 < pts.length; i++) {
      var a = pts[i], b = pts[i + 1];
      var len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len * s < 26) continue;        // terlalu pendek di layar, malah berantakan
      segs.push({
        x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2,
        text: Units.fmt(len, u), kind: 'len'
      });
    }
    // sudut dalam di titik-titik yang sudah pasti (butuh sisi kiri & kanan)
    for (i = 1; i + 1 < pts.length; i++) {
      var p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      var a1 = Math.atan2(p0[1] - p1[1], p0[0] - p1[0]);
      var a2 = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
      var ang = Math.abs(a2 - a1) * 180 / Math.PI;
      if (ang > 180) ang = 360 - ang;
      segs.push({ x: p1[0], y: p1[1], text: Math.round(ang) + '°', kind: 'ang' });
    }

    while (draw.labels.length < segs.length) {
      var t = new Konva.Text({
        fontSize: 11, fontFamily: 'Segoe UI, sans-serif',
        listening: false, shadowColor: '#0b0e12', shadowBlur: 3, shadowOpacity: 0.95
      });
      draw.labels.push(t);
      draw.group.add(t);
    }
    while (draw.labels.length > segs.length) draw.labels.pop().destroy();

    for (i = 0; i < segs.length; i++) {
      var lb = draw.labels[i];
      lb.text(segs[i].text);
      lb.fill(segs[i].kind === 'ang' ? '#e8b84b' : '#dfe8f2');
      lb.scaleX(1 / s); lb.scaleY(1 / s);
      lb.offsetX(lb.width() / 2);
      lb.offsetY(segs[i].kind === 'ang' ? -8 / s : lb.height() / 2 + 6 / s);
      lb.position({ x: segs[i].x, y: segs[i].y });
    }
  }

  /** apakah titik ini praktis menimpa titik terakhir yang sudah ditaruh? */
  function onLastPoint(w) {
    if (!draw.pts.length) return false;
    var s = scaleFactor(), last = draw.pts[draw.pts.length - 1];
    var dx = (w.x - last[0]) * s, dy = (w.y - last[1]) * s;
    return Math.sqrt(dx * dx + dy * dy) < CLOSE_PX;
  }

  function drawClick(evt) {
    var w = drawPoint(evt);
    if (!w) return;
    if (nearFirst(w)) { finishDraw(); return; }
    // klik kedua di tempat yang sama = niat klik-ganda, bukan titik baru.
    // Penandanya dipakai handler dblclick supaya klik cepat di dua tempat
    // berbeda tidak ikut mengakhiri poligon.
    if (onLastPoint(w)) { draw.dupClick = true; return; }
    draw.dupClick = false;
    draw.pts.push([w.x, w.y]);
    syncDraw(w);
    drawStatus();
  }

  function undoDrawPoint() {
    if (!draw || !draw.pts.length) return;
    draw.pts.pop();
    syncDraw();
    drawStatus();
  }

  function finishDraw() {
    if (!draw) return;
    var pts = draw.pts.slice();
    endDraw();

    if (pts.length < 3) { drawStatus('Poligon butuh minimal 3 titik.', 'warn'); return; }
    var shape = Shapes.polygonFromPoints(pts, unit());
    if (!shape) { drawStatus('Bentuknya tidak punya luas — coba lagi.', 'warn'); return; }

    Project.add([shape]);
    Project.setSelection([shape.id]);
    drawStatus(
      Shapes.selfIntersects(pts)
        ? 'Poligon dibuat (' + pts.length + ' titik), tapi sisinya saling menyilang — ' +
          'hasil 3D/STL bisa kacau. Rapikan lewat Edit Titik.'
        : 'Poligon dibuat: ' + pts.length + ' titik.',
      Shapes.selfIntersects(pts) ? 'warn' : ''
    );
  }

  /* ================================================================== */
  /* EDIT TITIK POLIGON                                                 */
  /* ================================================================== */
  var vedit = null;

  function vertexEditable(shape) {
    return !!shape && Shapes.def(shape.type).foot === 'poly' &&
           !Shapes.isTilted(shape) && !shape.meta.locked;
  }

  function startVertexEdit(id) {
    var shape = Project.get(id);
    if (!vertexEditable(shape)) return false;
    exitVertexEdit();
    if (draw) cancelDraw();

    vedit = { id: id, group: new Konva.Group(), dots: [], mids: [] };
    overlayLayer.add(vedit.group);
    tr.nodes([]);
    if (nodes[id]) nodes[id].draggable(false);
    syncVertexEdit();
    Project.emit('vertexedit', { active: true, id: id });
    return true;
  }

  function exitVertexEdit() {
    if (!vedit) return;
    var n = nodes[vedit.id], s = Project.get(vedit.id);
    if (n && s && !s.meta.locked) n.draggable(true);
    vedit.group.destroy();
    vedit = null;
    overlayLayer.batchDraw();
    syncTransformer();
    Project.emit('vertexedit', { active: false });
  }

  /** titik lokal poligon -> koordinat dunia */
  function vertexWorld(shape, lp) {
    var a = (shape.rotation || 0) * Math.PI / 180;
    var c = Math.cos(a), n = Math.sin(a);
    return { x: shape.x + (lp[0] * c - lp[1] * n), y: shape.y + (lp[0] * n + lp[1] * c) };
  }

  /** koordinat dunia -> titik lokal poligon */
  function vertexLocal(shape, w) {
    var a = (shape.rotation || 0) * Math.PI / 180;
    var c = Math.cos(a), n = Math.sin(a);
    var dx = w.x - shape.x, dy = w.y - shape.y;
    return [dx * c + dy * n, -dx * n + dy * c];
  }

  /** tulis ulang daftar titik lokal ke Project */
  function commitVertices(local, nohistory) {
    var shape = Project.get(vedit.id);
    var patch = Shapes.polygonPatchFromLocal(shape, local, unit());
    if (!patch) return false;
    Project.update(vedit.id, patch, { nohistory: !!nohistory, source: 'editor2d', full: true });
    return true;
  }

  function syncVertexEdit() {
    if (!vedit) return;
    var shape = Project.get(vedit.id);
    if (!vertexEditable(shape)) { exitVertexEdit(); return; }

    var s = scaleFactor();
    var local = Shapes.polygonLocal(shape);
    var n = local.length, i;

    while (vedit.dots.length < n) vedit.dots.push(makeVertexHandle(vedit.dots.length));
    while (vedit.dots.length > n) vedit.dots.pop().destroy();
    while (vedit.mids.length < n) vedit.mids.push(makeMidHandle(vedit.mids.length));
    while (vedit.mids.length > n) vedit.mids.pop().destroy();

    for (i = 0; i < n; i++) {
      var w = vertexWorld(shape, local[i]);
      vedit.dots[i].position(w);
      vedit.dots[i].radius((HANDLE_PX + 1) / s);
      vedit.dots[i].setAttr('vi', i);

      var j = (i + 1) % n;
      var wj = vertexWorld(shape, local[j]);
      vedit.mids[i].position({ x: (w.x + wj.x) / 2, y: (w.y + wj.y) / 2 });
      vedit.mids[i].radius(HANDLE_PX / s);
      vedit.mids[i].setAttr('vi', i);
    }
    overlayLayer.batchDraw();
  }

  function makeVertexHandle(index) {
    var c = new Konva.Circle({
      fill: '#4da3ff', stroke: '#12161c', strokeWidth: 1.5,
      strokeScaleEnabled: false, draggable: true
    });
    c.on('mousedown', function (e) { e.cancelBubble = true; });
    c.on('dragstart', function () { Project.pushHistory(); });
    c.on('dragmove', function () {
      var shape = Project.get(vedit.id);
      var local = Shapes.polygonLocal(shape);
      var i = c.getAttr('vi');
      local[i] = vertexLocal(shape, { x: snapWorld(c.x()), y: snapWorld(c.y()) });
      // titik dijaga minimal 3: kalau hasilnya jadi tidak valid, biarkan saja
      commitVertices(local, true);
      syncVertexEdit();
    });
    c.on('click', function (e) {
      if (!e.evt.altKey) return;
      e.cancelBubble = true;
      var shape = Project.get(vedit.id);
      var local = Shapes.polygonLocal(shape);
      if (local.length <= 3) { drawStatus('Poligon minimal 3 titik.', 'warn'); return; }
      local.splice(c.getAttr('vi'), 1);
      Project.pushHistory();
      commitVertices(local, true);
      syncVertexEdit();
    });
    vedit.group.add(c);
    return c;
  }

  function makeMidHandle(index) {
    var c = new Konva.Circle({
      fill: 'rgba(18,22,28,0.85)', stroke: '#4da3ff', strokeWidth: 1.4,
      strokeScaleEnabled: false, opacity: 0.75
    });
    c.on('mouseenter', function () { c.opacity(1); overlayLayer.batchDraw(); });
    c.on('mouseleave', function () { c.opacity(0.75); overlayLayer.batchDraw(); });
    c.on('mousedown', function (e) {
      e.cancelBubble = true;
      var shape = Project.get(vedit.id);
      var local = Shapes.polygonLocal(shape);
      var i = c.getAttr('vi'), j = (i + 1) % local.length;
      var mid = [(local[i][0] + local[j][0]) / 2, (local[i][1] + local[j][1]) / 2];
      local.splice(i + 1, 0, mid);
      Project.pushHistory();
      commitVertices(local, true);
      syncVertexEdit();
    });
    vedit.group.add(c);
    return c;
  }

  /* ------------------------------------------------------------------ */
  /* interaksi stage: pan, zoom, rubber-band                            */
  /* ------------------------------------------------------------------ */
  function wireStageEvents() {
    stage.container().addEventListener('contextmenu', function (e) { e.preventDefault(); });
    stage.container().addEventListener('mouseleave', hideCursorTip);

    stage.on('mousedown touchstart', function (e) {
      var mid = e.evt.button === 1 || e.evt.button === 2;
      if (draw && !mid && !spaceDown) { e.evt.preventDefault(); drawClick(e.evt); return; }
      if (mid || spaceDown) {
        e.evt.preventDefault();
        panning = { sx: e.evt.clientX, sy: e.evt.clientY, px: stage.x(), py: stage.y() };
        stage.container().style.cursor = 'grabbing';
        return;
      }
      if (e.target === stage) {
        var p = stage.getPointerPosition();
        rubberStart = screenToWorld(p.x, p.y);
        rubber.setAttrs({ x: rubberStart.x, y: rubberStart.y, width: 0, height: 0, visible: true });
        overlayLayer.batchDraw();
        if (!e.evt.shiftKey) Project.setSelection([], { source: 'editor2d' });
      }
    });

    stage.on('mousemove touchmove', function (e) {
      if (draw && !panning) {
        var dp = drawPoint(e.evt);
        if (dp) {
          syncDraw(dp);
          var el0 = document.getElementById('status-coords');
          if (el0) el0.textContent = 'X ' + Units.fmt(dp.x, unit()) + '   Y ' + Units.fmt(dp.y, unit());
          showCursorTip(dp, null);
        }
        return;
      }
      var p = stage.getPointerPosition();
      if (p) {
        var w = screenToWorld(p.x, p.y);
        var el = document.getElementById('status-coords');
        if (el) el.textContent = 'X ' + Units.fmt(w.x, unit()) + '   Y ' + Units.fmt(w.y, unit());
        // saat menggeser / menarik kotak seleksi, penunjuk cuma menghalangi
        if (panning || rubberStart) hideCursorTip();
        else {
          var hit = e.target && e.target !== stage && e.target.name() === 'shape'
            ? Project.get(e.target.id()) : null;
          showCursorTip(w, hit);
        }
      }
      if (panning) {
        stage.position({
          x: panning.px + (e.evt.clientX - panning.sx),
          y: panning.py + (e.evt.clientY - panning.sy)
        });
        stage.batchDraw();
        drawGrid();
        return;
      }
      if (rubberStart && p) {
        var w2 = screenToWorld(p.x, p.y);
        rubber.setAttrs({
          x: Math.min(rubberStart.x, w2.x),
          y: Math.min(rubberStart.y, w2.y),
          width: Math.abs(w2.x - rubberStart.x),
          height: Math.abs(w2.y - rubberStart.y)
        });
        overlayLayer.batchDraw();
      }
    });

    var endPointer = function (e) {
      if (panning) {
        panning = null;
        stage.container().style.cursor = spaceDown ? 'grab' : 'default';
      }
      if (rubberStart) {
        var box = { x: rubber.x(), y: rubber.y(), w: rubber.width(), h: rubber.height() };
        rubber.visible(false);
        rubberStart = null;
        overlayLayer.batchDraw();
        if (box.w > 0.001 && box.h > 0.001) selectInBox(box, e && e.evt && e.evt.shiftKey);
      }
    };
    stage.on('mouseup touchend', endPointer);
    window.addEventListener('mouseup', function (e) { if (panning || rubberStart) endPointer({ evt: e }); });

    // klik-ganda mengakhiri poligon, tapi HANYA kalau klik keduanya memang
    // menimpa titik terakhir — kalau tidak, mengklik dua titik dengan cepat
    // akan tidak sengaja menutup poligon
    stage.on('dblclick dbltap', function () {
      if (draw && draw.dupClick) finishDraw();
    });

    /*
     * Roda mouse mengikuti kebiasaan Photoshop/Figma:
     *   roda           -> geser atas-bawah
     *   Shift + roda   -> geser kiri-kanan
     *   Ctrl + roda    -> zoom (juga cocok dengan pinch trackpad, yang oleh
     *                    peramban dikirim sebagai ctrl+wheel)
     * Menjadikan roda polos sebagai zoom bikin kanvas besar susah dijelajahi —
     * tiap mau melihat bagian lain harus zoom keluar dulu lalu masuk lagi.
     */
    stage.on('wheel', function (e) {
      e.evt.preventDefault();
      var ev = e.evt;

      if (ev.ctrlKey || ev.metaKey) {
        zoomAt(Units.nextZoom(zoom, ev.deltaY < 0 ? 1 : -1), stage.getPointerPosition());
        return;
      }

      // deltaMode: 0 = piksel, 1 = baris, 2 = halaman
      var mult = ev.deltaMode === 1 ? 16 : (ev.deltaMode === 2 ? stage.height() : 1);
      var dx = ev.deltaX * mult;
      var dy = ev.deltaY * mult;

      // Sebagian peramban sudah menukar sendiri jadi deltaX saat Shift ditahan;
      // kalau belum, tukar di sini.
      if (ev.shiftKey && !ev.deltaX) { dx = dy; dy = 0; }

      stage.position({ x: stage.x() - dx, y: stage.y() - dy });
      stage.batchDraw();
      drawGrid();
    });
  }

  function selectInBox(box, additive) {
    var ids = [];
    var shapes = Project.shapes;
    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      if (!Shapes.isVisible(s)) continue;
      var b = Project.bounds([s.id]);
      if (!b) continue;
      if (b.maxX >= box.x && b.minX <= box.x + box.w &&
          b.maxY >= box.y && b.minY <= box.y + box.h) ids.push(s.id);
    }
    if (additive) {
      var cur = Project.selection;
      for (var j = 0; j < ids.length; j++) if (cur.indexOf(ids[j]) < 0) cur.push(ids[j]);
      ids = cur;
    }
    Project.setSelection(ids, { raw: true, source: 'editor2d' });
  }

  /* ------------------------------------------------------------------ */
  /* zoom & fit                                                         */
  /* ------------------------------------------------------------------ */
  function zoomAt(newZoom, anchor) {
    var oldS = scaleFactor();
    anchor = anchor || { x: stage.width() / 2, y: stage.height() / 2 };
    var world = { x: (anchor.x - stage.x()) / oldS, y: (anchor.y - stage.y()) / oldS };
    zoom = newZoom;
    var s = scaleFactor();
    stage.scale({ x: s, y: s });
    stage.position({ x: anchor.x - world.x * s, y: anchor.y - world.y * s });
    stage.batchDraw();
    drawGrid();
    refreshLabels();
    syncDraw();
    syncVertexEdit();
    Project.emit('zoom', { zoom: zoom });
  }

  function zoomBy(dir) { zoomAt(Units.nextZoom(zoom, dir), null); }
  function setZoom(z) { zoomAt(z, null); }

  function fit(ids) {
    var b = Project.bounds(ids && ids.length ? ids : null);
    var u = unit();
    if (!b || !(b.w > 0 || b.h > 0)) {
      // kosong: tampilkan area default 20 m
      var span = Units.fromM(20, u);
      b = { cx: 0, cy: 0, w: span, h: span };
    }
    var pad = 1.08;
    var sx = stage.width() / (b.w * pad || 1);
    var sy = stage.height() / (b.h * pad || 1);
    var target = Math.min(sx, sy) / (pxPerMeter() * Units.def(u).toM);

    // pilih step zoom terbesar yang masih muat
    var steps = Units.ZOOM_STEPS, z = steps[0];
    for (var i = 0; i < steps.length; i++) if (steps[i] <= target) z = steps[i];
    zoom = z;
    var s = scaleFactor();
    stage.scale({ x: s, y: s });
    stage.position({ x: stage.width() / 2 - b.cx * s, y: stage.height() / 2 - b.cy * s });
    stage.batchDraw();
    drawGrid();
    refreshLabels();
    syncDraw();
    syncVertexEdit();
    Project.emit('zoom', { zoom: zoom });
  }

  /* ------------------------------------------------------------------ */
  /* sinkronisasi dengan Project                                        */
  /* ------------------------------------------------------------------ */
  function onProjectChange(info) {
    if (info.reason === 'unit' || info.reason === 'rescale') {
      stage.scale({ x: scaleFactor(), y: scaleFactor() });
    }
    if (info.full || info.reason === 'load' || info.reason === 'undo' || info.reason === 'redo') {
      rebuild();
      drawGrid();
      if (vedit) { if (Project.get(vedit.id)) syncVertexEdit(); else exitVertexEdit(); }
      return;
    }
    if (info.source === 'editor2d') { refreshLabels(); syncLandWarnings(); return; }
    var ids = info.ids || [];
    for (var i = 0; i < ids.length; i++) {
      var sh = Project.get(ids[i]);
      if (sh) applyToNode(sh);
    }
    shapeLayer.batchDraw();
    overlayLayer.batchDraw();
    if (vedit) syncVertexEdit(); else tr.forceUpdate();
  }

  function onProjectSelect() {
    if (suppressSelect) return;
    // pindah seleksi = selesai mengedit titik poligon sebelumnya
    if (vedit && (Project.selection.length !== 1 || Project.selection[0] !== vedit.id)) {
      exitVertexEdit();
      return;
    }
    if (vedit) return;          // transformer tetap disembunyikan saat edit titik
    syncTransformer();
  }

  /* ------------------------------------------------------------------ */
  function resize() {
    if (!stage || !container) return;
    var w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    stage.width(w); stage.height(h);
    drawGrid();
    stage.batchDraw();
  }

  function setSpace(down) {
    spaceDown = down;
    if (stage) stage.container().style.cursor = down ? 'grab' : 'default';
  }

  global.Editor2D = {
    init: init,
    resize: resize,
    rebuild: rebuild,
    drawGrid: drawGrid,
    refreshLabels: refreshLabels,
    applySnapAngle: applySnapAngle,
    zoomBy: zoomBy,
    setZoom: setZoom,
    fit: fit,
    getZoom: function () { return zoom; },
    center: viewportCenterWorld,
    setSpace: setSpace,

    startDraw: startDraw,
    highlightSide: highlightSide,
    refreshCursorTip: function () { if (!Project.state.cursorTip) hideCursorTip(); },
    cancelDraw: cancelDraw,
    finishDraw: finishDraw,
    undoDrawPoint: undoDrawPoint,
    isDrawing: function () { return !!draw; },

    startVertexEdit: startVertexEdit,
    exitVertexEdit: exitVertexEdit,
    isVertexEditing: function () { return !!vedit; },
    canVertexEdit: vertexEditable
  };
})(window);
