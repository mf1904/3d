/* layout3d — galeri challenge (halaman publik)
 *
 * Berdiri sendiri dari editor. Yang dipakai bersama hanya shapes.js + units.js
 * untuk menghitung denah; menggambarnya pakai canvas 2D biasa, bukan Konva —
 * pratinjau di kartu tidak perlu interaksi, dan pengunjung galeri tidak
 * seharusnya menunggu pustaka editor selesai dimuat.
 *
 * Rute dibaca dari path, bukan hash, supaya tautannya rapi dan bisa dibagikan:
 *   /c                      -> daftar semua challenge
 *   /c/<slug>               -> brief + galeri submission
 *   /c/<slug>?s=<id>        -> satu submission
 */
(function (global) {
  'use strict';

  var main = document.getElementById('g-main');

  /* ------------------------------------------------------------- util -- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function api(method, url, body) {
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

  function tanggal(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function show(html) { main.innerHTML = html; }
  function fatal(msg) { show('<div class="g-error">' + esc(msg) + '</div>'); }

  /* -------------------------------------------------- gambar pratinjau -- */

  /**
   * Denah kecil sebuah project di atas canvas biasa.
   *
   * Yang digambar cuma dua lapis: bidang tanah, lalu tapak tiap objek. Cukup
   * untuk mengenali gubahan massanya sekilas, dan tidak perlu tahu apa pun
   * tentang atap, bukaan, atau elevasi.
   */
  function drawPlan(canvas, data) {
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth || 240;
    var h = canvas.clientHeight || 180;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#161b22';
    ctx.fillRect(0, 0, w, h);

    var shapes = (data && data.shapes) || [];
    var lands = [], builds = [];
    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      if (s.meta && s.meta.hidden) continue;
      if (Shapes.isLand(s.type)) {
        var p = Shapes.landPolygon(s);
        if (p.length >= 3) lands.push(p);
      } else {
        builds.push(Shapes.footprintCorners(s));
      }
    }
    var all = lands.concat(builds);
    if (!all.length) {
      ctx.fillStyle = '#6b7a8d';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('(kosong)', w / 2, h / 2);
      return;
    }

    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    all.forEach(function (poly) {
      poly.forEach(function (pt) {
        if (pt[0] < x0) x0 = pt[0];
        if (pt[0] > x1) x1 = pt[0];
        if (pt[1] < y0) y0 = pt[1];
        if (pt[1] > y1) y1 = pt[1];
      });
    });

    var pad = 10;
    var sx = (w - pad * 2) / Math.max(x1 - x0, 1e-6);
    var sy = (h - pad * 2) / Math.max(y1 - y0, 1e-6);
    var k = Math.min(sx, sy);
    var ox = (w - (x1 - x0) * k) / 2 - x0 * k;
    var oy = (h - (y1 - y0) * k) / 2 - y0 * k;

    function trace(poly) {
      ctx.beginPath();
      poly.forEach(function (pt, i) {
        var X = pt[0] * k + ox, Y = pt[1] * k + oy;
        if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
      });
      ctx.closePath();
    }

    ctx.lineJoin = 'round';
    lands.forEach(function (p) {
      trace(p);
      ctx.fillStyle = 'rgba(111, 143, 90, .30)';
      ctx.fill();
      ctx.strokeStyle = '#6f8f5a';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    });
    builds.forEach(function (p) {
      trace(p);
      ctx.fillStyle = 'rgba(214, 196, 158, .78)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(20, 25, 32, .8)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  /** pratinjau digambar setelah kartunya masuk DOM supaya ukurannya sudah pasti */
  function renderThumbs(jobs) {
    jobs.forEach(function (j) {
      var cv = document.getElementById(j.id);
      if (!cv) return;
      api('GET', '/api/challenges/' + encodeURIComponent(j.slug) +
                 '/submissions/' + encodeURIComponent(j.sid))
        .then(function (d) { drawPlan(cv, d.data); })
        .catch(function () { /* satu pratinjau gagal tidak boleh merusak galeri */ });
    });
  }

  /* ------------------------------------------------------------ aturan -- */

  function rulesHtml(c) {
    var r = c.constraints || {};
    var out = [];
    if (r.maxKdb) out.push('<span class="g-rule">KDB maks <b>' + r.maxKdb + '%</b></span>');
    if (r.maxHeight) out.push('<span class="g-rule">Tinggi maks <b>' + r.maxHeight + ' m</b></span>');
    if (r.maxObjects) out.push('<span class="g-rule">Objek maks <b>' + r.maxObjects + '</b></span>');
    out.push('<span class="g-rule">Semua bangunan <b>di dalam batas tanah</b></span>');
    if (c.deadline) out.push('<span class="g-rule">Batas waktu <b>' + tanggal(c.deadline) + '</b></span>');
    return '<div class="g-rules">' + out.join('') + '</div>';
  }

  function badgesHtml(rep) {
    if (!rep) return '';
    var b = [];
    b.push('<span class="g-badge ' + (rep.ok ? 'ok' : 'bad') + '">' +
           (rep.ok ? 'Memenuhi brief' : rep.violations.length + ' pelanggaran') + '</span>');
    if (rep.land) b.push('<span class="g-badge num">KDB ' + rep.kdb + '%</span>');
    if (rep.peak) b.push('<span class="g-badge num">' + rep.peak + ' ' + esc(rep.unit) + '</span>');
    return '<div class="g-badges">' + b.join('') + '</div>';
  }

  /* ------------------------------------------------------ daftar semua -- */

  function viewList() {
    api('GET', '/api/challenges').then(function (d) {
      if (!d.challenges.length) {
        show('<div class="g-head"><h1>Design challenge</h1></div>' +
             '<p class="g-empty">Belum ada challenge yang dibuka.</p>');
        return;
      }
      var cards = d.challenges.map(function (c) {
        return '<a class="g-card" href="/c/' + esc(c.slug) + '">' +
          '<div class="g-card-body">' +
            '<h3>' + esc(c.title) + '</h3>' +
            '<div class="g-meta">' + c.submissions + ' submission · ' + tanggal(c.created) + '</div>' +
            (c.brief ? '<div class="g-note">' + esc(c.brief.slice(0, 120)) +
                       (c.brief.length > 120 ? '…' : '') + '</div>' : '') +
            '<div class="g-badges"><span class="g-tag ' + (c.open ? 'open' : 'closed') + '">' +
              (c.open ? 'Terbuka' : 'Ditutup') + '</span></div>' +
          '</div></a>';
      }).join('');
      show('<div class="g-head"><h1>Design challenge</h1>' +
           '<div class="g-sub">Pilih challenge untuk melihat brief dan karya peserta.</div></div>' +
           '<div class="g-grid">' + cards + '</div>');
    }).catch(function (e) { fatal(e.message); });
  }

  /* ------------------------------------------------- satu challenge ---- */

  function viewChallenge(slug) {
    Promise.all([
      api('GET', '/api/challenges/' + encodeURIComponent(slug)),
      api('GET', '/api/challenges/' + encodeURIComponent(slug) + '/submissions')
    ]).then(function (res) {
      var c = res[0].challenge, admin = res[0].admin, subs = res[1].submissions;

      var kirim = c.open
        ? '<a class="g-btn" href="/?c=' + esc(c.slug) + '">Ikut challenge ini</a>'
        : '';

      var jobs = [];
      var grid = subs.length
        ? '<div class="g-grid">' + subs.map(function (s) {
            var cid = 'th-' + s.id;
            jobs.push({ id: cid, slug: slug, sid: s.id });
            return '<a class="g-card" href="/c/' + esc(slug) + '?s=' + esc(s.id) + '">' +
              '<canvas class="g-thumb" id="' + cid + '"></canvas>' +
              '<div class="g-card-body">' +
                '<h3>' + esc(s.author) + '</h3>' +
                '<div class="g-meta">' + tanggal(s.updated) + '</div>' +
                (s.note ? '<div class="g-note">' + esc(s.note.slice(0, 90)) + '</div>' : '') +
                badgesHtml(s.report) +
              '</div></a>';
          }).join('') + '</div>'
        : '<p class="g-empty">Belum ada submission. Jadilah yang pertama.</p>';

      show(
        '<div class="g-head">' +
          '<h1>' + esc(c.title) + '</h1>' +
          '<div class="g-sub">' + subs.length + ' submission · dibuat ' + tanggal(c.created) +
          ' · <span class="g-tag ' + (c.open ? 'open' : 'closed') + '">' +
          (c.open ? 'Terbuka' : 'Ditutup') + '</span></div>' +
        '</div>' +
        (c.brief ? '<div class="g-brief">' + esc(c.brief) + '</div>' : '') +
        rulesHtml(c) +
        '<div class="g-cta">' + kirim +
          '<a class="g-btn ghost" href="/c">Challenge lain</a></div>' +
        (admin ? adminHtml(c) : '') +
        grid
      );

      renderThumbs(jobs);
      if (admin) bindAdmin(c);
    }).catch(function (e) { fatal(e.message); });
  }

  /* --------------------------------------------------- satu submission -- */

  function viewSubmission(slug, sid) {
    Promise.all([
      api('GET', '/api/challenges/' + encodeURIComponent(slug)),
      api('GET', '/api/challenges/' + encodeURIComponent(slug) +
                 '/submissions/' + encodeURIComponent(sid))
    ]).then(function (res) {
      var c = res[0].challenge, s = res[1].submission, data = res[1].data;
      var rep = s.report;

      var pelanggaran = rep && rep.violations && rep.violations.length
        ? '<div class="g-error"><b>Catatan brief</b><ul>' +
          rep.violations.map(function (v) { return '<li>' + esc(v.pesan) + '</li>'; }).join('') +
          '</ul></div>'
        : '';

      var angka = rep
        ? '<div class="g-rules">' +
          '<span class="g-rule">Luas tanah <b>' + rep.land + ' ' + esc(rep.unit) + '²</b></span>' +
          '<span class="g-rule">Luas terbangun <b>' + rep.built + ' ' + esc(rep.unit) + '²</b></span>' +
          '<span class="g-rule">KDB <b>' + rep.kdb + '%</b></span>' +
          '<span class="g-rule">Puncak <b>' + rep.peak + ' ' + esc(rep.unit) + '</b></span>' +
          '<span class="g-rule">Objek <b>' + rep.objects + '</b></span>' +
          '</div>'
        : '';

      show(
        '<div class="g-head"><h1>' + esc(s.author) + '</h1>' +
        '<div class="g-sub">' + esc(c.title) + ' · diperbarui ' + tanggal(s.updated) + '</div></div>' +
        (s.note ? '<div class="g-brief">' + esc(s.note) + '</div>' : '') +
        angka + pelanggaran +
        '<canvas class="g-thumb" id="big" style="aspect-ratio:16/9;border-radius:8px;' +
          'border:1px solid var(--line)"></canvas>' +
        '<div class="g-cta" style="margin-top:16px">' +
          '<a class="g-btn" href="/?view=' + esc(slug) + '/' + esc(sid) + '">Buka di editor 3D</a>' +
          '<a class="g-btn ghost" href="/c/' + esc(slug) + '">Kembali ke galeri</a>' +
        '</div>'
      );
      drawPlan(document.getElementById('big'), data);
    }).catch(function (e) { fatal(e.message); });
  }

  /* ------------------------------------------------------------ admin -- */

  function adminHtml(c) {
    return '<div class="g-admin">' +
      '<h2>Panel admin</h2>' +
      '<div class="row">' +
        '<input class="g-link" id="a-invite" readonly placeholder="Klik &quot;Terbitkan tautan undangan&quot;">' +
        '<button class="g-btn ghost" id="a-rotate">Terbitkan tautan undangan</button>' +
        '<button class="g-btn ghost" id="a-toggle">' + (c.open ? 'Tutup challenge' : 'Buka lagi') + '</button>' +
      '</div>' +
      '<div class="g-meta" style="margin-top:8px;color:var(--fg-mute)">' +
        'Tautan undangan diperlukan peserta untuk mengirim karya. Menerbitkan yang baru ' +
        'akan mematikan tautan lama.' +
      '</div>' +
    '</div>';
  }

  function bindAdmin(c) {
    var out = document.getElementById('a-invite');
    var rot = document.getElementById('a-rotate');
    var tog = document.getElementById('a-toggle');

    rot.addEventListener('click', function () {
      if (!global.confirm('Terbitkan tautan undangan baru? Tautan lama langsung tidak berlaku.')) return;
      rot.disabled = true;
      api('POST', '/api/challenges/' + encodeURIComponent(c.slug) + '/invite')
        .then(function (d) {
          out.value = global.location.origin + '/?c=' + c.slug + '&k=' + d.inviteToken;
          out.select();
        })
        .catch(function (e) { global.alert(e.message); })
        .then(function () { rot.disabled = false; });
    });

    tog.addEventListener('click', function () {
      tog.disabled = true;
      api('PATCH', '/api/challenges/' + encodeURIComponent(c.slug), { open: !c.open })
        .then(function () { global.location.reload(); })
        .catch(function (e) { global.alert(e.message); tog.disabled = false; });
    });
  }

  /* ------------------------------------------------------------- rute -- */

  function route() {
    var m = global.location.pathname.match(/^\/c\/([^/]+)/);
    var slug = m ? decodeURIComponent(m[1]) : '';
    var sid = new URLSearchParams(global.location.search).get('s');

    if (!slug) return viewList();
    if (sid) return viewSubmission(slug, sid);
    viewChallenge(slug);
  }

  route();

  global.Gallery = { drawPlan: drawPlan, route: route };
})(window);
