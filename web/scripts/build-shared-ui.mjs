import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const web = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(web, 'public/generated');
await mkdir(out, { recursive: true });
await build({
  absWorkingDir: web,
  entryPoints: ['frontend/responsables.tsx'],
  outfile: path.join(out, 'responsables.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  jsx: 'automatic', minify: true,
  // El componente se importa desde la raíz compartida; resolver React desde web
  // evita depender de los paquetes nativos y las instalaciones del escritorio.
  alias: { react: path.join(web, 'node_modules/react'), 'react-dom': path.join(web, 'node_modules/react-dom') },
  define: { 'process.env.NODE_ENV': '"production"' },
});
// Sin preflight global: los estilos del módulo no reinician el resto del portal.
const css = '@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css" layer(utilities) source(none);\n@source "../../components/shared/ResponsablesSection.tsx";\n';
const output = await postcss([tailwind({ base: web, optimize: true })]).process(css, { from: path.join(web, 'frontend/shared.css'), to: path.join(out, 'responsables.css') });
await writeFile(path.join(out, 'responsables.css'), output.css);
console.log('Built shared desktop/web ResponsablesSection.');
