/* layout3d — cetak & simpan gambar dengan latar putih
 *
 * Editor memakai latar gelap karena enak dipandang berjam-jam. Kertas tidak
 * begitu: mencetak layar gelap apa adanya menghabiskan tinta, dan garis tipis
 * yang jelas di layar hilang begitu dibalik jadi hitam-di-atas-putih.
 *
 * Jadi yang dicetak bukan tangkapan layar. Editor2D.snapshot() dan
 * Viewer3D.snapshot() menggambar ulang isinya dengan palet terang di atas alas
 * putih, pada ukuran cetak, tanpa perkakas sunting — lalu semuanya dikembalikan
 * seperti semula.
 *
 * Mencetak lewat <iframe> tersembunyi, bukan window.open: popup diblokir diam-
 * diam di banyak peramban, dan pengguna hanya akan melihat tombol yang tidak
 * melakukan apa-apa.
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* Ukuran render, piksel. Sisi panjang ~2200 px: pada A4 itu sekitar 190 dpi —
   * tajam untuk garis denah, tapi masih ringan dibanding 300 dpi penuh. */
  var UKURAN = {
    landscape: { w: 2200, h: 1556 },
    portrait: { w: 1556, h: 2200 }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function namaBerkas(sufiks) {
    var n = (Project.state.name || 'layout3d').replace(/[^\w\d\- ]+/g, '').trim() || 'layout3d';
    var d = new Date();
    var ts = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
    return n.replace(/\s+/g, '-') + '-' + sufiks + '-' + ts + '.png';
  }

  /** keterangan skala & satuan, supaya gambar cetaknya bisa dibaca sendiri */
  function keterangan() {
    var u = Project.state.scale.unit;
    var b = Project.bounds();
    var bagian = ['Satuan ' + Units.def(u).label];
    if (b && b.w > 0) {
      bagian.push('Luasan ' + Units.fmt(b.w, u, false) + ' × ' + Units.fmt(b.h, u, false) +
                  ' ' + Units.def(u).label);
    }
    bagian.push(Project.shapes.length + ' objek');
    bagian.push(new Date().toLocaleDateString('id-ID',
      { day: 'numeric', month: 'long', year: 'numeric' }));
    return bagian.join('  ·  ');
  }

  /* -------------------------------------------------------------- ambil -- */

  function ambil(pilihan, orientasi, grid) {
    var uk = UKURAN[orientasi] || UKURAN.landscape;
    var out = [];
    if (pilihan === '2d' || pilihan === 'both') {
      out.push({ judul: 'Denah 2D', url: Editor2D.snapshot({ width: uk.w, height: uk.h, grid: grid }) });
    }
    if (pilihan === '3d' || pilihan === 'both') {
      out.push({ judul: 'Tampak 3D', url: Viewer3D.snapshot({ width: uk.w, height: uk.h, grid: grid }) });
    }
    return out.filter(function (g) { return !!g.url; });
  }

  /* -------------------------------------------------------------- cetak -- */

  function halamanCetak(gambar, orientasi) {
    var judul = esc(Project.state.name || 'Untitled');
    var ket = esc(keterangan());

    var isi = gambar.map(function (g) {
      return '<section>' +
        '<header><h1>' + judul + '</h1>' +
        '<span class="sub">' + esc(g.judul) + '</span></header>' +
        '<div class="wrap"><img src="' + g.url + '" alt="' + esc(g.judul) + '"></div>' +
        '<footer>' + ket + '</footer>' +
      '</section>';
    }).join('');

    /* Warna dipaksa apa adanya (print-color-adjust): tanpa itu sebagian
       peramban "menghemat" dengan membuang latar dan warna isian, dan yang
       keluar hanya garis. */
    return '<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">' +
      '<title>' + judul + '</title><style>' +
      '@page { size: A4 ' + orientasi + '; margin: 12mm; }' +
      'html,body { margin:0; padding:0; background:#fff; color:#1b2129;' +
      ' font:12px/1.5 "Segoe UI",Roboto,system-ui,sans-serif;' +
      ' -webkit-print-color-adjust:exact; print-color-adjust:exact; }' +
      'section { page-break-after:always; break-after:page;' +
      ' height:100vh; display:flex; flex-direction:column; }' +
      'section:last-child { page-break-after:auto; break-after:auto; }' +
      'header { display:flex; align-items:baseline; gap:10px;' +
      ' border-bottom:1px solid #c9d2dc; padding-bottom:5px; margin-bottom:8px; }' +
      'h1 { font-size:15px; margin:0; font-weight:600; }' +
      '.sub { color:#6b7a8d; font-size:11px; }' +
      '.wrap { flex:1 1 auto; display:flex; align-items:center;' +
      ' justify-content:center; min-height:0; }' +
      'img { max-width:100%; max-height:100%; object-fit:contain; }' +
      'footer { border-top:1px solid #c9d2dc; padding-top:5px; margin-top:8px;' +
      ' color:#6b7a8d; font-size:10.5px; }' +
      '</style></head><body>' + isi + '</body></html>';
  }

  function cetak(gambar, orientasi) {
    var lama = $('print-frame');
    if (lama) lama.remove();

    var f = document.createElement('iframe');
    f.id = 'print-frame';
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;' +
                      'border:0;opacity:0;pointer-events:none';
    document.body.appendChild(f);

    var d = f.contentWindow.document;
    d.open();
    d.write(halamanCetak(gambar, orientasi));
    d.close();

    /* Gambar data: URL pun belum tentu selesai di-decode saat dokumen ditutup.
     * Mencetak lebih awal menghasilkan halaman kosong, jadi tunggu semuanya. */
    var img = Array.prototype.slice.call(d.images);
    var sisa = img.length;
    var jalan = false;

    function mulai() {
      if (jalan) return;
      jalan = true;
      try {
        f.contentWindow.focus();
        f.contentWindow.print();
      } catch (e) {
        UI.say('Gagal membuka dialog cetak: ' + e.message, 'err');
      }
      // sisakan waktu untuk dialog cetak sebelum iframe-nya dibuang
      setTimeout(function () { f.remove(); }, 60000);
    }

    if (!sisa) return mulai();
    img.forEach(function (im) {
      if (im.complete) { if (!--sisa) mulai(); return; }
      im.onload = im.onerror = function () { if (!--sisa) mulai(); };
    });
    setTimeout(mulai, 4000);   // jaring pengaman kalau ada gambar yang tidak pernah selesai
  }

  /* ------------------------------------------------------------- simpan -- */

  function simpan(gambar) {
    gambar.forEach(function (g, i) {
      var a = document.createElement('a');
      a.href = g.url;
      a.download = namaBerkas(g.judul === 'Denah 2D' ? 'denah' : '3d');
      document.body.appendChild(a);
      setTimeout(function () { a.click(); a.remove(); }, i * 350);
    });
    UI.say(gambar.length > 1 ? '2 gambar PNG diunduh.' : 'Gambar PNG diunduh.');
  }

  /* ------------------------------------------------------------- dialog -- */

  function bacaPilihan() {
    var p = document.querySelector('input[name="pr-apa"]:checked');
    var o = document.querySelector('input[name="pr-or"]:checked');
    return {
      apa: p ? p.value : 'both',
      orientasi: o ? o.value : 'landscape',
      grid: $('pr-grid').checked
    };
  }

  function jalankan(aksi) {
    var v = bacaPilihan();
    var gambar;
    try {
      gambar = ambil(v.apa, v.orientasi, v.grid);
    } catch (e) {
      UI.say('Gagal menyiapkan gambar: ' + e.message, 'err');
      return;
    }
    if (!gambar.length) { UI.say('Tidak ada yang bisa dicetak.', 'err'); return; }

    UI.closeModal();
    if (aksi === 'cetak') cetak(gambar, v.orientasi); else simpan(gambar);
  }

  function dialog() {
    UI.modal({
      title: 'Cetak / simpan gambar',
      body:
        '<p>Gambar dibuat ulang dengan <b>latar putih</b> siap kertas — bukan tangkapan ' +
        'layar gelap. Kotak seleksi dan pegangan resize tidak ikut tercetak.</p>' +

        '<label>Yang dicetak</label>' +
        '<div class="pr-opt">' +
          '<label><input type="radio" name="pr-apa" value="2d"> Denah 2D</label>' +
          '<label><input type="radio" name="pr-apa" value="3d"> Tampak 3D</label>' +
          '<label><input type="radio" name="pr-apa" value="both" checked> Keduanya</label>' +
        '</div>' +

        '<label>Orientasi kertas</label>' +
        '<div class="pr-opt">' +
          '<label><input type="radio" name="pr-or" value="landscape" checked> Mendatar</label>' +
          '<label><input type="radio" name="pr-or" value="portrait"> Tegak</label>' +
        '</div>' +

        '<label class="pr-check"><input type="checkbox" id="pr-grid" checked> ' +
          'Sertakan grid</label>' +

        '<div class="ch-hint">Nama project, satuan, luasan, dan tanggal ikut tercetak ' +
        'sebagai kepala dan kaki halaman.</div>',
      actions: [
        { label: 'Batal' },
        { label: 'Simpan PNG', onClick: function () { jalankan('simpan'); return false; } },
        { label: 'Cetak', primary: true, onClick: function () { jalankan('cetak'); return false; } }
      ]
    });
  }

  global.Printout = {
    dialog: dialog,
    snapshotAll: ambil,
    cetak: cetak,
    // dibuka untuk pratinjau & pengujian: isi halaman cetak harus bisa
    // diperiksa tanpa membuka dialog cetak peramban
    html: halamanCetak
  };
})(window);
