/* layout3d — mode design challenge di dalam editor
 *
 * Tiga peran, tiga bentuk tautan, tanpa akun:
 *
 *   /?c=<slug>&k=<undangan>       peserta baru — template dimuat, boleh kirim
 *   /?s=<slug>/<id>&e=<sunting>   peserta lama — karyanya dimuat, boleh perbarui
 *   /?view=<slug>/<id>            siapa saja — melihat karya orang, tidak bisa kirim
 *
 * Alasan tautan, bukan akun: backend ini satu-password-satu-orang. Menambah
 * tabel user demi challenge ikut menyeret registrasi, verifikasi, lupa
 * password, dan moderasi — proyek tersendiri. Token pada tautan memberi hak
 * yang persis sama besarnya tanpa satu pun dari itu.
 *
 * Konsekuensi yang harus jujur diakui: kehilangan tautan = kehilangan hak
 * sunting, dan siapa pun yang dikirimi tautan itu bisa ikut menyunting.
 * Admin bisa menerbitkan tautan baru untuk memulihkan.
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var mode = null;        // 'join' | 'edit' | 'view' | null
  var slug = '';
  var sid = '';
  var inviteToken = '';
  var editToken = '';
  var challenge = null;
  var bar = null;
  var timer = null;

  /* -------------------------------------------------------------- util -- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function req(method, url, body) {
    return fetch(url, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || ('Gagal (' + r.status + ')'));
        return d;
      });
    });
  }

  /** "slug/id" -> [slug, id]; format lain dianggap tidak ada */
  function splitRef(v) {
    var m = String(v || '').match(/^([a-z0-9][a-z0-9-]{1,48})\/([A-Za-z0-9_-]{1,64})$/);
    return m ? [m[1], m[2]] : null;
  }

  function parseUrl() {
    var q = new URLSearchParams(global.location.search);

    var ref = splitRef(q.get('s'));
    if (ref) {
      mode = 'edit'; slug = ref[0]; sid = ref[1];
      editToken = q.get('e') || '';
      return true;
    }
    ref = splitRef(q.get('view'));
    if (ref) {
      mode = 'view'; slug = ref[0]; sid = ref[1];
      return true;
    }
    var c = q.get('c');
    if (c && /^[a-z0-9][a-z0-9-]{1,48}$/.test(c)) {
      mode = 'join'; slug = c;
      inviteToken = q.get('k') || '';
      return true;
    }
    return false;
  }

  /* --------------------------------------------------------------- bar -- */

  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'ch-bar';
    var main = $('main');
    main.parentNode.insertBefore(bar, main);
    document.body.classList.add('has-ch-bar');
    return bar;
  }

  function rulesText(c) {
    var r = (c && c.constraints) || {};
    var out = [];
    if (r.maxKdb) out.push('KDB ≤ ' + r.maxKdb + '%');
    if (r.maxHeight) out.push('tinggi ≤ ' + r.maxHeight + ' m');
    if (r.maxObjects) out.push('≤ ' + r.maxObjects + ' objek');
    out.push('di dalam batas tanah');
    return out.join(' · ');
  }

  function renderBar() {
    var el = ensureBar();
    var judul = challenge ? challenge.title : slug;

    var aksi = '';
    if (mode === 'join') {
      aksi = inviteToken
        ? '<button class="tb primary" id="ch-submit">Kirim karya</button>'
        : '<span class="ch-warn">Butuh tautan undangan untuk mengirim</span>';
    } else if (mode === 'edit') {
      aksi = '<button class="tb primary" id="ch-update">Perbarui karya</button>';
    } else if (mode === 'view') {
      aksi = '<span class="ch-note">Mode lihat — perubahan tidak tersimpan</span>';
    }

    el.innerHTML =
      '<div class="ch-left">' +
        '<span class="ch-kicker">Challenge</span>' +
        '<a class="ch-title" href="/c/' + esc(slug) + '">' + esc(judul) + '</a>' +
        '<span class="ch-rules">' + esc(rulesText(challenge)) + '</span>' +
      '</div>' +
      '<div class="ch-right">' +
        '<span id="ch-status" class="ch-status">menghitung…</span>' +
        aksi +
      '</div>';

    if ($('ch-submit')) $('ch-submit').addEventListener('click', kirim);
    if ($('ch-update')) $('ch-update').addEventListener('click', perbarui);
  }

  /* ---------------------------------------------------------- penilaian -- */

  /**
   * Status kepatuhan dihitung di klien memakai js/evaluate.js — kode yang
   * sama persis dengan yang dipakai server saat menyimpan. Yang di layar
   * karena itu tidak akan berbeda dari yang tercatat di galeri.
   */
  function nilai() {
    if (!challenge) return null;
    try {
      return Evaluate.evaluate(Project.serialize(), challenge.constraints);
    } catch (e) {
      console.warn('[layout3d] evaluasi gagal:', e);
      return null;
    }
  }

  function refreshStatus() {
    var el = $('ch-status');
    if (!el) return;
    var r = nilai();
    if (!r) { el.textContent = ''; return; }

    el.className = 'ch-status ' + (r.ok ? 'ok' : 'bad');
    if (r.ok) {
      el.textContent = 'Memenuhi brief · KDB ' + r.kdb + '% · puncak ' + r.peak + ' ' + r.unit;
      el.title = 'Luas tanah ' + r.land + ' ' + r.unit + '², terbangun ' + r.built + ' ' + r.unit + '²';
    } else {
      el.textContent = r.violations.length + ' hal perlu dibereskan';
      el.title = r.violations.map(function (v) { return '• ' + v.pesan; }).join('\n');
    }
  }

  /* Penilaian menyapu kisi 600×600 — murah, tapi tidak untuk tiap pixel
   * geseran. Ditunda sampai gerakannya berhenti sejenak. */
  function scheduleStatus() {
    clearTimeout(timer);
    timer = setTimeout(refreshStatus, 220);
  }

  /* ------------------------------------------------------------- kirim -- */

  function laporanHtml(r) {
    if (!r || r.ok) return '';
    return '<div class="ch-viol"><b>Karya ini belum memenuhi brief:</b><ul>' +
      r.violations.map(function (v) { return '<li>' + esc(v.pesan) + '</li>'; }).join('') +
      '</ul><p>Boleh tetap dikirim — pelanggarannya akan terlihat di galeri.</p></div>';
  }

  function kirim() {
    var r = nilai();
    UI.modal({
      title: 'Kirim karya ke challenge',
      body:
        '<label>Nama peserta</label>' +
        '<input type="text" id="ch-author" maxlength="80" placeholder="Nama atau tim">' +
        '<label>Catatan singkat (opsional)</label>' +
        '<input type="text" id="ch-note" maxlength="200" placeholder="Gagasan desainnya dalam satu kalimat">' +
        laporanHtml(r) +
        '<div id="ch-err" class="ch-err"></div>',
      actions: [
        { label: 'Batal' },
        { label: 'Kirim', primary: true, onClick: function () {
            var author = ($('ch-author').value || '').trim();
            if (!author) { $('ch-err').textContent = 'Nama peserta belum diisi.'; return false; }

            req('POST', '/api/challenges/' + encodeURIComponent(slug) + '/submissions', {
              author: author,
              note: ($('ch-note').value || '').trim(),
              invite: inviteToken,
              data: Project.serialize()
            }).then(function (d) {
              UI.closeModal();
              sesudahKirim(d.submission, d.editToken);
            }).catch(function (e) {
              $('ch-err').textContent = e.message;
            });
            return false;
          } }
      ],
      onOpen: function () { setTimeout(function () { $('ch-author').focus(); }, 30); }
    });
  }

  /**
   * Tautan sunting hanya diperlihatkan SEKALI. Server menyimpan hash-nya, jadi
   * tidak ada cara menampilkannya lagi nanti — karena itu dialognya menahan
   * pengguna dengan tautan yang bisa disalin, bukan sekadar "berhasil".
   */
  function sesudahKirim(sub, token) {
    var url = global.location.origin + '/?s=' + slug + '/' + sub.id + '&e=' + token;
    try { global.localStorage.setItem('layout3d:ch:' + slug + ':' + sub.id, token); } catch (e) { /* mode privat */ }

    UI.modal({
      title: 'Karya terkirim',
      body:
        '<p>Karya <b>' + esc(sub.author) + '</b> sudah masuk galeri.</p>' +
        '<p><b>Simpan tautan ini</b> — hanya dengan tautan inilah karyamu bisa disunting lagi. ' +
        'Tautannya tidak bisa ditampilkan ulang.</p>' +
        '<input type="text" id="ch-link" readonly value="' + esc(url) + '" ' +
          'style="width:100%;font-family:ui-monospace,Consolas,monospace;font-size:11.5px">' +
        '<div class="ch-hint">Tersimpan juga di browser ini, tapi jangan diandalkan: ' +
        'hapus data situs, dan tautannya ikut hilang.</div>',
      actions: [
        { label: 'Salin tautan', onClick: function () {
            var i = $('ch-link');
            i.select();
            try { document.execCommand('copy'); UI.say('Tautan sunting disalin.'); }
            catch (e) { UI.say('Salin manual dari kotak tautan.'); }
            return false;
          } },
        { label: 'Lihat galeri', primary: true, onClick: function () {
            global.location.href = '/c/' + slug;
            return false;
          } }
      ],
      onOpen: function () { setTimeout(function () { $('ch-link').select(); }, 30); }
    });
  }

  function perbarui() {
    var r = nilai();
    UI.modal({
      title: 'Perbarui karya',
      body: '<p>Kirim versi terbaru ke galeri challenge?</p>' + laporanHtml(r) +
            '<div id="ch-err" class="ch-err"></div>',
      actions: [
        { label: 'Batal' },
        { label: 'Perbarui', primary: true, onClick: function () {
            req('PUT', '/api/challenges/' + encodeURIComponent(slug) +
                       '/submissions/' + encodeURIComponent(sid), {
              edit: editToken,
              data: Project.serialize()
            }).then(function () {
              UI.closeModal();
              UI.say('Karya diperbarui di galeri.');
            }).catch(function (e) {
              $('ch-err').textContent = e.message;
            });
            return false;
          } }
      ]
    });
  }

  /* -------------------------------------------------------- buat (admin) -- */

  /** dialog admin: jadikan project yang sedang dibuka sebagai template challenge */
  function buatDialog() {
    UI.modal({
      title: 'Buat challenge dari project ini',
      body:
        '<p>Project yang sedang terbuka akan menjadi template — biasanya berisi ' +
        'bidang tanah dan konteks sekitarnya, tanpa bangunan yang harus dirancang peserta.</p>' +
        '<label>Judul</label><input type="text" id="cc-title" maxlength="120">' +
        '<label>Brief</label><textarea id="cc-brief" rows="4" ' +
          'placeholder="Apa yang harus dirancang, untuk siapa, dan apa yang dinilai."></textarea>' +
        '<div class="cc-grid">' +
          '<div><label>KDB maks (%)</label><input type="number" id="cc-kdb" min="0" max="100" step="1"></div>' +
          '<div><label>Tinggi maks</label><input type="number" id="cc-h" min="0" step="0.5"></div>' +
          '<div><label>Objek maks</label><input type="number" id="cc-n" min="0" step="1"></div>' +
        '</div>' +
        '<div class="ch-hint">Kosongkan yang tidak dipakai — batas bernilai 0 berarti tidak dibatasi. ' +
        'Aturan "semua bangunan di dalam batas tanah" selalu berlaku.</div>' +
        '<div id="cc-err" class="ch-err"></div>',
      actions: [
        { label: 'Batal' },
        { label: 'Buat', primary: true, onClick: function () {
            var title = ($('cc-title').value || '').trim();
            if (!title) { $('cc-err').textContent = 'Judul belum diisi.'; return false; }

            req('POST', '/api/challenges', {
              title: title,
              brief: $('cc-brief').value || '',
              constraints: {
                maxKdb: Number($('cc-kdb').value) || 0,
                maxHeight: Number($('cc-h').value) || 0,
                maxObjects: Number($('cc-n').value) || 0
              },
              template: Project.serialize()
            }).then(function (d) {
              UI.closeModal();
              sesudahBuat(d.challenge, d.inviteToken);
            }).catch(function (e) { $('cc-err').textContent = e.message; });
            return false;
          } }
      ],
      onOpen: function () {
        $('cc-title').value = (Project.state && Project.state.name) || '';
        setTimeout(function () { $('cc-title').focus(); }, 30);
      }
    });
  }

  function sesudahBuat(c, invite) {
    var undangan = global.location.origin + '/?c=' + c.slug + '&k=' + invite;
    var galeri = global.location.origin + '/c/' + c.slug;
    UI.modal({
      title: 'Challenge dibuat',
      body:
        '<p><b>Tautan undangan</b> — bagikan ke peserta. Hanya pemegang tautan ini ' +
        'yang bisa mengirim karya.</p>' +
        '<input type="text" id="cc-inv" readonly value="' + esc(undangan) + '" ' +
          'style="width:100%;font-family:ui-monospace,Consolas,monospace;font-size:11.5px">' +
        '<p style="margin-top:12px"><b>Tautan galeri</b> — publik, boleh disebar bebas.</p>' +
        '<input type="text" readonly value="' + esc(galeri) + '" ' +
          'style="width:100%;font-family:ui-monospace,Consolas,monospace;font-size:11.5px">' +
        '<div class="ch-hint">Tautan undangan disimpan sebagai hash di server dan tidak bisa ' +
        'ditampilkan ulang. Kalau hilang, terbitkan yang baru dari panel admin di halaman galeri.</div>',
      actions: [
        { label: 'Tutup' },
        { label: 'Buka galeri', primary: true, onClick: function () {
            global.location.href = galeri; return false;
          } }
      ],
      onOpen: function () { setTimeout(function () { $('cc-inv').select(); }, 30); }
    });
  }

  /* -------------------------------------------------------------- boot -- */

  /** muat template/karya, lalu pasang bar. Menolak diam-diam kalau gagal. */
  function load() {
    // Autosave dialihkan ke kunci milik challenge ini. Tanpa itu, membuka
    // tautan undangan akan menimpa project pribadi yang tersimpan di
    // browser yang sama — kehilangan diam-diam, dan penyebabnya tidak
    // mungkin ditebak pengguna.
    Project.setAutosaveKey(mode === 'join' ? 'c:' + slug : 's:' + slug + '/' + sid);

    // Peserta yang me-refresh di tengah menggambar harus menemukan
    // pekerjaannya, bukan template kosong lagi. Draf lokal karena itu
    // menang atas template — tapi tidak atas karya yang sudah terkirim,
    // yang versi resminya ada di server.
    var adaDraf = mode === 'join' && Project.hasAutosave();

    var p = mode === 'join'
      ? req('GET', '/api/challenges/' + encodeURIComponent(slug))
          .then(function (d) { challenge = d.challenge; return d.template; })
      : Promise.all([
          req('GET', '/api/challenges/' + encodeURIComponent(slug)),
          req('GET', '/api/challenges/' + encodeURIComponent(slug) +
                     '/submissions/' + encodeURIComponent(sid))
        ]).then(function (r) { challenge = r[0].challenge; return r[1].data; });

    return p.then(function (data) {
      if (adaDraf && Project.restoreAutosave()) {
        renderBar();
        refreshStatus();
        Project.on('change', scheduleStatus);
        UI.say('Draf challenge kamu dipulihkan. Tekan Kirim karya kalau sudah siap.');
        return true;
      }
      Project.load(data, { nohistory: true });
      renderBar();
      refreshStatus();
      Project.on('change', scheduleStatus);
      UI.say(mode === 'join'
        ? 'Template challenge dimuat. Rancang di dalam batas tanah, lalu tekan Kirim karya.'
        : mode === 'edit'
          ? 'Karyamu dimuat. Setelah diubah, tekan Perbarui karya.'
          : 'Melihat karya peserta. Perubahan di sini tidak tersimpan.');
      return true;
    }).catch(function (e) {
      UI.modal({
        title: 'Challenge tidak bisa dibuka',
        body: '<p>' + esc(e.message) + '</p>' +
              '<p>Editor tetap bisa dipakai seperti biasa.</p>',
        actions: [{ label: 'Tutup', primary: true }]
      });
      mode = null;
      return false;
    });
  }

  global.Challenge = {
    /** true kalau URL menunjuk ke sebuah challenge (app.js melewati demo/autosave) */
    detect: function () { return parseUrl(); },
    load: load,
    active: function () { return !!mode; },
    mode: function () { return mode; },
    buatDialog: buatDialog,
    refreshStatus: refreshStatus
  };
})(window);
