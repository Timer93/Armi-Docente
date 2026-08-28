export type OptimizableImageKind = 'general_insignia' | 'general_logo' | 'session_resource';

type ImageOptimizationPreset = {
  maxWidth: number;
  maxHeight: number;
  jpegQuality: number;
};

const IMAGE_OPTIMIZATION_PRESETS: Record<OptimizableImageKind, ImageOptimizationPreset> = {
  // Se conserva por compatibilidad; los recursos de sesión se guardan sin transformar.
  session_resource: { maxWidth: 1200, maxHeight: 1600, jpegQuality: 0.92 },
  // Los elementos institucionales se muestran a menor tamaño en encabezados y pies.
  general_insignia: { maxWidth: 240, maxHeight: 240, jpegQuality: 0.9 },
  general_logo: { maxWidth: 240, maxHeight: 240, jpegQuality: 0.9 },
};

const imageMimeFromDataUrl = (value: string) =>
  String(value || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/)?.[1]?.toLowerCase() || '';

const estimatedDataUrlBytes = (value: string) => {
  const base64 = String(value || '').split(',')[1] || '';
  return Math.max(0, Math.floor((base64.length * 3) / 4));
};

const loadDataUrlImage = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('No se pudo preparar la imagen para optimizarla.'));
  image.src = dataUrl;
});

const canvasContainsTransparency = (context: CanvasRenderingContext2D, width: number, height: number) => {
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) return true;
  }
  return false;
};

/**
 * Optimiza las imágenes que terminarán en documentos Word.
 * - Nunca amplía una imagen pequeña.
 * - Conserva PNG cuando existe transparencia.
 * - Convierte imágenes opacas a JPEG de alta calidad.
 * - SVG y GIF se conservan para no rasterizar vectores ni perder animación.
 */
export const optimizeImageDataUrl = async (
  imageData: string,
  kind: OptimizableImageKind,
): Promise<string> => {
  const source = String(imageData || '').trim();
  // Instructivo, Anexo 1 y Anexo 2 deben conservar exactamente sus píxeles,
  // formato y compresión originales. La optimización del DOCX se hará aparte.
  if (kind === 'session_resource') return source;
  const mimeType = imageMimeFromDataUrl(source);
  if (!mimeType || !IMAGE_OPTIMIZATION_PRESETS[kind]) return source;
  if (mimeType.includes('svg') || mimeType.includes('gif')) return source;
  if (typeof document === 'undefined' || typeof Image === 'undefined') return source;

  try {
    const image = await loadDataUrlImage(source);
    const sourceWidth = Number(image.naturalWidth || image.width || 0);
    const sourceHeight = Number(image.naturalHeight || image.height || 0);
    if (!sourceWidth || !sourceHeight) return source;

    const preset = IMAGE_OPTIMIZATION_PRESETS[kind];
    const scale = Math.min(1, preset.maxWidth / sourceWidth, preset.maxHeight / sourceHeight);
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
    const resized = targetWidth !== sourceWidth || targetHeight !== sourceHeight;

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return source;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    const canContainAlpha = mimeType.includes('png') || mimeType.includes('webp');
    const hasTransparency = canContainAlpha
      ? canvasContainsTransparency(context, targetWidth, targetHeight)
      : false;

    if (hasTransparency) {
      // Si ya está dentro del límite, conservar el PNG original evita una recompresión innecesaria.
      if (!resized && mimeType.includes('png')) return source;
      return canvas.toDataURL('image/png');
    }

    const optimized = canvas.toDataURL('image/jpeg', preset.jpegQuality);
    if (!resized && estimatedDataUrlBytes(optimized) >= estimatedDataUrlBytes(source) * 0.95) {
      return source;
    }
    return optimized;
  } catch (error) {
    console.warn('No se pudo optimizar la imagen; se conservará el archivo original.', error);
    return source;
  }
};
