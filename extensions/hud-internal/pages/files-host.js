/* zwire HUD — FILES: the `window.zfbHost` backend for the shared file browser.
 *
 * lib/file-browser/webui/file-browser.js is host-agnostic: it calls
 * `window.zfbHost.<method>(...)` and ships default bridges for Tauri and JUCE.
 * zwire is neither — it is a Chromium extension page, and its backend is
 * zwire-host over native messaging. So this installs zwire's own bridge, which
 * must be loaded BEFORE file-browser.js (the shared file self-guards on an
 * existing `window.zfbHost` and skips its Tauri default when one is present).
 *
 * Every method maps to one `fs_*` command in zwire-host/src/fsx.rs, using the
 * snake_case argument names that module's dispatcher reads — the same names the
 * JUCE shim uses, since both speak raw JSON rather than Tauri's camelCase
 * parameter mapping. Replies are the host envelope `{ok, data}` / `{ok, err}`;
 * `fb` unwraps `data` and rejects on `err`, which is the contract the shared
 * browser expects (it awaits a value and catches a throw).
 *
 * Transport is ONE persistent connectNative port for the whole page rather than
 * per-call sendNativeMessage: a directory listing fans out into a stat/size/git
 * call per row, and sendNativeMessage spawns a fresh host process every time.
 * Requests carry an incrementing `id`; zwire-host stamps it back onto the reply
 * (proto.rs `respond`), so concurrent calls demultiplex correctly.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.zfbHost) return;
  var HOST = 'com.zwire.hud';

  var port = null, nextId = 1, pending = Object.create(null);

  function disconnected(reason) {
    port = null;
    // Fail every in-flight call rather than leaving the UI spinning forever.
    Object.keys(pending).forEach(function (id) {
      var p = pending[id];
      delete pending[id];
      p.reject(new Error(reason));
    });
  }

  function ensurePort() {
    if (port) return port;
    port = chrome.runtime.connectNative(HOST);
    port.onMessage.addListener(function (msg) {
      if (!msg || msg.id == null) return;          // streamed event frame, not a reply
      var p = pending[msg.id];
      if (!p) return;
      delete pending[msg.id];
      if (msg.ok === false) p.reject(new Error(msg.err || 'zwire-host: call failed'));
      else p.resolve(msg.data);
    });
    port.onDisconnect.addListener(function () {
      var e = chrome.runtime.lastError;
      disconnected((e && e.message) || 'zwire-host disconnected');
    });
    return port;
  }

  /* One host call. `args` keys are the snake_case names fsx.rs reads. */
  function fb(cmd, args) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      var req = { cmd: cmd, id: id };
      if (args) Object.keys(args).forEach(function (k) {
        // Drop undefined so an omitted optional argument stays absent rather
        // than arriving as JSON null (which fsx.rs would read as "wrong type").
        if (args[k] !== undefined) req[k] = args[k];
      });
      pending[id] = { resolve: resolve, reject: reject };
      try { ensurePort().postMessage(req); }
      catch (e) { delete pending[id]; reject(e instanceof Error ? e : new Error(String(e))); }
    });
  }

  /* `fs_read_head_bytes` crosses the JSON pipe as a number array; the sniffing
   * code in file-browser.js wants real bytes. */
  function toBytes(data) { return Array.isArray(data) ? Uint8Array.from(data) : data; }

  /* `fs_read_file_base64` returns standard base64, matching the Tauri/JUCE shims. */
  window.zfbHost = {
    /* ── directory / info ── */
    listDirectory: function (dirPath, showHidden) { return fb('fs_list_dir', { dir_path: dirPath, include_hidden: !!showHidden }); },
    fsListSubdirs: function (dirPath, includeHidden) { return fb('fs_list_subdirs', { dir_path: dirPath, include_hidden: !!includeHidden }); },
    fsFolderSize: function (folderPath, timeoutMs) { return fb('fs_folder_size', { folder_path: folderPath, timeout_ms: timeoutMs }); },
    fsGetInfo: function (path) { return fb('fs_get_info', { path: path }); },
    fsDiskUsage: function (path) { return fb('fs_disk_usage', { path: path }); },
    fsXattrs: function (path) { return fb('fs_xattrs', { path: path }); },
    fsGitStatus: function (dirPath) { return fb('fs_git_status', { dir_path: dirPath }); },

    /* ── mutate ── */
    renameFile: function (oldPath, newPath) { return fb('fs_rename_file', { old_path: oldPath, new_path: newPath }); },
    deleteFile: function (filePath) { return fb('fs_delete_file', { file_path: filePath }); },
    moveToTrash: function (filePath) { return fb('fs_move_to_trash', { file_path: filePath }); },
    fsSecureDelete: function (filePath) { return fb('fs_secure_delete', { file_path: filePath }); },
    fsDuplicate: function (path) { return fb('fs_duplicate', { path: path }); },
    fsCopyPath: function (src, dest) { return fb('fs_copy_path', { src: src, dest: dest }); },
    fsCreateDir: function (dirPath) { return fb('fs_create_dir', { dir_path: dirPath }); },
    fsCreateFile: function (filePath) { return fb('fs_create_file', { file_path: filePath }); },
    fsTouch: function (filePath) { return fb('fs_touch', { file_path: filePath }); },
    fsChmod: function (path, modeOctal) { return fb('fs_chmod', { path: path, mode_octal: modeOctal }); },
    fsSymlinkRetarget: function (path, newTarget) { return fb('fs_symlink_retarget', { path: path, new_target: newTarget }); },

    /* ── read ── */
    fsReadFileBase64: function (filePath, maxBytes) { return fb('fs_read_file_base64', { file_path: filePath, max_bytes: maxBytes }); },
    fsReadHead: function (filePath, maxBytes) { return fb('fs_read_head', { file_path: filePath, max_bytes: maxBytes }); },
    fsReadHeadBytes: function (filePath, maxBytes) { return fb('fs_read_head_bytes', { file_path: filePath, max_bytes: maxBytes }).then(toBytes); },

    /* ── search / compare / archive / hash ── */
    fsGrep: function (root, needle, caseInsensitive, maxResults) {
      return fb('fs_grep', { root: root, needle: needle, case_insensitive: !!caseInsensitive, max_results: maxResults });
    },
    fsFindDuplicates: function (dir, recursive, minSizeBytes) {
      return fb('fs_find_duplicates', { dir: dir, recursive: !!recursive, min_size_bytes: minSizeBytes });
    },
    fsCompareDirs: function (dirA, dirB) { return fb('fs_compare_dirs', { dir_a: dirA, dir_b: dirB }); },
    fsDiff: function (pathA, pathB) { return fb('fs_diff', { path_a: pathA, path_b: pathB }); },
    fsHash: function (path, algos) { return fb('fs_hash', { path: path, algos: algos }); },
    fsCompress: function (paths, archivePath) { return fb('fs_compress', { paths: paths, archive_path: archivePath }); },
    fsExtract: function (archivePath, destDir) { return fb('fs_extract', { archive_path: archivePath, dest_dir: destDir }); },

    /* ── open / run ── */
    // "Open Terminal" opens ZWIRE's OWN terminal — the HUD terminal tab, PTY-backed
    // by this same host — at that directory, rather than launching the platform's
    // terminal application. `?cd=` is read by pages/terminal-boot.js.
    fsOpenTerminal: function (folderPath) {
      return new Promise(function (resolve, reject) {
        try {
          chrome.tabs.create({ url: chrome.runtime.getURL('pages/terminal.html') + '?cd=' + encodeURIComponent(folderPath) },
            function () { var e = chrome.runtime.lastError; if (e) reject(new Error(e.message)); else resolve(folderPath); });
        } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
      });
    },
    // Default-application open, via the host's existing `open` verb — which takes
    // `target` and replies without a `data` field (osops.rs), so this resolves
    // undefined on success and rejects with the host's error otherwise.
    openFileDefault: function (path) { return fb('open', { target: path }); },

    /* ── host helpers ── */
    getHomeDir: function () { return fb('fs_home_dir', {}); },
    // The "App data" button navigates to this file's PARENT, so returning zwire's
    // own global config file lands the browser in ~/.zwire.
    getPrefsPath: function () {
      return fb('fs_home_dir', {}).then(function (home) {
        return String(home || '').replace(/[/\\]+$/, '') + '/.zwire/global.toml';
      });
    },

    /* ── directory watch ──
     * zwire-host does stream directory changes (`fs_watch`), but the shared
     * browser has no host-event channel wired on any backend — the Tauri and
     * JUCE shims both resolve this as a no-op and let the user refresh. Matching
     * that keeps behaviour identical across the fleet; wiring a live watcher is
     * a change to the shared browser, not to this bridge. */
    fbWatcherSet: function (dir) { return Promise.resolve(dir); },
  };
})();
