import { useEffect, useRef, useState } from 'react';

const SOUND_KEY = 'armi_sessions_action_sound';
export function useSessionActionSound() {
    const [enabled, setEnabled] = useState(() => {
        try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
    });
    const enabledRef = useRef(enabled);
    const audio = useRef<AudioContext | null>(null);
    const disposed = useRef(false);
    useEffect(() => {
        disposed.current = false;
        return () => { disposed.current = true; void audio.current?.close().catch(() => {}); audio.current = null; };
    }, []);

    const play = (kind: 'click' | 'saved' = 'click') => {
        if (!enabledRef.current || disposed.current) return;
        try {
            const Constructor = window.AudioContext || (window as any).webkitAudioContext;
            if (!Constructor) return;
            const context: AudioContext = audio.current || (audio.current = new Constructor());
            const emit = () => {
                if (disposed.current || !enabledRef.current || context.state !== 'running') return;
                const frequencies = kind === 'saved' ? [660, 880] : [640];
                frequencies.forEach((frequency, index) => {
                    const oscillator = context.createOscillator();
                    const gain = context.createGain();
                    const start = context.currentTime + index * .08;
                    const duration = kind === 'saved' ? .085 : .035;
                    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
                    gain.gain.setValueAtTime(.0001, start);
                    gain.gain.exponentialRampToValueAtTime(.025, start + .005);
                    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
                    oscillator.connect(gain); gain.connect(context.destination);
                    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
                    oscillator.start(start); oscillator.stop(start + duration + .01);
                });
            };
            if (context.state === 'suspended') void context.resume().then(emit).catch(() => {});
            else emit();
        } catch { /* Audio availability must never block a session action. */ }
    };
    const toggle = () => {
        const next = !enabledRef.current;
        enabledRef.current = next; setEnabled(next);
        try { localStorage.setItem(SOUND_KEY, next ? 'on' : 'off'); } catch { /* Optional preference. */ }
        if (next) play();
        else void audio.current?.suspend().catch(() => {});
    };
    return { enabled, play, toggle };
}
