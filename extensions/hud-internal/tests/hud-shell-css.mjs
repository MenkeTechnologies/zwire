// HUD shell header layout (pages/zg-boot.js injectCss) vs the zgui-core cascade.
//
// The shell mounts a real <header class="zb-header"> holding two stacked rows:
// .zb-header-inner (logo + filter) and .zb-navrow (page nav). zgui-core's
// cyberpunk.css styles the BARE `header` ELEMENT as a flex row with
// justify-content:space-between — and an element rule wins over a class rule that
// never declares `display`. With no override the two rows became flex siblings:
// nav pushed to the right edge, inner squeezed, and the filter (margin-left:auto,
// 240px basis) wrapped under the logo — rendering a row too low and spilling past
// the header's bottom border. These assertions pin the override AND the reason for
// it, so the day cyberpunk.css stops flexing `header` we find out here.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const SHELL = fs.readFileSync(new URL('../pages/zg-boot.js', import.meta.url), 'utf8');
const CYBER = fs.readFileSync(new URL('../lib/zgui-core/webui/cyberpunk.css', import.meta.url), 'utf8');
const ALL = fs.readFileSync(new URL('../lib/zgui-core/webui/all.css', import.meta.url), 'utf8');

// --- the injected shell stylesheet ------------------------------------------
// The rules live as string literals in injectCss(); join them the way the module does.
// Comments in that block carry apostrophes, so drop them before pairing quotes.
const block = SHELL.slice(SHELL.indexOf("s.id = 'zb-shell-css'"), SHELL.indexOf('document.head.appendChild(s)'))
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const css = (block.match(/'([^']*)'/g) || []).map((s) => s.slice(1, -1)).join('');
assert.ok(css.includes('.zb-header{'), 'injectCss no longer emits a .zb-header rule');

function rule(sel) {
  const at = css.indexOf(sel + '{');
  assert.notEqual(at, -1, sel + ' rule missing from the shell stylesheet');
  return css.slice(at + sel.length + 1, css.indexOf('}', at));
}

// The load-bearing override: without an explicit display the element rule applies.
assert.match(rule('.zb-header'), /display:\s*block/, '.zb-header must declare display:block to beat cyberpunk.css header{display:flex}');
// The rows are only stacked because the header is a block box; each is its own flex row.
assert.match(rule('.zb-header-inner'), /display:\s*flex/);
assert.match(rule('.zb-navrow'), /display:\s*flex/);
// The filter rides the logo row on the right and shrinks rather than wrapping below it.
const filter = rule('.zb-filter');
assert.match(filter, /margin-left:\s*auto/);
assert.match(filter, /flex:\s*0 1 /, '.zb-filter must be shrinkable or it wraps onto a second header line');

// --- the cascade this override exists to beat --------------------------------
assert.match(ALL, /@import url\("\.\/cyberpunk\.css"\)/, 'HUD pages load cyberpunk.css through all.css');
const headerRule = CYBER.slice(CYBER.indexOf('\nheader {'), CYBER.indexOf('header::after'));
assert.match(headerRule, /display:\s*flex/, 'cyberpunk.css no longer flexes bare <header> — the .zb-header override can be revisited');
assert.match(headerRule, /justify-content:\s*space-between/);

console.log('hud shell header css: ok');
