export type SessionMenuPoint = { x: number; y: number };
export const SESSION_RADIAL_SIZE = 48;

export function clampSessionMenuPoint(point: SessionMenuPoint, width: number, height: number): SessionMenuPoint {
    return {
        x: Math.max(12, Math.min(Math.max(12, width - SESSION_RADIAL_SIZE - 12), point.x)),
        y: Math.max(12, Math.min(Math.max(12, height - SESSION_RADIAL_SIZE - 12), point.y)),
    };
}

export function sessionRadialLayout(point: SessionMenuPoint, width: number, height: number, count = 8) {
    const cx = point.x + 24;
    const cy = point.y + 24;
    const sx = cx <= width / 2 ? 1 : -1;
    const sy = cy <= height / 2 ? 1 : -1;
    const specs = count === 7
        ? [[140, 0], [140, 22.5], [140, 45], [140, 67.5], [140, 90], [80, 0], [80, 90]]
        : [[140, 0], [140, 22.5], [140, 45], [140, 67.5], [140, 90], [80, 0], [80, 45], [80, 90]];
    const nodes = specs.map(([radius, angle]) => ({
        x: Math.max(12, Math.min(width - 56, cx + sx * radius * Math.cos(angle * Math.PI / 180) - 22)),
        y: Math.max(12, Math.min(height - 56, cy + sy * radius * Math.sin(angle * Math.PI / 180) - 22)),
    }));
    // Very short windows cannot fit an arc. Retain all actions in a compact
    // palette anchored beside the trigger rather than allowing overlaps.
    if (width < 300 || height < 300) {
        const candidates: SessionMenuPoint[] = [];
        for (let y = 12; y <= height - 56; y += 50) {
            for (let x = 12; x <= width - 56; x += 50) {
                if (Math.hypot(x + 22 - cx, y + 22 - cy) >= 52) candidates.push({ x, y });
            }
        }
        candidates.sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y));
        nodes.forEach((node, i) => { if (candidates[i]) Object.assign(node, candidates[i]); });
    }
    return nodes;
}
