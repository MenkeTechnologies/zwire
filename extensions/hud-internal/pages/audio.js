/* zwire HUD — Audio. An audio dashboard built entirely from zgui-core audio components, with two
 * jobs:
 *
 *  1. CONTROL the real browser-wide EQ. The parametric EQ + preamp are serialized to a spec string
 *     and persisted to $STATE/audio-eq via the native host; bin/zwire exports it as ZWIRE_AUDIO_EQ,
 *     and fork patch 0022 (AudioRendererMixer::Render) applies that exact RBJ-biquad cascade to ALL
 *     page audio. So the on-screen curve is what every tab's audio is shaped by — no per-element
 *     hook, no gesture, no CORS/DRM taint. (Takes effect on the fork build; saved across launches.)
 *
 *  2. PREVIEW + ANALYZE locally. A local Web Audio graph runs a chosen source (file / mic / pink
 *     noise / tone) through the same EQ/gain/compressor so you can hear and meter the curve here:
 *       source ─▶ inputGain ─▶ [5-band biquad EQ] ─▶ compressor ─▶ pan ─▶ master ─▶ analyser ─▶ out
 *     driving a full instrument wall — spectrum, spectrogram, oscilloscope, goniometer, correlation,
 *     LUFS, peak, VU, gain-reduction. Every widget is ZGui.* per the zgui-core-only rule. */
(function () {
  'use strict';
  var Z = window.ZGui;
  var HOST = (window.ZBHUD && window.ZBHUD.HOST) || 'com.zwire.hud';

  /* ---------------------------------------------------------------- layout css (arrangement only) */
  (function css() {
    if (document.getElementById('az-css')) return;
    var s = document.createElement('style'); s.id = 'az-css';
    s.textContent = [
      '.az-grid{display:grid;gap:16px;grid-template-columns:minmax(0,1fr) 320px;align-items:start;}',
      '.az-col{display:flex;flex-direction:column;gap:16px;min-width:0;}',
      '.az-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;}',
      '.az-row .az-spacer{flex:1;}',
      '.az-eqwrap{position:relative;}',
      '.az-canvas{width:100%;border-radius:4px;display:block;background:#06060e;}',
      '.az-knobs{display:flex;flex-wrap:wrap;gap:22px;align-items:flex-start;}',
      '.az-knob{display:flex;flex-direction:column;align-items:center;gap:4px;}',
      '.az-knob .az-read{font:11px/1.2 var(--mono,monospace);color:var(--accent);letter-spacing:.5px;}',
      '.az-meters{display:flex;gap:14px;align-items:flex-end;justify-content:center;flex-wrap:wrap;}',
      '.az-metercol{display:flex;flex-direction:column;align-items:center;gap:6px;}',
      '.az-metercol .az-cap{font:10px/1 var(--mono,monospace);color:var(--text-dim,#8aa);letter-spacing:1px;text-transform:uppercase;}',
      '.az-presets{display:flex;flex-wrap:wrap;gap:8px;}',
      '.az-note{font:11px/1.4 var(--mono,monospace);color:var(--text-dim,#8aa);margin-top:8px;}',
      '.az-note b{color:var(--accent);}',
      '.az-master{display:flex;justify-content:center;}',
      '@media(max-width:1000px){.az-grid{grid-template-columns:minmax(0,1fr);}}'
    ].join('');
    document.head.appendChild(s);
  })();

  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function toast(m, ty) { try { if (Z.toast && Z.toast.show) Z.toast.show(m, 2600, ty || ''); } catch (e) {} }
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; c.className = 'az-canvas'; return c; }

  /* ---------------------------------------------------------------- EQ model ---------------------- */
  function flat() {
    return [
      { type: 'lowshelf', freq: 80, gain: 0, q: 0.7 },
      { type: 'peaking', freq: 250, gain: 0, q: 1.0 },
      { type: 'peaking', freq: 1000, gain: 0, q: 1.0 },
      { type: 'peaking', freq: 4000, gain: 0, q: 1.0 },
      { type: 'highshelf', freq: 12000, gain: 0, q: 0.7 }
    ];
  }
  var PRESETS = {
    'Flat': [0, 0, 0, 0, 0],
    'Bass Boost': [6, 2, 0, 0, 0],
    'Loudness': [5, 0, -2, 1, 5],
    'Vocal': [-3, -1, 3, 4, 1],
    'Scoop': [3, -1, -5, -1, 3]
  };

  /* ---------------------------------------------------------------- Web Audio engine (local) ----- */
  var ctx = null, inputGain, filters = [], comp, panner, masterGain, analyser, splitter, anL, anR, outGain;
  // tabCapture MUTES the source tab (its audio is redirected into our stream),
  // so the dashboard must play the captured audio back or you hear nothing.
  // Always pass through.
  function updateOutputRouting() { if (outGain) outGain.gain.value = 1; }
  var freqU8, floatL, floatR;
  var activeNode = null, fileEl = null, fileSrc = null, micStream = null, micSrc = null;
  var tabStream = null, tabSrc = null, capturing = false;
  var faderDb = 0, muted = false, preampDb = 0;
  // ENGINE channel-strip state (drives the always-on C++ engine via the spec,
  // NOT the local web-audio preview). Ported from zdsp-core channel_strip.h.
  var engGain = 1.0, engPan = 0.0, engMono = false, engDrive = 0.0;
  var engThresh = 0.0, engRatio = 1.0;  // engine compressor (ratio<=1 = off)
  // ENGINE space & glue (drive the always-on C++ engine): stereo width (M/S),
  // feedback delay/echo, Schroeder reverb, brickwall limiter. Defaults = bypass.
  var engWidth = 1.0;                                  // 1 = normal, 0 = mono, 2 = wide
  var engDelayMs = 0.0, engDelayFb = 0.3, engDelayMix = 0.0;
  var engReverbMix = 0.0, engRoom = 0.5, engDamp = 0.5;
  var engLimit = false, engCeiling = -1.0;             // brickwall limiter (dBFS ceiling)
  var engBypass = false;  // master engine DSP bypass (A/B diff) — writes "off"
  var engMute = false;    // engine master mute (gain 0)
  // ENGINE meter feed — start it FIRST (connect is ~4ms) so meter frames are
  // already flowing by the time the heavy UI finishes building; otherwise the
  // charts sit frozen for ~1s. Functions are hoisted (defined lower down).
  var mf = null, meterPort = null;
  startMeterFeed();

  function ensureCtx() {
    if (ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    inputGain = ctx.createGain();
    filters = flat().map(function (b) {
      var f = ctx.createBiquadFilter();
      f.type = b.type; f.frequency.value = b.freq; f.Q.value = b.q; f.gain.value = b.gain;
      return f;
    });
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24; comp.ratio.value = 4; comp.knee.value = 24;
    comp.attack.value = 0.01; comp.release.value = 0.2;
    panner = ctx.createStereoPanner();
    masterGain = ctx.createGain();
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.75;
    splitter = ctx.createChannelSplitter(2);
    anL = ctx.createAnalyser(); anL.fftSize = 2048;
    anR = ctx.createAnalyser(); anR.fftSize = 2048;
    freqU8 = new Uint8Array(analyser.frequencyBinCount);
    floatL = new Float32Array(anL.fftSize);
    floatR = new Float32Array(anR.fftSize);

    var node = inputGain;
    filters.forEach(function (f) { node.connect(f); node = f; });
    node.connect(comp);
    comp.connect(panner);
    panner.connect(masterGain);
    masterGain.connect(analyser);
    // Output routing: local sources (noise/tone/file/mic) play through to the
    // speakers; a captured TAB is ANALYSIS-ONLY (outGain muted) so the dashboard
    // never re-plays/duplicates the tab — opening or closing this page must not
    // change what you hear. The C++ engine already shapes the real playback.
    outGain = ctx.createGain();
    analyser.connect(outGain);
    outGain.connect(ctx.destination);
    updateOutputRouting();
    masterGain.connect(splitter);
    splitter.connect(anL, 0);
    splitter.connect(anR, 1);
  }

  function syncFilters(bands) {
    bands.forEach(function (b, i) {
      var f = filters[i]; if (!f) return;
      f.type = b.type; f.frequency.value = b.freq; f.Q.value = b.q; f.gain.value = b.gain;
    });
  }

  function knobToGain(v) { return v * 2; }             // 0..1 -> 0..2 (unity at 0.5)
  function gainToDb(g) { return g <= 0.0001 ? -Infinity : 20 * Math.log10(g); }
  function fmtDb(db) { return db === -Infinity ? '−∞' : (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB'; }

  /* ---------------------------------------------------------------- browser-wide EQ persistence --
     Serialize preamp + bands to the ZWIRE_AUDIO_EQ spec and write it (via the native host `exec`
     bus) to the state dir bin/zwire reads. Fork patch 0022 then EQs all browser audio. */
  function buildSpec() {
    if (engBypass) return 'off';  // whole-engine bypass for A/B diff (C++ passes audio through)
    var bands = eq ? eq.get() : flat();
    var parts = [preampDb.toFixed(2)];
    bands.forEach(function (b) { parts.push(b.type + ',' + Math.round(b.freq) + ',' + (+b.gain).toFixed(2) + ',' + (+b.q).toFixed(3)); });
    // Channel-strip directives (only when non-default, keeps the spec tidy).
    var effGain = engMute ? 0 : engGain;
    if (engMute || Math.abs(effGain - 1) > 1e-3) parts.push('gain,' + effGain.toFixed(3));
    if (Math.abs(engPan) > 1e-3) parts.push('pan,' + engPan.toFixed(3));
    if (engMono) parts.push('mono,1');
    if (engDrive > 1e-3) parts.push('drive,' + engDrive.toFixed(3));
    if (engRatio > 1.001) { parts.push('thresh,' + engThresh.toFixed(1)); parts.push('ratio,' + engRatio.toFixed(2)); }
    // Space & glue directives (only when engaged, keeps the spec tidy).
    if (Math.abs(engWidth - 1) > 1e-3) parts.push('width,' + engWidth.toFixed(3));
    if (engDelayMix > 1e-3 && engDelayMs > 0.5) {
      parts.push('delay,' + engDelayMs.toFixed(1));
      parts.push('feedback,' + engDelayFb.toFixed(3));
      parts.push('delaymix,' + engDelayMix.toFixed(3));
    }
    if (engReverbMix > 1e-3) {
      parts.push('reverb,' + engReverbMix.toFixed(3));
      parts.push('room,' + engRoom.toFixed(3));
      parts.push('damp,' + engDamp.toFixed(3));
    }
    if (engLimit) parts.push('ceiling,' + engCeiling.toFixed(2));
    return parts.join(';');
  }
  function stateDirShell() {
    var p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '').toLowerCase();
    return (p.indexOf('mac') >= 0 || p.indexOf('darwin') >= 0)
      ? '"$HOME/Library/Application Support/com.menketechnologies.zwire"'
      : '"${XDG_CONFIG_HOME:-$HOME/.config}/zwire"';
  }
  function showSpec() { if (specReadout) specReadout.textContent = 'ZWIRE_AUDIO_EQ = ' + buildSpec(); }
  var persistTimer = null, hostMissing = false, lastPersist = 0;
  function eqPath() { return metersPath().replace(/\/meters$/, '/audio-eq'); }
  function persistBrowserEq(announce) {
    showSpec();
    // Once we know the native host isn't there, stop hammering it on every EQ
    // drag; only an explicit click (announce) retries and reports.
    if (hostMissing && !announce) return;
    var spec = buildSpec();
    // Fire the audio-eq-changed lifecycle hook on an explicit save only (not on
    // every knob drag, which would spawn a host per move). Background relays it.
    if (announce) { try { chrome.runtime.sendMessage({ type: 'zbFireHook', event: 'audio-eq-changed', payload: { spec: spec } }, function () { void chrome.runtime.lastError; }); } catch (e) {} }
    // FAST path: write the spec over the ALREADY-OPEN persistent meter port with a
    // direct fs_write. The old path did sendNativeMessage (spawns a fresh host
    // process) of an exec of /bin/sh (spawns a subshell) PER knob move — ~30-80ms
    // of spawn jitter on every change, the bulk of the knob→engine lag. Reusing
    // the live pipe + a direct file write is ~1-2ms.
    if (meterPort) {
      try {
        meterPort.postMessage({ id: 'eqw', cmd: 'fs_write', path: eqPath(), text: spec });
        hostMissing = false;
        if (announce) toast('Browser EQ saved → applies to all tabs live (fork build)', 'success');
        return;
      } catch (e) { /* pipe hiccup — fall back to a one-shot below */ }
    }
    // Fallback (port not up yet / mid-reconnect): one-shot native fs_write.
    try {
      chrome.runtime.sendNativeMessage(HOST, { cmd: 'fs_write', path: eqPath(), text: spec }, function (reply) {
        var err = chrome.runtime.lastError;
        if (err && /not found|host/i.test(err.message || '')) hostMissing = true;
        else if (!err) hostMissing = false;
        if (announce) {
          if (err) toast(hostMissing
            ? 'Native host unavailable — the browser-EQ file couldn’t be written. The EQ still previews here; the fork build needs the zwire host installed.'
            : 'Browser EQ save failed: ' + err.message, 'error');
          else toast('Browser EQ saved → applies to all tabs on next launch (fork build)', 'success');
        }
      });
    } catch (e) { hostMissing = true; if (announce) toast('Browser EQ save failed: ' + e, 'error'); }
  }
  // Leading+trailing THROTTLE (~30ms), not a pure debounce: fire immediately on the
  // first move, then at most every 30ms DURING a continuous turn (plus a trailing
  // write). A pure debounce would delay every update until you STOP turning — you'd
  // hear nothing mid-turn. The write is cheap now (fs_write over the live pipe), so
  // a 30ms cadence + the 25ms engine poll makes the knob feel live as you turn.
  function persistDebounced() {
    var now = Date.now(), since = now - lastPersist;
    if (since >= 30) {
      lastPersist = now;
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
      persistBrowserEq(false);
    } else if (!persistTimer) {
      persistTimer = setTimeout(function () { persistTimer = null; lastPersist = Date.now(); persistBrowserEq(false); }, 30 - since);
    }
  }

  // Read the ACTIVE browser EQ back from $STATE/audio-eq (via the native host)
  // and reflect it in the dashboard, so opening the page never resets the curve
  // to flat (which is what clobbered the saved EQ). Parse is the inverse of
  // buildSpec().
  function b64dec(s) { try { return s ? decodeURIComponent(escape(atob(s))) : ''; } catch (e) { try { return s ? atob(s) : ''; } catch (x) { return ''; } } }
  function parseSpec(spec) {
    var parts = String(spec || '').split(';').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) return null;
    var pd = parseFloat(parts[0]); if (isNaN(pd)) pd = 0;
    var bands = [], strip = {
      gain: 1, pan: 0, mono: false, drive: 0, thresh: 0, ratio: 1,
      width: 1, delayMs: 0, delayFb: 0.3, delayMix: 0,
      reverbMix: 0, room: 0.5, damp: 0.5, limit: false, ceiling: -1
    };
    for (var i = 1; i < parts.length; i++) {
      var f = parts[i].split(',');
      if (f.length === 2) {  // channel-strip directive
        var nm = f[0].trim(), val = parseFloat(f[1]);
        if (nm === 'gain' && !isNaN(val)) strip.gain = val;
        else if (nm === 'pan' && !isNaN(val)) strip.pan = val;
        else if (nm === 'mono') strip.mono = (val !== 0);
        else if (nm === 'drive' && !isNaN(val)) strip.drive = val;
        else if (nm === 'thresh' && !isNaN(val)) strip.thresh = val;
        else if (nm === 'ratio' && !isNaN(val)) strip.ratio = val;
        else if (nm === 'width' && !isNaN(val)) strip.width = val;
        else if (nm === 'delay' && !isNaN(val)) strip.delayMs = val;
        else if (nm === 'feedback' && !isNaN(val)) strip.delayFb = val;
        else if (nm === 'delaymix' && !isNaN(val)) strip.delayMix = val;
        else if (nm === 'reverb' && !isNaN(val)) strip.reverbMix = val;
        else if (nm === 'room' && !isNaN(val)) strip.room = val;
        else if (nm === 'damp' && !isNaN(val)) strip.damp = val;
        else if (nm === 'ceiling' && !isNaN(val)) { strip.limit = true; strip.ceiling = val; }
        continue;
      }
      if (f.length < 4) continue;
      var type = f[0].trim();
      if (type !== 'lowshelf' && type !== 'peaking' && type !== 'highshelf') continue;
      var freq = parseFloat(f[1]), gain = parseFloat(f[2]), q = parseFloat(f[3]);
      if (isNaN(freq) || isNaN(gain) || isNaN(q)) continue;
      bands.push({ type: type, freq: freq, gain: gain, q: q });
    }
    return { preampDb: pd, bands: bands, strip: strip };
  }
  function applyLoaded(cfg) {
    if (!cfg) return;
    if (cfg.bands && cfg.bands.length && eq) { eq.setBands(cfg.bands); if (ctx) syncFilters(cfg.bands); }
    preampDb = cfg.preampDb || 0;
    var g = Math.pow(10, preampDb / 20);
    if (inputGain) inputGain.gain.value = g;
    if (preampUnit && preampUnit.knob) { var kv = Math.max(0, Math.min(1, g / 2)); preampUnit.knob.set(kv); if (preampUnit.read) preampUnit.read.textContent = preampUnit.fmt(kv); }
    // Reflect saved channel-strip state in the ENGINE controls (so reopening
    // never clobbers it back to unity on the next persist).
    if (cfg.strip) {
      engGain = cfg.strip.gain; engPan = cfg.strip.pan; engMono = cfg.strip.mono; engDrive = cfg.strip.drive;
      engThresh = cfg.strip.thresh; engRatio = cfg.strip.ratio;
      if (comp) { comp.threshold.value = engThresh; comp.ratio.value = engRatio; }
      // Space & glue (older saved specs won't have these — fall back to defaults).
      engWidth = (cfg.strip.width == null ? 1 : cfg.strip.width);
      engDelayMs = cfg.strip.delayMs || 0; engDelayFb = (cfg.strip.delayFb == null ? 0.3 : cfg.strip.delayFb); engDelayMix = cfg.strip.delayMix || 0;
      engReverbMix = cfg.strip.reverbMix || 0; engRoom = (cfg.strip.room == null ? 0.5 : cfg.strip.room); engDamp = (cfg.strip.damp == null ? 0.5 : cfg.strip.damp);
      engLimit = !!cfg.strip.limit; engCeiling = (cfg.strip.ceiling == null ? -1 : cfg.strip.ceiling);
      if (spaceControls && spaceControls.sync) spaceControls.sync();
      if (engControls && engControls.sync) engControls.sync();
      if (typeof threshUnit !== 'undefined' && threshUnit && threshUnit.knob) {
        var tv = Math.max(0, Math.min(1, (engThresh + 60) / 60)); threshUnit.knob.set(tv); if (threshUnit.read) threshUnit.read.textContent = threshUnit.fmt(tv);
      }
      if (typeof ratioUnit !== 'undefined' && ratioUnit && ratioUnit.knob) {
        var rv = Math.max(0, Math.min(1, (engRatio - 1) / 19)); ratioUnit.knob.set(rv); if (ratioUnit.read) ratioUnit.read.textContent = ratioUnit.fmt(rv);
      }
    }
    showSpec();
  }
  function loadBrowserEq() {
    showSpec();
    var cmd = 'cat ' + stateDirShell() + '/audio-eq 2>/dev/null';
    var req = { cmd: 'exec', program: '/bin/sh', args: ['-c', cmd], env: { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' } };
    try {
      chrome.runtime.sendNativeMessage(HOST, req, function (reply) {
        var err = chrome.runtime.lastError;
        if (err) { if (/not found|host/i.test(err.message || '')) hostMissing = true; return; }
        var out = b64dec((reply && reply.stdout) || '').trim();
        var lc = out.toLowerCase();
        if (lc === 'off' || lc === '0') {
          engBypass = true; if (typeof engBypassTog !== 'undefined' && engBypassTog && engBypassTog.set) engBypassTog.set(true); showSpec(); return;
        }
        if (typeof engBypassTog !== 'undefined' && engBypassTog && engBypassTog.set) { engBypass = false; engBypassTog.set(false); }
        if (out) { var cfg = parseSpec(out); if (cfg) applyLoaded(cfg); }
      });
    } catch (e) {}
  }

  /* ---------------------------------------------------------------- sources ----------------------- */
  function detachSource() { if (activeNode) { try { activeNode.disconnect(inputGain); } catch (e) {} activeNode = null; } }
  function attach(node) { detachSource(); node.connect(inputGain); activeNode = node; }
  function stopGenerators() {
    if (curType === 'file' && fileEl) { try { fileEl.pause(); } catch (e) {} }
    if (genNode) { try { genNode.stop(); } catch (e) {} try { genNode.disconnect(); } catch (e) {} genNode = null; }
  }
  var curType = 'noise', genNode = null, playing = false, toneHz = 220;

  function makePinkNoise() {
    var len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; return src;
  }

  function play() {
    ensureCtx(); ctx.resume();
    if (curType === 'file') {
      if (!fileEl) { toast('Load an audio file first (▸ Load file)', 'error'); return; }
      if (fileSrc) attach(fileSrc); fileEl.play();
    } else if (curType === 'mic') {
      if (!micSrc) { openMic(); return; }
      attach(micSrc);
    } else if (curType === 'tabs') {
      openTabs(); return;
    } else if (curType === 'noise') {
      genNode = makePinkNoise(); attach(genNode); genNode.start();
    } else if (curType === 'tone') {
      genNode = ctx.createOscillator(); genNode.type = 'sawtooth'; genNode.frequency.value = toneHz;
      attach(genNode); genNode.start();
    }
    updateOutputRouting();
    playing = true; setPlayLabel();
  }
  function stopTabs() { if (tabStream) { try { tabStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} } tabStream = null; tabSrc = null; }
  function stop() {
    stopGenerators();
    if (curType === 'mic') detachSource();
    if (curType === 'tabs') { detachSource(); stopTabs(); }
    playing = false; setPlayLabel();
  }
  function openMic() {
    ensureCtx();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('No microphone API available', 'error'); return; }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } }).then(function (st) {
      micStream = st; micSrc = ctx.createMediaStreamSource(st); attach(micSrc); playing = true; setPlayLabel();
      toast('Mic live — lower MASTER to avoid feedback through speakers', '');
    }).catch(function (e) { toast('Mic denied: ' + (e && e.message || e), 'error'); });
  }
  // TABS: snoop a playing tab's output into the analyzer chain. audio.html is a
  // privileged extension page, so it calls tabCapture directly — no service-worker
  // round-trip (that message hop was closing the port before responding). Fork
  // patch 0023 allowlists this extension for tabCapture with no manifest
  // permission, activeTab grant, or picker prompt, so getMediaStreamId just works
  // and we consume it via getUserMedia(chromeMediaSource:'tab'). tabCapture taps
  // the same audio-service Snooper as loopback = the tab's real final output;
  // feeding it to inputGain lights up the whole meter/spectrum wall.
  function openTabs(auto) {
    ensureCtx(); ctx.resume();
    // Serialize attempts: the auto retries (interval/visibility/focus/onUpdated)
    // can fire again before getUserMedia resolves, and capturing the same tab
    // twice throws "Cannot capture a tab with an active stream". One at a time.
    if (capturing || tabStream) return;
    if (!(chrome && chrome.tabs && chrome.tabCapture && chrome.tabCapture.getMediaStreamId)) {
      if (!auto) toast('tabCapture API unavailable — needs the fork build with patch 0023.', 'error');
      return;
    }
    capturing = true;
    // Find the current (dashboard) tab first so we never capture ourselves — the
    // dashboard becomes "audible" the moment it plays a stream, and it's usually
    // the active tab, so an active/self pick would just snoop a silent feedback
    // loop. Target a real *other* audible tab, preferring a normal web page.
    chrome.tabs.getCurrent(function (me) {
      var myId = me && me.id;
      chrome.tabs.query({ audible: true }, function (tabs) {
        if (chrome.runtime.lastError) { capturing = false; if (!auto) toast('Tab query failed: ' + chrome.runtime.lastError.message, 'error'); return; }
        tabs = (tabs || []).filter(function (t) { return t.id !== myId; });
        // Prefer http(s) pages over other extension/chrome pages.
        var web = tabs.filter(function (t) { return /^https?:/.test(t.url || ''); });
        var pick = web[0] || tabs[0];
        if (!pick) { capturing = false; if (!auto) toast('No other tab is playing audio right now — start a video/song in a normal tab, then pick Tabs again.', ''); return; }
        captureTab(pick.id, myId, pick.title || pick.url || ('tab ' + pick.id), auto);
      });
    });
  }
  function captureTab(tabId, consumerTabId, label, auto) {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId, consumerTabId: consumerTabId }, function (streamId) {
        if (chrome.runtime.lastError || !streamId) {
          capturing = false;
          var msg = (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'no stream id';
          // "active stream" == already captured (a race or another dashboard) — benign, stay quiet.
          if (!auto && !/active stream/i.test(msg)) {
            toast('Tab capture denied: ' + msg + ' — needs fork patch 0023 (tabCapture allowlist).', 'error');
          }
          return;
        }
        var constraints = { audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }, video: false };
        navigator.mediaDevices.getUserMedia(constraints).then(function (st) {
          capturing = false;
          if (tabStream) { try { tabStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
          tabStream = st; tabSrc = ctx.createMediaStreamSource(st); attach(tabSrc);
          curType = 'tabs'; if (srcGroup) srcGroup.set('tabs');
          updateOutputRouting();
          playing = true; setPlayLabel();
          if (!auto) toast('Capturing “' + label + '” → live on the meters', 'success');
        }).catch(function (e) {
          capturing = false;
          var m = (e && e.message || e) + '';
          if (!auto && !/active stream/i.test(m)) toast('getUserMedia(tab) failed: ' + m, 'error');
        });
      });
  }
  function loadFile(file) {
    ensureCtx();
    if (fileEl) { try { fileEl.pause(); } catch (e) {} if (fileSrc) { try { fileSrc.disconnect(); } catch (e) {} } detachSource(); }
    var url = URL.createObjectURL(file);
    fileEl = new Audio(url); fileEl.loop = true; fileEl.crossOrigin = 'anonymous';
    fileSrc = ctx.createMediaElementSource(fileEl);
    curType = 'file'; if (srcGroup) srcGroup.set('file');
    toast('Loaded: ' + file.name, 'success'); play();
  }

  /* ---------------------------------------------------------------- build page -------------------- */
  var shell = window.ZBHUD.mount({
    title: 'AUDIO', current: 'audio.html',
    filterPlaceholder: '>_ audio · EQ · gain',
    palette: [
      { icon: '▸', label: 'Audio: Play preview', hint: 'transport', run: play },
      { icon: '■', label: 'Audio: Stop preview', hint: 'transport', run: stop },
      { icon: '≈', label: 'Audio: Flat EQ', hint: 'preset', run: function () { applyPreset('Flat'); } }
    ]
  });

  var srcGroup = null, playBtn = null, eq = null;
  var spectrum = null, sgram = null, gonio = null, corr = null, lufs = null, peak = null, vu = null, gr = null, master = null;
  var scopeCanvas = null, scopeCtx = null, specReadout = null;

  function setPlayLabel() { if (playBtn) playBtn.textContent = playing ? '■  Stop' : '▸  Play'; }


  /* ---- EQ + spectrum ---- */
  var eqWrap = el('div', 'az-eqwrap');
  eq = Z.parametricEq({
    bands: flat(), freqMin: 20, freqMax: 20000, gainMax: 18, sampleRate: 48000,
    onChange: function () { if (ctx) syncFilters(eq.get()); persistDebounced(); }
  });
  eqWrap.appendChild(eq.el);
  var eqCard = Z.card({ title: '// PARAMETRIC EQ  ·  drag nodes  ·  live FFT overlay', body: eqWrap });

  /* ---- ENGINE STRIP — controls that modify the ALWAYS-ON browser-wide C++
     engine. Saved to appdata ($STATE/audio-eq) and applied to every tab live,
     even with this page closed. (The GAIN & DYNAMICS knobs further down are the
     local web-audio preview only — these are the real engine controls.) ---- */
  var engControls = (function () {
    var wrap = el('div');
    var row = el('div', 'az-knobs');
    var gCol = el('div', 'az-knob'), gRead = el('div', 'az-read', engGain.toFixed(2) + '×');
    var gKnob = Z.knob({ value: engGain / 2, label: 'GAIN', size: 58, onChange: function (v) { engGain = v * 2; gRead.textContent = engGain.toFixed(2) + '×'; persistDebounced(); } });
    gCol.appendChild(gKnob.el); gCol.appendChild(gRead);
    var dCol = el('div', 'az-knob'), dRead = el('div', 'az-read', Math.round(engDrive * 100) + '%');
    var dKnob = Z.knob({ value: engDrive, label: 'DRIVE', size: 58, onChange: function (v) { engDrive = v; dRead.textContent = Math.round(v * 100) + '%'; persistDebounced(); } });
    dCol.appendChild(dKnob.el); dCol.appendChild(dRead);
    row.appendChild(gCol); row.appendChild(dCol);
    var panWrap = el('div'); panWrap.style.minWidth = '180px'; panWrap.style.alignSelf = 'center';
    var pan = Z.bipolarSlider(panWrap, { value: engPan, min: -1, max: 1, center: 0, label: 'PAN', showValue: true, onChange: function (v) { engPan = v; persistDebounced(); } });
    var monoWrap = el('div'); monoWrap.style.alignSelf = 'center';
    var mono = Z.ledToggle({ label: 'MONO', on: engMono, color: 'cyan', onChange: function (on) { engMono = on; persistDebounced(); } });
    monoWrap.appendChild(mono.el);
    var rowB = el('div', 'az-row'); rowB.appendChild(row); rowB.appendChild(panWrap); rowB.appendChild(monoWrap);
    wrap.appendChild(rowB);
    wrap.appendChild(el('div', 'az-note',
      'These + the EQ above are the <b>always-on browser-wide engine</b>: saved to <b>$STATE/audio-eq</b> and applied to '
      + '<b>every tab live</b> by the C++ audio engine — even with this page closed. No capture, no playback here.'));
    function sync() {
      if (gKnob.set) gKnob.set(Math.max(0, Math.min(1, engGain / 2))); gRead.textContent = engGain.toFixed(2) + '×';
      if (dKnob.set) dKnob.set(Math.max(0, Math.min(1, engDrive))); dRead.textContent = Math.round(engDrive * 100) + '%';
      if (pan && pan.set) pan.set(engPan);
      if (mono && mono.set) mono.set(engMono);
    }
    return { el: Z.card({ title: '// ENGINE STRIP  ·  gain · pan · mono · drive  ·  always-on + saved', body: wrap }).el, sync: sync };
  })();

  var specWrap = el('div');
  spectrum = Z.spectrumAnalyzer(specWrap, { width: 640, height: 140, peakHold: true });
  if (spectrum.canvas) spectrum.canvas.style.width = '100%';
  var specCard = Z.card({ title: '// SPECTRUM ANALYZER', body: specWrap });

  /* ---- spectrogram (waterfall) ---- */
  var sgWrap = el('div');
  sgram = Z.spectrogram(sgWrap, { bins: 96, cols: 256, width: 640, height: 130 });
  if (sgram.canvas) sgram.canvas.style.width = '100%';
  var sgCard = Z.card({ title: '// SPECTROGRAM  ·  scrolling FFT heat', body: sgWrap });

  /* ---- oscilloscope (ZGui.viz) ---- */
  var scWrap = el('div');
  scopeCanvas = canvas(640, 140); scWrap.appendChild(scopeCanvas);
  scopeCanvas.style.width = '100%';
  scopeCtx = scopeCanvas.getContext('2d');
  var scCard = Z.card({ title: '// OSCILLOSCOPE  ·  triggered sweep', body: scWrap });

  /* ---- waveform (ZGui.viz.waveform) — scrolling min/max envelope of the engine output ---- */
  var wfWrap = el('div');
  var wfCanvas = canvas(640, 120); wfWrap.appendChild(wfCanvas); wfCanvas.style.width = '100%';
  var wfCtx = wfCanvas.getContext('2d');
  var wfHist = [];  // scrolling {max,min} envelope columns
  var wfCard = Z.card({ title: '// WAVEFORM  ·  scrolling envelope', body: wfWrap });

  /* ---- waterfall (ZGui.viz.waterfall) — 3D perspective spectral history ---- */
  var wtWrap = el('div');
  var wtCanvas = canvas(640, 150); wtWrap.appendChild(wtCanvas); wtCanvas.style.width = '100%';
  var wtCtx = wtCanvas.getContext('2d');
  var wtHist = [];  // spectrum frames (newest last), dB-ish
  var wtCard = Z.card({ title: '// WATERFALL  ·  3D spectral history', body: wtWrap });

  /* ---- gain / dynamics knobs ---- */
  function knobUnit(label, value, fmt, onChange) {
    var wrap = el('div', 'az-knob');
    var read = el('div', 'az-read', fmt(value));
    var k = Z.knob({ value: value, label: label, size: 58, onChange: function (v) { read.textContent = fmt(v); onChange(v); } });
    wrap.appendChild(k.el); wrap.appendChild(read);
    return { wrap: wrap, knob: k, read: read, fmt: fmt };
  }
  var knobsRow = el('div', 'az-knobs');
  // PREAMP: feeds both the local inputGain and the browser spec's preamp (dB).
  var preampUnit = knobUnit('PREAMP', 0.5,
    function (v) { return fmtDb(gainToDb(knobToGain(v))); },
    function (v) { var g = knobToGain(v); if (inputGain) inputGain.gain.value = g; preampDb = (g <= 0.0001 ? -60 : 20 * Math.log10(g)); persistDebounced(); });
  knobsRow.appendChild(preampUnit.wrap);
  // THRESH/RATIO: engine compressor (thresh,ratio in the spec) — also mirrored
  // in the local preview comp. Defaults: THRESH 0 dB, RATIO 1:1 => comp OFF.
  var threshUnit = knobUnit('THRESH', 1.0,
    function (v) { return (v * 60 - 60).toFixed(0) + ' dB'; },
    function (v) { engThresh = v * 60 - 60; if (comp) comp.threshold.value = engThresh; persistDebounced(); });
  knobsRow.appendChild(threshUnit.wrap);
  var ratioUnit = knobUnit('RATIO', 0,
    function (v) { return (1 + v * 19).toFixed(1) + ':1'; },
    function (v) { engRatio = 1 + v * 19; if (comp) comp.ratio.value = engRatio; persistDebounced(); });
  knobsRow.appendChild(ratioUnit.wrap);
  var knobsCard = Z.card({ title: '// ENGINE DYNAMICS  ·  preamp · compressor  ·  always-on + saved', body: knobsRow });
  // Master engine-DSP bypass — writes "off" so the C++ engine passes raw audio
  // through (A/B diff). Settings are retained; toggling back re-applies them.
  var engBypassTog = Z.ledToggle({ label: 'BYPASS ENGINE DSP', on: engBypass, color: 'magenta',
    onChange: function (on) { engBypass = on; persistDebounced(); toast(on ? 'Engine DSP BYPASSED — raw audio (A/B)' : 'Engine DSP active', ''); } });
  var bypassRow = el('div', 'az-row'); bypassRow.appendChild(engBypassTog.el);
  knobsCard.body.insertBefore(bypassRow, knobsCard.body.firstChild);
  knobsCard.body.appendChild(el('div', 'az-note',
    '<b>BYPASS ENGINE DSP</b> A/B-diffs the whole chain (EQ + strip + compressor) on/off. Preamp + compressor drive the '
    + '<b>browser-wide engine</b> — saved to appdata, applied to every tab live (even with this page closed).'));

  /* ---- ENGINE SPACE & GLUE — stereo width (M/S) · feedback delay/echo ·
     Schroeder reverb · brickwall limiter. All engine-side (spec directives),
     always-on + saved, applied to every tab live. Defaults = bypass. ---- */
  var spaceControls = (function () {
    var wrap = el('div');
    var pct = function (v) { return Math.round(v * 100) + '%'; };
    var widthU = knobUnit('WIDTH', engWidth / 2,
      function (v) { return (v * 2).toFixed(2) + '×'; },
      function (v) { engWidth = v * 2; persistDebounced(); });
    var delayU = knobUnit('DELAY', engDelayMs / 2000,
      function (v) { return Math.round(v * 2000) + ' ms'; },
      function (v) { engDelayMs = v * 2000; persistDebounced(); });
    var fbU = knobUnit('FEEDBACK', engDelayFb / 0.95,
      function (v) { return pct(v * 0.95); },
      function (v) { engDelayFb = v * 0.95; persistDebounced(); });
    var dmixU = knobUnit('DLY MIX', engDelayMix, pct,
      function (v) { engDelayMix = v; persistDebounced(); });
    var revU = knobUnit('REVERB', engReverbMix, pct,
      function (v) { engReverbMix = v; persistDebounced(); });
    var roomU = knobUnit('ROOM', engRoom, pct,
      function (v) { engRoom = v; persistDebounced(); });
    var dampU = knobUnit('DAMP', engDamp, pct,
      function (v) { engDamp = v; persistDebounced(); });
    var ceilU = knobUnit('CEILING', (engCeiling + 30) / 30,
      function (v) { return (v * 30 - 30).toFixed(1) + ' dB'; },
      function (v) { engCeiling = v * 30 - 30; persistDebounced(); });
    var row = el('div', 'az-knobs');
    [widthU, delayU, fbU, dmixU, revU, roomU, dampU, ceilU].forEach(function (u) { row.appendChild(u.wrap); });
    var limWrap = el('div'); limWrap.style.alignSelf = 'center';
    var limTog = Z.ledToggle({ label: 'LIMITER', on: engLimit, color: 'cyan',
      onChange: function (on) { engLimit = on; persistDebounced(); } });
    limWrap.appendChild(limTog.el);
    var rowB = el('div', 'az-row'); rowB.appendChild(row); rowB.appendChild(limWrap);
    wrap.appendChild(rowB);
    wrap.appendChild(el('div', 'az-note',
      'Post-dynamics <b>space &amp; glue</b>: chain order is delay → reverb → M/S width → pan → <b>limiter</b> (last, '
      + 'so nothing re-clips). Engine-side + saved to <b>$STATE/audio-eq</b>, live on every tab with this page closed.'));
    function sync() {
      var set = function (u, v, f) { if (u.knob.set) u.knob.set(Math.max(0, Math.min(1, v))); u.read.textContent = u.fmt(f == null ? v : f); };
      set(widthU, engWidth / 2);
      set(delayU, engDelayMs / 2000);
      set(fbU, engDelayFb / 0.95);
      set(dmixU, engDelayMix);
      set(revU, engReverbMix);
      set(roomU, engRoom);
      set(dampU, engDamp);
      set(ceilU, (engCeiling + 30) / 30);
      if (limTog && limTog.set) limTog.set(engLimit);
    }
    return { el: Z.card({ title: '// ENGINE SPACE & GLUE  ·  width · delay · reverb · limiter  ·  always-on + saved', body: wrap }).el, sync: sync };
  })();

  /* ---- transport / preview sources ---- */
  var transport = el('div', 'az-row');
  srcGroup = Z.buttonGroup({
    buttons: [{ value: 'noise', label: 'Noise' }, { value: 'tone', label: 'Tone' }, { value: 'file', label: 'File' }, { value: 'mic', label: 'Mic' }, { value: 'tabs', label: 'Tab ⚠' }],
    value: 'noise',
    onChange: function (v) { var wasPlaying = playing; stop(); curType = v; updateOutputRouting(); if (v === 'tabs') { openTabs(); } else if (wasPlaying && v !== 'file') play(); }
  });
  transport.appendChild(srcGroup.el);
  playBtn = Z.button({ label: '▸  Play', variant: 'primary', onClick: function () { playing ? stop() : play(); } });
  transport.appendChild(playBtn);
  transport.appendChild(Z.button({ label: '▸ Load file', onClick: function () { fileInput.click(); } }));
  var fileInput = el('input'); fileInput.type = 'file'; fileInput.accept = 'audio/*'; fileInput.style.display = 'none';
  fileInput.addEventListener('change', function () { if (fileInput.files && fileInput.files[0]) loadFile(fileInput.files[0]); });
  transport.appendChild(fileInput);
  transport.appendChild(el('span', 'az-spacer'));
  var presetBar = el('div', 'az-presets');
  Object.keys(PRESETS).forEach(function (name) { presetBar.appendChild(Z.button({ label: name, variant: 'mini', onClick: function () { applyPreset(name); } })); });
  transport.appendChild(presetBar);
  var transportCard = Z.card({ title: '// PREVIEW SOURCE & TRANSPORT', body: transport });
  transportCard.body.appendChild(el('div', 'az-note',
    '<b>Tabs</b> captures the browser-wide output loopback (every tab’s audio, live on the meters) via fork patch 0023. '
    + 'Local preview sources: <b>Noise</b> pink noise · <b>Tone</b> sawtooth (TONE knob) · <b>File</b> loops a local track · <b>Mic</b> live input.'));

  /* ---- right column: meters ---- */
  function meterCol(cap, node) { var c = el('div', 'az-metercol'); c.appendChild(node); c.appendChild(el('div', 'az-cap', cap)); return c; }

  var metersWrap = el('div', 'az-meters');
  peak = Z.peakMeter({ stereo: true, min: -60, max: 6, lufs: -60 });
  metersWrap.appendChild(meterCol('Peak L/R', peak.el));
  var grWrap = el('div'); gr = Z.gainReduction(grWrap, { maxDb: 18, width: 54, height: 150 });
  metersWrap.appendChild(meterCol('Gain Reduce', grWrap));
  var metersCard = Z.card({ title: '// LEVEL', body: metersWrap });

  var lufsWrap = el('div'); lufs = Z.lufsMeter(lufsWrap, { target: -14, floor: -36 });
  var lufsCard = Z.card({ title: '// LOUDNESS  ·  LUFS (M/S/I)', body: lufsWrap });

  var gonioWrap = el('div', 'az-master'); gonio = Z.goniometer(gonioWrap, { size: 200, color: '#05d9e8', fade: 0.2 });
  var gonioCard = Z.card({ title: '// GONIOMETER  ·  stereo vectorscope', body: gonioWrap });

  var corrWrap = el('div'); corr = Z.correlationMeter(corrWrap, { width: 260, height: 26 });
  var corrCard = Z.card({ title: '// PHASE CORRELATION', body: corrWrap });

  var vuWrap = el('div', 'az-master'); vu = Z.vuMeter(vuWrap, { width: 200, height: 110, label: 'VU' });
  var vuCard = Z.card({ title: '// VU', body: vuWrap });

  var masterWrap = el('div', 'az-master');
  master = Z.channelStrip({
    name: 'MASTER', color: '#05d9e8', db: 0, pan: 0,
    // The master strip is an ENGINE control: fader/pan/mute drive the always-on
    // C++ output gain/pan (written to appdata), not just the local preview.
    onFader: function (db) {
      faderDb = db;
      var g = db <= -48 ? 0 : Math.pow(10, db / 20);
      if (!muted && masterGain) masterGain.gain.value = g;   // local preview volume
      engGain = g; persistDebounced();                        // engine output gain
      if (engControls && engControls.sync) engControls.sync();
    },
    onPan: function (v) {
      if (panner) panner.pan.value = v;
      engPan = v; persistDebounced();
      if (engControls && engControls.sync) engControls.sync();
    },
    onMute: function (b) {
      muted = b; engMute = b;
      if (masterGain) masterGain.gain.value = b ? 0 : (faderDb <= -48 ? 0 : Math.pow(10, faderDb / 20));
      persistDebounced();
    },
    onSolo: function () {}
  });
  masterWrap.appendChild(master.el);
  var masterCard = Z.card({ title: '// MASTER', body: masterWrap });

  /* ---- assemble ---- */
  var grid = el('div', 'az-grid');
  var left = el('div', 'az-col');
  [knobsCard, eqCard, engControls, spaceControls, specCard, sgCard, scCard, wfCard, wtCard, transportCard].forEach(function (c) { left.appendChild(c.el); });
  var right = el('div', 'az-col');
  [metersCard, lufsCard, gonioCard, corrCard, vuCard, masterCard].forEach(function (c) { right.appendChild(c.el); });
  grid.appendChild(left); grid.appendChild(right);
  shell.body.appendChild(grid);

  function applyPreset(name) {
    var g = PRESETS[name]; if (!g) return;
    var bands = flat(); g.forEach(function (v, i) { bands[i].gain = v; });
    eq.setBands(bands); if (ctx) syncFilters(bands);
    persistDebounced(); toast('EQ preset: ' + name, '');
  }
  showSpec(); // reflect the current curve in the readout; don't write on load (would clobber a saved EQ)
  loadBrowserEq(); // pull the saved engine config from appdata into the controls (EQ + strip), so they reflect the always-on state

  /* ---------------------------------------------------------------- meter/animation loop --------- */
  function bars(n) {
    var out = new Array(n), bins = freqU8.length, nyq = ctx.sampleRate / 2;
    for (var i = 0; i < n; i++) {
      var f0 = 20 * Math.pow(nyq / 20, i / n), f1 = 20 * Math.pow(nyq / 20, (i + 1) / n);
      var b0 = Math.max(0, Math.floor(f0 / nyq * bins)), b1 = Math.min(bins - 1, Math.ceil(f1 / nyq * bins));
      var m = 0, k = 0; for (var b = b0; b <= b1; b++) { m += freqU8[b]; k++; }
      out[i] = k ? (m / k) / 255 : 0;
    }
    return out;
  }
  function rmsF(buf) { var s = 0; for (var i = 0; i < buf.length; i++) { var x = buf[i]; s += x * x; } return Math.sqrt(s / buf.length); }
  function toDb(r) { if (r < 0.0002) return -60; var d = 20 * Math.log10(r); return d < -60 ? -60 : (d > 6 ? 6 : d); }

  // LUFS-ish momentary/short/integrated from real signal (RMS-based approximation, not K-weighted).
  var lufsM = -60, lufsS = -60, lufsI = -60, lufsN = 0;
  function updateLufs(monoRms) {
    var l = monoRms < 1e-6 ? -70 : 20 * Math.log10(monoRms) - 0.691;
    lufsM = lufsM + (l - lufsM) * 0.25;             // ~momentary (fast)
    lufsS = lufsS + (l - lufsS) * 0.03;             // ~short-term (slow)
    if (l > -60) { lufsN++; lufsI = lufsI + (l - lufsI) / Math.min(lufsN, 3000); } // gated running mean
  }

  function linToDb(v) { return (!v || v < 1e-4) ? -60 : Math.max(-60, Math.min(6, 20 * Math.log10(v))); }
  function resample(a, n) { if (!a || a.length === n) return a; var o = new Array(n); for (var i = 0; i < n; i++) o[i] = a[Math.min(a.length - 1, Math.floor(i * a.length / n))]; return o; }
  // Map the engine's 64 log-spaced bars (0..1, 20Hz..Nyquist) back to a linear
  // FFT-bin byte array so the parametric-EQ live overlay (setSpectrum) can draw it.
  var _u8 = null;
  function barsToFreqU8(bars, fs, fftSize) {
    var bins = fftSize >> 1;
    if (!_u8 || _u8.length !== bins) _u8 = new Uint8Array(bins);
    var nyq = fs / 2, nb = bars.length, lg = Math.log(nyq / 20);
    for (var i = 0; i < bins; i++) {
      var f = i * fs / fftSize;
      if (f < 20 || lg <= 0) { _u8[i] = 0; continue; }
      var bi = Math.floor(Math.log(f / 20) / lg * nb);
      if (bi < 0) bi = 0; else if (bi >= nb) bi = nb - 1;
      _u8[i] = Math.round(Math.max(0, Math.min(1, bars[bi])) * 255);
    }
    return _u8;
  }
  // Charts render the ENGINE meter frame (real post-DSP output from the C++
  // audio engine via $STATE/meters — no tab capture, no mute, no dropout).
  var _s56 = new Array(56), _s96 = new Array(96), _renderN = 0;
  function resampleInto(a, out) { var n = out.length, len = a.length; for (var i = 0; i < n; i++) out[i] = a[Math.min(len - 1, (i * len / n) | 0)]; return out; }
  function renderCharts() {
    var m = mf;
    if (!m || !m.bars) return;  // idle until engine meter data arrives
    var fs = m.fs || 44100;
    var heavy = (++_renderN & 1) === 0;  // spectrogram/waveform/waterfall at ~half rate
    try { spectrum.push(resampleInto(m.bars, _s56)); } catch (e) {}
    try { eq.setSpectrum(barsToFreqU8(m.bars, fs, 2048), fs, 2048); } catch (e) {}
    var L = m._L || (m._L = new Float32Array(m.sl || []));
    var R = m._R || (m._R = new Float32Array(m.sr || []));
    var start = 0; try { start = Z.viz.triggerIndex(L); } catch (e) {}
    try { Z.viz.oscilloscope(scopeCtx, scopeCanvas.width, scopeCanvas.height, L, { start: start }); } catch (e) {}
    if (heavy) {
      try { sgram.push(resampleInto(m.bars, _s96)); } catch (e) {}
      try {
        var mx = 0, mn = 0; for (var wi = 0; wi < L.length; wi++) { if (L[wi] > mx) mx = L[wi]; if (L[wi] < mn) mn = L[wi]; }
        wfHist.push({ max: mx, min: mn }); if (wfHist.length > 128) wfHist.shift();
        Z.viz.waveform(wfCtx, wfCanvas.width, wfCanvas.height, wfHist);
      } catch (e) {}
      try {
        var db = new Array(m.bars.length); for (var bi = 0; bi < m.bars.length; bi++) db[bi] = m.bars[bi] * 100 - 100;
        wtHist.push(db); if (wtHist.length > 28) wtHist.shift();
        Z.viz.waterfall(wtCtx, wtCanvas.width, wtCanvas.height, wtHist);
      } catch (e) {}
    }
    try { gonio.push(L, R); } catch (e) {}
    try { corr.set(m.corr); } catch (e) {}
    var ldb = linToDb(m.pL), rdb = linToDb(m.pR);
    peak.set([ldb, rdb]);
    var monoRms = Math.sqrt((m.rL * m.rL + m.rR * m.rR) / 2);
    updateLufs(monoRms);
    if (peak.setLufs) peak.setLufs(lufsM);
    lufs.set({ m: lufsM, s: lufsS, i: lufsI });
    if (master && master.setMeter) master.setMeter([ldb, rdb]);
    vu.set(Math.max(ldb, rdb));
  }
  // Render ONCE per rAF, capped at ~30fps (the engine meter feed is only 30fps,
  // so drawing faster just burns main-thread scripting — which was saturating the
  // thread and dropping frames on scroll). One driver, ~33ms budget.
  var lastRenderT = 0;
  function rafLoop() {
    requestAnimationFrame(rafLoop);
    var now = (window.performance && performance.now()) || Date.now();
    if (now - lastRenderT < 32) return;
    lastRenderT = now;
    renderCharts();
  }
  requestAnimationFrame(rafLoop);

  /* ---- ENGINE meter back-channel: the C++ audio engine writes a compact meter
     frame (spectrum + peak/RMS + correlation + stereo scope) of the REAL post-DSP
     output to $STATE/meters ~30fps; the native host streams it to us over a
     persistent port. No tab capture — the charts are a true live view of the
     always-on engine, and this page never touches the audio. ---- */
  function metersPath() {
    var p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '').toLowerCase();
    return (p.indexOf('mac') >= 0 || p.indexOf('darwin') >= 0)
      ? '~/Library/Application Support/com.menketechnologies.zwire/meters'
      : '~/.config/zwire/meters';
  }
  // PUSH, not poll: the native host owns a background thread that streams the
  // meters file to us on every change (cmd:'meter_stream'). The page does zero
  // polling — nothing on the main thread to starve during scroll or page build.
  // We just receive {ev:'meter', text} frames and stash the latest for rendering.
  function startMeterFeed() {
    if (!(chrome && chrome.runtime && chrome.runtime.connectNative)) return;
    try { meterPort = chrome.runtime.connectNative(HOST); } catch (e) { meterPort = null; return; }
    meterPort.onMessage.addListener(function (msg) {
      if (msg && msg.ev === 'meter' && typeof msg.text === 'string') { try { mf = JSON.parse(msg.text); } catch (e) {} }
    });
    meterPort.onDisconnect.addListener(function () { meterPort = null; setTimeout(startMeterFeed, 1500); });
    try { meterPort.postMessage({ id: 'meters', cmd: 'meter_stream', path: metersPath(), interval_ms: 33 }); } catch (e) {}
  }

  // NOTE: tab capture is NOT auto-started. chrome.tabCapture MUTES the source
  // tab (its audio is redirected into our stream) and RELEASING the capture on
  // page close takes ~1s to un-mute — so any capture makes closing this page cut
  // the audio. That violates "closing must never change audio", so the charts no
  // longer capture tabs. Live tab-audio charts should instead come from the C++
  // engine (which already has the post-DSP audio) over a meter back-channel — no
  // capture, no mute, no dropout. Local preview sources (noise/tone/file/mic)
  // still drive the charts. Resume the context on first interaction for those.
  ['pointerdown', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, function () { if (ctx) { try { ctx.resume(); } catch (e) {} } });
  });
})();
