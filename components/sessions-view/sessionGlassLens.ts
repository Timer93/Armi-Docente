/*!
MIT License

Copyright (c) 2026 Archis Vaze

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
// Optical maps adapted from https://github.com/archisvaze/liquid-glass (SVG demo).
        function calculateRefractionProfile(glassThickness, bezelWidth, heightFn, ior, samples) {
            samples = samples || 128;
            const eta = 1 / ior;
            function refract(nx, ny) {
                const dot = ny;
                const k = 1 - eta * eta * (1 - dot * dot);
                if (k < 0) return null;
                const sq = Math.sqrt(k);
                return [-(eta * dot + sq) * nx, eta - (eta * dot + sq) * ny];
            }
            const profile = new Float64Array(samples);
            for (let i = 0; i < samples; i++) {
                const x = i / samples;
                const y = heightFn(x);
                const dx = x < 1 ? 0.0001 : -0.0001;
                const y2 = heightFn(x + dx);
                const deriv = (y2 - y) / dx;
                const mag = Math.sqrt(deriv * deriv + 1);
                const ref = refract(-deriv / mag, -1 / mag);
                if (!ref) {
                    profile[i] = 0;
                    continue;
                }
                profile[i] = ref[0] * ((y * bezelWidth + glassThickness) / ref[1]);
            }
            return profile;
        }

        function generateDisplacementMap(w, h, radius, bezelWidth, profile, maxDisp) {
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d');
            const img = ctx.createImageData(w, h);
            const d = img.data;
            for (let i = 0; i < d.length; i += 4) {
                d[i] = 128;
                d[i + 1] = 128;
                d[i + 2] = 0;
                d[i + 3] = 255;
            }

            const r = radius,
                rSq = r * r,
                r1Sq = (r + 1) ** 2;
            const rBSq = Math.max(r - bezelWidth, 0) ** 2;
            const wB = w - r * 2,
                hB = h - r * 2,
                S = profile.length;

            for (let y1 = 0; y1 < h; y1++) {
                for (let x1 = 0; x1 < w; x1++) {
                    const x = x1 < r ? x1 - r : x1 >= w - r ? x1 - r - wB : 0;
                    const y = y1 < r ? y1 - r : y1 >= h - r ? y1 - r - hB : 0;
                    const dSq = x * x + y * y;
                    if (dSq > r1Sq || dSq < rBSq) continue;
                    const dist = Math.sqrt(dSq);
                    const fromSide = r - dist;
                    const op = dSq < rSq ? 1 : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq));
                    if (op <= 0 || dist === 0) continue;
                    const cos = x / dist,
                        sin = y / dist;
                    const bi = Math.min(((fromSide / bezelWidth) * S) | 0, S - 1);
                    const disp = profile[bi] || 0;
                    const dX = (-cos * disp) / maxDisp,
                        dY = (-sin * disp) / maxDisp;
                    const idx = (y1 * w + x1) * 4;
                    d[idx] = (128 + dX * 127 * op + 0.5) | 0;
                    d[idx + 1] = (128 + dY * 127 * op + 0.5) | 0;
                }
            }
            ctx.putImageData(img, 0, 0);
            return c.toDataURL();
        }

        function generateSpecularMap(w, h, radius, bezelWidth, angle) {
            angle = angle != null ? angle : Math.PI / 3;
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d');
            const img = ctx.createImageData(w, h);
            const d = img.data;
            d.fill(0);

            const r = radius,
                rSq = r * r,
                r1Sq = (r + 1) ** 2;
            const rBSq = Math.max(r - bezelWidth, 0) ** 2;
            const wB = w - r * 2,
                hB = h - r * 2;
            const sv = [Math.cos(angle), Math.sin(angle)];

            for (let y1 = 0; y1 < h; y1++) {
                for (let x1 = 0; x1 < w; x1++) {
                    const x = x1 < r ? x1 - r : x1 >= w - r ? x1 - r - wB : 0;
                    const y = y1 < r ? y1 - r : y1 >= h - r ? y1 - r - hB : 0;
                    const dSq = x * x + y * y;
                    if (dSq > r1Sq || dSq < rBSq) continue;
                    const dist = Math.sqrt(dSq);
                    const fromSide = r - dist;
                    const op = dSq < rSq ? 1 : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq));
                    if (op <= 0 || dist === 0) continue;
                    const cos = x / dist,
                        sin = -y / dist;
                    const dot = Math.abs(cos * sv[0] + sin * sv[1]);
                    const edge = Math.sqrt(Math.max(0, 1 - (1 - fromSide) ** 2));
                    const coeff = dot * edge;
                    const col = (255 * coeff) | 0;
                    const alpha = (col * coeff * op) | 0;
                    const idx = (y1 * w + x1) * 4;
                    d[idx] = col;
                    d[idx + 1] = col;
                    d[idx + 2] = col;
                    d[idx + 3] = alpha;
                }
            }
            ctx.putImageData(img, 0, 0);
            return c.toDataURL();
        }

export function createSessionGlassLens(width: number, height: number, radius: number) {
    const bezel = Math.max(1, Math.min(radius - 1, height * 0.15));
    const profile = calculateRefractionProfile(height * 0.32, bezel,
        (x: number) => Math.pow(1 - Math.pow(1 - x, 4), 0.25), 1.7, 128);
    const scale = Math.max(...Array.from(profile).map(Math.abs)) || 1;
    return {
        width, height, scale,
        displacement: generateDisplacementMap(width, height, radius, bezel, profile, scale),
        specular: generateSpecularMap(width, height, radius, bezel * 2.5, Math.PI / 3),
    };
}