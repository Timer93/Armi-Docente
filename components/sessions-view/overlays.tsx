import React, { useState, useEffect, useRef } from 'react';

const CustomDatePicker: React.FC<{
    value: string;
    onChange: (value: string) => void;
    onClose: () => void;
    isOpen: boolean;
}> = ({ value, onChange, onClose, isOpen }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [viewDate, setViewDate] = useState(() => {
        if (value) {
            const [y, m, d] = value.split('-').map(Number);
            return new Date(y, m - 1, 1);
        }
        return new Date();
    });

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const currentMonth = viewDate.getMonth();
    const currentYear = viewDate.getFullYear();
    
    const days = [];
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const prevDaysCount = firstDay === 0 ? 6 : firstDay - 1;
    const totalDays = new Date(currentYear, currentMonth + 1, 0).getDate();

    for (let i = 0; i < prevDaysCount; i++) days.push(null);
    for (let d = 1; d <= totalDays; d++) days.push(new Date(currentYear, currentMonth, d));

    return (
        <div className="absolute z-[1000] bg-white border border-slate-200 shadow-2xl rounded-[2rem] p-5 w-72 animate-scale-in right-0 top-full mt-2 ring-8 ring-black/5" ref={containerRef}>
            <div className="flex justify-between items-center mb-4">
                <button type="button" onClick={() => setViewDate(new Date(currentYear, currentMonth - 1, 1))} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 text-xl font-bold transition-all">•</button>
                <span className="text-[11px] font-black uppercase text-slate-800 tracking-widest">{monthNames[currentMonth]} {currentYear}</span>
                <button type="button" onClick={() => setViewDate(new Date(currentYear, currentMonth + 1, 1))} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 text-xl font-bold transition-all">•</button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-[9px] text-center mb-2 font-black text-slate-400 uppercase tracking-[0.2em]">
                {['L','M','M','J','V','S','D'].map((d, i) => <div key={i} className={i >= 5 ? 'text-red-400' : ''}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
                {days.map((date, i) => {
                    if (!date) return <div key={i}></div>;
                    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                    const isSelected = value === iso;
                    const isToday = new Date().toISOString().split('T')[0] === iso;
                    return (
                        <button 
                            key={i} 
                            type="button" 
                            onClick={() => { onChange(iso); }}
                            className={`h-8 rounded-xl flex items-center justify-center text-[11px] transition-all font-bold ${isSelected ? 'bg-blue-600 text-white shadow-lg scale-110' : 'hover:bg-blue-50 text-slate-600'} ${isToday && !isSelected ? 'ring-2 ring-inset ring-blue-100' : ''} ${date.getDay() === 0 || date.getDay() === 6 ? 'text-red-500' : ''}`}
                        >
                            {date.getDate()}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

const InternalToast: React.FC<{ message: string; type: 'success' | 'error' | 'warning'; onClose: () => void }> = ({ message, type, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 5000);
        return () => clearTimeout(timer);
    }, [onClose]);

    const tone = type === 'success'
        ? {
            shell: 'border-emerald-200 bg-emerald-50/96 text-emerald-900 shadow-[0_14px_34px_rgba(16,185,129,0.16)]',
            stripe: 'bg-emerald-500',
            iconWrap: 'bg-emerald-100 text-emerald-700',
            eyebrow: 'text-emerald-600/80',
            icon: '✓'
        }
        : type === 'error'
            ? {
                shell: 'border-rose-200 bg-rose-50/96 text-rose-900 shadow-[0_14px_34px_rgba(244,63,94,0.16)]',
                stripe: 'bg-rose-500',
                iconWrap: 'bg-rose-100 text-rose-700',
                eyebrow: 'text-rose-600/80',
                icon: '!'
            }
            : {
                shell: 'border-amber-200 bg-amber-50/96 text-amber-900 shadow-[0_14px_34px_rgba(245,158,11,0.16)]',
                stripe: 'bg-amber-500',
                iconWrap: 'bg-amber-100 text-amber-700',
                eyebrow: 'text-amber-700/80',
                icon: '•'
            };

    return (
        <div className="w-full animate-fly-in-right pointer-events-auto">
            <div className={`relative overflow-hidden rounded-[1.6rem] border backdrop-blur-xl transition-all ${tone.shell}`}>
                <div className={`absolute inset-y-0 left-0 w-1.5 ${tone.stripe}`} aria-hidden="true" />
                <div className="flex items-center gap-3 px-4 py-2.5 pl-5">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-black ${tone.iconWrap}`}>
                        {tone.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                        <span className={`block text-[9px] font-black uppercase tracking-[0.24em] ${tone.eyebrow}`}>
                            Sistema de Sesiones
                        </span>
                        <p className="mt-0.5 text-[12px] font-bold leading-5 break-words">
                            {message}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base text-current/60 transition-colors hover:bg-black/5 hover:text-current"
                        aria-label="Cerrar aviso"
                    >
                        ×
                    </button>
                </div>
            </div>
        </div>
    );
};

const AuthOverlay: React.FC<{
    onSave: (key: string) => void;
    onClose: () => void;
    isSaving: boolean;
}> = ({ onSave, onClose, isSaving }) => {
    const [inputKey, setInputKey] = useState('');

    return (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xl animate-fade-in">
            <div className="bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden border border-slate-200 flex flex-col md:flex-row">
                <div className="bg-blue-600 w-full md:w-72 p-8 text-white flex flex-col justify-between">
                    <div>
                        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center text-3xl mb-6 shadow-inner">🤖</div>
                        <h3 className="text-xl font-black uppercase tracking-tight leading-tight mb-4">Asistente IA Armi</h3>
                        <p className="text-[10px] font-bold text-blue-100 leading-relaxed uppercase tracking-wider">Configura tu API key para completar sesiones automáticamente.</p>
                    </div>
                    <div className="mt-8 space-y-4">
                        <div className="flex gap-3 items-start">
                            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black shrink-0">1</span>
                            <p className="text-[9px] font-bold leading-tight uppercase">Entra a <a href="https://aistudio.google.com/app/apikey" target="_blank" className="underline decoration-2 underline-offset-2">Google AI Studio</a>.</p>
                        </div>
                        <div className="flex gap-3 items-start">
                            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black shrink-0">2</span>
                            <p className="text-[9px] font-bold leading-tight uppercase">Pulsa "Create API Key".</p>
                        </div>
                        <div className="flex gap-3 items-start">
                            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black shrink-0">3</span>
                            <p className="text-[9px] font-bold leading-tight uppercase">Pégala aquí y guarda.</p>
                        </div>
                    </div>
                </div>

                <div className="flex-1 p-10 flex flex-col">
                    <div className="flex justify-between items-start mb-8">
                        <div>
                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Paso Final</h4>
                            <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Vincular LLave IA</h2>
                        </div>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">✕</button>
                    </div>

                    <div className="space-y-6 flex-1">
                        <div className="group">
                            <label className="block text-[10px] font-black text-slate-500 mb-3 ml-1 uppercase tracking-widest">API KEY:</label>
                            <div className="relative">
                                <input
                                    type="password"
                                    value={inputKey}
                                    onChange={(e) => setInputKey(e.target.value)}
                                    placeholder="AIzaSy..."
                                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-sm font-mono focus:border-blue-500 focus:bg-white transition-all outline-none shadow-inner"
                                />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300">🔑</div>
                            </div>
                        </div>
                        <div className="bg-amber-50 p-5 rounded-2xl border border-amber-100 flex gap-4">
                            <span className="text-xl shrink-0">🛡️</span>
                            <p className="text-[10px] text-amber-700 font-bold leading-relaxed uppercase">La llave se guarda en tu configuración de datos generales.</p>
                        </div>
                    </div>

                    <button
                        onClick={() => onSave(inputKey.trim())}
                        disabled={isSaving || inputKey.trim().length < 10}
                        className="mt-8 w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-[10px] disabled:opacity-50"
                    >
                        {isSaving ? 'Guardando...' : 'Activar Motor Pedagógico'}
                    </button>
                </div>
            </div>
        </div>
    );
};



export { CustomDatePicker, InternalToast, AuthOverlay };

