/**
 * DocuVault State Library
 *
 * Allows static HTML files hosted in DocuVault to read and persist state
 * via the DocuVault Space State API (database-backed, no Git commits).
 *
 * Usage:
 *   <script src="/assets/docuvault-state.js"></script>
 *   <script>
 *     DocuVaultState.init({
 *       spaceId: 'a4100e58-e5ec-4cb3-a304-5d04d963dc47',
 *       key: 'my-form'        // arbitrary identifier for this state bucket
 *     });
 *   </script>
 *
 *   const state = await DocuVaultState.ready();
 *   state.get('assignee');
 *   state.set('assignee', 'Anna');
 *   await state.save();
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'docuvault_api_token';
  var API_BASE = '/api';

  var _config = null;
  var _readyPromise = null;
  var _data = {};

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

  // --- URL helper ---

  function stateUrl() {
    return API_BASE + '/spaces/' + _config.spaceId + '/state/' + encodeURIComponent(_config.key);
  }

  // --- Load ---

  function load() {
    var url = stateUrl();
    var headers = { 'Accept': 'application/json' };
    var token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    return fetch(url, { headers: headers })
      .then(function (res) {
        if (res.status === 404) {
          _data = {};
          return;
        }
        if (res.status === 401 || res.status === 403) {
          clearToken();
          _data = {};
          return;
        }
        if (!res.ok) {
          throw new Error('DocuVaultState: failed to load state (' + res.status + ' ' + res.statusText + ')');
        }
        return res.json().then(function (entry) {
          try {
            _data = JSON.parse(entry.value);
            if (typeof _data !== 'object' || _data === null || Array.isArray(_data)) {
              _data = {};
            }
          } catch (e) {
            _data = {};
          }
        });
      })
      .catch(function (err) {
        console.warn('DocuVaultState: could not load state, starting empty.', err);
        _data = {};
      });
  }

  // --- State handle ---

  var stateHandle = {
    /** Returns the current in-memory value for key. */
    get: function (key) {
      return _data[key];
    },

    /** Returns a shallow copy of the full state object. */
    getAll: function () {
      return Object.assign({}, _data);
    },

    /** Sets key to value in memory. Does not persist until save() is called. */
    set: function (key, value) {
      _data[key] = value;
    },

    /** Removes key from memory. Does not persist until save() is called. */
    remove: function (key) {
      delete _data[key];
    },

    /**
     * Persists the current state to DocuVault via the Space State API.
     * Prompts for an API token on first call if none is stored.
     * @returns {Promise<void>}
     */
    save: function () {
      if (!_config) {
        return Promise.reject(new Error('DocuVaultState not initialized. Call init() first.'));
      }

      return ensureToken().then(function (token) {
        return fetch(stateUrl(), {
          method: 'PUT',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ value: JSON.stringify(_data) })
        });
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
      });
    }
  };

  // --- Public API ---

  var DocuVaultState = {
    /**
     * Must be called once before ready(). Config:
     *   spaceId {string} — DocuVault space UUID
     *   key     {string} — identifier for this state bucket (e.g. 'my-form')
     */
    init: function (config) {
      if (!config || !config.spaceId) throw new Error('DocuVaultState.init: spaceId is required');
      if (!config.key) throw new Error('DocuVaultState.init: key is required');
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

    /** Clears the stored API token. The next save() call will re-prompt. */
    clearToken: clearToken
  };

  global.DocuVaultState = DocuVaultState;

}(typeof window !== 'undefined' ? window : this));
