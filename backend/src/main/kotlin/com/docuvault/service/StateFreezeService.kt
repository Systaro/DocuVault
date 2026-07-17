package com.docuvault.service

import com.docuvault.infrastructure.repository.SpaceStateRepository
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.*

/**
 * Produces "frozen" exports of HTML files that use the DocuVault State Library
 * (assets/docuvault-state.js). The current state of every referenced state key
 * is snapshotted and embedded into the HTML as a self-contained DocuVaultState
 * shim, so the exported file works standalone (offline, outside DocuVault).
 * save() is disabled in the shim — the export is read-only by design.
 */
@Service
class StateFreezeService(
    private val spaceStateRepository: SpaceStateRepository,
    private val objectMapper: ObjectMapper
) {

    companion object {
        // Matches DocuVaultState.init({ ... }) — the config object is flat (spaceId, key, token)
        private val INIT_REGEX = Regex("""DocuVaultState\s*\.\s*init\s*\(\s*\{([^}]*)\}""")
        private val KEY_REGEX = Regex("""\bkey\s*:\s*['"]([^'"]+)['"]""")
        private val LIB_SCRIPT_REGEX = Regex(
            """<script[^>]*\bsrc\s*=\s*["'][^"']*docuvault-state(\.min)?\.js[^"']*["'][^>]*>\s*</script>""",
            RegexOption.IGNORE_CASE
        )
        private val HEAD_REGEX = Regex("""<head[^>]*>""", RegexOption.IGNORE_CASE)
    }

    /** Returns the state keys referenced by DocuVaultState.init() calls in the HTML. */
    fun detectStateKeys(html: String): List<String> =
        INIT_REGEX.findAll(html)
            .mapNotNull { init -> KEY_REGEX.find(init.groupValues[1])?.groupValues?.get(1) }
            .distinct()
            .toList()

    /**
     * Returns the HTML with the state library replaced by a frozen, self-contained
     * shim carrying the current state snapshot — or null if the file does not use
     * the DocuVault State Library at all.
     */
    @Transactional(readOnly = true)
    fun freezeHtml(html: String, spaceId: UUID): String? {
        val keys = detectStateKeys(html)
        if (keys.isEmpty()) return null

        val snapshots = keys.associateWith { key ->
            val raw = spaceStateRepository.findBySpaceIdAndKey(spaceId, key)?.value
            parseStateObject(raw)
        }

        val shim = buildShim(snapshots, Instant.now())
        val withoutLib = LIB_SCRIPT_REGEX.replace(html, "")

        val headMatch = HEAD_REGEX.find(withoutLib)
        return if (headMatch != null) {
            val insertAt = headMatch.range.last + 1
            withoutLib.substring(0, insertAt) + shim + withoutLib.substring(insertAt)
        } else {
            shim + withoutLib
        }
    }

    /** Parses a stored state value into a JSON object node; falls back to {} on anything invalid. */
    private fun parseStateObject(raw: String?): Any {
        if (raw.isNullOrBlank()) return emptyMap<String, Any>()
        return try {
            val node = objectMapper.readTree(raw)
            if (node.isObject) objectMapper.treeToValue(node, Map::class.java) else emptyMap<String, Any>()
        } catch (e: Exception) {
            emptyMap<String, Any>()
        }
    }

    private fun buildShim(snapshots: Map<String, Any>, frozenAt: Instant): String {
        val snapshotJson = objectMapper.writeValueAsString(snapshots)
            // Prevent embedded strings from terminating the script block / opening HTML comments
            .replace("</", "<\\/")
            .replace("<!--", "<\\u0021--")

        return """
<script>
/* DocuVault frozen state export — generated $frozenAt. State is a read-only snapshot. */
(function (global) {
  'use strict';
  var FROZEN_AT = '$frozenAt';
  var SNAPSHOTS = $snapshotJson;
  var _data = {};
  var _ready = null;
  var stateHandle = {
    get: function (key) { return _data[key]; },
    getAll: function () { return Object.assign({}, _data); },
    set: function (key, value) { _data[key] = value; },
    remove: function (key) { delete _data[key]; },
    save: function () {
      return Promise.reject(new Error(
        'This file is a frozen DocuVault export from ' + FROZEN_AT + '. Changes are not persisted.'
      ));
    }
  };
  global.DocuVaultState = {
    frozen: true,
    frozenAt: FROZEN_AT,
    init: function (config) {
      if (!config || !config.key) throw new Error('DocuVaultState.init: key is required');
      var snap = SNAPSHOTS[config.key];
      _data = (snap && typeof snap === 'object' && !Array.isArray(snap)) ? snap : {};
      _ready = Promise.resolve(stateHandle);
    },
    ready: function () {
      if (!_ready) return Promise.reject(new Error('DocuVaultState not initialized. Call init() first.'));
      return _ready;
    },
    clearToken: function () {}
  };
}(typeof window !== 'undefined' ? window : this));
</script>"""
    }
}
