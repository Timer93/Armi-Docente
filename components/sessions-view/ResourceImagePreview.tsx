import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, RotateCcw, X } from 'lucide-react';

type Props = {
    src: string;
    title: string;
    onClose: () => void;
};

type Point = { x: number; y: number };

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.25;

const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

export const ResourceImagePreview: React.FC<Props> = ({ src, title, onClose }) => {
    const [zoom, setZoom] = useState(MIN_ZOOM);
    const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const dragOrigin = useRef<{ pointer: Point; image: Point } | null>(null);

    const resetView = () => {
        setZoom(MIN_ZOOM);
        setPosition({ x: 0, y: 0 });
        setDragging(false);
        dragOrigin.current = null;
    };

    const changeZoom = (nextValue: number) => {
        const nextZoom = clampZoom(nextValue);
        setZoom(nextZoom);
        if (nextZoom === MIN_ZOOM) setPosition({ x: 0, y: 0 });
    };

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (event.key === '+' || event.key === '=') setZoom((current) => clampZoom(current + ZOOM_STEP));
            if (event.key === '-') setZoom((current) => {
                const next = clampZoom(current - ZOOM_STEP);
                if (next === MIN_ZOOM) setPosition({ x: 0, y: 0 });
                return next;
            });
            if (event.key === '0') resetView();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (zoom <= MIN_ZOOM || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragOrigin.current = {
            pointer: { x: event.clientX, y: event.clientY },
            image: position
        };
        setDragging(true);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!dragging || !dragOrigin.current) return;
        setPosition({
            x: dragOrigin.current.image.x + event.clientX - dragOrigin.current.pointer.x,
            y: dragOrigin.current.image.y + event.clientY - dragOrigin.current.pointer.y
        });
    };

    const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        setDragging(false);
        dragOrigin.current = null;
    };

    return createPortal(
        <div
            className="fixed inset-0 z-[20000] flex h-screen w-screen select-none flex-col overflow-hidden bg-slate-950"
            role="dialog"
            aria-modal="true"
            aria-label={`Vista en pantalla completa: ${title}`}
        >
            <div className="pointer-events-none absolute left-4 top-4 z-20 max-w-[55vw] rounded-xl bg-slate-950/75 px-3 py-2 text-white backdrop-blur">
                <p className="truncate text-xs font-black uppercase tracking-wider">{title}</p>
                <p className="mt-0.5 text-[9px] font-semibold text-slate-300">Rueda: zoom · Clic y arrastre: mover · Doble clic o tecla 0: restablecer</p>
            </div>

            <div className="absolute right-4 top-4 z-30 flex items-center gap-2 rounded-2xl border border-white/15 bg-slate-900/85 p-2 shadow-2xl backdrop-blur">
                <button
                    type="button"
                    onClick={() => changeZoom(zoom - ZOOM_STEP)}
                    disabled={zoom <= MIN_ZOOM}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-900 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-35"
                    title="Alejar"
                    aria-label="Alejar imagen"
                >
                    <Minus className="h-5 w-5" strokeWidth={2.5} />
                </button>
                <span className="min-w-12 text-center text-[10px] font-black text-white">{Math.round(zoom * 100)}%</span>
                <button
                    type="button"
                    onClick={() => changeZoom(zoom + ZOOM_STEP)}
                    disabled={zoom >= MAX_ZOOM}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-900 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-35"
                    title="Acercar"
                    aria-label="Acercar imagen"
                >
                    <Plus className="h-5 w-5" strokeWidth={2.5} />
                </button>
                <button
                    type="button"
                    onClick={resetView}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-700 text-white transition hover:bg-slate-600"
                    title="Restablecer vista"
                    aria-label="Restablecer vista"
                >
                    <RotateCcw className="h-4 w-4" strokeWidth={2.5} />
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-600 text-white transition hover:bg-rose-500"
                    title="Cerrar"
                    aria-label="Cerrar vista en pantalla completa"
                >
                    <X className="h-5 w-5" strokeWidth={2.6} />
                </button>
            </div>

            <div
                className={`flex h-full w-full touch-none items-center justify-center overflow-hidden ${zoom > MIN_ZOOM ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'}`}
                onWheel={(event) => {
                    event.preventDefault();
                    changeZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={stopDragging}
                onPointerCancel={stopDragging}
                onDoubleClick={resetView}
            >
                <img
                    src={src}
                    alt={title}
                    draggable={false}
                    className="max-h-[96vh] max-w-[96vw] object-contain will-change-transform"
                    style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${zoom})` }}
                />
            </div>
        </div>,
        document.body
    );
};

