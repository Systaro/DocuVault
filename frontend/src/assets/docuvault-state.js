/**
 * DocuVault State Library
 *
 * Allows static HTML files hosted in DocuVault to read and persist state
 * via the DocuVault API, committed back to Git as a companion JSON file.
 *
 * Usage:
 *   <script src="/assets/docuvault-state.js"></script>
 *   <script>
 *     DocuVaultState.init({
 *       spaceId: 'a4100e58-e5ec-4cb3-a304-5d04d963dc47',
 *       stateFile: 'my-module/my-form.json'
 *     });
 *   </script>
 *
 *   const state = await DocuVaultState.ready();
 *   state.get('key');
 *   state.set('key', 'value');
 *   await state.save();
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'docuvault_api_token';
  var API_BASE = '/api';

  var _config = null;
  var _readyPromise = null;
  var _data = {};
  var _contentHash = null;

  // --- Auth helpers ---

  function getToken() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function storeToken(token) {
    try { localStorage.setItem(STORAGE_KEY, token); } catch (e) { /* ignore */ }
  }

  function clearToken() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  function promptForToken() {
    var token = window.prompt(
      'Enter your DocuVault API token to save state.\n\nYou can create one under Account \u2192 API Tokens.'
    );
    if (!token || !token.trim()) {
      return Promise.reject(new Error('DocuVault API token is required to save state.'));
    }
    token = token.trim();
    storeToken(token);
    return Promise.resolve(token);
  }

  function ensureToken() {
    var token = getToken();
    if (token) return Promise.resolve(token);
    return promptForToken();
  }

  // --- URL helpers ---

  function encodePath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  function documentUrl(spaceId, stateFile) {
    return API_BASE + '/spaces/' + spaceId + '/documents/' + encodePath(stateFile);
  }

  function documentsUrl(spaceId) {
    return API_BASE + '/spaces/' + spaceId + '/documents';
  }

  // --- Load ---

  function load() {
    var spaceId = _config.spaceId;
    var stateFile = _config.stateFile;
    var url = documentUrl(spaceId, stateFile);
    var headers = { 'Accept': 'application/json' };
    var token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    return fetch(url, { headers: headers })
      .then(function (res) {
        if (res.status === 404) {
          _data = {};
          _contentHash = null;
          return;
        }
        if (res.status === 401 || res.status === 403) {
          // Auth failure on read — clear bad token but start with empty state
          clearToken();
          _data = {};
          _contentHash = null;
          return;
        }
        if (!res.ok) {
          throw new Error('DocuVaultState: failed to load state (' + res.status + ' ' + res.statusText + ')');
        }
        return res.json().then(function (doc) {
          _contentHash = doc.contentHash || null;
          try {
            _data = JSON.parse(doc.content);
            if (typeof _data !== 'object' || _data === null || Array.isArray(_data)) {
              _data = {};
            }
          } catch (e) {
            _data = {};
          }
        });
      })
      .catch(function (err) {
        // Network error or unexpected failure — start with empty state so the page still works
        console.warn('DocuVaultState: could not load state, starting empty.', err);
        _data = {};
        _contentHash = null;
      });
  }

  // --- State handle ---

  var stateHandle = {
    /**
     * Returns the current in-memory value for key.
     */
    get: function (key) {
      return _data[key];
    },

    /**
     * Returns a shallow copy of the full state object.
     */
    getAll: function () {
      return Object.assign({}, _data);
    },

    /**
     * Sets key to value in memory. Does not persist until save() is called.
     */
    set: function (key, value) {
      _data[key] = value;
    },

    /**
     * Removes key from memory. Does not persist until save() is called.
     */
    remove: function (key) {
      delete _data[key];
    },

    /**
     * PUTs the full state JSON to DocuVault with autoCommit: true.
     * Creates the companion JSON file if it does not exist yet.
     * Prompts for an API token on first call if none is stored.
     * @returns {Promise<void>}
     */
    save: function () {
      if (!_config) {
        return Promise.reject(new Error('DocuVaultState not initialized. Call init() first.'));
      }

      var spaceId = _config.spaceId;
      var stateFile = _config.stateFile;
      var content = JSON.stringify(_data, null, 2);

      return ensureToken().then(function (token) {
        var authHeader = 'Bearer ' + token;

        // Try PUT (update existing)
        return fetch(documentUrl(spaceId, stateFile), {
          method: 'PUT',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ content: content, autoCommit: true })
        }).then(function (res) {
          if (res.status === 404) {
            // File doesn't exist yet — create it
            return fetch(documentsUrl(spaceId), {
              method: 'POST',
              headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ path: stateFile, content: content, autoCommit: true })
            });
          }
          return res;
        }).then(function (res) {
          if (res.status === 401 || res.status === 403) {
            clearToken();
            throw new Error('Invalid or expired API token. Please try saving again.');
          }
          if (!res.ok) {
            return res.text().then(function (body) {
              throw new Error('DocuVaultState: save failed (' + res.status + '): ' + body);
            });
          }
          return res.json().then(function (doc) {
            _contentHash = doc.contentHash || null;
          });
        });
      });
    }
  };

  // --- Public API ---

  var DocuVaultState = {
    /**
     * Must be called once before ready(). Config:
     *   spaceId   {string} — DocuVault space UUID
     *   stateFile {string} — path to the companion JSON within the space
     */
    init: function (config) {
      if (!config || !config.spaceId) throw new Error('DocuVaultState.init: spaceId is required');
      if (!config.stateFile) throw new Error('DocuVaultState.init: stateFile is required');
      _config = config;
      _readyPromise = load();
    },

    /**
     * Returns a Promise that resolves to a state handle once the initial
     * load from the API completes. Always safe to await multiple times.
     * @returns {Promise<stateHandle>}
     */
    ready: function () {
      if (!_readyPromise) {
        return Promise.reject(new Error('DocuVaultState not initialized. Call init() first.'));
      }
      return _readyPromise.then(function () { return stateHandle; });
    },

    /**
     * Clears the stored API token. The next save() call will re-prompt.
     */
    clearToken: clearToken
  };

  global.DocuVaultState = DocuVaultState;

}(typeof window !== 'undefined' ? window : this));
