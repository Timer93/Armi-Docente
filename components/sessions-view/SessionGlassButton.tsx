import React, { useEffect, useId, useRef, useState } from 'react';
import { createSessionGlassLens } from './sessionGlassLens';
import { EMPTY_WATER_LIGHT, NEUTRAL_WATER_MAP, startSessionWaterRipple } from './sessionWaterRipple';
import './session-glass.css';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: 'neutral' | 'mint';
};

export function SessionGlassButton({ children, className = '', style, tone = 'neutral', type = 'button', onClick, ...props }: Props) {
    const button = useRef<HTMLButtonElement>(null);
    const waterMap = useRef<SVGFEImageElement>(null);
    const waterLight = useRef<SVGFEImageElement>(null);
    const waterStrength = useRef<SVGFEDisplacementMapElement>(null);
    const stopRipple = useRef<() => void>(() => {});
    const filterId = `session-lens-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const [lens, setLens] = useState<ReturnType<typeof createSessionGlassLens> | null>(null);
    useEffect(() => () => stopRipple.current(), []);

    useEffect(() => {
        const element = button.current;
        if (!element || !CSS.supports('backdrop-filter', 'url("#lens")')) return;
        let previousSize = '';
        const observer = new ResizeObserver(([entry]) => {
            const width = Math.min(256, Math.round(entry.borderBoxSize?.[0]?.inlineSize || element.offsetWidth));
            const height = Math.min(96, Math.round(entry.borderBoxSize?.[0]?.blockSize || element.offsetHeight));
            const radius = Math.min(parseFloat(getComputedStyle(element).borderTopLeftRadius) || 12, width / 2, height / 2);
            const size = `${width}:${height}:${radius}`;
            if (!width || !height || size === previousSize) return;
            previousSize = size;
            setLens(createSessionGlassLens(width, height, radius));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    return (
        <button {...props} ref={button} type={type}
            onClick={(event) => {
                stopRipple.current();
                if (waterMap.current && waterLight.current && waterStrength.current) {
                    stopRipple.current = startSessionWaterRipple(event.currentTarget,
                        waterMap.current, waterLight.current, waterStrength.current,
                        event.detail === 0 ? undefined : { x: event.clientX, y: event.clientY });
                }
                onClick?.(event);
            }}
            className={`session-glass-button ${className}`} data-tone={tone}
            style={{ ...style, ...(lens ? { '--session-glass-lens': `url("#${filterId}")` } : {}) } as React.CSSProperties}>
            {lens && <svg className="session-glass-filter" aria-hidden="true" focusable="false">
                <defs>
                    <filter id={filterId} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
                        <feGaussianBlur in="SourceGraphic" stdDeviation="0.3" result="softBackdrop" />
                        <feImage href={lens.displacement} x="0" y="0" width={lens.width} height={lens.height} result="lensMap" />
                        <feDisplacementMap in="softBackdrop" in2="lensMap" scale={lens.scale} xChannelSelector="R" yChannelSelector="G" result="refracted" />
                        <feColorMatrix in="refracted" type="saturate" values="1.6" result="saturated" />
                        <feImage href={lens.specular} x="0" y="0" width={lens.width} height={lens.height} result="specular" />
                        <feComposite in="saturated" in2="specular" operator="in" result="litEdge" />
                        <feComponentTransfer in="specular" result="reflection"><feFuncA type="linear" slope="0.5" /></feComponentTransfer>
                        <feBlend in="litEdge" in2="refracted" mode="normal" result="glass" />
                        <feBlend in="reflection" in2="glass" mode="normal" result="stillGlass" />
                        <feImage ref={waterMap} href={NEUTRAL_WATER_MAP} x="0" y="0" width={lens.width} height={lens.height} result="waterMap" />
                        <feDisplacementMap ref={waterStrength} in="stillGlass" in2="waterMap" scale="0" xChannelSelector="R" yChannelSelector="G" result="waterGlass" />
                        <feImage ref={waterLight} href={EMPTY_WATER_LIGHT} x="0" y="0" width={lens.width} height={lens.height} result="waterLight" />
                        <feBlend in="waterLight" in2="waterGlass" mode="normal" />
                    </filter>
                </defs>
            </svg>}
            <span className="session-glass-content">{children}</span>
        </button>
    );
}
