// שמירה בזיכרון של הדפדפן (IndexedDB).
// songs: פרטי כל שיר (קצב, סמנים, רשימות ההקלטות). audio: הצליל עצמו, כל מערך פעם אחת לפי מזהה.
(function (root) {
  'use strict';
  var DB_NAME = 'bli-ozniyot', db = null;

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function () {
        var d = rq.result;
        if (!d.objectStoreNames.contains('songs')) d.createObjectStore('songs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('audio')) d.createObjectStore('audio');
      };
      rq.onsuccess = function () { db = rq.result; res(db); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function tx(store, mode, fn) {
    return open().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), st = t.objectStore(store), out;
        out = fn(st);
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error); };
      });
    });
  }

  var api = {
    putSong: function (meta) { return tx('songs', 'readwrite', function (s) { s.put(meta); }); },
    getSong: function (id) { return tx('songs', 'readonly', function (s) { return s.get(id); }); },
    allSongs: function () { return tx('songs', 'readonly', function (s) { return s.getAll(); }); },
    deleteSong: function (id) { return tx('songs', 'readwrite', function (s) { s.delete(id); }); },
    putAudio: function (id, arr) { return tx('audio', 'readwrite', function (s) { s.put(arr, id); }); },
    getAudio: function (id) { return tx('audio', 'readonly', function (s) { return s.get(id); }); },
    deleteAudio: function (ids) { return tx('audio', 'readwrite', function (s) { ids.forEach(function (id) { s.delete(id); }); }); },
    persist: function () { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {} },
    newId: function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  };
  root.Store = api;
})(this);
