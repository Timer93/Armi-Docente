import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

// DOM doubles cover controller navigation, escaping and retries. Visual QA is separate.
const status = { textContent: '', classList: { toggle() {} } };
let buttons = [];
const commentEvents = {};
const commentForm = { elements: { body: { value: '' } }, addEventListener(name, fn) { commentEvents[name] = fn; } };
const root = {
  html: '',
  set innerHTML(value) { this.html = value; buttons = [...value.matchAll(/data-forum-post="([^"]+)"/g)].map((match) => ({ dataset: { forumPost: match[1] } })); },
  get innerHTML() { return this.html; },
  querySelector: (selector) => selector === '[data-forum-status]' ? status : selector === '[data-forum-comment]' && root.html.includes('data-forum-comment class=') ? commentForm : null,
  querySelectorAll: (selector) => selector === '[data-forum-post]' ? buttons : [],
  scrollIntoView() {}, replaceChildren() { this.html = ''; }, addEventListener() {}
};
const post = { id: 'test-post-id-12345678', title: '<img src=x onerror=alert(1)>', body: 'Texto <script>alert(1)</script>', authorName: '<b>Autor</b>', category: 'aporte', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), own: false, attachments: [], commentCount: 1, canComment: true };
const listing = { posts: [post], total: 1, classroom: { grade: '5to', section: 'A', year: '2026' }, hasMore: false };
let pending = null;
let savedDraft = {};
const api = async (url, options = {}) => {
  if (pending) return await new Promise((resolve) => { pending.resolve = resolve; });
  if (url.endsWith('/draft')) { if (options.method === 'PUT') savedDraft = JSON.parse(options.body); return { data: savedDraft, updatedAt: new Date().toISOString() }; }
  if (url.endsWith('/resources')) return {sessions:[],evidences:[]};
  if (url.endsWith('/notifications')) return {items:[],unread:0};
  return url.includes('/posts?') ? listing : { post, comments: [{ id: 'comment1', authorName: 'Compañero', body: '<svg onload=alert(1)>', createdAt: new Date().toISOString(), own: false }], total: 1, hasMore: false };
};
const window = {};
vm.runInNewContext(fs.readFileSync('backend/public/student-forum.js', 'utf8'), { window, crypto: { getRandomValues: (bytes) => crypto.webcrypto.getRandomValues(bytes) }, URL, URLSearchParams, FormData, Uint8Array, Intl, Date, console, setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},localStorage:{getItem:()=>null,setItem(){}} });
const controller = window.armiForumPortal.create(root, { api, token: () => 'student-token' });
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
controller.open(); await flush();
assert.match(root.html, /Foro estudiantil/);
assert.match(root.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.doesNotMatch(root.html, /<script>alert/);
assert.doesNotMatch(root.html, /<b>Autor<\/b>/);
assert.ok(buttons.length > 0);
buttons[0].onclick(); await flush();
assert.match(root.html, /Conversación/);
assert.match(root.html, /&lt;svg onload=alert\(1\)&gt;/);
assert.doesNotMatch(root.html, /<svg onload/);
commentForm.elements.body.value = 'Mi respuesta todavía sin publicar'; commentEvents.input();
controller.leave(); await flush();
assert.equal(savedDraft.comments[post.id], 'Mi respuesta todavía sin publicar');
controller.reset(); controller.open(); await flush(); buttons[0].onclick(); await flush();
assert.equal(commentForm.elements.body.value, 'Mi respuesta todavía sin publicar', 'Leaving and signing in again restore the unpublished comment');
// Replies from an old page must not repopulate the forum after logout.
pending = {};
controller.open(); const before = root.html; await flush(); controller.reset();
await flush(); pending.resolve(listing); await flush(); assert.equal(root.html, '');
assert.match(before, /Cargando/);
console.log('OK: controlador del foro en HTTP local, navegación, textos seguros y descarte de respuestas tras cerrar sesión.');
