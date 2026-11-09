import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import sharp from 'sharp';
import { readPracticeImages, bindPracticeImages } from '../backend/interactiveImageLibrary.js';
import { validateStoredInteractiveActivity } from '../backend/interactiveHtml.js';
import { validateInteractiveHtml, buildInteractiveHtmlPrompt } from '../components/sessions-view/interactiveHtml.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-images-'));
try {
  for (const format of ['png', 'jpeg', 'gif', 'webp']) {
    await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffa500' } }).toFormat(format).toFile(path.join(root, `bot_${format}.${format}`));
  }
  fs.writeFileSync(path.join(root, 'bot_vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>');
  fs.writeFileSync(path.join(root, 'unsafe.svg'), '<svg><script>alert(1)</script></svg>');
  fs.writeFileSync(path.join(root, 'fake.png'), 'not an image');
  const library = await readPracticeImages(root);
  assert.equal(library.images.length, 5);
  assert.equal(library.warnings.length, 2);
  const html = '<html><head><title>Prueba</title><meta name="armi-activity-version" content="1"></head><body><header>Prueba</header><main><img data-armi-image="bot_png"><img hidden data-armi-image="bot-vector"><img hidden data-armi-image="bot_gif.gif"></main><footer>ARMI</footer><script>window.ARMI_PRACTICE.register({getState:()=>({}),restoreState:()=>{},getResult:()=>({score:0,maxScore:20})});window.parent.postMessage({type:"armi:activity-result",completed:true,maxScore:20},"*");</script></body></html>';
  const bound = await bindPracticeImages(html, root);
  assert.equal(bound.embedded.length, 3);
  assert.match(bound.html, /data:image\/gif;base64/);
  assert.doesNotMatch(bound.html, /data:image\/webp;base64/);
  assert.equal(validateInteractiveHtml(bound.html).valid, true);
  assert.equal(validateStoredInteractiveActivity({ id: '1', enabled: true, criterionId: 'c', html: bound.html }), true);
  assert.equal((await bindPracticeImages(bound.html, root)).html, bound.html);
  const withoutImages = html.replace(/<img\b[^>]*>/g, '');
  const omitted = await bindPracticeImages(withoutImages, root);
  assert.equal(omitted.html, withoutImages);
  assert.deepEqual(omitted.embedded, []);
  assert.ok(omitted.warnings.some((warning) => /no utiliza imágenes.*ARMI/.test(warning)));
  const emptyRoot = path.join(root, 'empty');
  fs.mkdirSync(emptyRoot);
  assert.deepEqual((await bindPracticeImages(withoutImages, emptyRoot)).warnings, []);
  await assert.rejects(bindPracticeImages(html.replace('bot_png', 'missing'), root), /Faltan imágenes/);
  // Execute the embedded bridge against DOM doubles, including a later expression change.
  const attrs = { 'data-armi-image': 'bot_png' };
  const image = { matches: () => true, getAttribute: (name) => attrs[name], setAttribute: (name, value) => { attrs[name] = value; } };
  let observer;
  const context = { document: { documentElement: { querySelectorAll: () => [image] } }, MutationObserver: class { constructor(fn) { observer = fn; } observe() {} } };
  vm.runInNewContext(bound.html.match(/<script data-armi-image-library>([\s\S]*?)<\/script>/)[1], context);
  assert.match(attrs.src, /^data:image\/png;base64,/);
  attrs['data-armi-image'] = 'bot_gif.gif';
  observer([{ type: 'attributes', target: image }]);
  assert.match(attrs.src, /^data:image\/gif;base64,/);
  fs.writeFileSync(path.join(root, 'bot_guiñando.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>');
  const unicodeBound = await bindPracticeImages(html.replace('bot_png', 'bot_guiñando'), root);
  assert.ok(unicodeBound.embedded.includes('bot_guiñando.svg'));
  attrs['data-armi-image'] = 'bot_guiñando';
  vm.runInNewContext(unicodeBound.html.match(/<script data-armi-image-library>([\s\S]*?)<\/script>/)[1], context);
  assert.match(attrs.src, /^data:image\/svg\+xml;base64,/);
  // The same state survives a format replacement without changing the HTML marker.
  fs.unlinkSync(path.join(root, 'bot_png.png'));
  await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffa500' } }).webp().toFile(path.join(root, 'bot_png.webp'));
  assert.ok((await bindPracticeImages(html, root)).embedded.includes('bot_png.webp'));
  const large = html.replace('<main>', `<main>${' '.repeat(800_000)}`);
  assert.equal(validateInteractiveHtml(large).valid, true);
  await assert.rejects(bindPracticeImages(' '.repeat(8 * 1024 * 1024 + 1), root), /8 MB/);
  const prompt = buildInteractiveHtmlPrompt({ imageNames: ['bot_png.png'] });
  assert.match(prompt, /Disponibles: bot_png.png/);
  assert.match(prompt, /<img hidden/);
  assert.match(prompt, /USO OBLIGATORIO/);
  assert.match(prompt, /personaje guía/);
  assert.doesNotMatch(prompt, /bot_sonriendo/);
  // Every example must reference an actual available state, even with one image.
  assert.ok([...prompt.matchAll(/data-armi-image="([^"]+)"/g)].every((match) => match[1] === 'bot_png'));
  const states = ['bot_saludando.png', 'bot_pensando.png', 'bot_celebrando.png', 'bot_confundido.png', 'bot_graduado.png'];
  const botPrompt = buildInteractiveHtmlPrompt({ imageNames: states });
  assert.match(botPrompt, /bienvenida: bot_saludando/);
  assert.match(botPrompt, /reto en curso: bot_pensando/);
  assert.match(botPrompt, /acierto: bot_celebrando/);
  assert.match(botPrompt, /error con ánimo para continuar: bot_confundido/);
  assert.match(botPrompt, /resultado final: bot_graduado/);
  const generatedDeclarations = [...prompt.matchAll(/<img\b[^>]*>/g)]
    .map((match) => match[0]).join('');
  const fromPrompt = await bindPracticeImages(withoutImages.replace('<main>', `<main>${generatedDeclarations}`), root);
  assert.deepEqual(fromPrompt.embedded, ['bot_png.webp']);
  const emptyPrompt = buildInteractiveHtmlPrompt({ imageNames: [] });
  assert.match(emptyPrompt, /biblioteca está vacía: usa CSS\/SVG/);
  assert.doesNotMatch(emptyPrompt, /data-armi-image="|USO OBLIGATORIO/);
  console.log('OK: formatos, SVG seguro, imágenes incrustadas, estados dinámicos, reimportación y límites.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
