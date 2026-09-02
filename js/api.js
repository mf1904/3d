/* layout3d — klien API penyimpanan server
 *
 * Semua path RELATIF ('api/...' bukan '/api/...'), supaya aplikasi tetap jalan
 * baik di root domain maupun di dalam sub-folder.
 *
 * Backend bersifat opsional: kalau aplikasi di-deploy sebagai file statis saja,
 * probe() gagal dan seluruh fitur server disembunyikan — aplikasi tetap penuh
 * fungsi dengan localStorage.
 */
(function (global) {
  'use strict';

  var state = {
    checked: false,     // probe sudah dijalankan?
    available: false,   // ada backend-nya?
    configured: false,  // password server sudah diset?
    authed: false       // sesi login aktif?
  };

  function url(path) { return 'api/' + path; }

  function request(method, path, body) {
    var opts = {
      method: method,
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url(path), opts).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* bukan JSON */ }
        if (!res.ok) {
          if (res.status === 401) state.authed = false;
          var err = new Error((data && data.error) || ('Server menjawab ' + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  /** Cek sekali apakah backend tersedia. Tidak pernah melempar. */
  function probe() {
    return request('GET', 'me').then(function (d) {
      state.checked = true;
      state.available = true;
      state.configured = !!(d && d.configured);
      state.authed = !!(d && d.authed);
      return state;
    }).catch(function () {
      state.checked = true;
      state.available = false;
      state.configured = false;
      state.authed = false;
      return state;
    });
  }

  var API = {
    get state() { return state; },
    probe: probe,

    login: function (password) {
      return request('POST', 'login', { password: password }).then(function (d) {
        state.authed = true;
        state.configured = true;
        return d;
      });
    },

    logout: function () {
      return request('POST', 'logout').then(function (d) {
        state.authed = false;
        return d;
      });
    },

    list: function () {
      return request('GET', 'projects').then(function (d) { return d.projects || []; });
    },

    load: function (id) {
      return request('GET', 'projects/' + encodeURIComponent(id))
        .then(function (d) { return d.project; });
    },

    save: function (name, data, id) {
      return request('POST', 'projects', { name: name, data: data, id: id })
        .then(function (d) { return d.project; });
    },

    remove: function (id) {
      return request('DELETE', 'projects/' + encodeURIComponent(id));
    }
  };

  global.API = API;
})(window);
