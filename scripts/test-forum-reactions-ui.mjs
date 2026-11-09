import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const { window, document } = parseHTML('<html><body><main id="forum"></main></body></html>');
window.HTMLElement.prototype.scrollIntoView = () => {};
Object.defineProperty(window.HTMLElement.prototype, 'elements', { get() { return Object.fromEntries([...this.querySelectorAll('[name]')].map(node => [node.name, node])); } });
const root = document.getElementById('forum');
const post = { id: 'post1', authorName: 'Estudiante', createdAt: new Date().toISOString(), title: 'Proyecto', body: 'Una idea', category: 'aporte', attachments: [], commentCount: 1, canComment: false, reviewedAt: new Date().toISOString(), reactions: { counts: { like: 0, heart: 0, idea: 0 }, mine: '' } };
const comment = { id: 'comment1', authorName: 'Compañero', createdAt: post.createdAt, body: 'Buen proyecto', reviewedAt: post.reviewedAt, reactions: { counts: { like: 0, heart: 0, idea: 0 }, mine: '' } };
const calls = [];
const feedQueries = [];
let scopes = [];
const api = async (url, options = {}) => {
  if (url.endsWith('/draft')) return { data: { post: {}, comments: {} } };
  if (url.endsWith('/resources')) return { sessions: [], evidences: [] };
  if (url.endsWith('/notifications')) return { items: [], unread: 0 };
  if (url.endsWith('/attachments/remove')) {
    const { attachmentIds } = JSON.parse(options.body);
    post.attachments = post.attachments.filter(file => !attachmentIds.includes(file.id));
    post.attachmentRemovalRemaining -= 1;
    calls.push([url, attachmentIds]); return { remaining: post.attachmentRemovalRemaining };
  }
  if (url.endsWith('/reaction')) {
    calls.push([url, JSON.parse(options.body).reaction]);
    const reaction = calls.at(-1)[1];
    return { counts: { like: Number(reaction === 'like'), heart: Number(reaction === 'heart'), idea: Number(reaction === 'idea') }, mine: reaction };
  }
  if (url.includes('/posts?')) { feedQueries.push(new URL(url, 'http://localhost').searchParams); return { posts: [post], total: 1, classroom: { year: '2026' }, scopes }; }
  return { post, comments: [comment], total: 1 };
};
vm.runInNewContext(fs.readFileSync('backend/public/student-forum.js', 'utf8'), { window, document, crypto: globalThis.crypto, URL, URLSearchParams, FormData, Intl, Date, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, localStorage: { getItem: () => null, setItem() {} } });
const controller = window.armiForumPortal.create(root, { api, token: () => 'test', student: () => ({ id: 'student1' }) });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
controller.open(); await flush();
assert.match(root.textContent, /Visto y aprobado por el docente/);
const reactionButton = (kind, reaction) => root.querySelector(`[data-reaction-kind="${kind}"][data-forum-reaction="${reaction}"]`);
reactionButton('posts', 'like').onclick(); await flush();
assert.equal(reactionButton('posts', 'like').getAttribute('aria-pressed'), 'true');
assert.equal(reactionButton('posts', 'like').querySelector('b').textContent, '1');
reactionButton('posts', 'heart').onclick(); await flush();
assert.equal(reactionButton('posts', 'like').getAttribute('aria-pressed'), 'false');
reactionButton('posts', 'heart').onclick(); await flush();
assert.equal(calls.at(-1)[1], '');
root.querySelector('[data-forum-post]').onclick(); await flush();
reactionButton('comments', 'idea').onclick(); await flush();
assert.equal(calls.at(-1)[0], '/api/student-portal/forum/comments/comment1/reaction');
assert.equal(reactionButton('comments', 'idea').getAttribute('aria-pressed'), 'true');
assert.equal(root.querySelectorAll('.forum-reviewed').length, 2);
controller.reset();
post.own = true; post.unitNumber = '3'; post.bimester = 'II'; post.attachmentRemovalRemaining = 3;
post.attachments = ['file1', 'file2', 'file3'].map(id => ({ id, name: `${id}.txt`, kind: 'text', size: 10 }));
window.confirm = () => true;
controller.open(); await flush();
root.querySelector('[data-forum-bimester="II"]').onclick(); await flush();
assert.equal(feedQueries.at(-1).get('bimester'), 'II');
assert.equal(root.querySelector('[data-forum-unit="7"]'), null, 'Other bimesters units are hidden');
root.querySelector('[data-forum-unit="3"]').onclick(); await flush();
assert.equal(feedQueries.at(-1).get('unit'), '3');
assert.equal(root.querySelector('.forum-post').dataset.forumTone, '3');
assert.match(root.querySelector('.forum-period-label').textContent, /Unidad 3/);
root.querySelector('[data-forum-post]').onclick(); await flush();
let removal = root.querySelector('[data-forum-remove-files]');
removal.querySelector('input[value="file1"]').setAttribute('checked', '');
removal.querySelector('input[value="file2"]').setAttribute('checked', '');
removal.dispatchEvent(new window.Event('submit', { cancelable: true })); await flush();
assert.equal(calls.at(-1)[0], '/api/student-portal/forum/posts/post1/attachments/remove');
assert.deepEqual([...calls.at(-1)[1]], ['file1', 'file2']);
assert.match(root.querySelector('[data-forum-remove-files]').textContent, /Te quedan 2 de 3/);
assert.equal(root.querySelector('[data-forum-file="file1"]'), null);
controller.reset(); scopes = [{ type: 'bimester', value: 'II', closed: 1 }];
controller.open(); await flush(); root.querySelector('[data-forum-bimester="II"]').onclick(); await flush();
assert.ok(root.querySelector('[data-forum-new]').hasAttribute('disabled'));
assert.match(root.textContent, /Este foro está cerrado/);
controller.reset();
console.log('OK: reacciones, aprobación, pestañas de bimestre/unidad, color por unidad, eliminación múltiple y aviso de foro cerrado.');
