// Notes store test (pages/notes.js). The page exposes its pure store helpers on
// window.ZBNotes and bails before touching chrome/DOM when the HUD shell is
// absent, so it loads headless here. Covers the folder tree + delete-cascade +
// search that the Vivaldi-style Notes view is built on.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../pages/notes.js', import.meta.url), 'utf8');
const win = {};
new Function('window', src)(win);
const N = win.ZBNotes;
assert.ok(N && N.childrenOf, 'window.ZBNotes not exposed');

const notes = [
  { id: 'f1', parentId: null, type: 'folder', title: 'Work', content: '', ts: 1 },
  { id: 'n1', parentId: 'f1', type: 'note', title: 'Standup', content: 'daily sync', ts: 2 },
  { id: 'n2', parentId: 'f1', type: 'note', title: '', content: '# Roadmap\nq3 plan', ts: 3 },
  { id: 'n3', parentId: null, type: 'note', title: 'Scratch', content: 'todo: milk', url: 'https://x.com', ts: 4 },
];

// childrenOf groups by parent.
assert.equal(N.childrenOf(notes, 'f1').length, 2, 'two notes under Work');
assert.equal(N.childrenOf(notes, null).length, 2, 'folder + root note at top level');
assert.equal(N.folders(notes).length, 1);

// title falls back to the first markdown line (heading stripped).
assert.equal(N.noteTitle(notes[1]), 'Standup', 'explicit title wins');
assert.equal(N.noteTitle(notes[2]), 'Roadmap', 'first-line heading used when title empty');
assert.equal(N.firstLine('# Hello\nrest'), 'Hello');

// search matches title, content, and url (case-insensitive).
assert.ok(N.matchNote(notes[1], 'sync'), 'content match');
assert.ok(N.matchNote(notes[3], 'X.COM'), 'url match, case-insensitive');
assert.ok(!N.matchNote(notes[1], 'zzz'));

// delete cascades: removing the folder drops its child notes too.
assert.deepEqual(N.descendantIds(notes, 'f1').sort(), ['n1', 'n2']);
const afterFolder = N.removeNode(notes, 'f1');
assert.equal(afterFolder.length, 1, 'folder + its 2 notes removed, root note remains');
assert.equal(afterFolder[0].id, 'n3');

// deleting a single note leaves the rest.
const afterNote = N.removeNode(notes, 'n3');
assert.equal(afterNote.length, 3);
assert.ok(!N.byId(afterNote, 'n3'));

console.log('notes store: all assertions passed');
