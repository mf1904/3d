/* layout3d — shape library (config-driven)
 *
 * Nambah shape baru = tambah satu entry di SHAPE_DEFS + daftarkan di LIBRARY.
 * Tidak ada komponen yang di-hardcode per shape; editor 2D & viewer 3D
 * membaca `foot` (bentuk denah) dan `geo` (builder 3D) dari sini.
 *
 * Semua ukuran default ditulis dalam METER, dikonversi saat shape dibuat.
 */
(function (global) {
  'use strict';

  var C = {
    wall:  '#b9c2cd',
    struct:'#8fa0b5',
    open:  '#63b3e8',
    room:  '#9fb3c8',
    build: '#c9b48d',
    roof:  '#d1685b',
    dome:  '#5aa9a0',
    furn:  '#8d7fb5'
  };

  /* --------------------------------------------------------------------- */
  /* definisi tipe shape                                                    */
  /* foot : 'rect' | 'ellipse' | 'poly'   -> bagaimana digambar di 2D       */
  /* geo  : nama builder di Geometry3D    -> bagaimana di-extrude di 3D     */
  /* --------------------------------------------------------------------- */
  var SHAPE_DEFS = {

    /* --- struktur --- */
    'wall':       { name:'Dinding',        foot:'rect',    geo:'wallHost', w:4,   d:0.2, h:3,   color:C.wall, host:true },
    'wall-corner':{ name:'Dinding Sudut',  foot:'poly',    geo:'poly',     w:4,   d:4,   h:3,   color:C.wall,
                    poly:function(){ var t=0.05; return [[-0.5,-0.5],[-0.5+t,-0.5],[-0.5+t,0.5-t],[0.5,0.5-t],[0.5,0.5],[-0.5,0.5]]; } },
    'column':     { name:'Kolom',          foot:'ellipse', geo:'cylinder', w:0.4, d:0.4, h:3,   color:C.struct },
    'column-sq':  { name:'Kolom Kotak',    foot:'rect',    geo:'box',      w:0.4, d:0.4, h:3,   color:C.struct },
    'door':       { name:'Pintu',          foot:'rect',    geo:'doorPanel',   w:0.9, d:0.14,h:2.1, color:C.open, decorative:true, opening:true },
    'window':     { name:'Jendela',        foot:'rect',    geo:'windowPanel', w:1.2, d:0.14,h:1.2, elev:1, color:C.open, decorative:true, opening:true },
    'stairs':     { name:'Tangga',         foot:'rect',    geo:'stairs',   w:1,   d:3,   h:3,   color:C.struct },

    /* --- bangunan / massa dasar --- */
    'room':       { name:'Ruangan',        foot:'rect',    geo:'roomShell',w:6,   d:5,   h:3,   color:C.room, thickness:0.15, host:true },
    'box':        { name:'Massa Box',      foot:'rect',    geo:'box',      w:8,   d:6,   h:3,   color:C.build,
                    host:true, shallowHost:true },
    'cylinder':   { name:'Silinder',       foot:'ellipse', geo:'cylinder', w:4,   d:4,   h:6,   color:C.build },
    'polygon':    { name:'Poligon',        foot:'poly',    geo:'poly',     w:6,   d:6,   h:3,   color:C.build,
                    poly:function(){ var p=[],n=5,i,a; for(i=0;i<n;i++){ a=-Math.PI/2 + i*2*Math.PI/n; p.push([Math.cos(a)*0.5, Math.sin(a)*0.5]); } return p; } },
    'slab':       { name:'Lantai / Alas',  foot:'rect',    geo:'box',      w:12,  d:12,  h:0.2, color:'#7d8894' },
    // Bidang tanah: layer referensi, bukan massa bangunan. Datar (tebal 5 cm
    // sekadar supaya mesh-nya tetap tertutup), default TIDAK ikut export STL,
    // dan otomatis ditaruh paling belakang supaya tidak menutupi denah.
    'land':       { name:'Bidang Tanah',   foot:'poly',    geo:'poly',     w:20,  d:15,  h:0.05, color:'#6f8f5a',
                    land:true, noExportDefault:true,
                    poly:function(){ return [[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]]; } },

    /* --- atap & kubah (dipasang di atas massa) --- */
    'roof-gable':   { name:'Atap Pelana',   foot:'rect', geo:'prismGable', w:8, d:6, h:2,   color:C.roof, roof:true },
    'roof-hip':     { name:'Atap Limas',    foot:'rect', geo:'hip',        w:8, d:6, h:2,   color:C.roof, roof:true },
    'roof-halfcyl': { name:'Atap Lengkung', foot:'rect', geo:'prismArc',   w:12,d:8, h:3,   color:C.roof, roof:true },
    'roof-shed':    { name:'Atap Miring',   foot:'rect', geo:'prismShed',  w:6, d:4, h:1.2, color:C.roof, roof:true },
    'roof-pyramid': { name:'Atap Piramida', foot:'rect', geo:'pyramid',    w:6, d:6, h:3,   color:C.roof, roof:true },
    'dome':         { name:'Kubah',         foot:'ellipse', geo:'dome',    w:6, d:6, h:3.5, color:C.dome, roof:true },
    'cone':         { name:'Kerucut',       foot:'ellipse', geo:'cone',    w:2, d:2, h:3,   color:C.dome, roof:true },
    'sphere':       { name:'Bola',          foot:'ellipse', geo:'sphere',  w:1, d:1, h:1,   color:C.dome, roof:true },

    /* --- mesin & peralatan pabrik --- */
    'm-machine':  { name:'Mesin',       foot:'rect',    geo:'machine',  w:3,   d:2,   h:2.4, color:'#6d8a9c' },
    'm-rotary':   { name:'Rotary',      foot:'ellipse', geo:'rotary',   w:2.4, d:2.4, h:14,  color:'#7f8b98',
                    tiltX:90, elev:1.2 },
    'm-conveyor': { name:'Konveyor',    foot:'rect',    geo:'conveyor', w:8,   d:0.8, h:1.2, color:'#5f7383' },
    'm-tank':     { name:'Tangki',      foot:'ellipse', geo:'tank',     w:3,   d:3,   h:4.5, color:'#6f8f95' },
    'm-hopper':   { name:'Hopper',      foot:'ellipse', geo:'hopper',   w:2.4, d:2.4, h:3.5, color:'#7a8794' },
    'm-panel':    { name:'Panel',       foot:'rect',    geo:'panelBox', w:1.2, d:0.6, h:2,   color:'#59707f' },

    /* --- furniture --- */
    'f-table':    { name:'Meja',       foot:'rect',    geo:'table',      w:1.6, d:0.8, h:0.75, color:C.furn },
    'f-chair':    { name:'Kursi',      foot:'rect',    geo:'chair',      w:0.5, d:0.5, h:0.9,  color:C.furn },
    'f-bed':      { name:'Kasur',      foot:'rect',    geo:'bed',        w:1.6, d:2,   h:1.0,  color:C.furn },
    'f-wardrobe': { name:'Lemari',     foot:'rect',    geo:'wardrobe',   w:1.8, d:0.6, h:2.1,  color:C.furn },
    'f-sofa':     { name:'Sofa',       foot:'rect',    geo:'sofa',       w:2,   d:0.9, h:0.8,  color:C.furn },
    'f-round':    { name:'Meja Bulat', foot:'ellipse', geo:'roundTable', w:1.2, d:1.2, h:0.75, color:C.furn },
    'f-car':      { name:'Mobil',      foot:'rect',    geo:'car',        w:1.8, d:4.5, h:1.5,  color:'#6f7d8c' },
    'f-tree':     { name:'Pohon',      foot:'ellipse', geo:'tree',       w:2.5, d:2.5, h:4,    color:'#4f8f57' }
  };

  /* --------------------------------------------------------------------- */
  /* ikon SVG (viewBox 0 0 26 18)                                          */
  /* --------------------------------------------------------------------- */
  var ICONS = {
    'wall':        '<rect x="2" y="7" width="22" height="4"/>',
    'wall-corner': '<path d="M3 3h4v8h16v4H3z"/>',
    'column':      '<circle cx="13" cy="9" r="4"/>',
    'column-sq':   '<rect x="9" y="5" width="8" height="8"/>',
    'door':        '<path d="M4 3h12v12H4z" fill="none" stroke-width="1.6"/><path d="M16 15A12 12 0 0 0 4 3" fill="none" stroke-width="1.2"/>',
    'window':      '<rect x="3" y="6" width="20" height="6" fill="none" stroke-width="1.6"/><path d="M13 6v6" stroke-width="1.4"/>',
    'stairs':      '<path d="M3 15h5v-3h5V9h5V6h5" fill="none" stroke-width="1.6"/>',
    'room':        '<rect x="3" y="3" width="20" height="12" fill="none" stroke-width="2.4"/>',
    'box':         '<rect x="3" y="4" width="20" height="10"/>',
    'cylinder':    '<circle cx="13" cy="9" r="6"/>',
    'polygon':     '<path d="M13 2l10 7-4 8H7l-4-8z"/>',
    'land':        '<path d="M2 13L7 4l9 1 8 6-5 6H6z" fill="none" stroke-width="1.8" stroke-dasharray="3 2"/>',
    'slab':        '<rect x="2" y="5" width="22" height="8" opacity=".55"/>',
    'roof-gable':  '<path d="M2 15L13 4l11 11z"/>',
    'roof-hip':    '<path d="M2 15L8 4h10l6 11z"/>',
    'roof-halfcyl':'<path d="M2 15A11 11 0 0 1 24 15z"/>',
    'roof-shed':   '<path d="M2 15L24 5v10z"/>',
    'roof-pyramid':'<path d="M13 3l11 12H2z"/><path d="M13 3v12" stroke-width="1" opacity=".5"/>',
    'dome':        '<path d="M4 15A9 9 0 0 1 22 15z"/><rect x="2" y="15" width="22" height="2"/>',
    'cone':        '<path d="M13 2l7 13H6z"/>',
    'sphere':      '<circle cx="13" cy="9" r="6.5"/>',
    'f-table':     '<rect x="4" y="6" width="18" height="6" rx="1"/>',
    'f-chair':     '<rect x="8" y="5" width="10" height="9" rx="1.5"/>',
    'f-bed':       '<rect x="5" y="3" width="16" height="12" rx="1.5"/><rect x="5" y="3" width="16" height="4" opacity=".5"/>',
    'f-wardrobe':  '<rect x="4" y="5" width="18" height="8"/><path d="M13 5v8" stroke-width="1" opacity=".6"/>',
    'f-sofa':      '<path d="M3 8h20v6H3z"/><path d="M3 8V5h20v3"  fill="none" stroke-width="1.6"/>',
    'f-round':     '<circle cx="13" cy="9" r="5.5" fill="none" stroke-width="2"/>',
    'f-car':       '<rect x="6" y="2" width="14" height="14" rx="3"/>',
    'f-tree':      '<circle cx="13" cy="8" r="5"/><rect x="12" y="12" width="2" height="4"/>',
    'm-machine':   '<rect x="3" y="5" width="20" height="9" rx="1"/><rect x="7" y="2" width="5" height="3"/>',
    'm-rotary':    '<rect x="2" y="6" width="22" height="6" rx="3"/><path d="M8 6v6M14 6v6M20 6v6" stroke="#12161c" stroke-width="1.2"/>',
    'm-conveyor':  '<rect x="2" y="7" width="22" height="3"/><circle cx="4" cy="13" r="2"/><circle cx="22" cy="13" r="2"/>',
    'm-tank':      '<rect x="7" y="4" width="12" height="11" rx="2"/><path d="M7 7h12" stroke="#12161c" stroke-width="1"/>',
    'm-hopper':    '<path d="M3 2h20l-8 14h-4z"/>',
    'm-panel':     '<rect x="8" y="2" width="10" height="14" rx="1"/><circle cx="15" cy="9" r="1.2" fill="#12161c"/>',
    'p-rumah':     '<path d="M3 16V8l10-6 10 6v8z"/><path d="M10 16v-5h6v5z" fill="#12161c"/>',
    'p-gudang':    '<path d="M2 16V9a11 8 0 0 1 22 0v7z"/>',
    'p-masjid':    '<path d="M4 16V9h14v7z"/><path d="M5 9a6 6 0 0 1 12 0z" /><path d="M20 16V5h3v11z"/>',
    'p-silo':      '<path d="M6 16V7h10v9z"/><path d="M6 7a5 5 0 0 1 10 0z"/>',
    'p-ruko':      '<path d="M3 16V6h8v10z"/><path d="M13 16V3h9v13z"/>'
  };

  function icon(key) {
    return '<svg class="gl" viewBox="0 0 26 18" fill="currentColor" stroke="currentColor">' +
           (ICONS[key] || ICONS.box) + '</svg>';
  }

  /* --------------------------------------------------------------------- */
  /* susunan panel library                                                  */
  /* --------------------------------------------------------------------- */
  var LIBRARY = [
    { category: 'Struktur',      types: ['wall', 'wall-corner', 'column', 'column-sq', 'door', 'window', 'stairs'] },
    { category: 'Bangunan',      types: ['room', 'box', 'cylinder', 'polygon', 'slab'] },
    { category: 'Tanah',         types: ['land'] },
    { category: 'Atap & Kubah',  types: ['roof-gable', 'roof-hip', 'roof-halfcyl', 'roof-shed', 'roof-pyramid', 'dome', 'cone', 'sphere'] },
    { category: 'Mesin & Pabrik', types: ['m-machine', 'm-rotary', 'm-conveyor', 'm-tank', 'm-hopper', 'm-panel'] },
    { category: 'Furniture',     types: ['f-table', 'f-chair', 'f-bed', 'f-wardrobe', 'f-sofa', 'f-round', 'f-car', 'f-tree'] }
  ];

  /* --------------------------------------------------------------------- */
  /* preset miniatur: kombinasi badan + atap                                */
  /* dimensi dalam METER; x/y relatif terhadap titik sisip                  */
  /* --------------------------------------------------------------------- */
  var PRESETS = [
    {
      id: 'p-rumah', name: 'Rumah', hint: 'box + atap pelana',
      parts: [
        { type: 'box',        label: 'Badan Rumah', x: 0, y: 0, w: 8,   d: 6,   h: 3,   elev: 0 },
        { type: 'roof-gable', label: 'Atap',        x: 0, y: 0, w: 8.8, d: 6.8, h: 2.2, elev: 3 }
      ]
    },
    {
      id: 'p-gudang', name: 'Gudang', hint: 'box + atap lengkung',
      parts: [
        { type: 'box',          label: 'Badan Gudang', x: 0, y: 0, w: 20,   d: 10,   h: 5, elev: 0 },
        { type: 'roof-halfcyl', label: 'Atap Quonset', x: 0, y: 0, w: 20.4, d: 10.4, h: 4, elev: 5 }
      ]
    },
    {
      id: 'p-masjid', name: 'Masjid', hint: 'box + kubah + menara',
      parts: [
        { type: 'box',      label: 'Ruang Utama', x: 0,  y: 0,  w: 12,  d: 12,  h: 5,   elev: 0 },
        { type: 'dome',     label: 'Kubah',       x: 0,  y: 0,  w: 7,   d: 7,   h: 3.6, elev: 5 },
        { type: 'cone',     label: 'Mustaka',     x: 0,  y: 0,  w: 0.7, d: 0.7, h: 1.4, elev: 8.6 },
        { type: 'cylinder', label: 'Menara',      x: 7.5,y: 5,  w: 2,   d: 2,   h: 14,  elev: 0 },
        { type: 'dome',     label: 'Kubah Menara',x: 7.5,y: 5,  w: 2.2, d: 2.2, h: 1.2, elev: 14 },
        { type: 'cone',     label: 'Puncak',      x: 7.5,y: 5,  w: 0.4, d: 0.4, h: 1,   elev: 15.2 }
      ]
    },
    {
      id: 'p-silo', name: 'Silo / Tandon', hint: 'silinder + kubah',
      parts: [
        { type: 'cylinder', label: 'Silo',  x: 0, y: 0, w: 4,   d: 4,   h: 9,   elev: 0 },
        { type: 'dome',     label: 'Tutup', x: 0, y: 0, w: 4.1, d: 4.1, h: 1.4, elev: 9 }
      ]
    },
    {
      id: 'p-ruko', name: 'Ruko 2 Lantai', hint: 'box + atap miring',
      parts: [
        { type: 'box',       label: 'Lantai 1', x: 0, y: 0, w: 6,   d: 12,   h: 3.5, elev: 0 },
        { type: 'box',       label: 'Lantai 2', x: 0, y: 0, w: 6,   d: 12,   h: 3.2, elev: 3.5 },
        { type: 'roof-shed', label: 'Atap',     x: 0, y: 0, w: 6.4, d: 12.4, h: 1,   elev: 6.7 }
      ]
    }
  ];

  /* --------------------------------------------------------------------- */

  var Shapes = {
    DEFS: SHAPE_DEFS,
    LIBRARY: LIBRARY,
    PRESETS: PRESETS,
    icon: icon,

    def: function (type) { return SHAPE_DEFS[type] || SHAPE_DEFS.box; },
    name: function (type) { return Shapes.def(type).name; },
    foot: function (type) { return Shapes.def(type).foot; },
    isRoof: function (type) { return !!Shapes.def(type).roof; },

    isTilted: function (s) {
      return Math.abs(s.tiltX || 0) > 1e-6 || Math.abs(s.tiltZ || 0) > 1e-6;
    },

    isVisible: function (s) { return !s.meta || s.meta.visible !== false; },

    isLand: function (type) { return !!Shapes.def(type).land; },

    /** pintu/jendela — bisa melubangi dinding yang ditempelinya */
    isOpening: function (type) { return !!Shapes.def(type).opening; },

    /** dinding/ruangan — bisa dilubangi */
    isHost: function (type) { return !!Shapes.def(type).host; },

    /** bukaan yang sedang aktif melubangi (tidak disembunyikan & tidak dimatikan) */
    activeOpenings: function (shapes) {
      return shapes.filter(function (s) {
        return Shapes.isOpening(s.type) && Shapes.isVisible(s) &&
               !(s.meta && s.meta.cut === false) && !Shapes.isTilted(s);
      });
    },

    /**
     * Uraikan sebuah host jadi segmen-segmen dinding lurus, dalam koordinat
     * LOKAL host (satuan project). Dipakai bersama oleh builder 3D dan
     * penghitung lubang, supaya keduanya tidak pernah beda tafsir.
     *
     * axis 'x' = dinding memanjang searah X lokal, 'z' = searah Z lokal.
     */
    wallSegments: function (s) {
      if (Shapes.def(s.type).geo === 'roomShell') {
        var t = Math.min(
          (s.meta && s.meta.thickness) || s.depth * 0.03,
          Math.min(s.width, s.depth) / 2.5
        );
        var inner = Math.max(1e-4, s.depth - 2 * t);
        return [
          { axis: 'x', cx: 0, cz: -s.depth / 2 + t / 2, len: s.width, thick: t },
          { axis: 'x', cx: 0, cz:  s.depth / 2 - t / 2, len: s.width, thick: t },
          { axis: 'z', cx: -s.width / 2 + t / 2, cz: 0, len: inner, thick: t },
          { axis: 'z', cx:  s.width / 2 - t / 2, cz: 0, len: inner, thick: t }
        ];
      }
      return [{ axis: 'x', cx: 0, cz: 0, len: s.width, thick: s.depth }];
    },

    /**
     * Segmen dinding host + daftar lubang pada masing-masing segmen.
     * Lubang dinyatakan dalam koordinat segmen: u sepanjang dinding (0 di
     * tengah), y dari alas host. Semua dalam satuan project.
     */
    wallCuts: function (host, openings) {
      var segs = Shapes.wallSegments(host), i;
      for (i = 0; i < segs.length; i++) segs[i].holes = [];
      if (!openings || !openings.length || Shapes.isTilted(host)) return segs;

      var a = (host.rotation || 0) * Math.PI / 180;
      var ca = Math.cos(a), sa = Math.sin(a);

      for (var k = 0; k < openings.length; k++) {
        var o = openings[k];
        if (o.id === host.id) continue;

        // posisi bukaan di frame lokal host
        var dx = o.x - host.x, dy = o.y - host.y;
        var u = dx * ca + dy * sa;      // sepanjang X lokal
        var v = -dx * sa + dy * ca;     // sepanjang Z lokal

        // ukuran bukaan diproyeksikan ke sumbu lokal host
        var rel = ((o.rotation || 0) - (host.rotation || 0)) * Math.PI / 180;
        var rc = Math.abs(Math.cos(rel)), rs = Math.abs(Math.sin(rel));
        var ex = o.width / 2 * rc + o.depth / 2 * rs;
        var ez = o.width / 2 * rs + o.depth / 2 * rc;

        var y0 = (o.elevation || 0) - (host.elevation || 0);
        var y1 = y0 + o.height;
        if (y1 <= 0 || y0 >= host.height) continue;   // di luar tinggi dinding

        for (i = 0; i < segs.length; i++) {
          var g = segs[i];
          var isX = g.axis === 'x';
          var along      = isX ? u  : v;
          var across     = isX ? v  : u;
          var alongHalf  = isX ? ex : ez;
          var acrossHalf = isX ? ez : ex;
          var cAlong     = isX ? g.cx : g.cz;
          var cAcross    = isX ? g.cz : g.cx;

          // harus benar-benar menembus pita tebal dinding…
          if (Math.abs(across - cAcross) >= g.thick / 2 + acrossHalf) continue;
          // …dan berada di dalam panjang dinding
          var a0 = along - alongHalf - cAlong;
          var a1 = along + alongHalf - cAlong;
          if (a1 <= -g.len / 2 || a0 >= g.len / 2) continue;

          // acrossOffset = seberapa jauh bukaan ini dari garis tengah segmen,
          // ke arah tebal dinding. depth = seberapa dalam bukaan menembus arah
          // itu (acrossHalf sudah menghitung rotasi relatif bukaan-terhadap-host,
          // jadi benar walau bukaan diputar terhadap dindingnya).
          // Dipakai host tebal (mis. Massa Box) untuk menaruh ceruk persis di
          // posisi bukaan, bukan di tengah massa yang jadi terowongan buta.
          g.holes.push({ u0: a0, u1: a1, y0: y0, y1: y1,
                         depth: acrossHalf * 2, acrossOffset: across - cAcross });
        }
      }
      return segs;
    },

    /**
     * Kotak pembatas objek dalam frame SEBELUM yaw, setelah kemiringan
     * tiltX/tiltZ diterapkan. Dipakai bersama oleh denah 2D, bounding box,
     * dan tombol "dudukkan ke lantai".
     *
     * Rotasi total = Ryaw · Rx(tiltX) · Rz(tiltZ)  (Euler 'YXZ' di Three.js),
     * jadi bagian tilt bisa dihitung terpisah dari yaw — itu yang bikin
     * denah 2D tetap bisa digambar sebagai persegi ber-yaw, bukan AABB kasar.
     *
     * @returns {{ex,ey,ez, cx,cy,cz}} setengah-ukuran & titik pusat relatif
     *          terhadap titik jangkar (tengah alas objek sebelum dimiringkan)
     */
    planExtents: function (s) {
      var hx = s.width / 2, hy = s.height / 2, hz = s.depth / 2;
      var ax = (s.tiltX || 0) * Math.PI / 180;
      var az = (s.tiltZ || 0) * Math.PI / 180;
      var cxa = Math.cos(ax), sxa = Math.sin(ax);
      var cza = Math.cos(az), sza = Math.sin(az);

      // baris matriks R = Rx(ax) · Rz(az)
      // r0 = [ cza,      -sza,      0   ]
      // r1 = [ cxa·sza,   cxa·cza, -sxa ]
      // r2 = [ sxa·sza,   sxa·cza,  cxa ]
      return {
        ex: Math.abs(cza) * hx + Math.abs(sza) * hy,
        ey: Math.abs(cxa * sza) * hx + Math.abs(cxa * cza) * hy + Math.abs(sxa) * hz,
        ez: Math.abs(sxa * sza) * hx + Math.abs(sxa * cza) * hy + Math.abs(cxa) * hz,
        cx: -sza * hy,
        cy: cxa * cza * hy,
        cz: sxa * cza * hy
      };
    },

    /* ------------------------------------------------------------------ */
    /* rotasi rigid untuk GRUP (dipakai tombol "Tidurkan" saat >1 objek     */
    /* terpilih) — matriks 3×3 murni tanpa dependensi Three.js, supaya     */
    /* logika ini tetap bisa diuji lepas dari renderer.                    */
    /*                                                                     */
    /* Konvensi vektor dunia: [x, elevation, y] — sama seperti pemetaan    */
    /* di viewer3d.js (denah y2D -> three.z, elevation -> three.y).        */
    /* ------------------------------------------------------------------ */
    mat3RotX: function (deg) {
      var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      return [[1, 0, 0], [0, c, -s], [0, s, c]];
    },
    mat3RotY: function (deg) {
      var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
    },
    mat3RotZ: function (deg) {
      var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
    },
    mat3Mul: function (A, B) {
      var M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], i, j, k;
      for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) {
        var v = 0;
        for (k = 0; k < 3; k++) v += A[i][k] * B[k][j];
        M[i][j] = v;
      }
      return M;
    },
    /** transpose = invers untuk matriks rotasi murni (ortonormal) */
    mat3Transpose: function (M) {
      return [
        [M[0][0], M[1][0], M[2][0]],
        [M[0][1], M[1][1], M[2][1]],
        [M[0][2], M[1][2], M[2][2]]
      ];
    },
    mat3ApplyVec: function (M, v) {
      return [
        M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
        M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
        M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]
      ];
    },

    /** yaw/tiltX/tiltZ (derajat) -> matriks rotasi dunia R = Ry(-yaw)·Rx(tiltX)·Rz(tiltZ) */
    composeRotation: function (yawDeg, tiltXDeg, tiltZDeg) {
      return Shapes.mat3Mul(
        Shapes.mat3Mul(Shapes.mat3RotY(-yawDeg), Shapes.mat3RotX(tiltXDeg)),
        Shapes.mat3RotZ(tiltZDeg)
      );
    },

    /**
     * Kebalikan composeRotation: matriks -> {yaw,tiltX,tiltZ} derajat.
     * Rumus sama persis dengan dekomposisi Euler order 'YXZ' Three.js,
     * ditulis manual di sini supaya shapes.js tidak perlu memuat Three.js.
     */
    decomposeRotation: function (M) {
      var R2D = 180 / Math.PI;
      var m13 = M[0][2], m23 = M[1][2], m33 = M[2][2];
      var m21 = M[1][0], m22 = M[1][1], m11 = M[0][0], m31 = M[2][0];
      var x = Math.asin(Math.max(-1, Math.min(1, -m23)));
      var y, z;
      if (Math.abs(m23) < 0.9999999) {
        y = Math.atan2(m13, m33);
        z = Math.atan2(m21, m22);
      } else {
        y = Math.atan2(-m31, m11);
        z = 0;
      }
      return { tiltX: x * R2D, yaw: -y * R2D, tiltZ: z * R2D };
    },

    /**
     * Terapkan rotasi rigid tambahan (deltaMat, matriks dunia) ke satu shape,
     * berputar terhadap `pivot` {x,y,elevation} (satuan project). Posisi DAN
     * orientasinya ikut berubah bersama — tipping sekumpulan objek yang
     * digrup akan menjaga susunan relatif antar bagiannya, bukan cuma
     * memutar tiap bagian di tempat.
     * @returns {x,y,elevation,rotation,tiltX,tiltZ} nilai baru (belum dibulatkan)
     */
    applyRigidDelta: function (shape, deltaMat, pivot) {
      var rel = [shape.x - pivot.x, (shape.elevation || 0) - pivot.elevation, shape.y - pivot.y];
      var relNew = Shapes.mat3ApplyVec(deltaMat, rel);
      var oldRot = Shapes.composeRotation(shape.rotation || 0, shape.tiltX || 0, shape.tiltZ || 0);
      var newRot = Shapes.mat3Mul(deltaMat, oldRot);
      var d = Shapes.decomposeRotation(newRot);
      return {
        x: pivot.x + relNew[0],
        elevation: pivot.elevation + relNew[1],
        y: pivot.y + relNew[2],
        rotation: d.yaw,
        tiltX: d.tiltX,
        tiltZ: d.tiltZ
      };
    },

    /** posisi pusat proyeksi denah (setelah yaw) relatif titik jangkar shape */
    planOffset: function (s) {
      var e = Shapes.planExtents(s);
      if (Math.abs(e.cx) < 1e-9 && Math.abs(e.cz) < 1e-9) return { x: 0, y: 0 };
      var t = (s.rotation || 0) * Math.PI / 180;
      var c = Math.cos(t), n = Math.sin(t);
      return { x: e.cx * c - e.cz * n, y: e.cx * n + e.cz * c };
    },

    /** daftar semua tipe (untuk validasi saat import) */
    isKnown: function (type) { return Object.prototype.hasOwnProperty.call(SHAPE_DEFS, type); },

    /**
     * Buat record shape baru.
     * @param type  tipe dari SHAPE_DEFS
     * @param unit  satuan project ('m'|'cm'|'mm')
     * @param over  override (nilai sudah dalam satuan project)
     */
    create: function (type, unit, over) {
      var d = Shapes.def(type);
      var k = Units.factor('m', unit); // meter -> satuan project
      var s = {
        id: Shapes.uid(),
        type: type,
        x: 0,
        y: 0,
        width:  Units.round(d.w * k, unit),
        depth:  Units.round(d.d * k, unit),
        rotation: 0,          // yaw: putar di denah (sumbu Y dunia)
        tiltX: d.tiltX || 0,  // miring depan-belakang (sumbu X dunia)
        tiltZ: d.tiltZ || 0,  // miring kiri-kanan     (sumbu Z dunia)
        height: Units.round(d.h * k, unit),
        elevation: Units.round((d.elev || 0) * k, unit),
        meta: {
          label: d.name,
          color: d.color,
          solid: !d.noExportDefault,
          locked: false,
          visible: true
        }
      };
      if (d.thickness) s.meta.thickness = Units.round(d.thickness * k, unit);
      if (d.opening) s.meta.cut = true;
      if (d.foot === 'poly') s.points = d.poly ? d.poly() : [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
      if (over) Shapes.assign(s, over);
      return s;
    },

    /** merge dangkal + merge meta */
    assign: function (shape, over) {
      for (var k in over) {
        if (!Object.prototype.hasOwnProperty.call(over, k)) continue;
        if (k === 'meta') {
          for (var m in over.meta) shape.meta[m] = over.meta[m];
        } else {
          shape[k] = over[k];
        }
      }
      return shape;
    },

    /** instansiasi preset -> array shape, posisinya digeser ke (cx,cy) */
    createPreset: function (presetId, unit, cx, cy) {
      var p = null, i;
      for (i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === presetId) p = PRESETS[i];
      if (!p) return [];
      var k = Units.factor('m', unit);
      var group = Shapes.uid();
      var out = [];
      for (i = 0; i < p.parts.length; i++) {
        var q = p.parts[i];
        out.push(Shapes.create(q.type, unit, {
          x: Units.round(cx + q.x * k, unit),
          y: Units.round(cy + q.y * k, unit),
          width:  Units.round(q.w * k, unit),
          depth:  Units.round(q.d * k, unit),
          height: Units.round(q.h * k, unit),
          elevation: Units.round(q.elev * k, unit),
          meta: { label: q.label, group: group }
        }));
      }
      return out;
    },

    /* ------------------------------------------------------------------ */
    /* poligon bebas                                                      */
    /* ------------------------------------------------------------------ */

    /** luas bertanda (positif = CCW di koordinat denah) */
    signedArea: function (pts) {
      var a = 0;
      for (var i = 0; i < pts.length; i++) {
        var j = (i + 1) % pts.length;
        a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
      }
      return a / 2;
    },

    /**
     * Apakah ada sisi yang saling menyilang? Poligon yang menyilang tidak bisa
     * di-ekstrusi jadi mesh tertutup, jadi user perlu diperingatkan.
     */
    selfIntersects: function (pts) {
      var n = pts.length;
      function cross(o, a, b) {
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      }
      function hits(p1, p2, p3, p4) {
        var d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
        var d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
        return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
      }
      for (var i = 0; i < n; i++) {
        for (var j = i + 1; j < n; j++) {
          // lewati sisi yang bertetangga (selalu berbagi titik)
          if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
          if (hits(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
        }
      }
      return false;
    },

    /**
     * Titik-titik denah (satuan project, koordinat dunia) -> record shape
     * poligon. `points` disimpan ternormalisasi −0.5..0.5 terhadap kotak
     * pembatasnya, jadi poligon tetap ikut ter-resize seperti shape lain.
     * @returns record shape, atau null kalau terlalu tipis / tanpa luas
     */
    polygonFromPoints: function (pts, unit, over) {
      if (!pts || pts.length < 3) return null;
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, i;
      for (i = 0; i < pts.length; i++) {
        minX = Math.min(minX, pts[i][0]); maxX = Math.max(maxX, pts[i][0]);
        minY = Math.min(minY, pts[i][1]); maxY = Math.max(maxY, pts[i][1]);
      }
      var w = maxX - minX, d = maxY - minY;
      if (!(w > 1e-9) || !(d > 1e-9)) return null;
      if (Math.abs(Shapes.signedArea(pts)) < w * d * 1e-6) return null;

      var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      var s = Shapes.create('polygon', unit, over);
      s.x = Units.round(cx, unit);
      s.y = Units.round(cy, unit);
      s.width = Units.round(w, unit);
      s.depth = Units.round(d, unit);
      s.points = pts.map(function (p) { return [(p[0] - cx) / w, (p[1] - cy) / d]; });
      if (over) Shapes.assign(s, over);
      return s;
    },

    /**
     * Setel ulang titik-titik poligon dari koordinat LOKAL (belum
     * ternormalisasi, belum diputar). Kotak pembatas dihitung ulang sehingga
     * width/depth ikut menyesuaikan, dan pergeseran pusatnya dikembalikan ke
     * x/y dunia — dengan begitu rotasi shape tidak ikut hilang.
     * @returns patch untuk Project.update, atau null kalau tidak valid
     */
    polygonPatchFromLocal: function (shape, local, unit) {
      if (!local || local.length < 3) return null;
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, i;
      for (i = 0; i < local.length; i++) {
        minX = Math.min(minX, local[i][0]); maxX = Math.max(maxX, local[i][0]);
        minY = Math.min(minY, local[i][1]); maxY = Math.max(maxY, local[i][1]);
      }
      var w = maxX - minX, d = maxY - minY;
      if (!(w > 1e-9) || !(d > 1e-9)) return null;

      var lcx = (minX + maxX) / 2, lcy = (minY + maxY) / 2;
      var a = (shape.rotation || 0) * Math.PI / 180;
      var c = Math.cos(a), n = Math.sin(a);
      return {
        x: Units.round(shape.x + (lcx * c - lcy * n), unit),
        y: Units.round(shape.y + (lcx * n + lcy * c), unit),
        width: Units.round(w, unit),
        depth: Units.round(d, unit),
        points: local.map(function (p) { return [(p[0] - lcx) / w, (p[1] - lcy) / d]; })
      };
    },

    /** titik-titik poligon dalam koordinat lokal (belum diputar), satuan project */
    polygonLocal: function (shape) {
      return (shape.points || []).map(function (p) {
        return [p[0] * shape.width, p[1] * shape.depth];
      });
    },

    /* ------------------------------------------------------------------ */
    /* ukuran sisi & sudut — untuk mencocokkan dengan data sertifikat/BPN  */
    /* ------------------------------------------------------------------ */

    /** luas poligon (selalu positif), satuan project kuadrat */
    polygonArea: function (pts) {
      return Math.abs(Shapes.signedArea(pts));
    },

    /** keliling poligon */
    polygonPerimeter: function (pts) {
      var t = 0;
      for (var i = 0; i < pts.length; i++) {
        var j = (i + 1) % pts.length;
        t += Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
      }
      return t;
    },

    /**
     * Rincian tiap sisi poligon: panjang, arah (bearing), dan sudut dalam di
     * titik AWAL sisi itu.
     *
     * Sudut dihitung sebagai sudut dalam poligon, jadi angkanya bisa langsung
     * dibandingkan dengan data ukur — bukan sudut arah yang perlu ditafsir
     * ulang. Untuk poligon berlawanan arah jarum jam maupun searah, hasilnya
     * sama (arah putar dinormalkan dulu).
     *
     * @returns [{i, len, bearing, angle}] — i = indeks titik awal sisi
     */
    polygonSides: function (pts) {
      var n = pts.length, out = [], i;
      if (n < 3) return out;
      // arah putar menentukan tanda sudut dalam; normalkan supaya konsisten
      var ccw = Shapes.signedArea(pts) > 0;

      for (i = 0; i < n; i++) {
        var prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
        var dx = next[0] - cur[0], dy = next[1] - cur[1];
        var len = Math.hypot(dx, dy);

        // sudut dalam di titik `cur`, antara sisi masuk dan sisi keluar
        var a1 = Math.atan2(prev[1] - cur[1], prev[0] - cur[0]);
        var a2 = Math.atan2(next[1] - cur[1], next[0] - cur[0]);
        var ang = (a2 - a1) * (ccw ? -1 : 1);
        while (ang < 0) ang += Math.PI * 2;
        while (ang > Math.PI * 2) ang -= Math.PI * 2;

        out.push({
          i: i,
          len: len,
          bearing: Math.atan2(dy, dx) * 180 / Math.PI,
          angle: ang * 180 / Math.PI
        });
      }
      return out;
    },

    /**
     * Ubah panjang satu sisi jadi `newLen`, arah sisinya dipertahankan.
     *
     * Aturannya "rantai": titik-titik SESUDAH sisi ini ikut bergeser sejauh
     * selisihnya, jadi panjang & sudut sisi-sisi lain tetap persis — kecuali
     * sisi penutup (dari titik terakhir kembali ke titik pertama), yang memang
     * harus menyerap perubahan supaya poligonnya tetap tertutup.
     *
     * Ini menyesuaikan cara orang membaca data ukur: sisi dimasukkan satu per
     * satu, dan sisi terakhir yang menutup bidang. Alternatifnya — menggeser
     * satu titik saja — akan diam-diam mengubah panjang sisi tetangganya, yang
     * justru merusak angka yang baru saja dimasukkan user.
     *
     * @param pts    titik lokal
     * @param idx    indeks titik awal sisi
     * @param newLen panjang baru (satuan project)
     * @returns titik-titik baru, atau null kalau tidak valid
     */
    setSideLength: function (pts, idx, newLen) {
      var n = pts.length;
      if (n < 3 || idx < 0 || idx >= n || !(newLen > 0)) return null;
      // sisi terakhir adalah sisi penutup: panjangnya ditentukan oleh semua
      // sisi lain, tidak bisa disetel sendiri tanpa merusak salah satunya
      if (idx >= n - 1) return null;

      var a = pts[idx], b = pts[idx + 1];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var len = Math.hypot(dx, dy);
      if (!(len > 1e-9)) return null;                 // sisi berimpit, arah tak jelas

      var k = (newLen - len) / len;
      var mx = dx * k, my = dy * k;

      // titik 0..idx terkunci; titik sesudahnya bergeser sejauh selisihnya
      var out = pts.map(function (p) { return [p[0], p[1]]; });
      for (var j = idx + 1; j < n; j++) {
        out[j][0] += mx;
        out[j][1] += my;
      }
      return out;
    },

    /**
     * Ubah sudut dalam di titik `idx` jadi `newDeg`, dengan memutar seluruh
     * rantai sesudahnya mengelilingi titik itu. Sama seperti setSideLength,
     * sisi penutup yang menyerap perubahan.
     */
    setVertexAngle: function (pts, idx, newDeg) {
      var n = pts.length;
      if (n < 3 || !isFinite(newDeg)) return null;
      // Titik 0 dan titik terakhir mengapit sisi penutup. Sudut di sana
      // ditentukan oleh sisa poligon — kalau dipaksa diputar, kedua sisinya
      // ikut bergerak bersama dan sudutnya tidak berubah sama sekali.
      if (idx < 1 || idx > n - 2) return null;

      var cur = Shapes.polygonSides(pts)[idx].angle;
      var ccw = Shapes.signedArea(pts) > 0;
      var delta = (newDeg - cur) * Math.PI / 180 * (ccw ? -1 : 1);
      if (!isFinite(delta)) return null;

      var p = pts[idx];
      var c = Math.cos(delta), s = Math.sin(delta);
      var out = pts.map(function (q) { return [q[0], q[1]]; });
      // hanya rantai SESUDAH titik ini yang berputar; sisi masuk tetap diam,
      // jadi sudut di antara keduanya benar-benar berubah
      for (var j = idx + 1; j < n; j++) {
        var vx = out[j][0] - p[0], vy = out[j][1] - p[1];
        out[j][0] = p[0] + vx * c - vy * s;
        out[j][1] = p[1] + vx * s + vy * c;
      }
      return out;
    },

    /** apakah panjang sisi / sudut di indeks ini bisa disetel lewat angka? */
    canSetSide:  function (n, idx) { return idx >= 0 && idx < n - 1; },
    canSetAngle: function (n, idx) { return idx >= 1 && idx <= n - 2; },

    /**
     * Coba perbaiki poligon yang sisinya saling menyilang, dengan mengurutkan
     * ulang titik berdasarkan sudut polar terhadap titik pusatnya (asumsi
     * "star-shaped" — tiap titik terlihat langsung dari pusat). Ini kasus yang
     * paling umum terjadi: klik-klik user membentuk himpunan titik yang benar,
     * cuma urutannya yang salah (mis. dua titik tertukar).
     *
     * Set titiknya SAMA, cuma urutannya berubah — bukan menggambar ulang bentuk.
     * Tidak semua poligon menyilang bisa diperbaiki cara ini (yang punya lekukan
     * "tersembunyi" dari pusat tidak akan terurut benar); kalau hasilnya masih
     * menyilang, dikembalikan null supaya caller tahu tidak ada perbaikan aman
     * yang bisa ditawarkan.
     *
     * @returns titik-titik yang sudah diurutkan ulang, atau null kalau gagal
     */
    autoFixPolygon: function (pts) {
      if (!pts || pts.length < 3 || !Shapes.selfIntersects(pts)) return null;
      var cx = 0, cy = 0, i;
      for (i = 0; i < pts.length; i++) { cx += pts[i][0]; cy += pts[i][1]; }
      cx /= pts.length; cy /= pts.length;

      var sorted = pts.slice().sort(function (a, b) {
        return Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx);
      });
      return Shapes.selfIntersects(sorted) ? null : sorted;
    },

    uid: function () {
      return 's' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
    }
  };

  global.Shapes = Shapes;
})(window);
