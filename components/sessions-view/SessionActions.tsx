import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Database, Eraser, FileText, Grip, LoaderCircle, Palette, Save, Settings2, Sparkles, Volume2, VolumeX, X, type LucideIcon } from 'lucide-react';
import { SessionGlassButton } from './SessionGlassButton';
import { clampSessionMenuPoint, sessionRadialLayout, type SessionMenuPoint } from './sessionRadialLayout';
import { useSessionActionSound } from './useSessionActionSound';
import './session-radial.css';

const POSITION_KEY = 'armi_sessions_radial_position_v1';
const sessionViewport = () => ({ width: document.documentElement.clientWidth || innerWidth, height: innerHeight });
type SessionAction = { id: string; label: string; short: string; Icon: LucideIcon; disabled?: boolean; run: () => unknown };
type Props = {
    module?: 'sessions' | 'units';
    headerRef: React.RefObject<HTMLDivElement | null>;
    themeColor: string;
    setThemeColor: (value: string) => void;
    contextLabel: string;
    headerFilled: boolean;
    isGeneratingIA: boolean;
    aiTokenLabel: string;
    onAI: () => void;
    onAISettings: () => void;
    onSave: () => Promise<any> | void;
    onClear?: () => void;
    saveDisabled?: boolean;
    managerDisabled?: boolean;
    templateDisabled?: boolean;
    onManager: () => void;
    onTemplate: () => Promise<any> | void;
};

export function SessionActions(props: Props) {
    const isUnit = props.module === 'units';
    const entity = isUnit ? 'unidad' : 'sesión';
    const positionKey = isUnit ? 'armi_units_radial_position_v1' : POSITION_KEY;
    const { enabled, play, toggle } = useSessionActionSound();
    const [floating, setFloating] = useState(false);
    const [open, setOpen] = useState(false);
    const [pinned, setPinned] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [viewport, setViewport] = useState(sessionViewport);
    const previousViewport = useRef(viewport);
    const [position, setPosition] = useState<SessionMenuPoint>(() => {
        const { width, height } = sessionViewport();
        try {
            const saved = JSON.parse(localStorage.getItem(positionKey) || 'null');
            if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
                return clampSessionMenuPoint({ x: Math.max(0, Math.min(1, saved.x)) * (width - 48), y: Math.max(0, Math.min(1, saved.y)) * (height - 48) }, width, height);
            }
        } catch { /* A missing or outdated preference is harmless. */ }
        return clampSessionMenuPoint({ x: width - 76, y: Math.min(160, height / 3) }, width, height);
    });
    const menuId = `session-radial-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const root = useRef<HTMLDivElement>(null);
    const colorInput = useRef<HTMLInputElement>(null);
    const colorAnchor = useRef<HTMLSpanElement>(null);
    const pointer = useRef<{ id: number; x: number; y: number; origin: SessionMenuPoint; moved: boolean } | null>(null);
    const positionRef = useRef(position);
    const suppressUntil = useRef(0);
    const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savingRef = useRef(false);
    const mounted = useRef(true);
    const clearTimers = () => {
        if (openTimer.current) clearTimeout(openTimer.current);
        if (closeTimer.current) clearTimeout(closeTimer.current);
    };
    const close = () => { clearTimers(); setOpen(false); setPinned(false); };
    const move = (next: SessionMenuPoint) => { positionRef.current = next; setPosition(previous => previous.x === next.x && previous.y === next.y ? previous : next); };

    useEffect(() => {
        mounted.current = true;
        const observer = new IntersectionObserver(([entry]) => {
            const away = !entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top || 0);
            setFloating(away);
            if (!away) { clearTimers(); setOpen(false); setPinned(false); }
        }, { threshold: 0 });
        const anchor = props.headerRef.current?.querySelector('.session-glass-toolbar') || props.headerRef.current;
        if (anchor) observer.observe(anchor);
        return () => { mounted.current = false; observer.disconnect(); clearTimers(); };
    }, [props.headerRef]);
    useEffect(() => {
        const resize = () => {
            const next = sessionViewport();
            const previous = previousViewport.current;
            setViewport(current => current.width === next.width && current.height === next.height ? current : next);
            move(clampSessionMenuPoint({ x: positionRef.current.x / Math.max(1, previous.width - 48) * (next.width - 48), y: positionRef.current.y / Math.max(1, previous.height - 48) * (next.height - 48) }, next.width, next.height));
            previousViewport.current = next;
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(document.documentElement);
        window.addEventListener('resize', resize);
        return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
    }, []);
    useEffect(() => {
        if (!floating || !open) return;
        const outside = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) close(); };
        const keyboard = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            close(); root.current?.querySelector<HTMLButtonElement>('[data-radial-trigger]')?.focus();
        };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', keyboard);
        return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keyboard); };
    }, [floating, open]);

    const actions: SessionAction[] = [
        { id: 'ai', label: 'Completar con IA Armi', short: props.isGeneratingIA ? 'Generando…' : 'IA Armi', Icon: props.isGeneratingIA ? Sparkles : Bot, disabled: !props.headerFilled || props.isGeneratingIA, run: props.onAI },
        { id: 'save', label: saving ? `Guardando ${entity}` : isUnit ? 'Guardar Unidad' : 'Guardar Sesión', short: 'Guardar', Icon: saving ? LoaderCircle : Save, disabled: saving || props.saveDisabled, run: props.onSave },
        { id: 'clear', label: 'Limpiar Formulario', short: 'Limpiar', Icon: Eraser, run: props.onClear || (() => {}) },
        { id: 'manager', label: isUnit ? 'Gestor de Unidades' : 'Ver sesiones guardadas', short: isUnit ? 'Unidades' : 'Sesiones', Icon: Database, disabled: props.managerDisabled, run: props.onManager },
        { id: 'template', label: isUnit ? 'Correspondencia' : 'Ver Plantilla', short: isUnit ? 'Correspondencia' : 'Plantilla', Icon: FileText, disabled: props.templateDisabled, run: props.onTemplate },
        { id: 'color', label: 'Personalizar color del apartado', short: 'Color', Icon: Palette, run: () => colorInput.current?.click() },
        { id: 'settings', label: 'Configuración de IA', short: 'Configurar IA', Icon: Settings2, run: props.onAISettings },
        { id: 'sound', label: enabled ? 'Silenciar sonidos' : 'Activar sonidos', short: enabled ? 'Silenciar' : 'Activar sonido', Icon: enabled ? Volume2 : VolumeX, run: toggle },
    ].filter(action => action.id !== 'clear' || !!props.onClear);
    const settingsAction = actions.find(action => action.id === 'settings')!;
    const soundAction = actions.find(action => action.id === 'sound')!;
    const runAction = async (action: typeof actions[number], fromRadial = false) => {
        if (action.disabled || (action.id === 'save' && savingRef.current)) return;
        if (fromRadial) {
            clearTimers(); setPinned(false);
            closeTimer.current = setTimeout(close, 140);
        }
        setError('');
        if (action.id === 'sound') { toggle(); return; }
        play();
        if (action.id === 'save') { savingRef.current = true; setSaving(true); }
        try {
            const result = await action.run();
            if (mounted.current && action.id === 'save' && result === true) play('saved');
        } catch {
            if (mounted.current) setError(action.id === 'save' ? `No se pudo guardar la ${entity}. Inténtalo de nuevo.` : 'No se pudo completar la acción. Inténtalo de nuevo.');
        } finally {
            if (action.id === 'save') { savingRef.current = false; if (mounted.current) setSaving(false); }
        }
    };
    const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 || !event.isPrimary) return;
        clearTimers();
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: positionRef.current, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        const start = pointer.current;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) < 6) return;
        if (!start.moved) { start.moved = true; close(); setDragging(true); }
        event.preventDefault();
        const bounds = sessionViewport();
        move(clampSessionMenuPoint({ x: start.origin.x + dx, y: start.origin.y + dy }, bounds.width, bounds.height));
    };
    const finishPointer = (id: number, cancel = false) => {
        const start = pointer.current;
        if (!start || start.id !== id) return;
        pointer.current = null; setDragging(false);
        if (start.moved) {
            suppressUntil.current = performance.now() + 450;
            if (cancel) move(start.origin);
            else {
                const bounds = sessionViewport();
                try { localStorage.setItem(positionKey, JSON.stringify({ x: positionRef.current.x / Math.max(1, bounds.width - 48), y: positionRef.current.y / Math.max(1, bounds.height - 48) })); } catch { /* Optional preference. */ }
            }
        }
    };
    useEffect(() => {
        const release = (event: PointerEvent) => finishPointer(event.pointerId);
        const cancel = (event: PointerEvent) => finishPointer(event.pointerId, true);
        const blur = () => { if (pointer.current) finishPointer(pointer.current.id); };
        window.addEventListener('pointerup', release, true);
        window.addEventListener('pointercancel', cancel, true);
        window.addEventListener('blur', blur);
        return () => { window.removeEventListener('pointerup', release, true); window.removeEventListener('pointercancel', cancel, true); window.removeEventListener('blur', blur); };
    }, []);
    const nodes = sessionRadialLayout(position, viewport.width, viewport.height, actions.length);
    const left = Math.min(position.x, ...nodes.map(node => node.x)) - 8;
    const top = Math.min(position.y, ...nodes.map(node => node.y)) - 8;
    const right = Math.max(position.x + 48, ...nodes.map(node => node.x + 44)) + 8;
    const bottom = Math.max(position.y + 48, ...nodes.map(node => node.y + 44)) + 8;

    return <>
        <div className="session-glass-toolbar" role="group" aria-label={`Acciones de ${entity}`}>
            {actions.filter(action => action.id !== 'settings' && action.id !== 'sound').map(action => <div key={action.id} className="relative shrink-0">
                <SessionGlassButton className="session-glass-action" aria-label={action.label} title={action.id === 'ai' ? `${action.label}\n${props.aiTokenLabel}` : action.label}
                    disabled={action.disabled} aria-busy={action.id === 'save' ? saving : action.id === 'ai' ? props.isGeneratingIA : undefined}
                    tone={action.id === 'save' ? 'mint' : 'neutral'} onClick={() => { void runAction(action); }}>
                    <action.Icon aria-hidden="true" /><span className="session-glass-label">{action.short}</span>
                </SessionGlassButton>
                {action.id === 'ai' && <SessionGlassButton className="session-glass-settings" title="Configuración de IA" aria-label="Configuración de IA" onClick={() => { void runAction(settingsAction); }}><Settings2 aria-hidden="true" /></SessionGlassButton>}
            </div>)}
            <SessionGlassButton className="session-sound-toggle" title={soundAction.label} aria-label={soundAction.label} aria-pressed={enabled} onClick={toggle}>
                {enabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
            </SessionGlassButton>
        </div>
        <span ref={colorAnchor} className="session-color-anchor" style={floating ? { position: 'fixed', left: position.x, top: position.y, zIndex: 901 } : undefined}>
            <input ref={colorInput} type="color" className="sr-only" tabIndex={-1} aria-label={isUnit ? 'Color de unidades' : 'Color de sesiones'} value={props.themeColor}
                onChange={event => { props.setThemeColor(event.target.value); try { localStorage.setItem(isUnit ? 'armi_units_theme' : 'armi_sessions_theme', event.target.value); } catch { /* Optional preference. */ } }} />
        </span>
        {error && createPortal(<p className="session-action-error" role="alert">{error}<button type="button" aria-label="Cerrar aviso" onClick={() => setError('')}>×</button></p>, document.body)}
        {floating && createPortal(<div ref={root} className={`session-radial print:hidden ${dragging ? 'is-dragging' : ''}`} style={{ left: position.x, top: position.y, '--session-radial-color': props.themeColor } as React.CSSProperties}
            onPointerEnter={event => {
                if (event.pointerType !== 'mouse' || pinned || pointer.current || performance.now() < suppressUntil.current) return;
                clearTimers(); openTimer.current = setTimeout(() => setOpen(true), 100);
            }}
            onPointerLeave={() => {
                clearTimers();
                if (!pinned && !pointer.current) closeTimer.current = setTimeout(() => setOpen(false), 300);
            }}
            onFocusCapture={() => { if (closeTimer.current) clearTimeout(closeTimer.current); }}
            onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) close(); }}>
            <SessionGlassButton className="session-radial-trigger" data-radial-trigger="true" aria-label={`Acciones de ${entity} · ${props.contextLabel}. Arrastra para mover.`}
                aria-expanded={open} aria-controls={menuId} title={`Acciones de ${entity} · Mantén pulsado y arrastra para mover`}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={event => finishPointer(event.pointerId)} onPointerCancel={event => finishPointer(event.pointerId, true)} onLostPointerCapture={event => finishPointer(event.pointerId)}
                onClickCapture={event => { if (performance.now() < suppressUntil.current) { event.preventDefault(); event.stopPropagation(); } }}
                onClick={() => {
                    if (performance.now() < suppressUntil.current) return;
                    clearTimers(); play();
                    if (pinned) close(); else { setPinned(true); setOpen(true); }
                }}>
                {open ? <X aria-hidden="true" /> : <Grip aria-hidden="true" />}
            </SessionGlassButton>
            {!open && <span className="session-radial-context" style={{ ...(position.x < viewport.width / 2 ? { left: 0 } : { right: 0 }), ...(position.y > viewport.height - 100 ? { bottom: 56 } : { top: 56 }) }}>{props.contextLabel}</span>}
            {open && !dragging && <div id={menuId} className="session-radial-fan" role="group" aria-label={`Acciones flotantes de ${entity}`} style={{ left: left - position.x, top: top - position.y, width: right - left, height: bottom - top }}>
                {actions.map((action, i) => <div key={action.id} className="session-radial-item" style={{ left: nodes[i].x - left, top: nodes[i].y - top, '--radial-origin-x': `${position.x + 2 - nodes[i].x}px`, '--radial-origin-y': `${position.y + 2 - nodes[i].y}px` } as React.CSSProperties}>
                    <SessionGlassButton className="session-radial-action" aria-label={action.label} aria-pressed={action.id === 'sound' ? enabled : undefined} disabled={action.disabled}
                        aria-busy={action.id === 'save' ? saving : action.id === 'ai' ? props.isGeneratingIA : undefined} onClick={event => {
                            if (event.detail === 0) root.current?.querySelector<HTMLButtonElement>('[data-radial-trigger]')?.focus({ preventScroll: true });
                            void runAction(action, true);
                        }}>
                        <action.Icon aria-hidden="true" />
                    </SessionGlassButton>
                    <span className="session-radial-caption" style={{ left: Math.max(8, Math.min(viewport.width - 158, nodes[i].x - 53)) - nodes[i].x, ...(nodes[i].y < 40 ? { top: 48 } : { bottom: 48 }) }}>{action.short}</span>
                </div>)}
            </div>}
        </div>, document.body)}
    </>;
}
