// A short radial water wave, inspired by https://nicopowa.github.io/ripples3/.
// Only the clicked control updates; no full-screen simulation or idle loop.
export function startSessionWaterRipple(
    element: HTMLElement,
    displacement: SVGFEImageElement,
    reflection: SVGFEImageElement,
    strength: SVGFEDisplacementMapElement,
    point?: { x: number; y: number },
) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
    const bounds = element.getBoundingClientRect();
    const width = Math.max(1, Math.min(256, Math.round(element.offsetWidth)));
    const height = Math.max(1, Math.min(96, Math.round(element.offsetHeight)));
    const originX = point ? (point.x - bounds.left) * width / bounds.width : width / 2;
    const originY = point ? (point.y - bounds.top) * height / bounds.height : height / 2;
    const canvas = document.createElement('canvas');
    const lightCanvas = document.createElement('canvas');
    canvas.width = lightCanvas.width = width;
    canvas.height = lightCanvas.height = height;
    const context = canvas.getContext('2d');
    const lightContext = lightCanvas.getContext('2d');
    if (!context || !lightContext) return () => {};
    const field = context.createImageData(width, height);
    const light = lightContext.createImageData(width, height);
    const duration = 820;
    const band = Math.max(3.5, Math.min(width, height) * .15);
    const frequency = 2 * Math.PI / 9;
    const started = performance.now();
    let frame = 0;
    let previous = -Infinity;
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
        stopped = true;
        cancelAnimationFrame(frame);
        if (timeout !== undefined) clearTimeout(timeout);
        strength.setAttribute('scale', '0');
        reflection.setAttribute('href', EMPTY_WATER_LIGHT);
        delete element.dataset.waterRipple;
    };
    const draw = (now: number) => {
        if (stopped) return;
        const elapsed = now - started;
        if (elapsed >= duration || !element.isConnected) return finish();
        if (now - previous < 1000 / 30) {
            frame = requestAnimationFrame(draw);
            return;
        }
        previous = now;
        const front = elapsed / duration * Math.max(width, height) * 1.4;
        const fade = Math.pow(1 - elapsed / duration, 1.35);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const dx = x - originX;
                const dy = y - originY;
                const distance = Math.max(.001, Math.hypot(dx, dy));
                const offset = distance - front;
                const phase = offset * frequency;
                const envelope = Math.exp(-offset * offset / (2 * band * band)) * fade;
                const slope = 1.45 * envelope * (frequency * Math.cos(phase) - offset / (band * band) * Math.sin(phase));
                const nx = slope * dx / distance;
                const ny = slope * dy / distance;
                const i = (y * width + x) * 4;
                field.data[i] = 128 + nx * 90;
                field.data[i + 1] = 128 + ny * 90;
                field.data[i + 2] = 0;
                field.data[i + 3] = 255;
                const highlight = (nx * -.55 + ny * -.83);
                const color = highlight > 0 ? 255 : 0;
                light.data[i] = light.data[i + 1] = light.data[i + 2] = color;
                light.data[i + 3] = Math.min(65, Math.abs(highlight) * 62);
            }
        }
        context.putImageData(field, 0, 0);
        lightContext.putImageData(light, 0, 0);
        displacement.setAttribute('href', canvas.toDataURL());
        reflection.setAttribute('href', lightCanvas.toDataURL());
        strength.setAttribute('scale', '12');
        frame = requestAnimationFrame(draw);
    };
    element.dataset.waterRipple = 'active';
    // RAF can pause when the window is hidden. Always restore the idle filter.
    timeout = setTimeout(finish, duration + 40);
    draw(started);
    return finish;
}

export const NEUTRAL_WATER_MAP = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"%3E%3Cpath fill="rgb(128,128,0)" d="M0 0h1v1H0z"/%3E%3C/svg%3E';
export const EMPTY_WATER_LIGHT = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E';
