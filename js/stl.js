/* layout3d — export STL (client-side, tanpa backend)
 *
 * Ditulis sendiri (bukan STLExporter dari three/examples) supaya tidak perlu
 * script tambahan di luar core r128, dan supaya konversi sumbu + skala cetak
 * bisa dikontrol langsung di sini.
 *
 * Konversi sumbu: Three.js Y-up  ->  STL Z-up
 *   (x, y, z)_three  ->  (x, -z, y)_stl      [rotasi +90° pada sumbu X]
 * Satuan output: milimeter (konvensi slicer).
 */
(function (global) {
  'use strict';

  function collectTriangles(objects, mmPerMeter) {
    var tris = [];
    var vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();

    for (var o = 0; o < objects.length; o++) {
      objects[o].updateMatrixWorld(true);
      objects[o].traverse(function (node) {
        if (!node.isMesh || !node.geometry || node.userData.noExport) return;
        var geo = node.geometry;
        var pos = geo.attributes && geo.attributes.position;
        if (!pos) return;
        var idx = geo.index;
        var m = node.matrixWorld;
        var count = idx ? idx.count : pos.count;

        for (var i = 0; i < count; i += 3) {
          var a = idx ? idx.getX(i)     : i;
          var b = idx ? idx.getX(i + 1) : i + 1;
          var c = idx ? idx.getX(i + 2) : i + 2;

          vA.fromBufferAttribute(pos, a).applyMatrix4(m);
          vB.fromBufferAttribute(pos, b).applyMatrix4(m);
          vC.fromBufferAttribute(pos, c).applyMatrix4(m);

          tris.push([
            [vA.x * mmPerMeter, -vA.z * mmPerMeter, vA.y * mmPerMeter],
            [vB.x * mmPerMeter, -vB.z * mmPerMeter, vB.y * mmPerMeter],
            [vC.x * mmPerMeter, -vC.z * mmPerMeter, vC.y * mmPerMeter]
          ]);
        }
      });
    }
    return tris;
  }

  function facetNormal(t) {
    var ux = t[1][0] - t[0][0], uy = t[1][1] - t[0][1], uz = t[1][2] - t[0][2];
    var vx = t[2][0] - t[0][0], vy = t[2][1] - t[0][1], vz = t[2][2] - t[0][2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-12) return [0, 0, 0];
    return [nx / len, ny / len, nz / len];
  }

  function toBinary(tris, title) {
    var buf = new ArrayBuffer(84 + tris.length * 50);
    var dv = new DataView(buf);
    var head = 'layout3d ' + (title || '') + ' | mm | binary STL';
    for (var i = 0; i < 80; i++) dv.setUint8(i, i < head.length ? head.charCodeAt(i) & 0x7f : 0x20);
    dv.setUint32(80, tris.length, true);

    var off = 84;
    for (var t = 0; t < tris.length; t++) {
      var n = facetNormal(tris[t]);
      dv.setFloat32(off, n[0], true); dv.setFloat32(off + 4, n[1], true); dv.setFloat32(off + 8, n[2], true);
      off += 12;
      for (var v = 0; v < 3; v++) {
        dv.setFloat32(off, tris[t][v][0], true);
        dv.setFloat32(off + 4, tris[t][v][1], true);
        dv.setFloat32(off + 8, tris[t][v][2], true);
        off += 12;
      }
      dv.setUint16(off, 0, true);
      off += 2;
    }
    return new Blob([buf], { type: 'model/stl' });
  }

  function toAscii(tris, title) {
    var out = ['solid ' + (title || 'layout3d')];
    var f = function (x) { return x.toFixed(6); };
    for (var t = 0; t < tris.length; t++) {
      var n = facetNormal(tris[t]);
      out.push('facet normal ' + f(n[0]) + ' ' + f(n[1]) + ' ' + f(n[2]));
      out.push('  outer loop');
      for (var v = 0; v < 3; v++) {
        out.push('    vertex ' + f(tris[t][v][0]) + ' ' + f(tris[t][v][1]) + ' ' + f(tris[t][v][2]));
      }
      out.push('  endloop');
      out.push('endfacet');
    }
    out.push('endsolid ' + (title || 'layout3d'));
    return new Blob([out.join('\n')], { type: 'model/stl' });
  }

  function bboxMm(tris) {
    if (!tris.length) return null;
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (var t = 0; t < tris.length; t++) {
      for (var v = 0; v < 3; v++) {
        for (var a = 0; a < 3; a++) {
          if (tris[t][v][a] < mn[a]) mn[a] = tris[t][v][a];
          if (tris[t][v][a] > mx[a]) mx[a] = tris[t][v][a];
        }
      }
    }
    return { x: mx[0] - mn[0], y: mx[1] - mn[1], z: mx[2] - mn[2] };
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /**
   * @param objects  array Object3D (mesh / group)
   * @param opts     { filename, printScale (1:N), binary, title, zeroBase }
   * @returns { triangles, size:{x,y,z} }  ukuran hasil dalam mm
   */
  function exportSTL(objects, opts) {
    opts = opts || {};
    var printScale = opts.printScale > 0 ? opts.printScale : 1;
    var mmPerMeter = 1000 / printScale;

    var tris = collectTriangles(objects, mmPerMeter);
    if (!tris.length) throw new Error('Tidak ada geometri untuk diexport.');

    /* Alas dibangun di bawah y = 0 supaya model yang sudah ada tidak perlu
     * digeser. Akibatnya benda jadi punya z negatif; slicer memang otomatis
     * menjatuhkannya ke meja, tapi berkas yang mulai tepat di z = 0 lebih
     * enak diperiksa dan tidak bikin ragu waktu dibuka. */
    if (opts.zeroBase) {
      var minZ = Infinity;
      for (var q = 0; q < tris.length; q++) {
        for (var w = 0; w < 3; w++) if (tris[q][w][2] < minZ) minZ = tris[q][w][2];
      }
      if (minZ !== 0 && isFinite(minZ)) {
        for (q = 0; q < tris.length; q++) {
          for (w = 0; w < 3; w++) tris[q][w][2] -= minZ;
        }
      }
    }

    var title = opts.title || 'layout3d';
    var blob = opts.binary === false ? toAscii(tris, title) : toBinary(tris, title);
    download(blob, opts.filename || 'layout3d.stl');

    return { triangles: tris.length, size: bboxMm(tris) };
  }

  global.STL = {
    exportSTL: exportSTL,
    download: download,
    collectTriangles: collectTriangles
  };
})(window);
