/* layout3d — bootstrap */
(function () {
  'use strict';

  function fail(msg) {
    var box = document.getElementById('dep-error');
    document.getElementById('dep-error-msg').textContent = msg;
    box.hidden = false;
    console.error('[layout3d]', msg);
  }

  function seedDemo() {
    var u = Project.unit();
    var list = Shapes.createPreset('p-rumah', u, 0, 0);
    Project.add(list, { nohistory: true });
    Project.setSelection([]);
  }

  function boot() {
    if (typeof Konva === 'undefined') return fail('Konva.js tidak termuat.');
    if (typeof THREE === 'undefined') return fail('Three.js tidak termuat.');

    document.body.setAttribute('data-view', 'split');

    var restored = false;
    try { restored = Project.restoreAutosave(); }
    catch (e) { console.warn('[layout3d] restore gagal:', e); }

    try {
      Editor2D.init('stage-2d');
      Viewer3D.init('c3d');
      UI.init();
    } catch (e) {
      return fail('Gagal inisialisasi: ' + e.message);
    }

    if (!restored || !Project.shapes.length) {
      seedDemo();
      UI.say('Contoh "Rumah" dimuat. Klik item di panel kiri untuk menambah objek.');
    } else {
      UI.say('Project terakhir dipulihkan (' + Project.shapes.length + ' objek).');
    }

    UI.syncToolbarFromProject();
    // tunggu layout final dulu, baru fit (ukuran pane belum pasti saat boot)
    setTimeout(function () {
      Editor2D.resize();
      Viewer3D.resize();
      Editor2D.fit();
      Viewer3D.fit();
    }, 80);

    // resize responsif
    var ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(function () { Editor2D.resize(); Viewer3D.resize(); });
      ro.observe(document.getElementById('pane-2d'));
      ro.observe(document.getElementById('pane-3d'));
    }
    window.addEventListener('resize', function () { Editor2D.resize(); Viewer3D.resize(); });

    console.log('[layout3d] siap. Shape types:', Object.keys(Shapes.DEFS).length,
                '| presets:', Shapes.PRESETS.length);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
