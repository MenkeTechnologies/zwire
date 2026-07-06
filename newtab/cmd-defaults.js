/* zwire HUD — default ⌘K custom-command registry + a one-time seeder. Shared by
 * the Commands page (commands.js) and the global palette (zpalette.js) so both
 * seed from ONE source, in a page/content-script context where storage writes
 * are reliable (the MV3 worker's startup write wasn't landing). Seeds once ever
 * (guarded by zb_cmds_seeded), merging defaults with any existing user entries. */
(function (root) {
  'use strict';
  function u(id, icon, label, kw, url) { return { id: 'def-' + id, icon: icon, label: label, detail: '', keyword: kw, type: 'url', value: url }; }
  function a(id, icon, label, kw, act) { return { id: 'def-' + id, icon: icon, label: label, detail: '', keyword: kw, type: 'action', value: act }; }
  root.ZWIRE_CMD_DEFAULTS = [
    u('chatgpt', '🤖', 'ChatGPT', 'cg', 'https://chatgpt.com/?q={q}&hints=search'),
    u('claude', '✳️', 'Claude', 'cl', 'https://claude.ai/new?q={q}'),
    u('perplexity', '🔮', 'Perplexity', 'pp', 'https://www.perplexity.ai/search?q={q}'),
    u('gmail', '✉️', 'Gmail', 'gm', 'https://mail.google.com/mail/u/0/#search/{q}'),
    u('gdrive', '📁', 'Google Drive', 'gd', 'https://drive.google.com/drive/search?q={q}'),
    u('gcal', '📅', 'Google Calendar', 'cal', 'https://calendar.google.com/'),
    u('translate', '🌐', 'Google Translate', 'tr', 'https://translate.google.com/?sl=auto&tl=en&text={q}'),
    u('images', '🖼️', 'Google Images', 'img', 'https://www.google.com/search?tbm=isch&q={q}'),
    u('define', '📖', 'Define word', 'def', 'https://www.google.com/search?q=define%3A{q}'),
    u('wolfram', '🧮', 'WolframAlpha', 'wa', 'https://www.wolframalpha.com/input?i={q}'),
    u('hn', '🟧', 'Hacker News', 'hn', 'https://hn.algolia.com/?q={q}'),
    u('linkedin', '💼', 'LinkedIn', 'li', 'https://www.linkedin.com/search/results/all/?keywords={q}'),
    u('imdb', '🎬', 'IMDb', 'imdb', 'https://www.imdb.com/find/?q={q}'),
    u('netflix', '📺', 'Netflix', 'nf', 'https://www.netflix.com/search?q={q}'),
    u('spotify', '🎵', 'Spotify', 'sp', 'https://open.spotify.com/search/{q}'),
    u('ytmusic', '🎧', 'YouTube Music', 'ytm', 'https://music.youtube.com/search?q={q}'),
    u('bing', '🔎', 'Bing', 'bing', 'https://www.bing.com/search?q={q}'),
    u('kagi', '🧭', 'Kagi', 'kagi', 'https://kagi.com/search?q={q}'),
    u('github', '🐙', 'GitHub', 'gh', 'https://github.com/search?q={q}'),
    u('gist', '📝', 'GitHub Gist', 'gist', 'https://gist.github.com/search?q={q}'),
    u('gpr', '🔀', 'GitHub PRs', 'pr', 'https://github.com/pulls'),
    u('gissues', '🐛', 'GitHub Issues', 'iss', 'https://github.com/issues'),
    u('grepapp', '🔍', 'grep.app (code search)', 'grep', 'https://grep.app/search?q={q}'),
    u('caniuse', '✅', 'Can I Use', 'ciu', 'https://caniuse.com/?search={q}'),
    u('bundlephobia', '📦', 'Bundlephobia', 'bp', 'https://bundlephobia.com/package/{q}'),
    u('regex101', '⚙️', 'regex101', 'rex', 'https://regex101.com/'),
    u('mavencentral', '☕', 'Maven Central', 'mvn', 'https://central.sonatype.com/search?q={q}'),
    u('aws', '🟠', 'AWS Console', 'aws', 'https://console.aws.amazon.com/console/home'),
    u('gcp', '🔵', 'GCP Console', 'gcp', 'https://console.cloud.google.com/'),
    u('vercel', '▲', 'Vercel', 'vc', 'https://vercel.com/dashboard'),
    u('cloudflare', '☁️', 'Cloudflare', 'cf', 'https://dash.cloudflare.com/'),
    u('notion', '🗒️', 'Notion', 'no', 'https://www.notion.so/{q}'),
    u('figma', '🎨', 'Figma', 'fig', 'https://www.figma.com/files'),
    u('devdocs', '📚', 'DevDocs', 'dd', 'https://devdocs.io/#q={q}'),
    u('archwiki', '🐧', 'Arch Wiki', 'aw', 'https://wiki.archlinux.org/index.php?search={q}'),
    u('emoji', '🔣', 'Emoji / Unicode', 'uni', 'https://emojipedia.org/search?q={q}'),
    u('gemini', '🌟', 'Gemini', 'gmn', 'https://gemini.google.com/app'),
    u('copilot', '🐙', 'GitHub Copilot', 'cop', 'https://github.com/copilot'),
    u('huggingface', '🤗', 'Hugging Face', 'hf', 'https://huggingface.co/search/full-text?q={q}'),
    u('codepen', '✏️', 'CodePen', 'cp', 'https://codepen.io/search/pens?q={q}'),
    u('codesandbox', '📦', 'CodeSandbox', 'csb', 'https://codesandbox.io/search?query={q}'),
    u('replit', '🔁', 'Replit', 'repl', 'https://replit.com/search?q={q}'),
    u('gitlab', '🦊', 'GitLab', 'gl', 'https://gitlab.com/search?search={q}'),
    u('bitbucket', '🪣', 'Bitbucket', 'bb', 'https://bitbucket.org/'),
    u('linear', '📐', 'Linear', 'lin', 'https://linear.app/'),
    u('trello', '📋', 'Trello', 'trl', 'https://trello.com/'),
    u('slack', '💬', 'Slack', 'sl', 'https://app.slack.com/client'),
    u('discord', '🎮', 'Discord', 'dc', 'https://discord.com/channels/@me'),
    u('telegram', '✈️', 'Telegram', 'tg', 'https://web.telegram.org/'),
    u('whatsapp', '🟢', 'WhatsApp', 'wsp', 'https://web.whatsapp.com/'),
    u('twitch', '🟣', 'Twitch', 'tw', 'https://www.twitch.tv/search?term={q}'),
    u('soundcloud', '🔊', 'SoundCloud', 'sc', 'https://soundcloud.com/search?q={q}'),
    u('ebay', '🛒', 'eBay', 'eb', 'https://www.ebay.com/sch/i.html?_nkw={q}'),
    u('etsy', '🧵', 'Etsy', 'etsy', 'https://www.etsy.com/search?q={q}'),
    u('flights', '🛫', 'Google Flights', 'fl', 'https://www.google.com/travel/flights?q={q}'),
    u('airbnb', '🏠', 'Airbnb', 'abnb', 'https://www.airbnb.com/s/{q}/homes'),
    u('yelp', '⭐', 'Yelp', 'yelp', 'https://www.yelp.com/search?find_desc={q}'),
    u('nyt', '📰', 'New York Times', 'nyt', 'https://www.nytimes.com/search?query={q}'),
    u('arxiv', '📄', 'arXiv', 'arx', 'https://arxiv.org/abs/{q}'),
    u('scholar', '🎓', 'Google Scholar', 'sch', 'https://scholar.google.com/scholar?q={q}'),
    u('weather', '🌤️', 'Weather', 'wx', 'https://www.google.com/search?q=weather+{q}'),
    u('npmtrends', '📈', 'npm trends', 'npt', 'https://npmtrends.com/{q}'),
    a('reload', '↻', 'Reload page', 'rl', 'reload'),
    a('copyurl', '⧉', 'Copy page URL', 'cu', 'copyUrl'),
    a('scheme', '◐', 'Cycle color scheme', 'cs', 'cycleScheme')
  ];
  // Merge in any default whose id isn't already present AND wasn't deleted by
  // the user (zb_cmds_removed). Runs on every load, so EXPANDING the defaults
  // above makes the new rules appear automatically, without re-adding ones the
  // user removed. onDone(list) gets the resulting array (drawn directly).
  root.zwireSeedCmds = function (onDone) {
    try {
      chrome.storage.local.get(['zb_custom_cmds', 'zb_cmds_removed'], function (o) {
        void chrome.runtime.lastError;
        var cur = (o && o.zb_custom_cmds) || [];
        var removed = {}; ((o && o.zb_cmds_removed) || []).forEach(function (id) { removed[id] = 1; });
        var have = {}; cur.forEach(function (c) { if (c && c.id) have[c.id] = 1; });
        var add = root.ZWIRE_CMD_DEFAULTS.filter(function (c) { return !have[c.id] && !removed[c.id]; });
        if (!add.length) { if (onDone) onDone(cur); return; }
        var merged = cur.concat(add);
        try { chrome.storage.local.set({ zb_custom_cmds: merged }, function () { void chrome.runtime.lastError; if (onDone) onDone(merged); }); }
        catch (e) { if (onDone) onDone(merged); }
      });
    } catch (e) { if (onDone) onDone(root.ZWIRE_CMD_DEFAULTS.slice()); }
  };
})(typeof self !== 'undefined' ? self : this);
