/* layout3d — builder geometri 3D
 *
 * Konvensi: setiap builder mengembalikan geometri UNIT
 *   x, z ∈ [-0.5, 0.5]   (footprint)
 *   y    ∈ [0, 1]        (alas di y=0, tumbuh ke atas)
 * lalu di-scale ke (w, h, d) meter oleh place().
 * Dengan begitu elevation tinggal jadi offset y — atap gampang ditumpuk di atas badan.
 *
 * Catatan versi: Three.js r128. Jangan pakai CapsuleGeometry / BufferGeometryUtils
 * (tidak tersedia di build core r128) — merge dilakukan manual di mergeGeos().
 */
(function (global) {
  'use strict';

  var SEG = 32;          // segmen radial default
  var ARC_SEG = 28;      // segmen busur atap lengkung

  /* ------------------------------------------------------------------ */
  /* util                                                               */
  /* ------------------------------------------------------------------ */

  /** gabung beberapa BufferGeometry jadi satu (position + normal saja) */
  function mergeGeos(list) {
    var parts = [], total = 0, i, g;
    for (i = 0; i < list.length; i++) {
      g = list[i];
      if (g.index) g = g.toNonIndexed();
      if (!g.attributes.normal) g.computeVertexNormals();
      parts.push(g);
      total += g.attributes.position.count;
    }
    if (parts.length === 1) return parts[0];
    var pos = new Float32Array(total * 3);
    var nor = new Float32Array(total * 3);
    var off = 0;
    for (i = 0; i < parts.length; i++) {
      pos.set(parts[i].attributes.position.array, off * 3);
      nor.set(parts[i].attributes.normal.array, off * 3);
      off += parts[i].attributes.position.count;
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return out;
  }

  /** bikin BufferGeometry dari daftar segitiga mentah (flat shading) */
  function fromTriangles(tris) {
    var pos = new Float32Array(tris.length * 9);
    for (var i = 0; i < tris.length; i++) {
      var t = tris[i];
      for (var v = 0; v < 3; v++) {
        pos[i * 9 + v * 3]     = t[v][0];
        pos[i * 9 + v * 3 + 1] = t[v][1];
        pos[i * 9 + v * 3 + 2] = t[v][2];
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  /** BufferGeometry dari array datar posisi + normal */
  function geoFrom(pos, nor) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
    return g;
  }

  function norm3(x, y, z) {
    var l = Math.sqrt(x * x + y * y + z * z) || 1;
    return [x / l, y / l, z / l];
  }

  /** unit geometry -> ukuran nyata (meter) */
  function place(geo, w, h, d) {
    geo.scale(w || 1e-6, h || 1e-6, d || 1e-6);
    return geo;
  }

  /* ------------------------------------------------------------------ */
  /* prisma dari profil penampang                                        */
  /* profil: titik [z, y] searah CCW, z ∈ [-.5,.5], y ∈ [0,1], konveks   */
  /* diekstrusi sepanjang sumbu X dari -0.5 ke +0.5                      */
  /* ------------------------------------------------------------------ */
  function prism(profile) {
    var hw = 0.5, tris = [], n = profile.length, i, j;

    // dinding samping
    for (i = 0; i < n; i++) {
      j = (i + 1) % n;
      var pi = profile[i], pj = profile[j];
      var A = [-hw, pi[1], pi[0]];
      var B = [ hw, pi[1], pi[0]];
      var C = [ hw, pj[1], pj[0]];
      var D = [-hw, pj[1], pj[0]];
      tris.push([A, B, C], [A, C, D]);
    }
    // tutup ujung (fan — profil harus konveks)
    for (i = 1; i < n - 1; i++) {
      var p0 = profile[0], p1 = profile[i], p2 = profile[i + 1];
      // ujung +x menghadap +x
      tris.push([[hw, p0[1], p0[0]], [hw, p2[1], p2[0]], [hw, p1[1], p1[0]]]);
      // ujung -x menghadap -x
      tris.push([[-hw, p0[1], p0[0]], [-hw, p1[1], p1[0]], [-hw, p2[1], p2[0]]]);
    }
    return fromTriangles(tris);
  }

  var PROFILES = {
    gable: [[-0.5, 0], [0.5, 0], [0, 1]],
    shed:  [[-0.5, 0], [0.5, 0], [0.5, 1]],
    arc: (function () {
      var p = [[-0.5, 0], [0.5, 0]];
      for (var i = 1; i < ARC_SEG; i++) {
        var a = i * Math.PI / ARC_SEG;
        p.push([Math.cos(a) * 0.5, Math.sin(a)]);
      }
      return p;
    })()
  };

  /* ------------------------------------------------------------------ */
  /* atap limas (hip): bubungan sepanjang sisi terpanjang                */
  /* dibangun langsung dalam ukuran nyata supaya rasio bubungan benar    */
  /* ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ */
  /* kubah / kerucut / piramida — ditulis manual, bukan pakai            */
  /* SphereGeometry+CircleGeometry, supaya mesh-nya benar-benar tertutup  */
  /* (STL yang bocor bikin slicer 3D print ngaco). Normal dihitung        */
  /* analitis supaya permukaan lengkung tetap halus setelah di-scale.     */
  /* ------------------------------------------------------------------ */

  /** setengah ellipsoid: jari-jari xz = 0.5, tinggi 1, alas tertutup */
  function domeUnit(seg, rings) {
    var S = seg || SEG, J = rings || 12, pos = [], nor = [], i, j;

    function V(jj, ii) {
      if (jj === J) return [0, 1, 0];   // kutub: satu titik persis, jangan hasil cos(π/2)
      var t = (jj / J) * (Math.PI / 2);
      var a = ((ii % S) / S) * Math.PI * 2;
      var r = 0.5 * Math.cos(t);
      return [r * Math.cos(a), Math.sin(t), r * Math.sin(a)];
    }
    // gradien ellipsoid (x/0.25, y/1, z/0.25)  ∝  (4x, y, 4z)
    function N(p) { return norm3(4 * p[0], p[1], 4 * p[2]); }

    function push(p) { pos.push(p[0], p[1], p[2]); var n = N(p); nor.push(n[0], n[1], n[2]); }
    function pushFlat(p, n) { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); }

    for (j = 0; j < J; j++) {
      for (i = 0; i < S; i++) {
        var A = V(j, i), B = V(j, i + 1), C = V(j + 1, i + 1), D = V(j + 1, i);
        push(A); push(C); push(B);
        if (j + 1 < J) { push(A); push(D); push(C); }  // baris teratas mengerucut ke kutub
      }
    }
    var down = [0, -1, 0];
    for (i = 0; i < S; i++) {
      pushFlat([0, 0, 0], down);
      pushFlat(V(0, i), down);
      pushFlat(V(0, i + 1), down);
    }
    return geoFrom(pos, nor);
  }

  /** kerucut: jari-jari xz = 0.5, tinggi 1, alas tertutup */
  function coneUnit() {
    var S = SEG, pos = [], nor = [], i;
    function V(ii) {
      var a = ((ii % S) / S) * Math.PI * 2;
      return [0.5 * Math.cos(a), 0, 0.5 * Math.sin(a)];
    }
    function sideN(ii) {
      var a = ((ii % S) / S) * Math.PI * 2;
      return norm3(Math.cos(a), 0.5, Math.sin(a));
    }
    function put(p, n) { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); }

    for (i = 0; i < S; i++) {
      var nA = sideN(i), nB = sideN(i + 1);
      var nApex = norm3(nA[0] + nB[0], nA[1] + nB[1], nA[2] + nB[2]);
      put(V(i + 1), nB);
      put(V(i), nA);
      put([0, 1, 0], nApex);
    }
    var down = [0, -1, 0];
    for (i = 0; i < S; i++) {
      put([0, 0, 0], down);
      put(V(i), down);
      put(V(i + 1), down);
    }
    return geoFrom(pos, nor);
  }

  /** piramida alas persegi 1×1, tinggi 1 */
  function pyramidUnit() {
    var A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5];
    var P = [0, 1, 0];
    return fromTriangles([
      [B, A, P], [C, B, P], [D, C, P], [A, D, P],
      [A, C, D], [A, B, C]
    ]);
  }

  function hipRoof(w, h, d) {
    var swap = d > w;
    var W = swap ? d : w, D = swap ? w : d;
    var hwv = W / 2, hd = D / 2;
    var rx = Math.max(0, (W - D) / 2);

    // alas persegi -> bubungan menyusut jadi satu titik = piramida
    if (rx < 1e-6) {
      var pg = place(pyramidUnit(), W, h, D);
      if (swap) pg.rotateY(Math.PI / 2);
      return pg;
    }

    var A = [-hwv, 0, -hd], B = [hwv, 0, -hd], C = [hwv, 0, hd], Dp = [-hwv, 0, hd];
    var R0 = [-rx, h, 0], R1 = [rx, h, 0];

    var tris = [
      [B, A, R0], [B, R0, R1],       // sisi -z
      [Dp, C, R1], [Dp, R1, R0],     // sisi +z
      [A, Dp, R0],                   // ujung -x
      [C, B, R1],                    // ujung +x
      [A, C, Dp], [A, B, C]          // alas
    ];
    var g = fromTriangles(tris);
    if (swap) g.rotateY(Math.PI / 2);
    return g;
  }

  /* ------------------------------------------------------------------ */
  /* builder per tipe (semua unit, kecuali yang butuh ukuran nyata)      */
  /* ------------------------------------------------------------------ */
  var BUILDERS = {

    box: function () {
      return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    },

    cylinder: function () {
      return new THREE.CylinderGeometry(0.5, 0.5, 1, SEG).translate(0, 0.5, 0);
    },

    cone: coneUnit,

    pyramid: pyramidUnit,

    sphere: function () {
      return new THREE.SphereGeometry(0.5, SEG, Math.round(SEG / 2)).translate(0, 0.5, 0);
    },

    dome: domeUnit,

    prismGable: function () { return prism(PROFILES.gable); },
    prismShed:  function () { return prism(PROFILES.shed); },
    prismArc:   function () { return prism(PROFILES.arc); },

    /** tangga: anak tangga naik searah sumbu +z (arah "dalam" di denah) */
    stairsUnit: function (steps) {
      var g = [], sd = 1 / steps, i;
      for (i = 0; i < steps; i++) {
        var hgt = (i + 1) / steps;
        g.push(new THREE.BoxGeometry(1, hgt, sd)
          .translate(0, hgt / 2, -0.5 + sd * (i + 0.5)));
      }
      return mergeGeos(g);
    }
  };

  /* ------------------------------------------------------------------ */
  /* builder yang butuh ukuran nyata (rasio tidak boleh ikut ter-scale)  */
  /* ------------------------------------------------------------------ */

  /** ruangan berongga: 4 dinding, tebal t, ukuran luar w×d */
  function roomShell(w, h, d, t) {
    t = Math.min(t || 0.15, Math.min(w, d) / 2.5);
    var inner = Math.max(1e-4, d - 2 * t);
    var parts = [
      new THREE.BoxGeometry(w, h, t).translate(0, h / 2, -d / 2 + t / 2),
      new THREE.BoxGeometry(w, h, t).translate(0, h / 2,  d / 2 - t / 2),
      new THREE.BoxGeometry(t, h, inner).translate(-w / 2 + t / 2, h / 2, 0),
      new THREE.BoxGeometry(t, h, inner).translate( w / 2 - t / 2, h / 2, 0)
    ];
    return mergeGeos(parts);
  }

  /* ------------------------------------------------------------------ */
  /* dinding berlubang                                                   */
  /*                                                                     */
  /* Tanpa operasi boolean/CSG: dinding dipotong jadi kolom-kolom pada    */
  /* setiap batas lubang, lalu tiap kolom diisi balok di atas & di bawah  */
  /* lubangnya. Hasilnya dekomposisi persegi yang eksak — tiap potongan   */
  /* tetap solid tertutup, jadi STL-nya aman.                            */
  /* ------------------------------------------------------------------ */

  function emptyGeo() {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(0), 3));
    return g;
  }

  /**
   * Dinding sepanjang X (panjang L, tinggi H, tebal T) dengan lubang persegi.
   * holes = [{u0,u1,y0,y1}], u relatif tengah dinding, y dari alas. Meter.
   */
  function wallWithOpenings(L, H, T, holes) {
    if (!holes || !holes.length) return boxP(L, H, T, 0, 0, 0);

    var hl = L / 2, i, k;

    // 1) batas kolom = setiap tepi lubang, dijepit ke panjang dinding
    var cuts = [-hl, hl];
    for (i = 0; i < holes.length; i++) {
      cuts.push(Math.max(-hl, Math.min(hl, holes[i].u0)));
      cuts.push(Math.max(-hl, Math.min(hl, holes[i].u1)));
    }
    cuts.sort(function (a, b) { return a - b; });

    var parts = [];
    for (i = 0; i + 1 < cuts.length; i++) {
      var ua = cuts[i], ub = cuts[i + 1];
      var wSeg = ub - ua;
      if (wSeg < 1e-6) continue;
      var mid = (ua + ub) / 2;

      // 2) lubang yang menutupi kolom ini secara penuh
      //    (batas kolom diambil dari tepi lubang, jadi tidak ada yang separuh)
      var spans = [];
      for (k = 0; k < holes.length; k++) {
        if (holes[k].u0 <= mid && holes[k].u1 >= mid) {
          var a0 = Math.max(0, holes[k].y0), a1 = Math.min(H, holes[k].y1);
          if (a1 > a0) spans.push([a0, a1]);
        }
      }

      // 3) gabungkan rentang vertikal yang bertumpuk, isi celah sisanya
      spans.sort(function (a, b) { return a[0] - b[0]; });
      var merged = [];
      for (k = 0; k < spans.length; k++) {
        var last = merged[merged.length - 1];
        if (last && spans[k][0] <= last[1] + 1e-9) last[1] = Math.max(last[1], spans[k][1]);
        else merged.push([spans[k][0], spans[k][1]]);
      }

      var y = 0;
      for (k = 0; k < merged.length; k++) {
        if (merged[k][0] - y > 1e-6) parts.push(boxP(wSeg, merged[k][0] - y, T, mid, y, 0));
        y = Math.max(y, merged[k][1]);
      }
      if (H - y > 1e-6) parts.push(boxP(wSeg, H - y, T, mid, y, 0));
    }

    return parts.length ? mergeGeos(parts) : emptyGeo();
  }

  /**
   * dinding lurus / cangkang ruangan / massa tebal — lengkap dengan lubang
   * pintu & jendela.
   *
   * Host TIPIS (dinding, ruangan): lubang menembus penuh sampai tebusnya,
   * seperti dinding sungguhan — perilaku ini tidak berubah dari sebelumnya.
   *
   * Host TEBAL bertanda `shallowHost` (mis. Massa Box): melubangi penuh
   * artinya menerowong seluruh badan bangunan, jelas bukan maksud user.
   * Sebagai gantinya dipotong CERUK (embrasure) setebal bukaannya sendiri,
   * persis di posisi bukaan itu ditaruh (acrossOffset) — sisa ketebalan di
   * kedua sisinya tetap solid utuh. Kalau user menaruh bukaan di tepi massa
   * (kelakuan wajar saat menaruh pintu di kanvas), hasilnya jadi pintu masuk
   * sungguhan yang tembus ke permukaan.
   */
  function hostWallGeo(shape, unit, openings) {
    var segs = Shapes.wallCuts(shape, openings);
    var m = function (v) { return Units.toM(v, unit); };
    var H = Math.max(1e-5, m(shape.height));
    var shallow = !!Shapes.def(shape.type).shallowHost;
    var parts = [];

    for (var i = 0; i < segs.length; i++) {
      var g = segs[i];
      if (g.len <= 1e-9 || g.thick <= 1e-9) continue;
      var L = m(g.len), Tfull = m(g.thick);
      var holes = g.holes.map(function (o) {
        return { u0: m(o.u0), u1: m(o.u1), y0: m(o.y0), y1: m(o.y1),
                 depth: m(o.depth), acrossOffset: m(o.acrossOffset) };
      });

      var piece;
      if (shallow && holes.length) {
        var revealT = Math.min(Tfull, Math.max.apply(null, holes.map(function (h) { return h.depth; })));
        revealT = Math.max(revealT, Math.min(Tfull, 0.01));   // jangan sampai geometrinya 0 tebal

        var mid = 0;
        for (var k = 0; k < holes.length; k++) mid += holes[k].acrossOffset;
        mid /= holes.length;
        // jaga ceruk tetap di dalam batas ketebalan massa
        var half = Tfull / 2, sh = revealT / 2;
        mid = Math.max(-half + sh, Math.min(half - sh, mid));

        var shell = wallWithOpenings(L, H, revealT, holes);
        shell.translate(0, 0, mid);
        var pieces = [shell];
        var loLen = (mid - sh) - (-half);
        var hiLen = half - (mid + sh);
        if (loLen > 1e-5) pieces.push(boxP(L, H, loLen, 0, 0, -half + loLen / 2));
        if (hiLen > 1e-5) pieces.push(boxP(L, H, hiLen, 0, 0, half - hiLen / 2));
        piece = mergeGeos(pieces);
      } else {
        piece = wallWithOpenings(L, H, Tfull, holes);
      }

      if (!piece.attributes.position.count) continue;
      // segmen arah Z dibangun sepanjang X dulu, lalu diputar; pakai -90°
      // supaya arah maju sepanjang dinding tetap searah +Z (bukan terbalik)
      if (g.axis === 'z') piece.rotateY(-Math.PI / 2);
      piece.translate(m(g.cx), 0, m(g.cz));
      parts.push(piece);
    }
    return parts.length ? mergeGeos(parts) : emptyGeo();
  }

  /** ekstrusi poligon bebas; points ternormalisasi [-0.5..0.5] di bidang denah */
  function polyExtrude(points, w, h, d) {
    var shape = new THREE.Shape();
    // titik denah (x, y2d) -> Shape (x, -y2d) supaya setelah rotateX(-90°)
    // sumbu y2d jatuh tepat ke sumbu z dunia
    shape.moveTo(points[0][0] * w, -points[0][1] * d);
    for (var i = 1; i < points.length; i++) shape.lineTo(points[i][0] * w, -points[i][1] * d);
    shape.closePath();
    var g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 6 });
    g.rotateX(-Math.PI / 2);
    return g;
  }

  /* ================================================================== */
  /* OBJEK KOMPOSIT                                                     */
  /*                                                                    */
  /* Dibangun langsung dalam METER (bukan unit) karena proporsi antar   */
  /* bagian tidak boleh ikut ter-scale: roda mobil harus tetap bundar   */
  /* walau bodinya 1,8 × 4,5 m.                                         */
  /*                                                                    */
  /* Aturan: semua bagian wajib berada di dalam kotak nominal w×h×d,    */
  /* supaya footprint denah 2D dan bounding box tetap jujur.            */
  /* Tiap bagian adalah solid tertutup sendiri, jadi hasil merge tetap  */
  /* aman untuk STL.                                                    */
  /* ================================================================== */

  var S_FINE = 20, S_MID = 14, S_LOW = 10;

  /** balok; (x,y,z) = titik tengah alas bagian */
  function boxP(w, h, d, x, y, z) {
    return new THREE.BoxGeometry(w, h, d).translate(x || 0, (y || 0) + h / 2, z || 0);
  }
  /** silinder tegak; (x,y,z) = titik tengah alas */
  function cylP(dia, h, x, y, z, seg) {
    return new THREE.CylinderGeometry(dia / 2, dia / 2, h, seg || S_MID)
      .translate(x || 0, (y || 0) + h / 2, z || 0);
  }
  /** kerucut terpancung; (x,y,z) = titik tengah alas */
  function frustP(diaTop, diaBot, h, x, y, z, seg) {
    return new THREE.CylinderGeometry(diaTop / 2, diaBot / 2, h, seg || S_FINE)
      .translate(x || 0, (y || 0) + h / 2, z || 0);
  }
  /** elipsoid; (x,y,z) = titik PUSAT */
  function ellipP(dx, dy, dz, x, y, z, seg) {
    var s = seg || S_MID;
    return new THREE.SphereGeometry(0.5, s, Math.max(4, Math.round(s / 2)))
      .scale(dx, dy, dz).translate(x || 0, y || 0, z || 0);
  }
  /** silinder dengan sumbu mendatar sepanjang X (roda/rol); (x,y,z) = pusat */
  function axleX(dia, len, x, y, z, seg) {
    return new THREE.CylinderGeometry(dia / 2, dia / 2, len, seg || S_MID)
      .rotateZ(Math.PI / 2).translate(x || 0, y || 0, z || 0);
  }
  /** silinder dengan sumbu mendatar sepanjang Z; (x,y,z) = pusat */
  function axleZ(dia, len, x, y, z, seg) {
    return new THREE.CylinderGeometry(dia / 2, dia / 2, len, seg || S_MID)
      .rotateX(Math.PI / 2).translate(x || 0, y || 0, z || 0);
  }
  /** kubah tertutup; (x,y,z) = titik tengah alas */
  function domeP(dia, h, x, y, z, seg) {
    return place(domeUnit(seg || 16, 7), dia, h, dia).translate(x || 0, y || 0, z || 0);
  }
  /** empat kaki balok di pojok-pojok */
  function legs(sz, h, spanX, spanZ) {
    var out = [], sx, sz2;
    for (sx = -1; sx <= 1; sx += 2) {
      for (sz2 = -1; sz2 <= 1; sz2 += 2) {
        out.push(boxP(sz, h, sz, sx * (spanX / 2 - sz / 2), 0, sz2 * (spanZ / 2 - sz / 2)));
      }
    }
    return out;
  }
  /** penampang lingkaran boleh lonjong: bangun bulat lalu gepengkan sumbu Z */
  function oval(geo, w, d) {
    if (Math.abs(d - w) > 1e-6) geo.scale(1, 1, d / w);
    return geo;
  }

  /* --- vegetasi ----------------------------------------------------- */

  function treeGeo(w, h, d) {
    var td = Math.max(w, d) * 0.14, th = h * 0.36, ch = h - th;
    return mergeGeos([
      cylP(td, th * 1.1, 0, 0, 0, S_LOW),                                    // batang
      ellipP(w, ch, d, 0, th + ch * 0.5, 0, 16),                             // tajuk utama
      ellipP(w * 0.52, ch * 0.5, d * 0.52, w * 0.16, th + ch * 0.72, -d * 0.12, 12)
    ]);
  }

  /* --- peralatan pabrik --------------------------------------------- */

  /** corong: kerah atas + corong mengerucut ke bawah + pipa keluaran */
  function hopperGeo(w, h, d) {
    var outD = w * 0.2;
    var pipeH = h * 0.16, coneH = h * 0.62, collarH = h - pipeH - coneH;
    return oval(mergeGeos([
      cylP(outD, pipeH, 0, 0, 0, S_MID),                                     // pipa keluaran
      frustP(w * 0.97, outD, coneH, 0, pipeH, 0, S_FINE),                    // corong
      cylP(w, collarH, 0, pipeH + coneH, 0, S_FINE)                          // kerah atas
    ]), w, d);
  }

  /** tangki: kaki + badan silinder + tutup kubah */
  function tankGeo(w, h, d) {
    var legH = h * 0.13, shellH = h * 0.6, domeH = h - legH - shellH;
    var parts = [
      cylP(w * 0.94, shellH, 0, legH, 0, S_FINE),
      domeP(w * 0.94, domeH, 0, legH + shellH, 0)
    ];
    for (var i = 0; i < 4; i++) {
      var a = Math.PI / 4 + i * Math.PI / 2;
      parts.push(cylP(w * 0.09, legH * 1.02, Math.cos(a) * w * 0.36, 0, Math.sin(a) * w * 0.36, S_LOW));
    }
    return oval(mergeGeos(parts), w, d);
  }

  /** rotary: cangkang + dua riding ring + gigi penggerak (sumbu = tinggi) */
  function rotaryGeo(w, h, d) {
    return oval(mergeGeos([
      cylP(w * 0.88, h, 0, 0, 0, S_FINE),
      cylP(w, h * 0.05, 0, h * 0.2, 0, S_FINE),
      cylP(w, h * 0.05, 0, h * 0.72, 0, S_FINE),
      cylP(w * 0.97, h * 0.035, 0, h * 0.45, 0, S_FINE)
    ]), w, d);
  }

  /** konveyor: kaki + rangka + sabuk + rol di kedua ujung (panjang = X) */
  function conveyorGeo(w, h, d) {
    var beltH = Math.min(h * 0.3, d * 0.55);
    var legH = h - beltH;
    var rail = d * 0.09;
    var parts = [
      boxP(w * 0.94, beltH * 0.34, rail, 0, legH + beltH * 0.2, -(d / 2 - rail / 2)),
      boxP(w * 0.94, beltH * 0.34, rail, 0, legH + beltH * 0.2, d / 2 - rail / 2),
      boxP(w * 0.86, beltH * 0.16, d * 0.78, 0, legH + beltH * 0.55, 0),     // sabuk
      axleZ(beltH * 0.62, d * 0.86, -w * 0.45, legH + beltH * 0.36, 0, S_MID),
      axleZ(beltH * 0.62, d * 0.86, w * 0.45, legH + beltH * 0.36, 0, S_MID)
    ];
    if (legH > 1e-4) {
      parts = parts.concat(legs(rail, legH, w * 0.76, d * 0.9));
    }
    return mergeGeos(parts);
  }

  /** mesin: alas + bodi + motor silinder + kotak kontrol */
  function machineGeo(w, h, d) {
    var baseH = h * 0.12, bodyH = h * 0.6, motorH = h - baseH - bodyH;
    return mergeGeos([
      boxP(w, baseH, d, 0, 0, 0),
      boxP(w * 0.84, bodyH, d * 0.84, 0, baseH, 0),
      cylP(Math.min(w, d) * 0.42, motorH, -w * 0.16, baseH + bodyH, 0, S_MID),
      boxP(w * 0.24, h * 0.28, d * 0.1, w * 0.28, baseH + bodyH * 0.5, d * 0.45)
    ]);
  }

  /** panel listrik: plint + kabinet + daun pintu + kanopi + gagang */
  function panelGeo(w, h, d) {
    var plint = h * 0.05, capH = h * 0.04;
    var bodyH = h - plint - capH;
    return mergeGeos([
      boxP(w, plint, d, 0, 0, 0),
      boxP(w * 0.96, bodyH, d * 0.92, 0, plint, 0),
      boxP(w * 0.86, bodyH * 0.86, d * 0.05, 0, plint + bodyH * 0.07, d * 0.44),
      boxP(w, capH, d, 0, h - capH, 0),
      cylP(w * 0.05, bodyH * 0.3, w * 0.34, plint + bodyH * 0.35, d * 0.46, S_LOW)
    ]);
  }

  /* --- bukaan -------------------------------------------------------- */

  /** pintu: kusen tiga sisi + daun pintu + kenop */
  function doorPanelGeo(w, h, d) {
    var fr = Math.min(w * 0.09, h * 0.05);
    return mergeGeos([
      boxP(fr, h, d, -(w - fr) / 2, 0, 0),
      boxP(fr, h, d, (w - fr) / 2, 0, 0),
      boxP(w, fr, d, 0, h - fr, 0),
      boxP(w - 2 * fr, h - fr, d * 0.55, 0, 0, 0),
      axleZ(Math.min(w, h) * 0.08, d, w * 0.3, h * 0.45, 0, S_LOW)
    ]);
  }

  /** jendela: kusen empat sisi + palang silang + kaca tipis */
  function windowPanelGeo(w, h, d) {
    var fr = Math.min(w, h) * 0.09;
    return mergeGeos([
      boxP(fr, h, d, -(w - fr) / 2, 0, 0),
      boxP(fr, h, d, (w - fr) / 2, 0, 0),
      boxP(w, fr, d, 0, 0, 0),
      boxP(w, fr, d, 0, h - fr, 0),
      boxP(fr * 0.6, h - 2 * fr, d * 0.8, 0, fr, 0),
      boxP(w - 2 * fr, fr * 0.6, d * 0.8, 0, (h - fr * 0.6) / 2, 0),
      boxP(w - 2 * fr, h - 2 * fr, d * 0.18, 0, fr, 0)
    ]);
  }

  /* --- furniture ------------------------------------------------------ */

  function tableGeo(w, h, d) {
    var topH = h * 0.09, ls = Math.min(w, d) * 0.09;
    return mergeGeos([boxP(w, topH, d, 0, h - topH, 0)]
      .concat(legs(ls, h - topH, w * 0.92, d * 0.88)));
  }

  function roundTableGeo(w, h, d) {
    var topH = h * 0.08, footH = h * 0.05;
    return oval(mergeGeos([
      cylP(w, topH, 0, h - topH, 0, S_FINE),
      cylP(w * 0.16, h - topH - footH, 0, footH, 0, S_MID),
      frustP(w * 0.36, w * 0.5, footH, 0, 0, 0, S_MID)
    ]), w, d);
  }

  function chairGeo(w, h, d) {
    var seatY = h * 0.48, seatH = h * 0.07, ls = Math.min(w, d) * 0.13;
    return mergeGeos([
      boxP(w, seatH, d, 0, seatY, 0),
      boxP(w, h - seatY - seatH, d * 0.13, 0, seatY + seatH, -(d / 2 - d * 0.065))
    ].concat(legs(ls, seatY, w * 0.9, d * 0.9)));
  }

  function bedGeo(w, h, d) {
    var baseH = h * 0.34, matH = h * 0.4, hb = d * 0.06;
    return mergeGeos([
      boxP(w, baseH, d, 0, 0, 0),
      boxP(w * 0.97, matH, d - hb, 0, baseH, hb / 2),
      boxP(w, h, hb, 0, 0, -(d - hb) / 2),                                   // sandaran kepala
      boxP(w * 0.4, h * 0.11, d * 0.11, -w * 0.24, baseH + matH, -d * 0.34),
      boxP(w * 0.4, h * 0.11, d * 0.11, w * 0.24, baseH + matH, -d * 0.34)
    ]);
  }

  function wardrobeGeo(w, h, d) {
    var plint = h * 0.05, capH = h * 0.03;
    var bodyH = h - plint - capH;
    var hd = Math.min(w * 0.035, d * 0.05) / 2;   // jari-jari gagang
    return mergeGeos([
      boxP(w * 0.94, plint, d * 0.9, 0, 0, 0),
      boxP(w, bodyH, d, 0, plint, 0),
      boxP(w * 0.46, bodyH * 0.9, d * 0.05, -w * 0.24, plint + bodyH * 0.05, d * 0.47),
      boxP(w * 0.46, bodyH * 0.9, d * 0.05, w * 0.24, plint + bodyH * 0.05, d * 0.47),
      cylP(hd * 2, bodyH * 0.22, -w * 0.03, plint + bodyH * 0.42, d * 0.5 - hd, S_LOW),
      cylP(hd * 2, bodyH * 0.22, w * 0.03, plint + bodyH * 0.42, d * 0.5 - hd, S_LOW),
      boxP(w, capH, d, 0, h - capH, 0)
    ]);
  }

  function sofaGeo(w, h, d) {
    var arm = w * 0.12, backD = d * 0.2, seatH = h * 0.42;
    return mergeGeos([
      boxP(w, seatH * 0.55, d, 0, 0, 0),                                      // alas
      boxP(w - 2 * arm, seatH * 0.5, d - backD, 0, seatH * 0.5, backD / 2),   // bantalan duduk
      boxP(w, h, backD, 0, 0, -(d - backD) / 2),                              // sandaran
      boxP(arm, h * 0.62, d, -(w - arm) / 2, 0, 0),
      boxP(arm, h * 0.62, d, (w - arm) / 2, 0, 0)
    ]);
  }

  /** mobil: bodi + kabin + 4 roda (lebar = X, panjang = Z) */
  function carGeo(w, h, d) {
    var wd = Math.min(h * 0.44, d * 0.2);
    var bodyY = wd * 0.42, bodyH = h * 0.4;
    var cabH = h - bodyY - bodyH;
    var tw = w * 0.13;
    return mergeGeos([
      boxP(w * 0.98, bodyH, d, 0, bodyY, 0),
      boxP(w * 0.84, cabH, d * 0.46, 0, bodyY + bodyH, -d * 0.04),
      axleX(wd, tw, -(w / 2 - tw / 2), wd / 2, -d * 0.31, S_MID),
      axleX(wd, tw, (w / 2 - tw / 2), wd / 2, -d * 0.31, S_MID),
      axleX(wd, tw, -(w / 2 - tw / 2), wd / 2, d * 0.31, S_MID),
      axleX(wd, tw, (w / 2 - tw / 2), wd / 2, d * 0.31, S_MID)
    ]);
  }

  /* ------------------------------------------------------------------ */
  /* builder yang perlu ukuran nyata (bukan unit)                        */
  /* ------------------------------------------------------------------ */
  var REAL = {
    hip: hipRoof,
    tree: treeGeo,
    hopper: hopperGeo,
    tank: tankGeo,
    rotary: rotaryGeo,
    conveyor: conveyorGeo,
    machine: machineGeo,
    panelBox: panelGeo,
    doorPanel: doorPanelGeo,
    windowPanel: windowPanelGeo,
    table: tableGeo,
    roundTable: roundTableGeo,
    chair: chairGeo,
    bed: bedGeo,
    wardrobe: wardrobeGeo,
    sofa: sofaGeo,
    car: carGeo
  };

  /* ------------------------------------------------------------------ */
  /* API                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Bangun geometri untuk satu shape.
   * @param shape record dari Project
   * @param unit  satuan project
   * @returns THREE.BufferGeometry dalam METER, alas di y=0, terpusat di (0,0)
   */
  function build(shape, unit, openings) {
    var w = Math.max(1e-5, Units.toM(shape.width, unit));
    var d = Math.max(1e-5, Units.toM(shape.depth, unit));
    var h = Math.max(1e-5, Units.toM(shape.height, unit));
    var def = Shapes.def(shape.type);
    var geo = def.geo;

    // dispatch berdasarkan flag `host`, bukan nama geo — supaya beberapa tipe
    // bisa berbagi geo yang sama ('box') tanpa ikut kena pelubangan hanya
    // gara-gara namanya kebetulan sama (mis. column-sq, slab tetap box biasa)
    if (def.host) return hostWallGeo(shape, unit, openings);

    if (REAL[geo]) return REAL[geo](w, h, d);

    switch (geo) {
      case 'poly':
        return polyExtrude(shape.points || [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], w, h, d);

      case 'stairs': {
        var n = Math.min(24, Math.max(3, Math.round(h / 0.18)));
        return place(BUILDERS.stairsUnit(n), w, h, d);
      }

      default: {
        var fn = BUILDERS[geo] || BUILDERS.box;
        return place(fn(), w, h, d);
      }
    }
  }


  /* ------------------------------------------------------------------ */
  /* alas cetak (base plate)                                            */
  /*                                                                    */
  /* Miniatur hasil cetak 3D butuh pijakan: tanpa alas, tiap bangunan   */
  /* jadi potongan lepas yang harus ditempel sendiri, dan bagian tipis  */
  /* (pohon, tiang, cerobong) gampang lepas dari meja printer.          */
  /*                                                                    */
  /* Dibangun dalam METER dunia, dengan permukaan atas tepat di y = 0   */
  /* supaya model yang sudah ada tinggal duduk di atasnya tanpa digeser.*/
  /* ------------------------------------------------------------------ */
  function basePlate(pointsM, thicknessM) {
    if (!pointsM || pointsM.length < 3) return null;
    var t = Math.max(1e-4, thicknessM);

    var shape = new THREE.Shape();
    // konvensi sama dengan polyExtrude: (x, y2d) -> Shape(x, -y2d),
    // supaya setelah rotateX(-90°) sumbu y2d jatuh tepat ke sumbu z dunia
    shape.moveTo(pointsM[0][0], -pointsM[0][1]);
    for (var i = 1; i < pointsM.length; i++) shape.lineTo(pointsM[i][0], -pointsM[i][1]);
    shape.closePath();

    var g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 6 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -t, 0);        // permukaan atas di y = 0
    return g;
  }

  /**
   * Perbesar poligon ke luar sejauh `marginM` — offset sisi yang sebenarnya.
   *
   * Tiap sisi digeser sejauh margin searah normal luarnya, lalu titik sudut
   * baru = perpotongan dua garis sisi yang sudah digeser. Dengan begitu jarak
   * tegak lurus dari tiap sisi lama ke sisi barunya tepat `marginM` — berapa
   * pun bentuknya.
   *
   * Cara yang lebih murah (menskala semua titik menjauhi titik berat) meleset
   * jauh: pada tanah 80 × 60 m, margin 3 mm cetak jadi 2,4 mm di satu sumbu
   * dan 1,8 mm di sumbu lain. Untuk alas cetak yang salahnya baru ketahuan
   * setelah berjam-jam nge-print, itu tidak sepadan dengan hematnya.
   *
   * Sudut dalam yang dalam dan sempit bisa membuat hasil offset memotong
   * dirinya sendiri. Kasus itu dideteksi, dan poligon aslinya dikembalikan apa
   * adanya — alas yang pas-pasan jauh lebih baik daripada alas yang simpul.
   */
  function growPolygon(pointsM, marginM) {
    var n = pointsM.length;
    if (!marginM || n < 3) return pointsM;

    // arah putaran menentukan mana sisi luar
    var luas2 = 0, i;
    for (i = 0; i < n; i++) {
      var a = pointsM[i], b = pointsM[(i + 1) % n];
      luas2 += a[0] * b[1] - b[0] * a[1];
    }
    var arah = luas2 >= 0 ? 1 : -1;

    // garis tiap sisi setelah digeser keluar: titik awal + arah
    var garis = [];
    for (i = 0; i < n; i++) {
      var p = pointsM[i], q = pointsM[(i + 1) % n];
      var dx = q[0] - p[0], dy = q[1] - p[1];
      var len = Math.hypot(dx, dy);
      if (len < 1e-12) return pointsM;            // titik kembar: jangan diutak-atik
      var nx = (dy / len) * arah, ny = (-dx / len) * arah;
      garis.push({
        x: p[0] + nx * marginM, y: p[1] + ny * marginM,
        dx: dx / len, dy: dy / len
      });
    }

    var out = [];
    for (i = 0; i < n; i++) {
      var g1 = garis[(i - 1 + n) % n], g2 = garis[i];
      var det = g1.dx * (-g2.dy) - g1.dy * (-g2.dx);
      if (Math.abs(det) < 1e-9) {
        // dua sisi hampir sejajar: pakai ujung sisi yang sudah digeser
        out.push([g2.x, g2.y]);
        continue;
      }
      var rx = g2.x - g1.x, ry = g2.y - g1.y;
      var t = (rx * (-g2.dy) - ry * (-g2.dx)) / det;
      out.push([g1.x + g1.dx * t, g1.y + g1.dy * t]);
    }

    // hasil yang memotong dirinya sendiri lebih buruk daripada tanpa margin
    for (i = 0; i < n; i++) {
      for (var j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;      // sisi yang bersebelahan
        if (segmenBersilang(out[i], out[(i + 1) % n], out[j], out[(j + 1) % n])) {
          return pointsM;
        }
      }
    }
    return out;
  }

  function segmenBersilang(a, b, c, d) {
    var sisi = function (p, q, r) {
      return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    };
    var d1 = sisi(a, b, c), d2 = sisi(a, b, d);
    var d3 = sisi(c, d, a), d4 = sisi(c, d, b);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }


  global.Geometry3D = {
    basePlate: basePlate,
    growPolygon: growPolygon,
    build: build,
    mergeGeos: mergeGeos,
    fromTriangles: fromTriangles,
    prism: prism,
    hipRoof: hipRoof,
    roomShell: roomShell,
    hostWallGeo: hostWallGeo,
    wallWithOpenings: wallWithOpenings,
    PROFILES: PROFILES
  };
})(window);
