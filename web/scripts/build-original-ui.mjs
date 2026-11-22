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
await copyFile(absolute('src/Logo_bar.ico'), path.join(out, 'favicon.ico'));
console.log('Built original App.tsx and desktop screens with isolated web adapters. Desktop sources were not modified.');
