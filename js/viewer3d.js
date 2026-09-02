/* layout3d — viewer 3D (Three.js r128)
 *
 * Peta koordinat 2D -> 3D:
 *   shape.x (denah X) -> three x
 *   shape.y (denah Y) -> three z
 *   elevation         -> three y  (alas mesh selalu di y=0 lokal)
 *   rotation (CW, °)  -> mesh.rotation.y = -rad   (2D searah jarum jam = -Y di three)
 * Semua nilai dikonversi ke METER dulu, jadi satuan project bebas ganti.
 *
 * Orbit control ditulis manual (OrbitControls ada di three/examples, bukan core r128).
 */
(function (global) {
  'use strict';

  var renderer, scene, camera, root, ground, gridHelper;
  var canvas, needsRender = true, rafId = null;
  var meshById = {};
  var raycaster, pointerVec;

  var ctrl = {
    target: null,
    radius: 40, theta: Math.PI * 0.25, phi: Math.PI * 0.32,
    minRadius: 0.5, maxRadius: 4000,
    dragging: null, lastX: 0, lastY: 0
  };

  var COLORS = {
    bg: 0x161b22,
    ground: 0x1c232c,
    grid1: 0x2c3846,
    grid2: 0x222b36,
    sel: 0x2f6da8
  };

  /* ------------------------------------------------------------------ */
  function init(canvasId) {
    canvas = document.getElementById(canvasId);

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(COLORS.bg, 1);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(COLORS.bg, 200, 900);

    camera = new THREE.PerspectiveCamera(45, 1, 0.05, 5000);
    ctrl.target = new THREE.Vector3(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    var key = new THREE.DirectionalLight(0xffffff, 0.72);
    key.position.set(28, 46, 20);
    scene.add(key);

    var fill = new THREE.DirectionalLight(0x9dc4ff, 0.28);
    fill.position.set(-30, 18, -24);
    scene.add(fill);

    var hemi = new THREE.HemisphereLight(0xbcd6f5, 0x1a1f26, 0.35);
    scene.add(hemi);

    ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshLambertMaterial({ color: COLORS.ground })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.userData.noExport = true;
    scene.add(ground);

    root = new THREE.Group();
    scene.add(root);

    raycaster = new THREE.Raycaster();
    pointerVec = new THREE.Vector2();

    buildGrid(60);
    wireControls();

    Project.on('change', function (info) { scheduleRebuild(info); });
    Project.on('select', function () { updateHighlight(); });

    resize();
    rebuild();
    fit();
    loop();
  }

  function buildGrid(sizeM) {
    if (gridHelper) { scene.remove(gridHelper); gridHelper.geometry.dispose(); }
    var step = 1;
    while (sizeM / step > 80) step *= 10;
    var divisions = Math.max(4, Math.round(sizeM / step));
    gridHelper = new THREE.GridHelper(divisions * step, divisions, COLORS.grid1, COLORS.grid2);
    gridHelper.position.y = 0;
    gridHelper.userData.noExport = true;
    if (gridHelper.material) {
      gridHelper.material.transparent = true;
      gridHelper.material.opacity = 0.6;
    }
    scene.add(gridHelper);
    ground.scale.set(divisions * step * 2.2, divisions * step * 2.2, 1);
    scene.fog.near = sizeM * 3;
    scene.fog.far = sizeM * 14;
  }

  /* ------------------------------------------------------------------ */
  /* bangun mesh                                                        */
  /* ------------------------------------------------------------------ */
  function disposeRoot() {
    for (var i = root.children.length - 1; i >= 0; i--) {
      var m = root.children[i];
      root.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    }
    meshById = {};
  }

  /** bukaan yang sedang aktif melubangi dinding (dihitung sekali per rebuild) */
  var openingCache = [];
  function refreshOpenings() {
    openingCache = Shapes.activeOpenings(Project.shapes);
    return openingCache;
  }

  function makeMesh(shape, unit) {
    var geo;
    try {
      geo = Geometry3D.build(shape, unit, openingCache);
    } catch (e) {
      console.error('[layout3d] gagal membangun geometri', shape.type, e);
      return null;
    }
    // dinding yang habis dilubangi bisa tidak menyisakan apa pun
    if (!geo.attributes.position || !geo.attributes.position.count) return null;
    var mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(shape.meta.color || '#c9b48d'),
      emissive: 0x000000,
      side: THREE.DoubleSide,
      transparent: !shape.meta.solid,
      opacity: shape.meta.solid ? 1 : 0.35
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.name = shape.id;
    mesh.userData.shapeId = shape.id;
    mesh.visible = Shapes.isVisible(shape);
    mesh.userData.noExport = !shape.meta.solid || !Shapes.isVisible(shape);
    placeMesh(mesh, shape, unit);
    return mesh;
  }

  var DEG = Math.PI / 180;

  function placeMesh(mesh, shape, unit) {
    mesh.position.set(
      Units.toM(shape.x, unit),
      Units.toM(shape.elevation || 0, unit),
      Units.toM(shape.y, unit)
    );
    // Euler 'YXZ' = Ryaw · RtiltX · RtiltZ : yaw diterapkan terakhir di frame
    // dunia, kemiringan bekerja di frame lokal objek. Urutan ini juga yang
    // dipakai Shapes.planExtents() untuk menghitung proyeksi denah.
    mesh.rotation.order = 'YXZ';
    mesh.rotation.set(
      (shape.tiltX || 0) * DEG,
      -(shape.rotation || 0) * DEG,
      (shape.tiltZ || 0) * DEG
    );
  }

  function rebuild() {
    disposeRoot();
    refreshOpenings();
    var unit = Project.state.scale.unit;
    var shapes = Project.shapes;
    for (var i = 0; i < shapes.length; i++) {
      var m = makeMesh(shapes[i], unit);
      if (!m) continue;
      meshById[shapes[i].id] = m;
      root.add(m);
    }
    autoGrid();
    updateHighlight();
    needsRender = true;
  }

  /** update ringan: hanya posisi/rotasi (tanpa rebuild geometri) */
  function updateTransforms(ids) {
    var unit = Project.state.scale.unit;
    for (var i = 0; i < ids.length; i++) {
      var m = meshById[ids[i]], s = Project.get(ids[i]);
      if (m && s) placeMesh(m, s, unit);
    }
    needsRender = true;
  }

  function autoGrid() {
    var b = Project.bounds();
    var unit = Project.state.scale.unit;
    var spanM = b ? Math.max(Units.toM(b.w, unit), Units.toM(b.h, unit), 10) : 20;
    var target = Math.max(20, Math.ceil(spanM * 1.6 / 10) * 10);
    if (Math.abs(target - (gridHelper ? gridHelper.userData.size || 0 : 0)) > 1) {
      buildGrid(target);
      gridHelper.userData.size = target;
      gridHelper.userData.noExport = true;
    }
  }

  /* ------------------------------------------------------------------ */
  /* rebuild ter-debounce                                               */
  /* ------------------------------------------------------------------ */
  var rebuildTimer = null, pendingFull = false, pendingIds = {};

  function scheduleRebuild(info) {
    // update parsial hanya aman kalau semua mesh-nya sudah ada
    var partial = info && info.reason === 'update' && !info.full && Array.isArray(info.ids);
    if (partial) {
      var ids = info.ids;
      for (var i = 0; i < ids.length; i++) {
        if (!meshById[ids[i]]) { partial = false; break; }
      }
    }
    if (partial) {
      // posisi/rotasi langsung (feedback instan saat drag);
      // ukuran baru menyusul lewat rebuildSome saat idle
      updateTransforms(info.ids);
      for (var j = 0; j < info.ids.length; j++) pendingIds[info.ids[j]] = true;
    } else {
      pendingFull = true;
    }
    // menggeser pintu/jendela (atau dindingnya) mengubah lubang di dinding lain,
    // jadi begitu ada bukaan aktif, pass saat idle harus rebuild penuh
    if (Shapes.activeOpenings(Project.shapes).length) pendingFull = true;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(function () {
      rebuildTimer = null;
      if (pendingFull) rebuild();
      else rebuildSome(Object.keys(pendingIds));
      pendingFull = false; pendingIds = {};
    }, 90);
  }

  function rebuildSome(ids) {
    refreshOpenings();
    var unit = Project.state.scale.unit;
    for (var i = 0; i < ids.length; i++) {
      var old = meshById[ids[i]];
      var s = Project.get(ids[i]);
      if (old) {
        root.remove(old);
        if (old.geometry) old.geometry.dispose();
        if (old.material) old.material.dispose();
        delete meshById[ids[i]];
      }
      if (!s) continue;
      var m = makeMesh(s, unit);
      if (m) { meshById[ids[i]] = m; root.add(m); }
    }
    autoGrid();
    updateHighlight();
    needsRender = true;
  }

  /* ------------------------------------------------------------------ */
  function updateHighlight() {
    var sel = Project.selection;
    for (var id in meshById) {
      var on = sel.indexOf(id) >= 0;
      var mat = meshById[id].material;
      if (!mat || !mat.emissive) continue;
      mat.emissive.setHex(COLORS.sel);
      mat.emissiveIntensity = on ? 0.2 : 0;    // cukup terlihat, warna asli tetap kebaca
    }
    needsRender = true;
  }

  /* ------------------------------------------------------------------ */
  /* kontrol orbit                                                      */
  /* ------------------------------------------------------------------ */
  function applyCamera() {
    var sp = Math.max(0.05, Math.min(Math.PI - 0.05, ctrl.phi));
    ctrl.phi = sp;
    camera.position.set(
      ctrl.target.x + ctrl.radius * Math.sin(sp) * Math.sin(ctrl.theta),
      ctrl.target.y + ctrl.radius * Math.cos(sp),
      ctrl.target.z + ctrl.radius * Math.sin(sp) * Math.cos(ctrl.theta)
    );
    camera.lookAt(ctrl.target);
    needsRender = true;
  }

  /** sumbu kanan & atas layar dalam koordinat dunia, untuk menggeser target */
  function screenAxes() {
    return {
      right: new THREE.Vector3(Math.cos(ctrl.theta), 0, -Math.sin(ctrl.theta)),
      up: new THREE.Vector3(0, 1, 0)
        .multiplyScalar(Math.sin(ctrl.phi))
        .addScaledVector(
          new THREE.Vector3(Math.sin(ctrl.theta), 0, Math.cos(ctrl.theta)),
          -Math.cos(ctrl.phi))
    };
  }

  /**
   * Titik dunia yang sedang ditunjuk kursor: kena objek kalau ada, kalau
   * tidak jatuh ke bidang mendatar setinggi titik orbit. Bidang cadangan itu
   * penting — tanpanya, zoom di area kosong (yang justru sering dipakai saat
   * mengatur pandangan) tidak punya acuan sama sekali.
   */
  function pointUnderCursor(e) {
    var r = canvas.getBoundingClientRect();
    pointerVec.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointerVec.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(pointerVec, camera);

    var vis = root.children.filter(function (m) { return m.visible; });
    var hits = raycaster.intersectObjects(vis, false);
    if (hits.length) return hits[0].point.clone();

    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ctrl.target.y);
    var pt = new THREE.Vector3();
    // ray sejajar bidang (pandangan mendatar) -> tidak ada perpotongan
    return raycaster.ray.intersectPlane(plane, pt) ? pt : null;
  }

  /**
   * Zoom dengan faktor k sambil menahan titik di bawah kursor tetap di
   * tempatnya pada layar.
   *
   * Caranya: skalakan posisi kamera DAN titik orbit terhadap titik itu.
   * Karena keduanya diskalakan dengan faktor sama, arah pandang tidak
   * berubah — hanya jaraknya — sehingga titik acuan tetap terproyeksi di
   * piksel yang sama.
   */
  function zoomAtCursor(e, k) {
    var newR = Math.max(ctrl.minRadius, Math.min(ctrl.maxRadius, ctrl.radius * k));
    var kk = newR / ctrl.radius;          // faktor efektif setelah dijepit batas
    if (Math.abs(kk - 1) < 1e-9) return;

    var p = pointUnderCursor(e);
    if (p) {
      ctrl.target.set(
        p.x + (ctrl.target.x - p.x) * kk,
        p.y + (ctrl.target.y - p.y) * kk,
        p.z + (ctrl.target.z - p.z) * kk
      );
    }
    ctrl.radius = newR;
    applyCamera();
  }

  function wireControls() {
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    canvas.addEventListener('mousedown', function (e) {
      ctrl.lastX = e.clientX; ctrl.lastY = e.clientY;
      ctrl.dragging = (e.button === 0 && !e.shiftKey) ? 'rotate' : 'pan';
      ctrl.moved = false;
      e.preventDefault();
    });

    window.addEventListener('mousemove', function (e) {
      if (!ctrl.dragging) return;
      var dx = e.clientX - ctrl.lastX, dy = e.clientY - ctrl.lastY;
      ctrl.lastX = e.clientX; ctrl.lastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) ctrl.moved = true;

      if (ctrl.dragging === 'rotate') {
        ctrl.theta -= dx * 0.006;
        ctrl.phi -= dy * 0.006;
      } else {
        // menyeret = menggenggam pemandangan: isi layar ikut arah kursor,
        // jadi tandanya kebalikan dari menggulir roda
        var panScale = ctrl.radius * 0.0016;
        var v = screenAxes();
        ctrl.target.addScaledVector(v.right, -dx * panScale);
        ctrl.target.addScaledVector(v.up, dy * panScale);
      }
      applyCamera();
    });

    window.addEventListener('mouseup', function (e) {
      if (ctrl.dragging === 'rotate' && !ctrl.moved) pick(e);
      ctrl.dragging = null;
    });

    /*
     * Roda mouse disamakan dengan kanvas 2D:
     *   roda           -> geser atas-bawah
     *   Shift + roda   -> geser kiri-kanan
     *   Ctrl + roda    -> zoom, MENUJU TITIK DI BAWAH KURSOR
     *
     * Yang terakhir itu intinya. Sebelumnya zoom selalu mendekat ke titik
     * pusat orbit, jadi memperbesar sudut tertentu mustahil: makin dekat,
     * yang mau dilihat justru makin keluar layar dan harus dikejar dengan
     * geser manual.
     */
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var mult = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? canvas.clientHeight : 1);

      if (e.ctrlKey || e.metaKey) {
        zoomAtCursor(e, e.deltaY > 0 ? 1.14 : 1 / 1.14);
        return;
      }

      var dx = e.deltaX * mult;
      var dy = e.deltaY * mult;
      if (e.shiftKey && !e.deltaX) { dx = dy; dy = 0; }

      var panScale = ctrl.radius * 0.0016;
      var v = screenAxes();
      // arah roda: gulir ke bawah = pandangan turun (isi layar naik),
      // sama seperti menggulir halaman — kebalikan dari menyeret dengan tangan
      ctrl.target.addScaledVector(v.right, dx * panScale);
      ctrl.target.addScaledVector(v.up, -dy * panScale);
      applyCamera();
    }, { passive: false });
  }

  function pick(e) {
    var r = canvas.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    pointerVec.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointerVec.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(pointerVec, camera);
    var visible = root.children.filter(function (m) { return m.visible; });
    var hits = raycaster.intersectObjects(visible, false);
    if (hits.length) {
      Project.setSelection([hits[0].object.userData.shapeId], { source: 'viewer3d' });
    } else {
      Project.setSelection([], { source: 'viewer3d' });
    }
  }

  /* ------------------------------------------------------------------ */
  function fit(ids) {
    // rebuild di-debounce; kalau masih ada yang tertunda, selesaikan dulu —
    // kalau tidak, bounding box-nya dihitung dari scene yang belum lengkap
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
      rebuildTimer = null;
      if (pendingFull) rebuild(); else rebuildSome(Object.keys(pendingIds));
      pendingFull = false; pendingIds = {};
    }

    var list = (ids && ids.length
      ? ids.map(function (i) { return meshById[i]; }).filter(Boolean)
      : root.children).filter(function (m) { return m.visible; });
    var box = new THREE.Box3();
    if (list.length) {
      box.setFromObject(list[0]);
      for (var i = 1; i < list.length; i++) box.expandByObject(list[i]);
    } else {
      box.set(new THREE.Vector3(-8, 0, -8), new THREE.Vector3(8, 4, 8));
    }
    var c = box.getCenter(new THREE.Vector3());
    var size = box.getSize(new THREE.Vector3());
    var span = Math.max(size.x, size.y, size.z, 1);

    // jarak yang benar-benar memuat objek, vertikal DAN horizontal
    // (pane 3D sering sempit & tinggi -> fov horizontal jauh lebih kecil)
    var vFov = camera.fov * Math.PI / 180;
    var aspect = camera.aspect || 1;
    var hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    var distV = (span / 2) / Math.tan(vFov / 2);
    var distH = (span / 2) / Math.tan(hFov / 2);

    ctrl.target.copy(c);
    ctrl.radius = Math.max(2, Math.max(distV, distH) * 1.45);
    ctrl.theta = Math.PI * 0.22;
    ctrl.phi = Math.PI * 0.33;
    camera.far = Math.max(2000, ctrl.radius * 12);
    camera.updateProjectionMatrix();
    applyCamera();
  }

  function resize() {
    if (!renderer || !canvas) return;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    needsRender = true;
  }

  function loop() {
    rafId = requestAnimationFrame(loop);
    if (needsRender) {
      needsRender = false;
      renderer.render(scene, camera);
    }
  }

  /** mesh untuk export STL (hanya yang solid) */
  function exportables(ids) {
    var out = [];
    var list = ids && ids.length ? ids : Object.keys(meshById);
    for (var i = 0; i < list.length; i++) {
      var m = meshById[list[i]];
      var s = Project.get(list[i]);
      if (m && s && s.meta.solid && Shapes.isVisible(s)) out.push(m);
    }
    return out;
  }

  global.Viewer3D = {
    init: init,
    resize: resize,
    rebuild: rebuild,
    fit: fit,
    exportables: exportables,
    invalidate: function () { needsRender = true; },

    /** keadaan kamera orbit — untuk debug & pengujian */
    cameraState: function () {
      return {
        target: ctrl.target.clone(),
        radius: ctrl.radius, theta: ctrl.theta, phi: ctrl.phi,
        position: camera.position.clone()
      };
    },

    /** proyeksikan titik dunia ke piksel kanvas — untuk memastikan titik yang
     *  ditunjuk kursor benar-benar diam di layar saat di-zoom */
    project: function (v) {
      var p = v.clone().project(camera);
      return {
        x: (p.x + 1) / 2 * canvas.clientWidth,
        y: (-p.y + 1) / 2 * canvas.clientHeight
      };
    }
  };
})(window);
