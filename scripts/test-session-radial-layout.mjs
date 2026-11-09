import assert from 'node:assert/strict';
import { clampSessionMenuPoint, sessionRadialLayout } from '../components/sessions-view/sessionRadialLayout.ts';
let cases = 0;
for (const [width, height] of [[320,320],[360,640],[800,600],[1600,900],[320,180],[240,500]]) {
    for (const count of [7,8]) for (const fx of [0,.25,.49,.5,.75,1]) for (const fy of [0,.25,.49,.5,.75,1]) {
        const anchor = clampSessionMenuPoint({ x:fx*width, y:fy*height },width,height);
        const nodes=sessionRadialLayout(anchor,width,height,count);
        assert.equal(nodes.length,count);
        for (const [i,node] of nodes.entries()) {
            assert.ok(node.x>=11.9&&node.y>=11.9&&node.x+44<=width-11.9&&node.y+44<=height-11.9,`offscreen at ${width}x${height}`);
            assert.ok(Math.hypot(node.x+22-anchor.x-24,node.y+22-anchor.y-24)>=45.9,`overlaps trigger at ${width}x${height}`);
            for(const other of nodes.slice(i+1)) assert.ok(Math.hypot(other.x-node.x,other.y-node.y)>=43.9,`actions overlap at ${width}x${height}: ${JSON.stringify(nodes)}`);
        }
        cases++;
    }
}
console.log(`OK: ${cases} radial positions, edge clamping, action spacing and short-window fallback.`);
