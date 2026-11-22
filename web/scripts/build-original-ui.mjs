import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };

const web = fileURLToPath(new URL('../', import.meta.url));
const repo = path.resolve(web, '..');
const out = path.join(web, 'dist');
if (path.dirname(out) !== path.resolve(web) || path.basename(out) !== 'dist') throw new Error('Invalid generated output path');
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'assets'), { recursive: true });
const absolute = file => path.join(repo, file);
const webFile = file => path.join(web, 'frontend', file);
const isolated = new Set(['SyncLifecycleManager', 'BackgroundSyncIndicator', 'RemoteAccessIndicator', 'AppUpdaterOverlay', 'CloudSyncPanel', 'GeneralNotesOverlay']);
const desktopPkg = JSON.parse(await readFile(absolute('package.json'), 'utf8'));
const alias = Object.fromEntries(Object.keys(pkg.dependencies).map(name => [name, path.join(web, 'node_modules', name)]));
alias.xlsx = webFile('excel-disabled.js');
const originalSource = {
  name: 'armi-web-runtime-adapters',
  setup(bundler) {
    bundler.onResolve({ filter: /^armi-web-runtime$/ }, () => ({path:webFile('runtime.js')}));
    bundler.onResolve({ filter: /^armi-desktop-api-original$/ }, () => ({ path: absolute('services/apiService.ts') }));
    bundler.onResolve({ filter: /(?:AuthContext|apiService|observePortableStorage|SyncLifecycleManager|BackgroundSyncIndicator|RemoteAccessIndicator|AppUpdaterOverlay|CloudSyncPanel|GeneralNotesOverlay)(?:\.tsx?)?$/ }, args => {
      const target = path.resolve(args.resolveDir, args.path).replace(/\\/g, '/').replace(/\.tsx?$/, '');
      const normalizedRepo = repo.replace(/\\/g, '/');
      if (target === `${normalizedRepo}/components/auth/AuthContext`) return { path: webFile('auth.tsx') };
      if (target === `${normalizedRepo}/services/apiService`) return { path: webFile('desktop-api.ts') };
      if (target === `${normalizedRepo}/utils/observePortableStorage`) return { path: webFile('desktop-only.tsx') };
      if (target.startsWith(`${normalizedRepo}/components/`) && isolated.has(path.basename(target))) return { path: webFile('desktop-only.tsx') };
    });
    bundler.onLoad({ filter: /[\\/]components[\\/]auth[\\/]LoginScreen\.tsx$/ }, async args => {
      let contents = await readFile(args.path, 'utf8');
      const marker = 'onClick={loginAsDeveloper}';
      const location = contents.indexOf(marker);
      if (location < 0 || contents.indexOf(marker, location + marker.length) >= 0) throw new Error('Review the desktop login before publishing web');
      const start = contents.lastIndexOf('<button', location);
      const end = contents.indexOf('</button>', location);
      if (start < 0 || end < 0) throw new Error('Cannot isolate the desktop developer button');
      contents = contents.slice(0, start) + contents.slice(end + '</button>'.length);
      const remember = contents.indexOf('checked={remember}');
      if (remember >= 0) {
        const labelStart = contents.lastIndexOf('<label', remember);
        const labelEnd = contents.indexOf('</label>', remember);
        if (labelStart < 0 || labelEnd < 0) throw new Error('Review the desktop remember-login control');
        contents = contents.slice(0, labelStart) + contents.slice(labelEnd + '</label>'.length);
      }
      return { contents, loader: 'tsx', resolveDir: path.dirname(args.path) };
    });
    bundler.onLoad({ filter: /[\\/]components[\\/]DatosGeneralesView\.tsx$/ }, async args => {
      // Marcas exclusivas de la compilación web; el archivo de escritorio no cambia.
      const contents = (await readFile(args.path, 'utf8'))
        .replace('<div className="animate-fade-in pb-10">', '<div data-armi-web-editor="general" className="animate-fade-in pb-10">')
        .replace('<div className="flex flex-col items-center gap-3">','<div data-web-unavailable="" className="flex flex-col items-center gap-3">')
        .replaceAll('Guardado automatico', 'Sin cambios pendientes')
        .replaceAll('Guardado automático', 'Sin cambios pendientes')
        .replaceAll('SQL Server Activo','Datos en la web');
      if (!contents.includes('data-armi-web-editor="general"')) throw new Error('Review general editor marker');
      return { contents, loader: 'tsx', resolveDir: path.dirname(args.path) };
    });
    bundler.onLoad({ filter: /[\\/]components[\\/]StudentsView\.tsx$/ }, async args => {
      let contents = (await readFile(args.path, 'utf8')).replace('<div className="animate-fade-in pb-12">','<div data-armi-web-editor="students" className="animate-fade-in pb-12">');
      if (!contents.includes('data-armi-web-editor="students"')) throw new Error('Review student editor marker');
      for (const title of ['Importar Excel','Egresar Promoción Anterior','Migración Masiva']) contents = contents.replace(`title="${title}"`,`data-web-unavailable="" title="${title}"`);
      for (const handler of ['handleRevealPortalPassword(student)','handleOpenStudentPortalTest(student)','handleResetPortalPassword(student)']) contents = contents.replace(`onClick={() => { void ${handler}; }}`,`data-web-unavailable="" onClick={() => { void ${handler}; }}`);
      contents = contents.replace('title={`Ver foto de ${student.name}`}','data-web-unavailable="" title={`Ver foto de ${student.name}`}');
      const clearButton = '<button onClick={handleClearForm}';
      if (!contents.includes(clearButton)) throw new Error('Review web student delete action');
      contents = contents.replace(clearButton, '<button type="button" title="Eliminar estudiante seleccionado" disabled={!selectedStudentId || savingStudentIds.includes(selectedStudentId)} onClick={() => handleDeleteRequest(selectedStudentId)} className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-40">Eliminar seleccionado</button>' + clearButton);
      contents = contents.replaceAll('eliminado permanentemente','eliminado de la web');
      contents = contents.replaceAll('SQL Sincronizado - Gestión de Datos Estudiantiles','Registro de estudiantes · Web');
      return { contents, loader: 'tsx', resolveDir: path.dirname(args.path) };
    });
    bundler.onLoad({filter:/[\\/]components[\\/](AnnualProgramView|UnitsView|SessionsView)\.tsx$/}, async args => {
      let contents = await readFile(args.path,'utf8');
      const name = path.basename(args.path,'.tsx');
      const dataset = {AnnualProgramView:'annual',UnitsView:'units',SessionsView:'sessions'}[name];
      if (name === 'AnnualProgramView') {
        const marker = /return \(\s*<>\s*\{toast &&/;
        if (!marker.test(contents)) throw new Error('Review annual planning web editor');
        contents = contents.replace(marker,`return (<div data-armi-web-editor="${dataset}">{toast &&`);
        const lastFragment = contents.lastIndexOf('</>');
        if (lastFragment < 0) throw new Error('Missing annual editor closing fragment');
        contents = contents.slice(0,lastFragment) + '</div>' + contents.slice(lastFragment+3);
        contents = contents.replaceAll('Sincronización Año','Guardado web Año');
      } else {
        const marker = '<div className="animate-fade-in pb-20 space-y-6 relative">';
        if (!contents.includes(marker)) throw new Error(`Review ${dataset} planning web editor`);
        contents = contents.replace(marker,`<div data-armi-web-editor="${dataset}" className="animate-fade-in pb-20 space-y-6 relative">`);
      }
      contents = contents.replaceAll('Unidad Sincronizada.','Unidad guardada en la web.');
      return {contents,loader:'tsx',resolveDir:path.dirname(args.path)};
    });
    bundler.onLoad({filter:/[\\/]sessions-view[\\/]SessionActions\.tsx$/}, async args => {
      let contents = await readFile(args.path,'utf8');
      const marker = ".filter(action => action.id !== 'clear' || !!props.onClear)";
      if (!contents.includes(marker)) throw new Error('Review planning actions for web');
      contents = "import {getWebIdentity as getArmiWebIdentity} from 'armi-web-runtime';\n" + contents.replace(marker, marker + ".map(action => ({...action,disabled:action.disabled || !getArmiWebIdentity()?.academic?.planningEditable || ['ai','template','settings'].includes(action.id)}))");
      return {contents,loader:'tsx',resolveDir:path.dirname(args.path)};
    });
    bundler.onLoad({filter:/[\\/]sessions-view[\\/]SessionManager\.tsx$/}, async args => {
      const contents = (await readFile(args.path,'utf8')).replace(/return createPortal\(\s*<div /,'return createPortal(<div data-armi-web-editor="sessions" ');
      if (!contents.includes('data-armi-web-editor="sessions"')) throw new Error('Review saved session manager for web');
      return {contents,loader:'tsx',resolveDir:path.dirname(args.path)};
    });
    bundler.onLoad({filter:/[\\/]sessions-view[\\/]SessionLearningResources\.tsx$/}, async args => {
      let contents = await readFile(args.path,'utf8');
      // These resources depend on desktop-generated files and Drive. Keep them
      // in consultation while enabling the authored lesson text around them.
      const index = contents.indexOf('    return (');
      const tail = contents.slice(index).replace(/(return \(\s*<>\s*)<div /,'$1<div data-web-unavailable="" ');
      contents = contents.slice(0,index)+tail;
      if (index < 0 || !contents.includes('data-web-unavailable')) throw new Error('Review web learning resources');
      return {contents,loader:'tsx',resolveDir:path.dirname(args.path)};
    });
    bundler.onLoad({ filter: /[\\/]index\.css$/ }, async args => {
      if (path.resolve(args.path) !== absolute('index.css')) return;
      const cssPath = value => value.replace(/\\/g, '/');
      let css = await readFile(args.path, 'utf8');
      css = css.replace('@import "tailwindcss";', `@import "${cssPath(path.join(web, 'node_modules/tailwindcss/index.css'))}" source(none);\n@source "${cssPath(absolute('App.tsx'))}";\n@source "${cssPath(absolute('components'))}";\n@source "${cssPath(path.join(web, 'frontend'))}";`);
      for (const file of ['react-quill-new/dist/quill.snow.css', 'quill/dist/quill.bubble.css']) css = css.replace(`"${file}"`, `"${cssPath(path.join(web, 'node_modules', file))}"`);
      const result = await postcss([tailwind({ base: repo, optimize: true })]).process(css, { from: args.path, map: false });
      return { contents: result.css, loader: 'css', resolveDir: path.dirname(args.path) };
    });
  },
};
await build({
  absWorkingDir: web, entryPoints: [{ in: 'frontend/entry.tsx', out: 'web' }],
  outdir: path.join(out, 'assets'), assetNames: '[name]-[hash]', chunkNames: 'chunks/[name]-[hash]',
  publicPath: '/assets',
  bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022',
  jsx: 'automatic', minify: true, alias, plugins: [originalSource],
  loader: Object.fromEntries(['.png', '.jpg', '.jpeg', '.svg', '.ico', '.gif', '.woff', '.woff2', '.ttf'].map(extension => [extension, 'file'])),
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.API_KEY': '""', 'process.env.GEMINI_API_KEY': '""', __APP_VERSION__: JSON.stringify(desktopPkg.version) },
  metafile: true,
}).then(async result => {
  // Evidencia de qué componentes originales entraron en la compilación; no se publica.
  await writeFile(path.join(web, '.web-build-inputs.json'), JSON.stringify(Object.keys(result.metafile.inputs), null, 2));
});
await copyFile(path.join(web, 'public/index.html'), path.join(out, 'index.html'));
await copyFile(path.join(web, 'public/_headers'), path.join(out, '_headers'));
await copyFile(path.join(web, 'public/curriculum.json'), path.join(out, 'curriculum.json'));
await copyFile(absolute('src/Logo_bar.ico'), path.join(out, 'favicon.ico'));
console.log('Built original App.tsx and desktop screens with isolated web adapters. Desktop sources were not modified.');
