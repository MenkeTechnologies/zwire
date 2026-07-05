/* zwire HUD — the keybinding registry (single source of truth).
 * Loaded as a content script before zvim/zpalette/zfind AND by the Keyboard
 * settings page (pages/keys.html), so both render/dispatch from the same list.
 * User remaps live in chrome.storage.local 'zb_keys' as { <action>: <key> };
 * the content scripts merge those over the defaults below. */
(function () {
  'use strict';
  window.ZWIRE_KEYMAP = {
    // action name -> { def: default key, label, cat }
    categories: [
      { id: 'scroll', label: 'Scroll', actions: [
        { name: 'scrollDown', def: 'j', label: 'Scroll down' },
        { name: 'scrollUp', def: 'k', label: 'Scroll up' },
        { name: 'scrollLeft', def: 'h', label: 'Scroll left' },
        { name: 'scrollRight', def: 'l', label: 'Scroll right' },
        { name: 'halfDown', def: 'd', label: 'Half-page down' },
        { name: 'halfUp', def: 'u', label: 'Half-page up' },
        { name: 'bottom', def: 'G', label: 'Bottom of page' },
        { name: 'top', def: 'H', label: 'Top of document' },
        { name: 'middle', def: 'M', label: 'Middle of document' },
        { name: 'low', def: 'L', label: 'Bottom of document' }
      ] },
      { id: 'tabs', label: 'Tabs & history', actions: [
        { name: 'prevTab', def: 'J', label: 'Previous tab' },
        { name: 'nextTab', def: 'K', label: 'Next tab' },
        { name: 'closeTab', def: 'x', label: 'Close tab' },
        { name: 'newTab', def: 't', label: 'New tab' },
        { name: 'reload', def: 'r', label: 'Reload page' },
        { name: 'histBack', def: '[', label: 'History back' },
        { name: 'histFwd', def: ']', label: 'History forward' }
      ] },
      { id: 'jump', label: 'Jump & hints', actions: [
        { name: 'hint', def: 'f', label: 'Link hints (click)' },
        { name: 'hintNewTab', def: 'F', label: 'Link hints (new tab)' },
        { name: 'gPrefix', def: 'g', label: 'g-prefix (gg / gt / gT / gi)' },
        { name: 'zPrefix', def: 'z', label: 'z-prefix (zt / zz / zb)' },
        { name: 'yPrefix', def: 'y', label: 'y-prefix (yy — yank URL)' },
        { name: 'setMark', def: 'm', label: 'Set mark (m<x>)' },
        { name: 'jumpMark', def: '`', label: 'Jump to mark (`<x>)' }
      ] },
      { id: 'launch', label: 'Palette & find', actions: [
        { name: 'palette', def: 'o', label: 'Command palette' },
        { name: 'paletteColon', def: ':', label: 'Command palette (:)' },
        { name: 'find', def: '/', label: 'Find in page' },
        { name: 'vimToggle', def: '\\', label: 'Toggle vim off (Ctrl/⌘+\\ re-enables)' }
      ] },
      // tmux overlay — each is the key pressed AFTER the C-b (or ⌥b) prefix.
      { id: 'tmux', label: 'Tmux (C-b then…)', actions: [
        { name: 'tmux-split-h', def: '%', label: 'Split pane right' },
        { name: 'tmux-split-v', def: '"', label: 'Split pane down' },
        { name: 'tmux-pane-next', def: 'o', label: 'Next pane' },
        { name: 'tmux-pane-last', def: ';', label: 'Last (previous) pane' },
        { name: 'tmux-zoom', def: 'z', label: 'Zoom pane' },
        { name: 'tmux-close', def: 'x', label: 'Close pane' },
        { name: 'tmux-swap-prev', def: '{', label: 'Swap pane ←' },
        { name: 'tmux-swap-next', def: '}', label: 'Swap pane →' },
        { name: 'tmux-rotate', def: 'O', label: 'Rotate panes' },
        { name: 'tmux-break', def: '!', label: 'Break pane to new window' },
        { name: 'tmux-pane-nums', def: 'q', label: 'Show pane numbers' },
        { name: 'tmux-layout', def: ' ', label: 'Cycle layout' },
        { name: 'tmux-win-new', def: 'c', label: 'New window' },
        { name: 'tmux-win-next', def: 'n', label: 'Next window' },
        { name: 'tmux-win-prev', def: 'p', label: 'Previous window' },
        { name: 'tmux-win-last', def: 'l', label: 'Last window' },
        { name: 'tmux-win-rename', def: ',', label: 'Rename window' },
        { name: 'tmux-win-move', def: '.', label: 'Move / renumber window' },
        { name: 'tmux-win-goto', def: "'", label: 'Go to window (prompt)' },
        { name: 'tmux-win-list', def: 'w', label: 'Window list' },
        { name: 'tmux-win-kill', def: '&', label: 'Kill window' },
        { name: 'tmux-mark', def: 'm', label: 'Mark pane / swap with marked' },
        { name: 'tmux-sync', def: 'e', label: 'Synchronize panes (all on / off)' },
        { name: 'tmux-sync-pane', def: 'E', label: 'Toggle this pane in the sync group' },
        { name: 'tmux-copy-mode', def: '[', label: 'Copy mode (scroll + yank selection)' },
        { name: 'tmux-paste', def: ']', label: 'Paste buffer (most recent)' },
        { name: 'tmux-buffers', def: '=', label: 'Choose paste buffer' },
        { name: 'tmux-reload', def: 'r', label: 'Reload pane' },
        { name: 'tmux-clock', def: 't', label: 'Clock' },
        { name: 'tmux-palette', def: ':', label: 'Command palette' },
        { name: 'tmux-detach', def: 'd', label: 'Detach (hide overlay)' },
        { name: 'tmux-sessions', def: 's', label: 'Sessions (save / load / manage)' },
        { name: 'tmux-session-save', def: 'S', label: 'Save current layout as a session' },
        { name: 'tmux-help', def: '?', label: 'Help' }
      ] }
    ],
    // Global chorded hotkeys (modifier + key). Editable key is the letter; the
    // ⌘/Ctrl modifier is fixed. Consumed by zpalette.js / zfind.js.
    global: [
      { name: 'openPalette', def: 'k', mod: '⌘/Ctrl', label: 'Open command palette' },
      { name: 'openFind', def: 'f', mod: '⌘/Ctrl', label: 'Open find bar' }
    ],
    // Fixed, not remappable here (owned by the native fork).
    native: [
      { name: 'tmuxPrefix', def: 'Ctrl-b', label: 'tmux split prefix (then % " o { } x)' }
    ]
  };
})();
