import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import pngToIco from 'png-to-ico';

const repoRoot = process.cwd();
const sourceIcoPath = path.join(repoRoot, 'src', 'Logo_bar.ico');
const buildDir = path.join(repoRoot, 'build');
const targetIcoPath = path.join(buildDir, 'icon.ico');
const tempDir = path.join(buildDir, 'generated-icon');
const iconSizes = [16, 24, 32, 48, 64, 128, 256];

const extractPngFromIco = (icoPath) => {
  const buffer = fs.readFileSync(icoPath);
  const imageBytes = buffer.readUInt32LE(14);
  const imageOffset = buffer.readUInt32LE(18);
  return buffer.subarray(imageOffset, imageOffset + imageBytes);
};

const runPowerShell = (script) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
      ['-NoProfile', '-Command', script],
      { stdio: 'inherit', shell: false }
    );

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error('No se pudieron generar las variantes PNG del icono.'));
    });
  });

const generatePngVariants = async (sourcePngPath, outputDir) => {
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    `$source = '${sourcePngPath.replace(/'/g, "''")}'`,
    `$outputDir = '${outputDir.replace(/'/g, "''")}'`,
    '$img = [System.Drawing.Image]::FromFile($source)',
    'foreach ($size in @(16,24,32,48,64,128,256)) {',
    '  $bmp = New-Object System.Drawing.Bitmap $size, $size',
    '  $graphics = [System.Drawing.Graphics]::FromImage($bmp)',
    '  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality',
    '  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality',
    '  $graphics.Clear([System.Drawing.Color]::Transparent)',
    '  $graphics.DrawImage($img, 0, 0, $size, $size)',
    "  $target = Join-Path $outputDir ($size.ToString() + '.png')",
    '  $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)',
    '  $graphics.Dispose()',
    '  $bmp.Dispose()',
    '}',
    '$img.Dispose()',
  ].join('; ');

  await runPowerShell(script);
};

const main = async () => {
  if (!fs.existsSync(sourceIcoPath)) {
    throw new Error(`No se encontro el icono principal en ${sourceIcoPath}`);
  }

  fs.mkdirSync(buildDir, { recursive: true });
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const sourcePngPath = path.join(tempDir, 'source.png');
  fs.writeFileSync(sourcePngPath, extractPngFromIco(sourceIcoPath));

  await generatePngVariants(sourcePngPath, tempDir);

  const pngVariants = iconSizes.map((size) => path.join(tempDir, `${size}.png`));
  const icoBuffer = await pngToIco(pngVariants);
  fs.writeFileSync(targetIcoPath, icoBuffer);

  const count = icoBuffer.readUInt16LE(4);
  console.log(`Icono Windows preparado en ${targetIcoPath} con ${count} capas.`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
