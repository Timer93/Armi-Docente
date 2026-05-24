
import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from '@google/genai';
import { DiagnosticEvaluationView } from './DiagnosticEvaluationView';
import { GeneralData, TeachingAssignment, Student, ScheduleEntry, MetaData, EvaluationLevel } from '../types';
import { 
    getDatosGenerales, 
    getProgramacionesAnuales, 
    saveProgramacionAnual, 
    deleteProgramacionAnual,
    saveDatosGenerales,
    getEstandares,
    bulkImportCompetencias,
    bulkImportEstandares,
    getCompetencias,
    getAreas,
    updateModuleStatus,
    getLearningGoalsStats,
    saveLearningGoal,
    getEstudiantes
} from '../services/apiService';
import { INITIAL_GENERAL_DATA } from '../constants';
import { Select } from './Select';
import { TemplateMergeView } from './TemplateMergeView'; 
import { readStoredViewSelection, writeStoredViewSelection } from '../utils/viewSelectionStorage';

const superNormalize = (str: string) => {
    if (!str) return "";
    return String(str).toLowerCase().replace(/[^a-z0-9 áéíóúñ]/gi, "").trim();
};

const normalizeText = (str: string) => {
    return str.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
};

const UNITS = [1, 2, 3, 4, 5, 6, 7, 8];
const BIMESTERS = [1, 2, 3, 4];

const OFFICIAL_AREAS_NAMES = [
    'Arte y Cultura', 'Castellano como Segunda Lengua', 'Ciencia y Tecnología',
    'Ciencias Sociales', 'Comunicación', 'Desarrollo Personal, Ciudadanía y Cívica',
    'Educación Física', 'Educación para el Trabajo', 'Educación Religiosa',
    'Inglés como Lengua Extranjera', 'Matemática', 'Tutoría y Orientación Educativa'
];

const AREA_ABBR: Record<string, string> = {
    'Arte y Cultura': 'ART', 'Castellano como Segunda Lengua': 'CAS', 'Ciencia y Tecnología': 'CT',
    'Ciencias Sociales': 'CS', 'Comunicación': 'COM', 'Desarrollo Personal, Ciudadanía y Cívica': 'DPCC',
    'Educación Física': '⚽', 'Educación para el Trabajo': 'EPT', 'Educación Religiosa': 'REL',
    'Inglés como Lengua Extranjera': 'ING', 'Matemática': 'MAT', 'Tutoría y Orientación Educativa': 'TUT'
};

const LEVEL_LABELS: Record<string, string> = {
    'AD': 'Destacado',
    'A': 'Esperado',
    'B': 'En proceso',
    'C': 'En inicio',
    'NE': 'No Evaluados'
};

const ORDERED_LEVELS = ['AD', 'A', 'B', 'C', 'NE'];
const INITIAL_RESOURCE_FIELDS = {
    medios: '• Presentaciones multimedia\n• Videos educativos\n• Infografías\n• Guías digitales\n• Recursos interactivos\n• Tutoriales virtuales\n• Material audiovisual\n• Plataformas educativas\n• Formularios digitales\n• Simuladores virtuales',
    materiales: '• Fichas de trabajo\n• Guías impresas\n• Documentos PDF\n• Plantillas de proyectos\n• Cuaderno de trabajo\n• Portafolio del estudiante\n• Instrumentos de evaluación\n• Recursos digitales descargables\n• Manuales de usuario\n• Organizadores gráficos',
    recursos: '• Internet\n• Laptops o PCs\n• Proyector multimedia\n• Pizarra\n• Dispositivos móviles\n• Parlantes\n• Impresora\n• Memorias USB\n• Plataforma virtual\n• Cuentas institucionales\n• Software ofimático\n• Herramientas colaborativas online',
    espacios: '• Aula de innovación pedagógica\n• Aula de clase\n• Centro de cómputo\n• Biblioteca escolar\n• Salón de usos múltiples\n• Áreas comunes del colegio\n• Entornos comunitarios\n• Espacios al aire libre',
    apps: '• WhatsApp\n• Gmail\n• Word\n• Excel\n• PowerPoint\n• Google Drive\n• Google Meet\n• Google Forms\n• Google Classroom\n• Zoom',
    softwares: '• Microsoft Excel\n• Microsoft Word\n• Microsoft PowerPoint\n• Softros LAN Messenger\n• Navegador web\n• Lector de PDF\n• WinRAR\n• Antivirus\n• Paint\n• Bloc de notas',
    plataformas: '• OneDrive\n• Google Drive\n• Gmail\n• Google Forms\n• Google Meet\n• Google Classroom\n• YouTube\n• Canva\n• ChatGPT\n• Microsoft Office Online',
};

const getInitialBibliographyFields = (level?: string, areaName?: string) => {
    const normalizedLevel = normalizeText(level || 'Secundaria');
    const resolvedLevel = normalizedLevel.includes('INICIAL')
        ? 'Inicial'
        : normalizedLevel.includes('PRIMARIA')
            ? 'Primaria'
            : 'Secundaria';
    const resolvedArea = String(areaName || '').trim() || 'el área seleccionada';

    return {
        referencias:
            `• Currículo Nacional de la Educación Básica (MINEDU)\n` +
            `• Programa Curricular de Educación ${resolvedLevel} (MINEDU)\n` +
            `• Orientaciones pedagógicas para ${resolvedArea}\n` +
            `• Guía de evaluación formativa (MINEDU)\n` +
            `• Recursos TIC aplicados a ${resolvedArea}\n` +
            `• Manuales y recursos didácticos vinculados a ${resolvedArea}\n` +
            `• Experiencias de aprendizaje y materiales complementarios para ${resolvedArea}`,
        linkografia:
            '• https://www.minedu.gob.pe\n' +
            '• https://www.perueduca.pe\n' +
            '• https://aprendoencasa.pe\n' +
            '• https://workspace.google.com\n' +
            '• https://www.microsoft.com/es-pe/education\n' +
            '• https://classroom.google.com\n' +
            '• https://drive.google.com\n' +
            '• https://www.canva.com/education'
    };
};

const STATIC_TRANSVERSALS = [
    {
        name: "Se desenvuelve en entornos virtuales generados por las TIC",
        caps: ["Personaliza entornos virtuales.", "Gestiona información del entorno virtual.", "Interactúa en entornos virtuales.", "Crea objetos virtuales en diversos formatos."]
    },
    {
        name: "Gestiona su aprendizaje de manera autónoma",
        caps: ["Define metas de aprendizaje.", "Organiza acciones estratégicas para alcanzar sus metas de aprendizaje.", "Monitorea y ajusta su desempeño durante el proceso de aprendizaje."]
    }
];

const STATIC_ENFOQUES = [
    "Enfoque de derechos.",
    "Enfoque Inclusivo o de Atención a la diversidad.",
    "Enfoque Intercultural.",
    "Enfoque Igualdad de Género.",
    "Enfoque ambiental.",
    "Enfoque orientación al bien común.",
    "Enfoque búsqueda de la Excelencia."
];

const STATIC_EJES_REGIONALES = [
    "Educación e Identidad Regional.",
    "Educación, Ciudadanía, Ética y Seguridad.",
    "Educación, Ambiente y Gestión de Riesgo.",
    "Educación, Salud y Bienestar.",
    "Educación, Emprendimiento y Cultura.",
    "Educación y Cultura General"
];

/**
 * Calcula la duración exacta en semanas y días laborables (L-V)
 * para que coincida con la vista "Calendarización MINEDU".
 */
const GLOBAL_PINNED_MATRIX_STORAGE_KEY = 'armi_pa_pinned_matrix_global';
const GLOBAL_PINNED_DIDACTIC_UNITS_STORAGE_KEY = 'armi_pa_pinned_didactic_units_global';
const getPinnedMatrixStorageKey = (areaId: string, grade: string) => `armi_pa_pinned_matrix_${areaId}_${grade}`;
const ANNUAL_VIEW_SELECTION_STORAGE_KEY = 'armi_view_selection_programacion_anual_v1';

const getMineduDuration = (startStr?: string, endStr?: string): string => {
    if (!startStr || !endStr) return "-";
    const [sYear, sMonth, sDay] = startStr.split('-').map(Number);
    const [eYear, eMonth, eDay] = endStr.split('-').map(Number);
    const start = new Date(sYear, sMonth - 1, sDay);
    const end = new Date(eYear, eMonth - 1, eDay);
    if (start > end) return "Error";
    let workingDays = 0;
    let currentDate = new Date(start);
    while (currentDate <= end) {
        const dayOfWeek = currentDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) workingDays++;
        currentDate.setDate(currentDate.getDate() + 1);
    }
    const weeks = Math.floor(workingDays / 5);
    const days = workingDays % 5;
    return `${weeks} sem. y ${days} d.`;
};

/**
 * Helper para extraer el número entero de semanas de la cadena de duración
 */
const extractWeeksFromMineduDuration = (duration: string): number => {
    const match = duration.match(/^(\d+)\s+sem/);
    return match ? parseInt(match[1], 10) : 0;
};

/**
 * Identifica bloques continuos de gestión (B) en el calendario
 * para insertarlos en las tablas de temporalización.
 */
const identifyManagementBlocks = (calendarMap: Record<string, string>) => {
    const seedStatuses = new Set(['B', 'E']);
    const bridgeStatuses = new Set(['B', 'C', 'E', 'F', 'G']);
    const dates = Object.keys(calendarMap).filter(k => seedStatuses.has(calendarMap[k])).sort();
    if (dates.length === 0) return [];

    const blocks: { id: string, isVac: boolean, start: string, end: string, target: 'B' }[] = [];
    let currentStart = dates[0];
    let currentEnd = dates[0];

    const countNonLectiveWeekdays = (startIso: string, endIso: string) => {
        const start = new Date(startIso + 'T00:00:00');
        const end = new Date(endIso + 'T00:00:00');
        let total = 0;
        const temp = new Date(start);
        while (temp <= end) {
            const dow = temp.getDay();
            const iso = temp.toISOString().split('T')[0];
            const status = calendarMap[iso];
            if (dow !== 0 && dow !== 6 && bridgeStatuses.has(status)) {
                total++;
            }
            temp.setDate(temp.getDate() + 1);
        }
        return total;
    };

    const canBridgeGap = (fromIso: string, toIso: string) => {
        const from = new Date(fromIso + 'T00:00:00');
        const to = new Date(toIso + 'T00:00:00');
        const temp = new Date(from);
        temp.setDate(temp.getDate() + 1);
        while (temp < to) {
            const dow = temp.getDay();
            if (dow !== 0 && dow !== 6) {
                const iso = temp.toISOString().split('T')[0];
                const status = calendarMap[iso];
                if (status === 'A') return false;
                if (status && !bridgeStatuses.has(status)) return false;
            }
            temp.setDate(temp.getDate() + 1);
        }
        return true;
    };

    for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1] + 'T00:00:00');
        const curr = new Date(dates[i] + 'T00:00:00');
        const diff = (curr.getTime() - prev.getTime()) / (1000 * 3600 * 24);

        if (diff <= 3 || canBridgeGap(dates[i - 1], dates[i])) {
            currentEnd = dates[i];
        } else {
            const workingDays = countNonLectiveWeekdays(currentStart, currentEnd);
            if (workingDays >= 5) {
                blocks.push({ id: 'Gestion', isVac: true, start: currentStart, end: currentEnd, target: 'B' });
            }
            currentStart = dates[i];
            currentEnd = dates[i];
        }
    }

    {
        const workingDays = countNonLectiveWeekdays(currentStart, currentEnd);
        if (workingDays >= 5) {
            blocks.push({ id: 'Gestion', isVac: true, start: currentStart, end: currentEnd, target: 'B' });
        }
    }

    return blocks;
};

const InternalToast: React.FC<{ message: string; type: 'success' | 'error'; onClose: () => void }> = ({ message, type, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 5000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div className="fixed top-10 right-10 z-[1000000] animate-fly-in-right w-full max-w-md pointer-events-none">
            <div className={`px-8 py-5 rounded-[2.5rem] shadow-[0_30px_90px_rgba(0,0,0,0.4)] border flex items-center gap-6 backdrop-blur-2xl transition-all border-white/30 pointer-events-auto ${type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
                <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center text-3xl shrink-0 shadow-inner">
                    {type === 'success' ? '✨' : '⚠️'}
                </div>
                <div className="flex flex-col pr-4 border-r border-white/20 min-w-0 flex-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-70 leading-none mb-1.5">ARMI Docente</span>
                    <p className="text-sm font-black leading-tight tracking-tight uppercase whitespace-pre-wrap">{message}</p>
                </div>
                <button onClick={onClose} className="w-10 h-10 rounded-full hover:bg-black/10 flex items-center justify-center transition-colors text-xl shrink-0">✕</button>
            </div>
            <style dangerouslySetInnerHTML={{ __html: `
                @keyframes flyInRight {
                    0% { opacity: 0; transform: translateX(200px) scale(0.8); }
                    100% { opacity: 1; transform: translateX(0) scale(1); }
                }
                .animate-fly-in-right {
                    animation: flyInRight 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
                }
            `}} />
        </div>
    );
};

const InfoToast: React.FC<{ message: string; onClose: () => void }> = ({ message, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 5000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div className="fixed top-10 right-10 z-[1000000] animate-fly-in-right w-full max-w-md pointer-events-none">
            <div className="bg-slate-900/95 text-white px-6 py-5 rounded-[2.5rem] shadow-[0_30px_90px_rgba(0,0,0,0.6)] border border-white/20 flex items-start gap-5 backdrop-blur-2xl ring-4 ring-black/10 pointer-events-auto">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-2xl shrink-0 animate-pulse">
                    ⚠️
                </div>
                <div className="flex-1 min-w-0">
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-500 mb-1 block">Aviso del Sistema</span>
                    <p className="text-[11px] font-bold leading-tight uppercase tracking-tight break-words">{message}</p>
                </div>
                <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1 text-lg shrink-0">✕</button>
            </div>
        </div>
    );
};

const AuthOverlay: React.FC<{
    onSave: (config: {
        provider: 'gemini' | 'openai';
        geminiKey: string;
        openaiKey: string;
        aiPedagogicalRoute: string;
        institutionalProblems: string;
        unitPedagogicalFocus: string;
    }) => void;
    onClose: () => void;
    isSaving: boolean;
    initialProvider?: 'gemini' | 'openai';
    initialGeminiKey?: string;
    initialOpenAIKey?: string;
    initialAiPedagogicalRoute?: string;
    initialInstitutionalProblems?: string;
    initialUnitPedagogicalFocus?: string;
}> = ({
    onSave,
    onClose,
    isSaving,
    initialProvider = 'gemini',
    initialGeminiKey = '',
    initialOpenAIKey = '',
    initialAiPedagogicalRoute = '',
    initialInstitutionalProblems = '',
    initialUnitPedagogicalFocus = ''
}) => {
    const [provider, setProvider] = useState<'gemini' | 'openai'>(initialProvider);
    const [geminiKey, setGeminiKey] = useState(initialGeminiKey);
    const [openaiKey, setOpenaiKey] = useState(initialOpenAIKey);
    const [aiPedagogicalRoute, setAiPedagogicalRoute] = useState(initialAiPedagogicalRoute);
    const [institutionalProblems, setInstitutionalProblems] = useState(initialInstitutionalProblems);
    const [unitPedagogicalFocus, setUnitPedagogicalFocus] = useState(initialUnitPedagogicalFocus);
    const canSave = provider === 'gemini' ? !!geminiKey.trim() : !!openaiKey.trim();

    return (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xl animate-fade-in">
            <div className="bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl overflow-hidden border border-slate-200 flex flex-col lg:flex-row">
                <div className="bg-blue-600 w-full md:w-60 p-6 text-white flex flex-col">
                    <div>
                        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center text-3xl mb-6 shadow-inner">🤖</div>
                        <h3 className="text-xl font-black uppercase tracking-tight leading-tight mb-4">Asistente IA Armi</h3>
                        <p className="text-[10px] font-bold text-blue-100 leading-relaxed uppercase tracking-wider">Configuración necesaria para habilitar el llenado automático de la programación anual.</p>
                    </div>
                    <div className="mt-8 space-y-4">
                        <div className="flex gap-3 items-start">
                            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black shrink-0">1</span>
                            <p className="text-[9px] font-bold leading-tight uppercase">Ingresa a <a href="https://aistudio.google.com/app/apikey" target="_blank" className="underline decoration-2 underline-offset-2">Google AI Studio</a>.</p>
                        </div>
                        <div className="flex gap-3 items-start">
                            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black shrink-0">2</span>
                            <p className="text-[9px] font-bold leading-tight uppercase">O usa tu clave de ChatGPT / OpenAI.</p>
                        </div>
                        <div className="flex gap-3 items-start">
                            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black shrink-0">3</span>
                            <p className="text-[9px] font-bold leading-tight uppercase">Pega la clave y guarda la configuración.</p>
                        </div>
                    </div>
                </div>

                <div className="flex-1 p-6 flex flex-col">
                    <div className="flex justify-between items-start mb-8">
                        <div>
                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Motor IA</h4>
                            <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Configuración de Proveedor</h2>
                        </div>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">✕</button>
                    </div>

                    <div className="space-y-4 flex-1">
                        <div>
                            <label className="block text-[10px] font-black text-slate-500 mb-3 ml-1 uppercase tracking-widest">Proveedor IA activo:</label>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setProvider('gemini')}
                                    className={`rounded-2xl px-4 py-4 text-xs font-black uppercase transition-all border-2 ${provider === 'gemini' ? 'bg-blue-600 text-white border-blue-600 shadow-lg' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300'}`}
                                >
                                    Gemini
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setProvider('openai')}
                                    className={`rounded-2xl px-4 py-4 text-xs font-black uppercase transition-all border-2 ${provider === 'openai' ? 'bg-emerald-600 text-white border-emerald-600 shadow-lg' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300'}`}
                                >
                                    ChatGPT / OpenAI
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-slate-500 mb-3 ml-1 uppercase tracking-widest">Clave Gemini:</label>
                            <div className="relative">
                                <input
                                    type="password"
                                    value={geminiKey}
                                    onChange={(e) => setGeminiKey(e.target.value)}
                                    placeholder="AIzaSy..."
                                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-sm font-mono focus:border-blue-500 focus:bg-white transition-all outline-none shadow-inner"
                                />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300">🔑</div>
                            </div>
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-slate-500 mb-3 ml-1 uppercase tracking-widest">Clave ChatGPT / OpenAI:</label>
                            <div className="relative">
                                <input
                                    type="password"
                                    value={openaiKey}
                                    onChange={(e) => setOpenaiKey(e.target.value)}
                                    placeholder="sk-..."
                                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-sm font-mono focus:border-emerald-500 focus:bg-white transition-all outline-none shadow-inner"
                                />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300">🔐</div>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-4">
                            <div>
                                <label className="block text-[10px] font-black text-slate-500 mb-3 ml-1 uppercase tracking-widest">
                                    Ruta pedagógica anual:
                                </label>
                                <textarea
                                    value={aiPedagogicalRoute}
                                    onChange={(e) => setAiPedagogicalRoute(e.target.value)}
                                    placeholder="Ejemplo: Durante el año se desarrollará un portafolio de emprendimiento orientado al concurso Crea y Emprende..."
                                    className="w-full h-20 bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-xs font-bold focus:border-blue-500 focus:bg-white transition-all outline-none shadow-inner resize-none"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-slate-500 mb-3 ml-1 uppercase tracking-widest">
                                    Problemáticas institucionales por bimestre:
                                </label>
                                <textarea
                                    value={institutionalProblems}
                                    onChange={(e) => setInstitutionalProblems(e.target.value)}
                                    placeholder="Ejemplo: I Bimestre: Bajo rendimiento académico. II Bimestre: Escasos hábitos de lectura..."
                                    className="w-full h-20 bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-xs font-bold focus:border-blue-500 focus:bg-white transition-all outline-none shadow-inner resize-none"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-slate-500 mb-3 ml-1 uppercase tracking-widest">
                                    Enfoque o producto esperado por unidad:
                                </label>
                                <textarea
                                    value={unitPedagogicalFocus}
                                    onChange={(e) => setUnitPedagogicalFocus(e.target.value)}
                                    placeholder="Ejemplo: Unidad 2: Identificación del problema y mapa de empatía. Unidad 3: Propuesta de valor y Lean Canvas..."
                                    className="w-full h-20 bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-xs font-bold focus:border-blue-500 focus:bg-white transition-all outline-none shadow-inner resize-none"
                                />
                            </div>
                        </div>
                        <div className="bg-amber-50 p-5 rounded-2xl border border-amber-100 flex gap-4">
                            <span className="text-xl shrink-0">🛡️</span>
                            <p className="text-[10px] text-amber-700 font-bold leading-relaxed uppercase">La llave se guarda en datos generales y luego se reutiliza en este módulo.</p>
                        </div>
                    </div>

                    <button
                        onClick={() => onSave({
                            provider,
                            geminiKey: geminiKey.trim(),
                            openaiKey: openaiKey.trim(),
                            aiPedagogicalRoute: aiPedagogicalRoute.trim(),
                            institutionalProblems: institutionalProblems.trim(),
                            unitPedagogicalFocus: unitPedagogicalFocus.trim()
                        })}
                        disabled={isSaving || !canSave}
                        className="mt-4 w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-[10px] disabled:opacity-50"
                    >
                        {isSaving ? 'Guardando...' : 'Guardar Configuración IA'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const getFlexValue = (obj: any, searchKey: string) => {
    if (!obj) return '';
    const normSearch = superNormalize(searchKey);
    const actualKey = Object.keys(obj).find(k => superNormalize(k) === normSearch);
    return actualKey ? obj[actualKey] : '';
};

const formatDate = (iso?: string) => {
    if (!iso) return '-';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
};

const dayNumberToText = (day: number) => {
  return ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'][day];
};

/**
 * Calcula días y horas efectivas basadas estrictamente en:
 * 1. El estado del calendario anual (Tipo A: Lectivo, B: Gestión)
 * 2. El horario semanal del docente para el Área/Grado/Sección seleccionado
 */
const getWorkingStats = (
  start?: string,
  end?: string,
  calendarMap?: Record<string, string>,
  schedule?: ScheduleEntry[],
  areaId?: string,
  areaName?: string,
  grade?: string,
  section?: string,
  targetType: 'A' | 'B' = 'A' // A: Escolar, B: Gestión
) => {
  if (!start || !end || !calendarMap || !schedule) return { days: 0, hours: 0 };

  const startDate = new Date(start + 'T00:00:00');
  const endDate = new Date(end + 'T00:00:00');

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate > endDate) return { days: 0, hours: 0 };

  const normAreaId = superNormalize(areaId || "");
  const normAreaName = superNormalize(areaName || "");
  const normGrade = superNormalize(grade || "");
  const normSection = String(section || "").toUpperCase();

  const activeEntries = schedule.filter(e =>
    (superNormalize(e.areaId) === normAreaId || superNormalize(e.areaName) === normAreaName) &&
    superNormalize(e.grade) === normGrade &&
    String(e.section).toUpperCase() === normSection
  );

  const hoursByDay: Record<string, number> = {};
  activeEntries.forEach(e => {
      const dayText = normalizeText(e.day);
      hoursByDay[dayText] = (hoursByDay[dayText] || 0) + 1;
  });

  let daysCount = 0;
  let hoursCount = 0;

  const cur = new Date(startDate);
  while (cur <= endDate) {
    const iso = cur.toISOString().split('T')[0];
    const statusInCalendar = calendarMap[iso];
    const dayText = dayNumberToText(cur.getDay());

    if (statusInCalendar === targetType) {
      if (targetType === 'A') {
        if (hoursByDay[dayText]) {
            daysCount++;
            hoursCount += hoursByDay[dayText];
        }
      } else {
        if (cur.getDay() !== 0 && cur.getDay() !== 6) {
           daysCount++;
           hoursCount = 0; 
        }
      }
    }
    cur.setDate(cur.getDate() + 1);
  }

  return { days: daysCount, hours: hoursCount };
};

const getManualCount = (metaObj: MetaData | undefined, lvl: string) => {
    if (!metaObj) return 0;
    if (lvl === 'AD') return metaObj.cant_destacado;
    if (lvl === 'A') return metaObj.cant_esperado;
    if (lvl === 'B') return metaObj.cant_proceso;
    if (lvl === 'C') return metaObj.cant_inicio;
    return metaObj.cant_no_evaluado;
};

export const AnnualProgramView: React.FC<{
  onSuccess: () => void;
  activeSection?: string;
}> = ({ onSuccess, activeSection = 'planificacion' }) => {
    const initialSelection = useMemo(() => readStoredViewSelection(ANNUAL_VIEW_SELECTION_STORAGE_KEY), []);

    const [generalData, setGeneralData] = useState<GeneralData>(INITIAL_GENERAL_DATA);
    const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
    
    const [selectedAreaId, setSelectedAreaId] = useState(initialSelection.areaId || '');
    const [selectedGrade, setSelectedGrade] = useState(initialSelection.grade || '');
    const [selectedSection, setSelectedSection] = useState(initialSelection.section || '');
    const [selectedYear, setSelectedYear] = useState(initialSelection.year || new Date().getFullYear().toString());
    const [showYearPicker, setShowYearPicker] = useState(false);
    const [isManageModalOpen, setIsManageModalOpen] = useState(false);
    const [allSavedProgramsList, setAllSavedProgramsList] = useState<any[]>([]);
    
    const [currentAssignment, setCurrentAssignment] = useState<TeachingAssignment | null>(null);
    const [competencias, setCompetencias] = useState<any[]>([]);
    const [areaPurpose, setAreaPurpose] = useState('');
    const [areaEnfoque, setAreaEnfoque] = useState('');
    const [areaStandardsText, setAreaStandardsText] = useState('');
    const [areaStandardsList, setAreaStandardsList] = useState<any[]>([]);
    const [transversalTextMap, setTransversalTextMap] = useState<Record<string, string>>({});
    
    const [matrixChecks, setMatrixChecks] = useState<Record<string, any>>({});
    const [didacticUnits, setDidacticUnits] = useState<Record<string, { situation: string, title: string }>>({});
    const [activeVinculacionUnit, setActiveVinculacionUnit] = useState<number | null>(null);
    const [isMatrixPinned, setIsMatrixPinned] = useState(false);
    const [isDidacticUnitsPinned, setIsDidacticUnitsPinned] = useState(false);

    const [resourceFields, setResourceFields] = useState(INITIAL_RESOURCE_FIELDS);
    const [bibliographyFields, setBibliographyFields] = useState(() => getInitialBibliographyFields(INITIAL_GENERAL_DATA.level, ''));

    const [showPreviewMatrix, setShowPreviewMatrix] = useState(false);
    const [showCalendarSummary, setShowCalendarSummary] = useState(false);
    const [isDraggingMatrix, setIsDraggingMatrix] = useState(false);
    const [dragCheckValue, setDragCheckValue] = useState(false);
    const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
    const [saving, setSaving] = useState(false);
    const [isGeneratingIA, setIsGeneratingIA] = useState(false);
    const [showAuthScreen, setShowAuthScreen] = useState(false);
    const [savingKey, setSavingKey] = useState(false);
    const [deletingProgramId, setDeletingProgramId] = useState<string | null>(null);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [showTemplateMode, setShowTemplateMode] = useState(false); 
    const [importType, setImportType] = useState<'competencias' | 'estandares'>('competencias');
    const [previewData, setPreviewData] = useState<any[]>([]);
    const [importLoading, setImportLoading] = useState(false);
    const [assignmentsLoaded, setAssignmentsLoaded] = useState(false);

    const [studentStats, setStudentStats] = useState({ total: '0', ciclo: '-', horas: '0' });

    const [lineaBaseStats, setLineaBaseStats] = useState<any[]>([]);
    const [statsData, setStatsData] = useState<any>(null);
    const [manualMetas, setManualMetas] = useState<MetaData[]>([]);
    const [studentMatricula, setStudentMatricula] = useState<Record<string, number>>({});
    const [competenciesList, setCompetenciesList] = useState<string[]>([]);
    const [goalToastMsg, setGoalToastMsg] = useState<string | null>(null);
    const [themeColor, setThemeColor] = useState(() => {
        return localStorage.getItem('armi_goals_theme') || '#0284c7';
    });
    const didacticUnitsRef = useRef(didacticUnits);

    useEffect(() => {
        didacticUnitsRef.current = didacticUnits;
    }, [didacticUnits]);

    const years = Array.from({ length: 5 }, (_, i) => (new Date().getFullYear() - 1 + i).toString());

    useEffect(() => {
        localStorage.setItem('armi_goals_theme', themeColor);
    }, [themeColor]);

    useEffect(() => {
        const load = async () => {
            const gd = await getDatosGenerales();
            setGeneralData(gd);
            if (!initialSelection.year && gd.year) setSelectedYear(gd.year);
            const savedAssign = localStorage.getItem('armi_assignments');
            if (savedAssign) setAssignments(JSON.parse(savedAssign));
            setAssignmentsLoaded(true);
        };
        load();
    }, [initialSelection.year]);

    const areaOptions = useMemo(() => {
        const unique = new Map();
        assignments.forEach(a => { if(!unique.has(a.areaId)) unique.set(a.areaId, a.areaName); });
        return Array.from(unique.entries()).map(([id, name]) => ({ value: id, label: name.toUpperCase() }));
    }, [assignments]);

    const availableGrades = useMemo(() => {
        if (!selectedAreaId) return [];
        const grades = new Set(assignments.filter(a => a.areaId === selectedAreaId).map(a => a.grade));
        return Array.from(grades).map(g => ({ value: g, label: g }));
    }, [assignments, selectedAreaId]);

    const availableSections = useMemo(() => {
        if (!selectedAreaId || !selectedGrade) return [];
        const sections = Array.from(new Set(assignments.filter(a => a.areaId === selectedAreaId && a.grade === selectedGrade).map(a => a.section))).sort();
        const options = sections.map(s => ({ value: s, label: s }));
        
        if (sections.length > 1) {
            const last = sections[sections.length - 1];
            const others = sections.slice(0, -1);
            const joinedLabel = sections.length === 2 
                ? `${sections[0]} y ${sections[1]}` 
                : `${others.join(', ')} y ${last}`;
            options.push({ value: joinedLabel, label: joinedLabel });
        }
        return options;
    }, [assignments, selectedAreaId, selectedGrade]);

    useEffect(() => {
        writeStoredViewSelection(ANNUAL_VIEW_SELECTION_STORAGE_KEY, {
            areaId: selectedAreaId,
            grade: selectedGrade,
            section: selectedSection,
            year: selectedYear
        });
    }, [selectedAreaId, selectedGrade, selectedSection, selectedYear]);

    useEffect(() => {
        if (!assignmentsLoaded) return;
        if (selectedAreaId && !areaOptions.some(option => option.value === selectedAreaId)) {
            setSelectedAreaId('');
            setSelectedGrade('');
            setSelectedSection('');
            return;
        }
        if (selectedGrade && !availableGrades.some(option => option.value === selectedGrade)) {
            setSelectedGrade('');
            setSelectedSection('');
            return;
        }
        if (selectedSection && !availableSections.some(option => option.value === selectedSection)) {
            setSelectedSection('');
        }
    }, [assignmentsLoaded, selectedAreaId, selectedGrade, selectedSection, areaOptions, availableGrades, availableSections]);

    const sectionsForSelectedGrade = useMemo(() => {
        return Array.from(new Set(assignments.filter(a => a.grade === selectedGrade && a.areaId === selectedAreaId).map(a => a.section))).sort();
    }, [assignments, selectedGrade, selectedAreaId]);

    const sectionsList = useMemo(() => {
        if (!selectedSection) return [];
        return selectedSection.split(/, | y /).map(s => s.trim().toUpperCase());
    }, [selectedSection]);

    useEffect(() => {
        const fetchEnrollment = async () => {
             if (selectedGrade && selectedSection && selectedAreaId) {
                const allStudents = await getEstudiantes();
                const counts: Record<string, number> = {};
                
                allStudents.filter(s => s.grade === selectedGrade && s.estado !== 'R').forEach(s => {
                    const sec = String(s.section).trim().toUpperCase();
                    counts[sec] = (counts[sec] || 0) + 1;
                });
                setStudentMatricula(counts);

                const targetSections = sectionsList;
                
                let alumnosDisplay = "";
                if (targetSections.length > 1) {
                    alumnosDisplay = targetSections.map(ts => (counts[ts] || 0).toString()).join(' - ');
                } else {
                    alumnosDisplay = (counts[targetSections[0]] || 0).toString();
                }

                let hoursDisplay = '00 h.';
                const savedSchedule = localStorage.getItem('armi_schedule_entries');
                if (savedSchedule) {
                    const entries: ScheduleEntry[] = JSON.parse(savedSchedule);
                    const hoursList = targetSections.map(sec => 
                        entries.filter(e => e.grade === selectedGrade && String(e.section).toUpperCase() === sec && e.areaId === selectedAreaId).length
                    );
                    const uniqueHours = Array.from(new Set(hoursList));
                    if (uniqueHours.length === 1) {
                        hoursDisplay = `${uniqueHours[0].toString().padStart(2, '0')} h.`;
                    } else {
                        hoursDisplay = hoursList.map(h => h.toString().padStart(2, '0')).join(' - ') + ' h.';
                    }
                }

                let ciclo = '-';
                const g = selectedGrade.toLowerCase();
                if (g.includes('1') || g.includes('2')) ciclo = 'VI';
                else if (g.includes('3') || g.includes('4') || g.includes('5')) ciclo = 'VII';

                setStudentStats({ total: alumnosDisplay, ciclo, horas: hoursDisplay });
            } else {
                setStudentStats({ total: '0', ciclo: '-', horas: '00 h.' });
                setStudentMatricula({});
            }
        };
        fetchEnrollment();
    }, [selectedGrade, selectedSection, selectedAreaId, sectionsList]);

    useEffect(() => {
        if (selectedAreaId && selectedGrade && selectedSection) {
            const found = assignments.find(a => (a.id === selectedAreaId || a.areaId === selectedAreaId) && a.grade === selectedGrade) || null;
            const dynamicBibliographyDefaults = getInitialBibliographyFields(generalData?.level || 'Secundaria', found?.areaName || '');
            setCurrentAssignment(found);
            
            if (found) {
                getCompetencias(selectedGrade, found.areaName).then(res => {
                    setCompetencias(res || []);
                    const unique = Array.from(new Set(res.map(c => c.competencias))).sort();
                    setCompetenciesList(unique);
                });

                getAreas(found.areaName).then(res => {
                    const areaMatch = (res || []).find(a => superNormalize(getFlexValue(a, 'area')) === superNormalize(found.areaName));
                    if (areaMatch) {
                        setAreaPurpose(getFlexValue(areaMatch, 'proposito'));
                        setAreaEnfoque(getFlexValue(areaMatch, 'enfoque'));
                    } else {
                        setAreaPurpose(`El área "${found.areaName}" no registra propósito.`);
                        setAreaEnfoque(`El área "${found.areaName}" no registra enfoque.`);
                    }
                });

                getEstandares(selectedGrade, found.areaName).then(res => {
                    setAreaStandardsList(res || []);
                    if (res && res.length > 0) setAreaStandardsText(res.map(e => getFlexValue(e, 'estandar')).join('\n\n'));
                    else setAreaStandardsText(`No se hallaron estándares para esta área.`);
                });
                const fetchTransversals = async () => {
                    const names = ["Se desenvuelve en los entornos virtuales generados por las TIC.", "Gestiona su aprendizaje de manera autónoma."];
                    const newMap: Record<string, string> = {};
                    for (const name of names) {
                        const res = await getEstandares(selectedGrade, name);
                        newMap[name] = (res && res.length > 0) ? getFlexValue(res[0], 'estandar') : '⚠️ Estándar no hallado.';
                    }
                    setTransversalTextMap(newMap);
                };
                fetchTransversals();

                getLearningGoalsStats(found.areaName, selectedGrade, selectedYear, generalData?.level || 'Secundaria').then(res => {
                    if (res.success) {
                        setStatsData(res.data.diagStats);
                        setLineaBaseStats(res.data.lineaBaseStats || []);
                    }
                });

            }
            
            getProgramacionesAnuales().then(allPrograms => {
                const compositeKey = `${selectedYear}-${selectedAreaId}-${selectedGrade}-${selectedSection}`;
                const program = allPrograms[compositeKey];
                
                if (program) {
                    setMatrixChecks(program.matrixChecks || {});
                    setDidacticUnits(program.didacticUnits || {});
                    if (program.resourceFields) setResourceFields(program.resourceFields);
                    if (program.bibliographyFields) setBibliographyFields(program.bibliographyFields);
                    if (program.areaPurpose) setAreaPurpose(program.areaPurpose);
                    if (program.areaEnfoque) setAreaEnfoque(program.areaEnfoque);
                    if (program.areaStandards) setAreaStandardsText(program.areaStandards);
                    
                    if (program.metas_datos) {
                        try {
                            const parsedMetas = typeof program.metas_datos === 'string' ? JSON.parse(program.metas_datos) : program.metas_datos;
                            setManualMetas(parsedMetas);
                        } catch (e) {
                            console.error("Error al parsear metas_datos:", e);
                        }
                    } else {
                        setManualMetas([]);
                    }

                    setToast({ msg: `Programación ${selectedYear} cargada con éxito.`, type: 'success' });
                } else {
                    const pinnedMatrixRaw = localStorage.getItem(GLOBAL_PINNED_MATRIX_STORAGE_KEY)
                        || localStorage.getItem(getPinnedMatrixStorageKey(selectedAreaId, selectedGrade));
                    const pinnedDidacticUnitsRaw = localStorage.getItem(GLOBAL_PINNED_DIDACTIC_UNITS_STORAGE_KEY);
                    if (pinnedMatrixRaw) {
                        try {
                            setMatrixChecks(JSON.parse(pinnedMatrixRaw));
                        } catch {
                            setMatrixChecks({});
                        }
                    } else {
                        setMatrixChecks({});
                    }
                    if (pinnedDidacticUnitsRaw) {
                        try {
                            setDidacticUnits(JSON.parse(pinnedDidacticUnitsRaw));
                        } catch {
                            setDidacticUnits({});
                        }
                    } else {
                        setDidacticUnits({});
                    }
                    setResourceFields(INITIAL_RESOURCE_FIELDS);
                    setBibliographyFields(dynamicBibliographyDefaults);
                    setManualMetas([]);
                }
            });
        } else {
            setCurrentAssignment(null);
            setMatrixChecks({});
            setDidacticUnits({});
            setResourceFields(INITIAL_RESOURCE_FIELDS);
            setBibliographyFields(getInitialBibliographyFields(generalData?.level || 'Secundaria', ''));
            setCompetenciesList([]);
            setManualMetas([]);
        }
    }, [selectedAreaId, selectedGrade, selectedSection, selectedYear, assignments, generalData.year, generalData.level]);

    useEffect(() => {
        const hasGlobalPinnedMatrix = !!localStorage.getItem(GLOBAL_PINNED_MATRIX_STORAGE_KEY);
        if (hasGlobalPinnedMatrix) {
            setIsMatrixPinned(true);
            return;
        }

        if (!selectedAreaId || !selectedGrade) {
            setIsMatrixPinned(false);
            return;
        }

        const legacyStorageKey = getPinnedMatrixStorageKey(selectedAreaId, selectedGrade);
        const legacyPinnedMatrix = localStorage.getItem(legacyStorageKey);

        if (legacyPinnedMatrix) {
            localStorage.setItem(GLOBAL_PINNED_MATRIX_STORAGE_KEY, legacyPinnedMatrix);
            localStorage.removeItem(legacyStorageKey);
            setIsMatrixPinned(true);
            return;
        }

        setIsMatrixPinned(false);
    }, [selectedAreaId, selectedGrade]);

    useEffect(() => {
        setIsDidacticUnitsPinned(!!localStorage.getItem(GLOBAL_PINNED_DIDACTIC_UNITS_STORAGE_KEY));
    }, [selectedAreaId, selectedGrade, selectedSection, selectedYear]);

    useEffect(() => {
        const handleGlobalMouseUp = () => setIsDraggingMatrix(false);
        window.addEventListener('mouseup', handleGlobalMouseUp);
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }, []);

    const calendarMap = useMemo(() => {
      const raw = localStorage.getItem('armi_calendar_state');
      return raw ? JSON.parse(raw) : {};
    }, [generalData]);

    const scheduleEntries: ScheduleEntry[] = useMemo(() => {
      const raw = localStorage.getItem('armi_schedule_entries');
      return raw ? JSON.parse(raw) : [];
    }, []);

    const temporalizacionPorSeccion = useMemo(() => {
        const managementBlocks = identifyManagementBlocks(calendarMap);
        
        return sectionsList.map(sec => {
            // Sincronización exacta con Calendarización MINEDU e inserción de Gestión cronológica
            const bimestresLectivos = [
                { id: 'I', start: generalData.b1_start, end: generalData.b1_end, target: 'A' as const },
                { id: 'II', start: generalData.b2_start, end: generalData.b2_end, target: 'A' as const },
                { id: 'III', start: generalData.b3_start, end: generalData.b3_end, target: 'A' as const },
                { id: 'IV', start: generalData.b4_start, end: generalData.b4_end, target: 'A' as const },
            ];

            const bimTableDataRaw = [
                ...bimestresLectivos,
                ...managementBlocks
            ].sort((a, b) => (a.start || '').localeCompare(b.start || '')).filter(b => b.start).map(b => {
                const stats = getWorkingStats(b.start, b.end, calendarMap, scheduleEntries, selectedAreaId, currentAssignment?.areaName, selectedGrade, sec, b.target);
                const durationLabel = getMineduDuration(b.start, b.end);
                return {
                    ...b,
                    weeks: durationLabel,
                    numericWeeks: extractWeeksFromMineduDuration(durationLabel),
                    days: stats.days > 0 ? `${stats.days} días` : '-',
                    hours: stats.hours > 0 ? `${stats.hours} horas` : (b.target === 'B' ? '---' : '0 horas'),
                    rawDays: stats.days,
                    rawHours: stats.hours
                };
            });

            const unidadesLectivas: any[] = [];
            [1, 2, 3, 4, 5, 6, 7, 8].forEach(u => {
                const start = (generalData as any)[`u${u}_start` || ''];
                const end = (generalData as any)[`u${u}_end` || ''];
                unidadesLectivas.push({ id: `Unidad ${u}`, start, end, target: 'A' as const });
            });

            const unitTableDataRaw = [
                ...unidadesLectivas,
                ...managementBlocks
            ].sort((a, b) => (a.start || '').localeCompare(b.start || '')).filter(u => u.start).map(u => {
                const stats = getWorkingStats(u.start, u.end, calendarMap, scheduleEntries, selectedAreaId, currentAssignment?.areaName, selectedGrade, sec, u.target);
                return {
                    ...u,
                    weeks: getMineduDuration(u.start, u.end),
                    days: stats.days > 0 ? `${stats.days} días` : '-', 
                    hours: stats.hours > 0 ? `${stats.hours} horas` : (u.target === 'B' ? '---' : '0 horas')
                };
            });

            const activeBims = bimTableDataRaw.filter(b => b.target === 'A');
            const managementBims = bimTableDataRaw.filter(b => b.target === 'B');
            
            // Ajuste solicitado: Sumar las semanas calculadas en cada bimestre individualmente
            const totalWeeksEfectivas = activeBims.reduce((acc, curr) => acc + (curr.numericWeeks || 0), 0);
            const totalWeeksGestion = managementBims.reduce((acc, curr) => acc + (curr.numericWeeks || 0), 0);
            
            const totalDaysEfectivos = activeBims.reduce((acc, curr) => acc + (curr.rawDays || 0), 0);
            const totalHoursEfectivas = activeBims.reduce((acc, curr) => acc + (curr.rawHours || 0), 0);
            const totalDaysGestion = managementBims.reduce((acc, curr) => acc + (curr.rawDays || 0), 0);

            return {
                section: sec,
                bimTableData: bimTableDataRaw,
                unitTableData: unitTableDataRaw,
                total: { 
                    weeks: (
                        <div className="flex flex-col items-center leading-tight py-1">
                            <span className="text-[#a9d08e] lowercase">{totalWeeksGestion} sem. gestión</span>
                            <span className="lowercase">{totalWeeksEfectivas} sem. efectivas</span>
                        </div>
                    ) as any,
                    days: (
                        <div className="flex flex-col items-center leading-tight py-1">
                            <span className="text-[#a9d08e] lowercase">{totalDaysGestion} dias. gestión</span>
                            <span className="lowercase">{totalDaysEfectivos} dias. efectivos</span>
                        </div>
                    ) as any,
                    hours: `${totalHoursEfectivas} horas` 
                }
            };
        });
    }, [generalData, calendarMap, scheduleEntries, selectedAreaId, currentAssignment, selectedGrade, sectionsList]);

    const handleSave = async () => {
        if (!selectedAreaId || !selectedGrade || !selectedSection) {
            setToast({ msg: 'Faltan datos de selección.', type: 'error' });
            return;
        }
        setSaving(true);
        const compositeKey = `${selectedYear}-${selectedAreaId}-${selectedGrade}-${selectedSection}`;
        const duracion = `${formatDate(generalData.b1_start)} al ${formatDate(generalData.b4_end)}`;
        
        const temporalizacion = {
            resumenSecciones: temporalizacionPorSeccion.map(ts => ({
                seccion: ts.section,
                bimestres: ts.bimTableData,
                totalEfectivas: ts.total.hours
            }))
        };

        const programData = {
            id: compositeKey, 
            nroPa: '01', 
            areaId: selectedAreaId, 
            areaName: currentAssignment?.areaName || '',
            grade: selectedGrade, 
            section: selectedSection,
            ugel: generalData.ugel || '',
            ie: generalData.institution || '',
            lugar: generalData.lugar || '',
            duracion: duracion,
            docente: generalData.teacher || '',
            coord_ped: generalData.pedagogical_coordinator || '',
            director: generalData.director || '',
            sub_director: generalData.subdirector || '',
            coord_tut: generalData.toe_coordinator || '',
            areaPurpose, 
            areaEnfoque,
            areaStandards: areaStandardsText,
            caracterizacion_context: generalData.context_description || '',
            caracterizacion_adolecente: currentAssignment?.studentCharacterization || '',
            temp_curr_area: temporalizacion,
            matrixChecks, 
            didacticUnits, 
            resourceFields, 
            bibliographyFields,
            inicio_bim_i: generalData.b1_start || '',
            inicio_bim_ii: generalData.b2_start || '',
            inicio_bim_iii: generalData.b3_start || '',
            inicio_bim_iv: generalData.b4_start || '',
            fin_bim_i: generalData.b1_end || '',
            fin_bim_ii: generalData.b2_end || '',
            fin_bim_iii: generalData.b3_end || '',
            fin_bim_iv: generalData.b4_end || '',
            
            alumnos: studentStats.total,
            horas_sem: studentStats.horas,
            ciclo: studentStats.ciclo,
            
            metas_datos: manualMetas
        };

        try {
            const res = await saveProgramacionAnual(programData);
            if (res.success) {
                setToast({ msg: `Sincronización Año ${selectedYear} Correcta.`, type: 'success' });
                await updateModuleStatus('programacion_anual', true);
                onSuccess();
            } else setToast({ msg: `Fallo SQL: ${res.message}`, type: 'error' });
        } catch (e: any) { 
            setToast({ msg: `Error de red.`, type: 'error' }); 
        } finally { 
            setSaving(false); 
        }
    };

    const handleOpenManager = async () => {
        setIsManageModalOpen(true);
        const list = await getProgramacionesAnuales();
        setAllSavedProgramsList(Object.values(list));
    };

    const handleTogglePinMatrix = () => {
        if (!selectedAreaId || !selectedGrade) {
            setToast({ msg: 'Seleccione área y grado para fijar la matriz.', type: 'error' });
            return;
        }

        if (isMatrixPinned) {
            localStorage.removeItem(GLOBAL_PINNED_MATRIX_STORAGE_KEY);
            setIsMatrixPinned(false);
            setToast({ msg: 'Matriz desfijada correctamente.', type: 'success' });
            return;
        }

        localStorage.setItem(GLOBAL_PINNED_MATRIX_STORAGE_KEY, JSON.stringify(matrixChecks));
        setIsMatrixPinned(true);
        setToast({ msg: 'Matriz fijada para cualquier area, grado y seccion.', type: 'success' });
    };

    const handleTogglePinDidacticUnits = () => {
        if (isDidacticUnitsPinned) {
            localStorage.removeItem(GLOBAL_PINNED_DIDACTIC_UNITS_STORAGE_KEY);
            setIsDidacticUnitsPinned(false);
            setToast({ msg: 'Unidades didacticas desfijadas correctamente.', type: 'success' });
            return;
        }

        localStorage.setItem(GLOBAL_PINNED_DIDACTIC_UNITS_STORAGE_KEY, JSON.stringify(didacticUnits));
        setIsDidacticUnitsPinned(true);
        setToast({ msg: 'Unidades didacticas fijadas para cualquier area, grado y seccion.', type: 'success' });
    };

    const handleLoadSpecific = (prog: any) => {
        setSelectedYear(prog.id.split('-')[0]); 
        setSelectedAreaId(prog.areaId);
        setSelectedGrade(prog.grade);
        setSelectedSection(prog.section);
        setIsManageModalOpen(false);
    };

    const handleDeleteSpecific = async (prog: any, event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        const year = prog.id.split('-')[0];
        const confirmed = window.confirm(`Se eliminara la programacion anual de ${prog.areaName} (${prog.grade} ${prog.section}) del año ${year}. Esta accion no se puede deshacer. ¿Desea continuar?`);
        if (!confirmed) return;

        setDeletingProgramId(prog.id);
        try {
            const res = await deleteProgramacionAnual(prog.id);
            if (!res.success) {
                setToast({ msg: `No se pudo eliminar la programacion: ${res.message || 'error desconocido'}`, type: 'error' });
                return;
            }

            setAllSavedProgramsList(prev => prev.filter(item => item.id !== prog.id));
            setToast({ msg: 'Programacion eliminada correctamente.', type: 'success' });
        } catch {
            setToast({ msg: 'Ocurrio un error al eliminar la programacion.', type: 'error' });
        } finally {
            setDeletingProgramId(null);
        }
    };

    const handleSaveIAKey = async (config: {
        provider: 'gemini' | 'openai';
        geminiKey: string;
        openaiKey: string;
        aiPedagogicalRoute: string;
        institutionalProblems: string;
        unitPedagogicalFocus: string;
    }) => {
        setSavingKey(true);
        try {
            const updated = {
                ...generalData,
                gemini_api_key: config.geminiKey,
                openai_api_key: config.openaiKey,
                ai_provider: config.provider,
                ai_pedagogical_route: config.aiPedagogicalRoute,
                ai_institutional_problems: config.institutionalProblems,
                ai_unit_pedagogical_focus: config.unitPedagogicalFocus
            };
            const res = await saveDatosGenerales(updated);
            if (res.success) {
                setGeneralData(updated);
                setShowAuthScreen(false);
                setToast({ msg: 'Llave IA guardada correctamente.', type: 'success' });
            }
        } catch (e) {
            setToast({ msg: 'Error al guardar llave IA.', type: 'error' });
        } finally {
            setSavingKey(false);
        }
    };

    const extractJsonBlock = (rawText: string) => {
        const cleaned = String(rawText || '').replace(/```json/gi, '').replace(/```/g, '').trim();
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
            throw new Error('La IA no devolvió un JSON válido.');
        }
        return cleaned.slice(firstBrace, lastBrace + 1);
    };

    const getOpenAIOutputText = (payload: any): string => {
        if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
        const output = Array.isArray(payload?.output) ? payload.output : [];
        const parts = output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : []);
        const text = parts
            .filter((part: any) => typeof part?.text === 'string')
            .map((part: any) => part.text)
            .join('\n')
            .trim();
        if (text) return text;
        throw new Error('OpenAI no devolvió texto utilizable.');
    };

    const requestOpenAIJson = async (apiKey: string, prompt: string) => {
        const res = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4.1-mini',
                input: prompt
            })
        });

        const payload = await res.json().catch(() => null);
        if (!res.ok) {
            const message = payload?.error?.message || 'Error al consultar OpenAI.';
            throw new Error(message);
        }

        return JSON.parse(extractJsonBlock(getOpenAIOutputText(payload)));
    };

    const getUnitPlanningSummary = (unitIdx: number) => {
        const competenciasArea = Object.keys(groupedCompetencias).filter((compName) =>
            Boolean(matrixChecks[`comp-${superNormalize(compName)}-${unitIdx}`])
        );
        const capacidadesArea = Object.entries(groupedCompetencias).flatMap(([compName, items]: [string, any[]]) =>
            items
                .filter((item) => Boolean(matrixChecks[`cap-${superNormalize(compName)}-${superNormalize(getFlexValue(item, 'capacidades'))}-${unitIdx}`]))
                .map((item) => getFlexValue(item, 'capacidades'))
        );
        const competenciasTrans = STATIC_TRANSVERSALS
            .filter((trans) => Boolean(matrixChecks[`transComp-${superNormalize(trans.name)}-${unitIdx}`]))
            .map((trans) => trans.name);
        const capacidadesTrans = STATIC_TRANSVERSALS.flatMap((trans) =>
            trans.caps.filter((cap) => Boolean(matrixChecks[`transCap-${superNormalize(cap)}-${unitIdx}`]))
        );
        const enfoques = STATIC_ENFOQUES.filter((enf) => Boolean(matrixChecks[`enfoque-${superNormalize(enf)}-${unitIdx}`]));
        const ejes = STATIC_EJES_REGIONALES.filter((eje) => Boolean(matrixChecks[`ejeReg-${superNormalize(eje)}-${unitIdx}`]));
        const vinculacion = Array.isArray(matrixChecks[`vinculacion-${unitIdx}`]) ? matrixChecks[`vinculacion-${unitIdx}`] : [];

        return {
            unidad: unitIdx + 1,
            competenciasArea,
            capacidadesArea,
            competenciasTrans,
            capacidadesTrans,
            enfoques,
            ejes,
            vinculacion
        };
    };

    const requestGeminiJson = async (apiKey: string, prompt: string) => {
        const ai = new GoogleGenAI({ apiKey });
        const stream = await ai.models.generateContentStream({
            model: 'gemini-3-flash-preview',
            contents: [{ parts: [{ text: prompt }] }]
        });
        let fullText = '';
        for await (const chunk of stream) {
            fullText += chunk.text || '';
        }
        return JSON.parse(extractJsonBlock(fullText));
    };

    const handleGenerateAI = async () => {
        if (!selectedAreaId || !selectedGrade || !selectedSection || !currentAssignment) {
            setToast({ msg: 'Seleccione área, grado y sección antes de usar la IA.', type: 'error' });
            return;
        }

        const aiProvider = generalData?.ai_provider || 'gemini';
        const apiKey = aiProvider === 'openai'
            ? String(generalData?.openai_api_key || '').trim()
            : String(generalData?.gemini_api_key || process.env.API_KEY || '').trim();

        if (!apiKey || apiKey.length < 10) {
            setShowAuthScreen(true);
            return;
        }

        const unitSummaries = UNITS.map((_, idx) => getUnitPlanningSummary(idx));
        const aiPedagogicalRoute = String((generalData as any)?.ai_pedagogical_route || '').trim();
        const institutionalProblems = String((generalData as any)?.ai_institutional_problems || '').trim();
        const unitPedagogicalFocus = String((generalData as any)?.ai_unit_pedagogical_focus || '').trim();

        const prompt = `
Actúa como especialista pedagógico del MINEDU Perú y completa una PROGRAMACIÓN ANUAL.

Datos base:
- Área: ${currentAssignment.areaName}
- Grado: ${selectedGrade}
- Sección: ${selectedSection}
- Año lectivo: ${selectedYear}
- Nivel: ${generalData.level || 'Secundaria'}
- Docente: ${generalData.teacher || ''}
- Caracterización del estudiante: ${currentAssignment.studentCharacterization || ''}
- Contexto institucional: ${generalData.context_description || ''}

- Problemáticas institucionales priorizadas:
${institutionalProblems || 'No especificadas. Si no se especifican, deduce problemáticas pertinentes a partir del contexto institucional y la caracterización del estudiante.'}

- Ruta pedagógica anual del docente:
${aiPedagogicalRoute || 'No especificada. Si no se especifica, organiza la programación con una progresión pedagógica coherente para el área.'}

- Enfoque o producto esperado por unidad:
${unitPedagogicalFocus || 'No especificado. Si no se especifica, distribuye los productos de aprendizaje de manera gradual y pertinente.'}

- Estándares del área: ${areaStandardsText || areaStandardsList.map((item: any) => `${getFlexValue(item, 'competencias')}: ${getFlexValue(item, 'estandar')}`).join('\n')}

Resumen por unidad:
${unitSummaries.map((unit) => `Unidad ${unit.unidad}
- Competencias del área: ${unit.competenciasArea.join('; ') || 'No especificadas'}
- Capacidades del área: ${unit.capacidadesArea.join('; ') || 'No especificadas'}
- Competencias transversales: ${unit.competenciasTrans.join('; ') || 'No especificadas'}
- Capacidades transversales: ${unit.capacidadesTrans.join('; ') || 'No especificadas'}
- Enfoques transversales: ${unit.enfoques.join('; ') || 'No especificados'}
- Ejes regionales: ${unit.ejes.join('; ') || 'No especificados'}
- Vinculación con otras áreas: ${unit.vinculacion.join('; ') || 'No especificada'}`).join('\n\n')}

Instrucciones:
- Redacta en español claro, formal y pedagógico.
- Mantén coherencia con el Currículo Nacional del Perú.
- Propón títulos breves, accionables y pertinentes para cada unidad.
- Redacta situaciones significativas conectadas con el contexto del estudiante.
- En recursos y bibliografía, usa listas simples con saltos de línea.
- Integra las problemáticas institucionales sin forzar artificialmente el contenido.
- Relaciona cada unidad con la ruta pedagógica anual del docente.
- Si existe enfoque o producto esperado por unidad, úsalo como guía principal para el título y la situación significativa.
- Distribuye progresivamente los productos de aprendizaje, evitando repetir el mismo producto en todas las unidades.
- Devuelve SOLO JSON válido con esta estructura exacta:
{
  "areaPurpose": "...",
  "areaEnfoque": "...",
  "didacticUnits": [
    { "unitNumber": 1, "title": "...", "situation": "..." }
  ],
  "resourceFields": {
    "medios": "...",
    "materiales": "...",
    "recursos": "...",
    "espacios": "...",
    "apps": "...",
    "softwares": "...",
    "plataformas": "..."
  },
  "bibliographyFields": {
    "referencias": "...",
    "linkografia": "..."
  }
}`;

        setIsGeneratingIA(true);
        try {
            const data = aiProvider === 'openai'
                ? await requestOpenAIJson(apiKey, prompt)
                : await requestGeminiJson(apiKey, prompt);

            if (typeof data?.areaPurpose === 'string') setAreaPurpose(data.areaPurpose);
            if (typeof data?.areaEnfoque === 'string') setAreaEnfoque(data.areaEnfoque);

            if (Array.isArray(data?.didacticUnits)) {
                const nextUnits = { ...didacticUnitsRef.current };
                data.didacticUnits.forEach((item: any) => {
                    const rawIdx = Number(item?.unitNumber) - 1;
                    if (rawIdx >= 0 && rawIdx < UNITS.length) {
                        nextUnits[rawIdx] = {
                            title: String(item?.title || ''),
                            situation: String(item?.situation || '')
                        };
                    }
                });
                setDidacticUnits(nextUnits);
            }

            if (data?.resourceFields && typeof data.resourceFields === 'object') {
                setResourceFields((prev) => ({ ...prev, ...data.resourceFields }));
            }

            if (data?.bibliographyFields && typeof data.bibliographyFields === 'object') {
                setBibliographyFields((prev) => ({ ...prev, ...data.bibliographyFields }));
            }

            setToast({ msg: 'IA Armi completó la programación anual.', type: 'success' });
        } catch (e: any) {
            setToast({ msg: `Error IA: ${e?.message || 'No se pudo completar el formulario.'}`, type: 'error' });
        } finally {
            setIsGeneratingIA(false);
        }
    };

    const handleMatrixMouseDown = (type: string, id: string | number, unitIdx: number, parentId?: string) => {
        const key = parentId ? `${type}-${parentId}-${id}-${unitIdx}` : `${type}-${id}-${unitIdx}`;
        const newValue = !matrixChecks[key];
        setDragCheckValue(newValue);
        setIsDraggingMatrix(true);
        setMatrixChecks(prev => ({ ...prev, [key]: newValue }));
    };

    const handleMatrixMouseEnter = (type: string, id: string | number, unitIdx: number, parentId?: string) => {
        if (isDraggingMatrix) {
            const key = parentId ? `${type}-${parentId}-${id}-${unitIdx}` : `${type}-${id}-${unitIdx}`;
            if (matrixChecks[key] !== dragCheckValue) setMatrixChecks(prev => ({ ...prev, [key]: dragCheckValue }));
        }
    };

    const toggleVinculacionArea = (unitIdx: number, areaName: string) => {
        const key = `vinculacion-${unitIdx}`;
        const currentArr = Array.isArray(matrixChecks[key]) ? matrixChecks[key] : [];
        const newArr = currentArr.includes(areaName) ? currentArr.filter((a:any) => a !== areaName) : [...currentArr, areaName];
        setMatrixChecks(prev => ({ ...prev, [key]: newArr }));
    };

    const getVinculacionAbbr = (unitIdx: number) => {
        const list: string[] = matrixChecks[`vinculacion-${unitIdx}`] || [];
        if (list.length === 0) return "-";
        return list.map(a => AREA_ABBR[a] || a.substring(0, 3).toUpperCase()).join(", ");
    };

    const handleAutoBulletKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, stateSetter: any, field: string) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const t = e.currentTarget; const s = t.selectionStart; const v = t.value;
            const nv = v.substring(0, s) + "\n• " + v.substring(t.selectionEnd);
            stateSetter((prev: any) => ({ ...prev, [field]: nv }));
            setTimeout(() => { 
                t.selectionStart = t.selectionEnd = s + 3; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; 
            }, 0);
        }
    };

    const handleUnitBulletKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, index: number, field: 'situation' | 'title') => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const t = e.currentTarget; const s = t.selectionStart; const v = t.value;
            const nv = v.substring(0, s) + "\n• " + v.substring(t.selectionEnd);
            setDidacticUnits(p => ({ ...p, [index]: { ...(p[index] || { situation: '', title: '' }), [field]: nv } }));
            setTimeout(() => { 
                t.selectionStart = t.selectionEnd = s + 3; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; 
            }, 0);
        }
    };

    const romanBim = (n: number) => ["I", "II", "III", "IV", "V"][n - 1];

    const groupedCompetencias = useMemo(() => {
        const groups: Record<string, any[]> = {};
        competencias.forEach(c => {
            const compName = getFlexValue(c, 'competencias');
            const capName = getFlexValue(c, 'capacidades');
            if (!groups[compName]) groups[compName] = [];
            const alreadyExists = groups[compName].some(item => getFlexValue(item, 'capacidades') === capName);
            if (!alreadyExists) groups[compName].push(c);
        });
        return groups;
    }, [competencias]);

    const handleManualGoalChange = (seccion: string, competencia: string, tipo: 'LINEA_BASE' | 'META' | 'DIAGNOSTICO', level: string, value: string) => {
        const val = Math.max(0, parseInt(value) || 0);
        const colKey = `cant_${level === 'AD' ? 'destacado' : level === 'A' ? 'esperado' : level === 'B' ? 'proceso' : level === 'C' ? 'inicio' : 'no_evaluado'}`;
        
        const normS = String(seccion).trim().toUpperCase();
        const normC = String(competencia).trim().toUpperCase();
        const limit = studentMatricula[normS] || 0;

        if (tipo !== 'LINEA_BASE') {
            const existingManual = manualMetas.find(m => 
                String(m.seccion).trim().toUpperCase() === normS && 
                String(m.competencia).trim().toUpperCase() === normC && 
                m.tipo === tipo
            );

            const sumOtherLevels = ORDERED_LEVELS.filter(l => l !== level).reduce((acc, l) => {
                let currentVal = 0;
                if (tipo === 'DIAGNOSTICO') {
                    const diagDb = (statsData || []).find((s: any) => String(s.seccion).trim().toUpperCase() === normS && String(s.competencia).trim().toUpperCase() === normC && String(s.nivel_logro).trim().toUpperCase() === String(l).trim().toUpperCase());
                    const dbVal = diagDb ? diagDb.cantidad : 0;
                    currentVal = dbVal || getManualCount(existingManual, l);
                } else {
                    currentVal = getManualCount(existingManual, l);
                }
                return acc + currentVal;
            }, 0);

            if (limit > 0 && (sumOtherLevels + val > limit)) {
                const tipoLabel = tipo === 'META' ? 'Metas' : 'Resultados de Diagnóstico';
                setGoalToastMsg(`La cantidad total de ${tipoLabel} (${sumOtherLevels + val}) no puede exceder la matrícula oficial de esta sección (${limit} estudiantes).`);
                return;
            }
        }

        setManualMetas(prev => {
            const existingInPrev = prev.find(m => 
                String(m.seccion).trim().toUpperCase() === normS && 
                String(m.competencia).trim().toUpperCase() === normC && 
                m.tipo === tipo
            );
            if (existingInPrev) {
                return prev.map(m => m === existingInPrev ? { ...m, [colKey]: val } : m);
            } else {
                const newMeta: MetaData = {
                    anio: selectedYear, area: currentAssignment?.areaName || '', grado: selectedGrade, seccion, competencia, tipo,
                    cant_destacado: 0, cant_esperado: 0, cant_proceso: 0, cant_inicio: 0, cant_no_evaluado: 0,
                    [colKey]: val
                };
                return [...prev, newMeta];
            }
        });
    };

    if (activeSection === 'evaluacion_diagnostica') {
        return <DiagnosticEvaluationView />;
    }

    if (showTemplateMode) {
        return <TemplateMergeView 
            onBack={() => setShowTemplateMode(false)}
            selectedAreaId={selectedAreaId}
            selectedGrade={selectedGrade}
            selectedSection={selectedSection}
        />;
    }

    return (
        <>
            {toast && <InternalToast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
            {goalToastMsg && <InfoToast message={goalToastMsg} onClose={() => setGoalToastMsg(null)} />}
            {showAuthScreen && (
                <AuthOverlay
                    onSave={handleSaveIAKey}
                    onClose={() => setShowAuthScreen(false)}
                    isSaving={savingKey}
                    initialProvider={(generalData.ai_provider as 'gemini' | 'openai') || 'gemini'}
                    initialGeminiKey={generalData?.gemini_api_key || ''}
                    initialOpenAIKey={generalData?.openai_api_key || ''}
                    initialAiPedagogicalRoute={(generalData as any)?.ai_pedagogical_route || ''}
                    initialInstitutionalProblems={(generalData as any)?.ai_institutional_problems || ''}
                    initialUnitPedagogicalFocus={(generalData as any)?.ai_unit_pedagogical_focus || ''}
                />
            )}
            
            <div className="animate-fade-in pb-20 space-y-6 relative">
                <div style={{ backgroundColor: themeColor }} className="text-white p-7 rounded-[3rem] shadow-2xl relative z-20 overflow-visible border border-white/20 transition-colors duration-500">
                    <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-white/30 via-white/10 to-transparent rounded-t-[3rem]"></div>
                    <div className="absolute top-6 right-8 flex items-center gap-3">
                        <div className="relative">
                            <div 
                                className="w-10 h-10 rounded-full border-2 border-white/40 shadow-lg cursor-pointer overflow-hidden transition-transform hover:scale-110 active:scale-95 flex items-center justify-center bg-white/20 backdrop-blur-md"
                                title="Personalizar color del apartado"
                            >
                                <span className="text-xl">🎨</span>
                                <input 
                                    type="color" 
                                    value={themeColor} 
                                    onChange={(e) => {
                                        setThemeColor(e.target.value);
                                        localStorage.setItem('armi_goals_theme', e.target.value);
                                    }}
                                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col lg:flex-row justify-between items-center gap-8">
                        <div className="flex items-center gap-5">
                            <div className="bg-white/20 p-4 rounded-[2rem] border border-white/30 shadow-inner backdrop-blur-md">
                                <span className="text-4xl drop-shadow-lg">📊</span>
                            </div>
                            <div className="flex flex-col">
                                <div className="flex items-center gap-4">
                                    <h1 className="text-4xl font-black italic font-serif tracking-tight uppercase leading-none">Programación Anual</h1>
                                    <div className="relative">
                                        <span 
                                            onClick={() => setShowYearPicker(!showYearPicker)}
                                            className="cursor-pointer text-white/90 hover:text-white transition-all border-b-2 border-dotted border-white/40 pb-0.5 px-2 rounded-xl hover:bg-white/10 text-2xl font-black italic"
                                            title="Cambiar Año Académico"
                                        >
                                            ({selectedYear})
                                        </span>
                                        {showYearPicker && (
                                            <div className="absolute top-full left-0 mt-3 bg-white border border-slate-200 shadow-2xl rounded-2xl p-2 z-[500] animate-fade-in flex flex-col gap-1 min-w-[120px]">
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest text-center py-1">Periodo</p>
                                                {years.map(y => (
                                                    <button 
                                                        key={y} 
                                                        onClick={() => { setSelectedYear(y); setShowYearPicker(false); }}
                                                        className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${selectedYear === y ? 'bg-blue-600 text-white shadow-lg' : 'hover:bg-slate-100 text-slate-600'}`}
                                                    >
                                                        {y}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-white/70 mt-2">Planificación y Organización Curricular</span>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-6 bg-white/10 p-3 rounded-full border border-white/20 shadow-inner backdrop-blur-sm mr-12 overflow-visible">
                            <div className="relative shrink-0">
                                <button
    onClick={handleGenerateAI}
    disabled={!currentAssignment || isGeneratingIA}
    className={`btn-3d-purple shrink-0 ${!currentAssignment ? 'opacity-40 grayscale cursor-not-allowed' : (isGeneratingIA ? 'animate-pulse' : '')}`}
    title="Completar con IA Armi"
>
    {isGeneratingIA ? <span className="text-xl">⌛</span> : <span className="text-lg">🤖</span>}
</button>
                                <button
                                    type="button"
                                    onClick={() => setShowAuthScreen(true)}
                                    className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-white text-slate-700 border border-slate-200 shadow-lg hover:bg-slate-50 flex items-center justify-center text-[10px] font-black"
                                    title="Configuración de IA"
                                >
                                    ⚙
                                </button>
                            </div>

                            <button 
                                onClick={() => setShowTemplateMode(true)} 
                                className="btn-water water-white w-14 h-14 rounded-full flex items-center justify-center hover:scale-110 active:scale-95 transition-all relative group"
                            >
                                <span className="text-2xl">📄</span>
                                <span className="tooltip hidden">Plantillas Word</span>
                            </button>
                            
                            <button 
                                onClick={handleSave} 
                                disabled={!currentAssignment || saving} 
                                className={`btn-water water-white w-14 h-14 rounded-full flex items-center justify-center hover:scale-110 active:scale-95 transition-all relative group ${(!currentAssignment || saving) ? 'opacity-50 grayscale' : 'hover:scale-105 active:scale-95'}`}
                            >
                                <span className="text-2xl">{saving ? '⏳' : '💾'}</span>
                                <span className="tooltip hidden">Sincronizar SQL</span>
                            </button>

                            <button 
                                onClick={handleOpenManager} 
                                className="btn-water water-white w-14 h-14 rounded-full flex items-center justify-center hover:scale-110 active:scale-95 transition-all relative group"
                            >
                                <span className="text-2xl">🗃️</span>
                                <span className="tooltip hidden">Gestionar Registros</span>
                            </button>
                        </div>
                    </div>

                    <div className="mt-8 grid grid-cols-1 md:grid-cols-12 gap-4 bg-black/10 p-5 rounded-[2.5rem] border border-white/10 backdrop-blur-md items-end shadow-inner">
                        <div className="md:col-span-6"><Select label="ÁREA CURRICULAR" name="area" options={areaOptions} value={selectedAreaId} onChange={e => { setSelectedAreaId(e.target.value); setSelectedGrade(''); setSelectedSection(''); }} labelClassName="text-white ml-2 text-[9px] font-black" valueClassName="text-slate-800" className="h-auto" /></div>
                        <div className="md:col-span-3"><Select label="GRADO" name="grade" options={availableGrades} value={selectedGrade} onChange={e => { setSelectedGrade(e.target.value); setSelectedSection(''); }} disabled={!selectedAreaId} labelClassName="text-white ml-2 text-[9px] font-black" valueClassName="text-slate-800" className="h-auto" /></div>
                        <div className="md:col-span-3"><Select label="SECCIÓN" name="section" options={availableSections} value={selectedSection} onChange={e => setSelectedSection(e.target.value)} disabled={!selectedGrade} labelClassName="text-white ml-2 text-[9px] font-black" valueClassName="text-slate-800" className="h-auto" /></div>
                    </div>
                </div>

                {!currentAssignment ? (
                    <div className="p-20 text-center border-4 border-dashed border-slate-200 rounded-[4rem] bg-slate-50/20 text-slate-300 flex flex-col items-center"><div className="text-8xl mb-8 grayscale opacity-20 animate-pulse">📐</div><p className="font-black uppercase tracking-[0.3em] text-xs max-w-xs leading-loose">Seleccione un área registrada para cargar y gestionar la matriz anual de planificación para el ciclo {selectedYear}.</p></div>
                ) : (
                    <>
                        <div className="bg-white px-8 py-4 rounded-3xl shadow-md border border-slate-100 flex flex-wrap items-center justify-between gap-6 animate-fade-in">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-xl shadow-inner">👨‍🏫</div>
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">ALUMNOS</span>
                                    <span className="text-base font-black text-blue-700 leading-none">{studentStats.total}</span>
                                </div>
                            </div>
                            <div className="h-8 w-px bg-slate-100 hidden md:block"></div>
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-xl shadow-inner">🔄</div>
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">CICLO</span>
                                    <span className="text-base font-black text-indigo-700 leading-none">{studentStats.ciclo}</span>
                                </div>
                            </div>
                            <div className="h-8 w-px bg-slate-100 hidden md:block"></div>
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-xl shadow-inner">⏰</div>
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">HORAS SEM.</span>
                                    <span className="text-base font-black text-emerald-700 leading-none">{studentStats.horas}</span>
                                </div>
                            </div>
                            <div className="ml-auto hidden lg:flex items-center gap-2 px-4 py-2 bg-slate-50 rounded-2xl border border-slate-100">
                                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Año Lectivo {selectedYear} - {generalData.level || 'Secundaria'}</span>
                            </div>
                        </div>

                        {/* VISTA PREVIA MATRIZ Y ESTÁNDARES */}
                        <div className="bg-white rounded-[2rem] shadow-xl border overflow-hidden" style={{ borderColor: themeColor }}>
                            <button onClick={() => setShowPreviewMatrix(!showPreviewMatrix)} className="w-full text-white p-4 flex justify-between items-center group transition-colors hover:brightness-110" style={{ backgroundColor: themeColor }}><span className="font-black uppercase text-[10px] tracking-[0.3em] select-none"><span className="text-xl">🎯</span>Estándares de Aprendizaje</span><span className="text-xl transition-transform duration-500" style={{ transform: showPreviewMatrix ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span></button>
                            <div className={`transition-all duration-700 ease-in-out overflow-hidden ${showPreviewMatrix ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}><div className="grid grid-cols-1"><div className="flex border-b border-slate-100"><div className="w-72 bg-slate-900 text-white p-6 flex items-center justify-center text-center border-r border-white/5 shrink-0 select-none"><h3 className="font-black uppercase text-[10px] leading-tight tracking-widest">Estándar de Aprendizaje - Área</h3></div><div className="flex-1"><table className="w-full border-collapse"><tbody>{areaStandardsList.map((st, i) => (<tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50"><td className="p-4 w-1/3 text-[10px] font-black uppercase text-slate-800 border-r border-slate-50 italic bg-slate-50/10 select-none">{getFlexValue(st, 'competencias')}</td><td className="p-4 text-[10px] text-slate-600 text-justify italic font-medium leading-relaxed">{getFlexValue(st, 'estandar')}</td></tr>))}</tbody></table></div></div><div className="flex"><div className="w-72 bg-slate-900 text-white p-6 flex items-center justify-center text-center border-r border-white/5 shrink-0 select-none"><h3 className="font-black uppercase text-[10px] leading-tight tracking-widest">Estándar de Aprendizaje - Transversales</h3></div><div className="flex-1"><table className="w-full border-collapse"><tbody>{Object.entries(transversalTextMap).map(([compName, text], i) => (<tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50"><td className="p-4 w-1/3 text-[10px] font-black uppercase text-slate-800 border-r border-slate-50 italic bg-slate-50/10 select-none">{compName}</td><td className="p-4 text-[10px] text-slate-600 text-justify italic font-medium leading-relaxed">{text}</td></tr>))}</tbody></table></div></div></div></div>
                        </div>

                        {/* TEMPORALIZACIÓN INDEPENDIENTE POR SECCIÓN */}
                        <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden" style={{ borderColor: themeColor }}>
                            <button onClick={() => setShowCalendarSummary(!showCalendarSummary)} className="w-full text-white p-4 flex justify-between items-center group transition-all hover:brightness-110" style={{ backgroundColor: themeColor }}><div className="flex items-center gap-3"><span className="text-xl">📅</span><span className="font-black uppercase text-[10px] tracking-[0.3em] select-none">Temporalización Curricular del Área</span></div><span className="text-xl transition-transform duration-500" style={{ transform: showCalendarSummary ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span></button>
                            <div className={`transition-all duration-700 ease-in-out overflow-hidden ${showCalendarSummary ? 'max-h-[4000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                                <div className="p-6 space-y-12 bg-slate-50/30">
                                    {temporalizacionPorSeccion.map((ts, idxSec) => (
                                        <div key={ts.section} className="animate-fade-in">
                                            <div className="flex items-center gap-4 mb-6">
                                                <div style={{ backgroundColor: themeColor }} className="min-w-[3rem] h-10 px-3 rounded-2xl flex items-center justify-center text-white font-black text-sm shadow-lg">{selectedGrade} {ts.section}</div>
                                                <h3 className="text-sm font-black text-slate-700 uppercase tracking-tighter">ANÁLISIS DE TIEMPO EFECTIVO</h3>
                                                <div className="h-px bg-slate-200 flex-1"></div>
                                            </div>
                                            
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                                <div className="space-y-0">
                                                    <div className="bg-slate-900 text-white text-[10px] font-black uppercase text-center py-2 tracking-[0.2em] rounded-t-2xl select-none">Bimestres - {selectedGrade} {ts.section}</div>
                                                    <div className="overflow-hidden border border-slate-300 rounded-b-2xl shadow-sm bg-white"><table className="w-full text-[10px] border-collapse text-center"><thead><tr className="bg-slate-100 text-slate-700 font-black uppercase border-b border-slate-300"><th className="p-3 border-r border-slate-200">BIM</th><th className="p-3 border-r border-slate-200">INICIO</th><th className="p-3 border-r border-slate-200">FIN</th><th className="p-3 border-r border-slate-200">SEMANAS</th><th className="p-3 border-r border-slate-200">DÍAS</th><th className="p-3">HORAS</th></tr></thead><tbody className="font-bold text-slate-600">{ts.bimTableData.map((b: any, i: number) => (<tr key={i} className={`border-b border-slate-100 hover:bg-sky-50/30 ${b.target === 'B' ? 'bg-emerald-50/40 text-emerald-900 font-black italic' : ''}`}><td className="p-3 border-r border-slate-200 bg-slate-50/50 font-black italic">{b.id}</td><td className="p-3 border-r border-slate-200 italic">{formatDate(b.start)}</td><td className="p-3 border-r border-slate-200 italic">{formatDate(b.end)}</td><td className="p-3 border-r border-slate-200 italic">{b.weeks}</td><td className="p-3 border-r border-slate-200 italic">{b.days}</td><td className="p-3 italic font-black text-slate-800">{b.hours}</td></tr>))}</tbody><tfoot className="bg-slate-900 text-white font-black uppercase text-[9px]"><tr><td colSpan={3} className="p-3 text-right pr-6">TOTAL</td><td className="p-3 border-l border-white/10">{ts.total.weeks}</td><td className="p-3 border-l border-white/10">{ts.total.days}</td><td className="p-3 border-l border-white/10" style={{ backgroundColor: themeColor }}>{ts.total.hours}</td></tr></tfoot></table></div>
                                                </div>
                                                <div className="space-y-0">
                                                    <div className="bg-slate-900 text-white text-[10px] font-black uppercase text-center py-2 tracking-[0.2em] rounded-t-2xl select-none">Unidades - {selectedGrade} {ts.section}</div>
                                                    <div className="overflow-hidden border border-slate-300 rounded-b-2xl shadow-sm bg-white"><table className="w-full text-[10px] border-collapse text-center"><thead><tr className="bg-slate-100 text-slate-700 font-black uppercase border-b border-slate-300"><th className="p-3 border-r border-slate-200">UNIDAD</th><th className="p-3 border-r border-slate-200">INICIO</th><th className="p-3 border-r border-slate-200">FIN</th><th className="p-3 border-r border-slate-200">SEMANAS</th><th className="p-3 border-r border-slate-200">DÍAS</th><th className="p-3">HORAS</th></tr></thead><tbody className="font-bold text-slate-600">{ts.unitTableData.map((u: any, i: number) => (<tr key={i} className={`border-b border-slate-100 hover:bg-sky-50/30 ${u.target === 'B' ? 'bg-emerald-50/40 text-emerald-900 font-black italic' : ''}`}><td className="p-3 border-r border-slate-200 bg-slate-50/50 font-black italic">{u.id}</td><td className="p-3 border-r border-slate-200 italic">{formatDate(u.start)}</td><td className="p-3 border-r border-slate-200 italic">{formatDate(u.end)}</td><td className="p-3 border-r border-slate-200 italic">{u.weeks}</td><td className="p-3 border-r border-slate-200 italic">{u.days}</td><td className="p-3 italic font-black text-slate-800">{u.hours}</td></tr>))}</tbody></table></div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                            <div className="bg-white rounded-[2rem] shadow-lg border overflow-hidden" style={{ borderColor: themeColor }}>
                                <div className="text-white px-6 py-3 text-center text-xs font-black uppercase tracking-widest select-none" style={{ backgroundColor: themeColor }}>I. PROPÓSITO Y ENFOQUE DEL ÁREA</div>

                                <div className="p-4 space-y-4">
                                    <div><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-1 block"><span className="text-xl">📍</span>Propósito del Área</label><textarea className="w-full h-32 p-4 border-2 border-slate-50 rounded-2xl outline-none focus:border-blue-400 bg-slate-50/30 text-[11px] text-slate-700 leading-relaxed text-justify italic font-medium resize-none shadow-inner" value={areaPurpose} onChange={e => setAreaPurpose(e.target.value)} /></div>
                                    <div><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-1 block"><span className="text-xl">🔍</span>Enfoque del Área</label><textarea className="w-full h-32 p-4 border-2 border-slate-50 rounded-2xl outline-none focus:border-blue-400 bg-slate-50/30 text-[11px] text-slate-700 leading-relaxed text-justify italic font-medium resize-none shadow-inner" value={areaEnfoque} onChange={e => setAreaEnfoque(e.target.value)} /></div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-[2rem] shadow-xl border overflow-hidden" style={{ borderColor: themeColor }}>
                            <div className="bg-slate-900 text-white p-3 flex items-center justify-between gap-4 text-[13px] font-black uppercase tracking-[0.4em] font-serif border-b-2 border-white/5 select-none">
                            <div className="flex-1 text-center">Unidades Didácticas:</div>
                            <button onClick={handleTogglePinDidacticUnits} className={`shrink-0 flex items-center gap-2 rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] border transition-all ${isDidacticUnitsPinned ? 'bg-amber-400 text-slate-900 border-amber-300' : 'bg-white/10 text-white border-white/20 hover:bg-white/20'}`} title="Fijar valores de las unidades didacticas para proximas programaciones">
                            <span>{isDidacticUnitsPinned ? '📌' : '📍'}</span>
                            <span>{isDidacticUnitsPinned ? 'Fijada' : 'Fijar'}</span>
                            </button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse text-[10px] min-w-[1000px] table-fixed">
                                    <thead><tr className="text-white font-black uppercase text-[9px] tracking-widest divide-x divide-white/20 border-b border-white/5" style={{ backgroundColor: themeColor }}>
                                    <th className="p-2 w-16 text-center">BIM</th>
                                    <th className="p-2 w-24 text-center">UNIDADES</th>
                                    <th className="p-2 w-2/5 text-center">SITUACIONES DE CONTEXTO</th>
                                    <th className="p-2 text-center">TÍTULO DE UNIDAD</th>
                                    </tr>
                                    </thead>
                                    <tbody>{BIMESTERS.map((bim) => (<React.Fragment key={bim}>{[0, 1].map((offset) => { const uIdx = (bim - 1) * 2 + offset; return (<tr key={uIdx} className="divide-x divide-slate-200 border-b border-slate-100 hover:bg-sky-50/30 transition-all align-top">{offset === 0 && <td rowSpan={2} className="p-2 text-center font-black text-slate-800 bg-slate-50/50 align-middle border-r-2 border-slate-200">
                                    <span className="text-[11px]">BIM {romanBim(bim)}</span>
                                    </td>}<td className="p-2 text-center font-bold text-slate-800 bg-slate-50/30 align-middle">Unidad {uIdx + 1}</td>
                                    <td className="p-1">
                                        <textarea className="w-full p-2 bg-transparent border-0 outline-none text-slate-600 italic text-[10.5px] resize-none leading-tight text-justify overflow-hidden font-medium" rows={1} style={{ height: 'auto', minHeight: '28px' }} onInput={e => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`; }} placeholder="..." value={didacticUnits[uIdx]?.situation || ''} onChange={e => setDidacticUnits(p => ({...p, [uIdx]: {...(p[uIdx] || {title:'', situation:''}), situation: e.target.value}}))} onKeyDown={e => handleUnitBulletKeyDown(e, uIdx, 'situation')} />
                                            </td>
                                            <td className="p-1">
                                                <textarea className="w-full p-2 bg-transparent border-0 outline-none font-bold text-slate-900 text-[10.5px] resize-none text-left leading-tight overflow-hidden italic" rows={1} style={{ height: 'auto', minHeight: '28px' }} onInput={e => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`; }} placeholder="..." value={didacticUnits[uIdx]?.title || ''} onChange={e => setDidacticUnits(p => ({...p, [uIdx]: {...(p[uIdx] || {title:'', situation:''}), title: e.target.value}}))} onKeyDown={e => handleUnitBulletKeyDown(e, uIdx, 'title')} />
                                                    </td>
                                                    </tr>); })}</React.Fragment>))}</tbody>
                                                    </table>
                                                    </div>
                                                    </div>

                        {/* SECCIÓN III: MATRIZ DE ORGANIZACIÓN */}
                        <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-visible relative" style={{ borderColor: themeColor }}>
                            <div className="bg-slate-900 text-white p-5 flex items-center justify-between gap-4 text-sm font-black uppercase tracking-[0.3em] select-none rounded-t-[2.5rem]">
                                <div className="flex-1 text-center">📋 II. MATRIZ DE ORGANIZACIÓN</div>
                                <button onClick={handleTogglePinMatrix} className={`shrink-0 flex items-center gap-2 rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] border transition-all ${isMatrixPinned ? 'bg-amber-400 text-slate-900 border-amber-300' : 'bg-white/10 text-white border-white/20 hover:bg-white/20'}`} title="Fijar valores de la matriz para próximas programaciones">
                                <span>{isMatrixPinned ? '📌' : '📍'}</span>
                            <span>{isMatrixPinned ? 'Fijada' : 'Fijar'}</span>
                            </button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className={`w-full border-collapse text-[11px] ${isDraggingMatrix ? 'select-none' : ''}`}>
                                    <thead className="text-white" style={{ backgroundColor: themeColor }}>
                                        <tr className="divide-x divide-white/20">
                                            <th className="p-4 w-64 text-left">Competencias y Capacidades</th>
                                            {UNITS.map(u => (<th key={u} className="relative p-1 w-10 h-20"><div className="absolute inset-0 flex items-center justify-center font-black uppercase text-[9px]" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>Unidad {u}</div></th>))}                                       
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                        {Object.entries(groupedCompetencias).map(([compName, items]: [string, any[]], cIdx) => (
                                            <React.Fragment key={cIdx}>
                                                <tr className="text-white font-black uppercase text-[10px]" style={{ backgroundColor: themeColor + 'CC' }}>
                                                    <td className="p-2.5 px-4">{compName}</td>
                                                    {UNITS.map((_, uIdx) => { 
                                                        const checked = matrixChecks[`comp-${superNormalize(compName)}-${uIdx}`]; 
                                                        return (<td key={uIdx} onMouseDown={() => handleMatrixMouseDown('comp', superNormalize(compName), uIdx)} onMouseEnter={() => handleMatrixMouseEnter('comp', superNormalize(compName), uIdx)} className={`p-0 text-center cursor-pointer transition-all border-b border-white/10 ${checked ? 'brightness-75' : 'hover:brightness-90'}`} style={{ backgroundColor: checked ? themeColor : 'transparent' }}>{checked && <span className="text-white text-lg font-black animate-scale-in">✓</span>}</td>); 
                                                    })}
                                                </tr>
                                                {items.map((item, iIdx) => { 
                                                    const capName = getFlexValue(item, 'capacidades'); 
                                                    const capKeyId = superNormalize(capName); 
                                                    const compKeyId = superNormalize(compName); 
                                                    return (<tr key={iIdx} className="divide-x divide-slate-100 hover:bg-slate-50 transition-colors"><td className="p-2 pl-8 text-[10px] font-bold text-slate-500 italic">{capName}</td>{UNITS.map((_, uIdx) => { const checked = matrixChecks[`cap-${compKeyId}-${capKeyId}-${uIdx}`]; return (<td key={uIdx} onMouseDown={() => handleMatrixMouseDown('cap', capKeyId, uIdx, compKeyId)} onMouseEnter={() => handleMatrixMouseEnter('cap', capKeyId, uIdx, compKeyId)} className={`p-0 text-center cursor-pointer transition-all ${checked ? 'bg-blue-50' : 'hover:bg-slate-100'}`}>{checked && <span className="text-base font-black animate-scale-in" style={{ color: themeColor }}>✓</span>}</td>); })}</tr>); 
                                                })}
                                            </React.Fragment>
                                        ))}
                                        <tr className="bg-slate-900 text-white font-black uppercase text-[10px]">
                                            <td className="p-3 px-4 flex items-center gap-2">🧩 COMPETENCIAS TRANSVERSALES</td>
                                            {UNITS.map(u => <td key={u} className="bg-slate-800"></td>)}
                                        </tr>
                                        {STATIC_TRANSVERSALS.map((trans, tIdx) => (
                                            <React.Fragment key={tIdx}>
                                                <tr className="text-white font-black uppercase text-[10px]" style={{ backgroundColor: themeColor + 'CC' }}>
                                                    <td className="p-2.5 px-4">{trans.name}</td>
                                                    {UNITS.map((_, uIdx) => { 
                                                        const checked = matrixChecks[`transComp-${superNormalize(trans.name)}-${uIdx}`]; 
                                                        return (<td key={uIdx} onMouseDown={() => handleMatrixMouseDown('transComp', superNormalize(trans.name), uIdx)} onMouseEnter={() => handleMatrixMouseEnter('transComp', superNormalize(trans.name), uIdx)} className={`p-0 text-center cursor-pointer transition-all border-b border-white/10 ${checked ? 'brightness-75' : 'hover:brightness-90'}`} style={{ backgroundColor: checked ? themeColor : 'transparent' }}>{checked && <span className="text-white text-lg font-black animate-scale-in">✓</span>}</td>); 
                                                    })}
                                                </tr>
                                                {trans.caps.map((cap, iIdx) => (
                                                    <tr key={iIdx} className="divide-x divide-slate-100 hover:bg-slate-50 transition-colors"><td className="p-2 pl-8 text-[10px] font-bold text-slate-500 italic">{cap}</td>{UNITS.map((_, uIdx) => { const checked = matrixChecks[`transCap-${superNormalize(cap)}-${uIdx}`]; return (<td key={uIdx} onMouseDown={() => handleMatrixMouseDown('transCap', superNormalize(cap), uIdx)} onMouseEnter={() => handleMatrixMouseEnter('transCap', superNormalize(cap), uIdx)} className={`p-0 text-center cursor-pointer transition-all ${checked ? 'bg-blue-50' : 'hover:bg-slate-100'}`}>{checked && <span className="text-base font-black animate-scale-in" style={{ color: themeColor }}>✓</span>}</td>); })}</tr>
                                                ))}
                                            </React.Fragment>
                                        ))}
                                        <tr className="bg-slate-900 text-white font-black uppercase text-[10px]">
                                            <td className="p-3 px-4 flex items-center gap-2">🌍 ENFOQUES TRANSVERSALES</td>
                                            {UNITS.map(u => <td key={u} className="bg-slate-800"></td>)}
                                        </tr>
                                        {STATIC_ENFOQUES.map((enf, eIdx) => (
                                            <tr key={eIdx} className="divide-x divide-slate-100 hover:bg-slate-50 transition-colors">
                                                <td className="p-2 px-4 text-[10px] font-bold text-slate-600">{enf}</td>
                                                {UNITS.map((_, uIdx) => { 
                                                    const checked = matrixChecks[`enfoque-${superNormalize(enf)}-${uIdx}`]; 
                                                    return (<td key={uIdx} onMouseDown={() => handleMatrixMouseDown('enfoque', superNormalize(enf), uIdx)} onMouseEnter={() => handleMatrixMouseEnter('enfoque', superNormalize(enf), uIdx)} className={`p-0 text-center cursor-pointer transition-all ${checked ? 'text-white' : 'hover:bg-slate-100'}`} style={{ backgroundColor: checked ? themeColor : 'transparent' }}>{checked && <span className="text-lg font-black animate-scale-in">✓</span>}</td>); 
                                                })}
                                            </tr>
                                        ))}
                                        <tr className="bg-slate-900 text-white font-black uppercase text-[10px]">
                                            <td className="p-3 px-4 flex items-center gap-2">🌍 EJES TEMÁTICOS REGIONALES</td>
                                            {UNITS.map(u => <td key={u} className="bg-slate-800"></td>)}
                                        </tr>
                                        {STATIC_EJES_REGIONALES.map((eje, eIdx) => (
                                            <tr key={eIdx} className="divide-x divide-slate-100 hover:bg-slate-50 transition-colors">
                                                <td className="p-2 px-4 text-[10px] font-bold text-slate-600">{eje}</td>
                                                {UNITS.map((_, uIdx) => {
                                                    const checked = matrixChecks[`ejeReg-${superNormalize(eje)}-${uIdx}`];
                                                    return (<td key={uIdx} onMouseDown={() => handleMatrixMouseDown('ejeReg', superNormalize(eje), uIdx)} onMouseEnter={() => handleMatrixMouseEnter('ejeReg', superNormalize(eje), uIdx)} className={`p-0 text-center cursor-pointer border-slate-100 transition-all ${checked ? 'text-white' : 'hover:bg-slate-100'}`} style={{ backgroundColor: checked ? themeColor : 'transparent' }}>{checked && <span className="text-lg font-black animate-scale-in">✓</span>}</td>);
                                                })}
                                            </tr>
                                        ))}
                                        <tr className="divide-x divide-slate-100 hover:bg-indigo-50/20 transition-colors group relative">
                                            <td className="p-2 px-4 text-[10px] font-black text-black-700 uppercase tracking-tighter">Vinculación con otras áreas</td>
                                            {UNITS.map((_, uIdx) => (
                                                <td key={uIdx} className="p-0 text-center relative border-slate-100">
                                                    <button onClick={() => setActiveVinculacionUnit(activeVinculacionUnit === uIdx ? null : uIdx)} className={`w-full h-full py-2 flex flex-col items-center justify-center gap-1 transition-all ${activeVinculacionUnit === uIdx ? 'bg-indigo-600 text-white shadow-inner' : 'hover:bg-indigo-50'}`}>
                                                        <span className="text-[8px] font-black leading-none px-1 text-center truncate w-full">{getVinculacionAbbr(uIdx)}</span>
                                                        <span className="text-[14px] opacity-40 leading-none">{activeVinculacionUnit === uIdx ? '▲' : '▼'}</span>
                                                    </button>
                                                    {activeVinculacionUnit === uIdx && (
                                                        <div className={`absolute bottom-full z-[500] mb-2 w-56 bg-white border border-slate-200 shadow-2xl rounded-2xl p-2 animate-fade-in text-left ${uIdx >= 5 ? 'right-0' : 'left-0'}`}>
                                                            <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                                                {OFFICIAL_AREAS_NAMES.map(area => (
                                                                    <div key={area} onClick={() => toggleVinculacionArea(uIdx, area)} className={`flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-all ${(matrixChecks[`vinculacion-${uIdx}`] || []).includes(area) ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'}`}>
                                                                        <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${(matrixChecks[`vinculacion-${uIdx}`] || []).includes(area) ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'}`}>
                                                                            {(matrixChecks[`vinculacion-${uIdx}`] || []).includes(area) && <span className="text-white text-[10px] font-black">✓</span>}
                                                                        </div>
                                                                        <span className="text-[10px] font-bold leading-tight">{area}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </td>
                                            ))}
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* RECURSOS */}
                        <div className="bg-white rounded-[2rem] shadow-xl border overflow-hidden" style={{ borderColor: themeColor }}><div className="bg-slate-900 text-white p-3 text-center text-[10px] font-black uppercase tracking-[0.3em] select-none">Medios, Materiales y Recursos Tecnológicos</div><div className="grid grid-cols-7 divide-x divide-slate-200">{[{ label: 'Medios', icon: '📄', field: 'medios' }, { label: 'Materiales', icon: '📚', field: 'materiales' }, { label: 'Recursos', icon: '🖨️', field: 'recursos' }, { label: 'Espacios', icon: '🏫', field: 'espacios' }, { label: 'Apps', icon: '📱', field: 'apps' }, { label: 'Softwares', icon: '⚙️', field: 'softwares' }, { label: 'Plataformas', icon: '🌐', field: 'plataformas' }].map((col) => (<div key={col.field} className="flex flex-col group h-48"><div className="bg-slate-50 p-2 text-center border-b border-slate-200 flex flex-col items-center justify-center gap-1 h-14 select-none"><span className="text-sm">{col.icon}</span><span className="text-[7px] font-black text-slate-500 uppercase leading-tight tracking-widest">{col.label}</span></div><textarea className="flex-1 w-full p-2 outline-none text-[10px] text-slate-700 italic font-medium resize-none leading-relaxed focus:bg-sky-50/30" value={(resourceFields as any)[col.field]} onChange={e => setResourceFields(p => ({ ...p, [col.field]: e.target.value }))} onKeyDown={e => handleAutoBulletKeyDown(e, setResourceFields, col.field)} /></div>))}</div></div>

                        {/* BIBLIOGRAFÍA */}
                        <div className="bg-white rounded-[2rem] shadow-xl border overflow-hidden" style={{ borderColor: themeColor }}><div className="grid grid-cols-2 divide-x divide-slate-200"><div className="flex flex-col h-48"><div className="bg-slate-900 text-white p-3 text-center flex items-center justify-center gap-3 h-12 select-none"><span className="text-base">📚</span><span className="text-[10px] font-black uppercase tracking-[0.2em]">Referencias Bibliográficas</span></div><textarea className="flex-1 w-full p-4 outline-none text-[10px] text-slate-700 italic font-medium resize-none leading-relaxed focus:bg-sky-50/30" value={bibliographyFields.referencias} onChange={e => setBibliographyFields(p => ({ ...p, referencias: e.target.value }))} onKeyDown={e => handleAutoBulletKeyDown(e, setBibliographyFields, 'referencias')} /></div><div className="flex flex-col h-48"><div className="bg-slate-900 text-white p-3 text-center flex items-center justify-center gap-3 h-12 select-none"><span className="text-base">🔗</span><span className="text-[10px] font-black uppercase tracking-[0.2em]">Linkografía</span></div><textarea className="flex-1 w-full p-4 outline-none text-[10px] text-slate-700 italic font-medium resize-none leading-relaxed focus:bg-sky-50/30" value={bibliographyFields.linkografia} onChange={e => setBibliographyFields(p => ({ ...p, linkografia: e.target.value }))} onKeyDown={e => handleAutoBulletKeyDown(e, setBibliographyFields, 'linkografia')} /></div></div></div>

                        {/* V. METAS DE APRENDIZAJE INTEGRADO Y RESTAURADO */}
                        {competenciesList.length > 0 && (
                            <div className="pt-12 space-y-8 animate-fade-in">
                                <div className="flex items-center gap-4 px-4">
                                    <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-4">
                                        <span className="w-2 h-8 rounded-full" style={{ backgroundColor: themeColor }}></span>
                                        V. Metas de Aprendizaje Comparativas
                                    </h2>
                                </div>
                                
                                <div className="space-y-12">
                                    {sectionsForSelectedGrade.map(seccion => {
                                        const normS = String(seccion).trim().toUpperCase();
                                        const totalMatriculaReal = studentMatricula[normS] || 0;
                                        
                                        return (
                                            <div key={seccion} className="space-y-6 animate-fade-in">
                                                <div className="flex justify-between items-center px-4">
                                                    <h3 className="text-lg font-black text-slate-700 uppercase tracking-tighter flex items-center gap-4 bg-white w-fit px-8 py-2 rounded-full border-2 border-slate-100 shadow-sm">
                                                        <span style={{ backgroundColor: themeColor }} className="text-white w-8 h-8 rounded-full flex items-center justify-center text-[11px] shadow-md transition-colors duration-500">{seccion}</span>
                                                        ANÁLISIS DE METAS - {selectedGrade} "{seccion}"
                                                    </h3>
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-4 py-1.5 rounded-full border border-slate-200 shadow-inner">
                                                        Matrícula Oficial: {totalMatriculaReal} est.
                                                    </span>
                                                </div>
                                                
                                                {competenciesList.map(comp => {
                                                    const currentYear = parseInt(selectedYear);
                                                    const prevYear = currentYear - 1;
                                                    const normC = String(comp).trim().toUpperCase();
                                                    
                                                    const getCount = (tipo: 'LINEA_BASE' | 'META' | 'DIAGNOSTICO', lvl: string) => {
                                                        const manual = manualMetas.find(m => 
                                                            String(m.seccion).trim().toUpperCase() === normS && 
                                                            String(m.competencia).trim().toUpperCase() === normC && 
                                                            m.tipo === tipo
                                                        );

                                                        if (tipo === 'LINEA_BASE') {
                                                            const autoCount = lineaBaseStats.filter((s: any) => 
                                                                String(s.seccion).trim().toUpperCase() === normS && 
                                                                String(s.competencia).trim().toUpperCase() === normC && 
                                                                String(s.nivel_logro).trim().toUpperCase() === lvl
                                                            ).reduce((a: number, b: any) => a + b.cantidad, 0);
                                                            return autoCount > 0 ? autoCount : (manual ? getManualCount(manual, lvl) : 0);
                                                        }
                                                        
                                                        if (tipo === 'DIAGNOSTICO') {
                                                            const match = (statsData || []).find((s: any) => 
                                                                String(s.seccion).trim().toUpperCase() === normS && 
                                                                String(s.competencia).trim().toUpperCase() === normC && 
                                                                String(s.nivel_logro).trim().toUpperCase() === String(lvl).trim().toUpperCase()
                                                            );
                                                            return match ? match.cantidad : (manual ? getManualCount(manual, lvl) : 0);
                                                        }
                                                        
                                                        return manual ? getManualCount(manual, lvl) : 0;
                                                    };

                                                    const isLbAuto = lineaBaseStats.some(s => String(s.seccion).trim().toUpperCase() === normS && String(s.competencia).trim().toUpperCase() === normC);
                                                    const isDiagAuto = (statsData || []).some((s: any) => String(s.seccion).trim().toUpperCase() === normS && String(s.competencia).trim().toUpperCase() === normC);

                                                    const totalLBActual = ORDERED_LEVELS.reduce((acc, lvl) => acc + getCount('LINEA_BASE', lvl), 0);
                                                    const totalDiagActual = ORDERED_LEVELS.reduce((acc, lvl) => acc + getCount('DIAGNOSTICO', lvl), 0);
                                                    const totalMetaActual = ORDERED_LEVELS.reduce((acc, lvl) => acc + getCount('META', lvl), 0);

                                                    const lbDen = totalLBActual || 1;
                                                    const currentDen = totalMatriculaReal || 1;

                                                    const totalLBPerc = totalLBActual > 0 ? "100.0" : "0.0";
                                                    const totalDiagPerc = totalMatriculaReal > 0 ? ((totalDiagActual / totalMatriculaReal) * 100).toFixed(1) : "0.0";
                                                    const totalMetaPerc = totalMatriculaReal > 0 ? ((totalMetaActual / totalMatriculaReal) * 100).toFixed(1) : "0.0";

                                                    return (
                                                        <div key={`${seccion}-${comp}`} style={{ borderColor: themeColor }} className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden mb-8 animate-fade-in relative">
                                                            <div style={{ backgroundColor: themeColor }} className="text-white p-4 font-black uppercase text-[11px] tracking-widest text-center border-b-2 border-black/10">
                                                                COMPETENCIA: {comp} - {selectedGrade} "{seccion}"
                                                            </div>
                                                            <table className="w-full border-collapse text-center table-fixed">
                                                                <thead>
                                                                    <tr className="bg-amber-50 text-[11px] font-black uppercase text-amber-900 border-b-2 border-amber-200">
                                                                        <th className="p-3 w-1/4 border-r border-amber-200 bg-amber-200/30">NIVEL DE LOGRO</th>
                                                                        <th colSpan={2} className="p-3 border-r border-amber-200 bg-amber-200/30">LÍNEA DE BASE {prevYear}</th>
                                                                        <th colSpan={2} className="p-3 border-r border-amber-200 bg-amber-200/30">DIAGNÓSTICO MARZO {currentYear}</th>
                                                                        <th colSpan={2} className="p-3 bg-amber-200/30">META DICIEMBRE {currentYear}</th>
                                                                    </tr>
                                                                    <tr className="bg-amber-50/50 text-[10px] font-black uppercase text-amber-600 border-b border-amber-200">
                                                                        <th className="py-2 border-r border-amber-200"></th>
                                                                        <th className="py-2 border-r border-amber-100">Cantidad</th>
                                                                        <th className="py-2 border-r border-amber-200">%</th>
                                                                        <th className="py-2 border-r border-amber-100">Cantidad</th>
                                                                        <th className="py-2 border-r border-amber-200">%</th>
                                                                        <th className="py-2 border-r border-amber-100">Cantidad</th>
                                                                        <th className="py-2">%</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="text-[11px] font-bold">
                                                                    {ORDERED_LEVELS.map(lvl => {
                                                                        const lbVal = getCount('LINEA_BASE', lvl);
                                                                        const lbPerc = totalLBActual > 0 ? ((lbVal / lbDen) * 100).toFixed(1) : "0.0";
                                                                        const diagVal = getCount('DIAGNOSTICO', lvl);
                                                                        const diagPerc = ((diagVal / currentDen) * 100).toFixed(1);
                                                                        const metaVal = getCount('META', lvl);
                                                                        const metaPerc = ((metaVal / currentDen) * 100).toFixed(1);
                                                                        
                                                                        const rowColor = lvl === 'AD' ? 'text-sky-500' : lvl === 'A' ? 'text-emerald-600' : lvl === 'B' ? 'text-orange-500' : lvl === 'C' ? 'text-red-600' : 'text-slate-500';
                                                                        
                                                                        return (
                                                                            <tr key={lvl} className={`border-b border-amber-100 hover:bg-amber-50/20 transition-colors ${rowColor}`}>
                                                                                <td className="p-2 border-r border-amber-200 text-left pl-6 font-black uppercase tracking-tight">{LEVEL_LABELS[lvl]}</td>
                                                                                
                                                                                <td className="p-1 border-r border-amber-100 relative h-full group">
                                                                                    <div className="relative h-full w-full">
                                                                                        <input type="number" disabled={isLbAuto} className={`w-full text-center bg-transparent outline-none focus:bg-white focus:ring-1 focus:ring-amber-400 rounded transition-all font-black ${rowColor} text-[11px] disabled:cursor-not-allowed`} value={lbVal || ''} onChange={e => handleManualGoalChange(seccion, comp, 'LINEA_BASE', lvl, e.target.value)} />
                                                                                        {isLbAuto && <div className="absolute inset-0 z-20 cursor-not-allowed opacity-0" onClick={() => setGoalToastMsg("Los datos de LÍNEA DE BASE provienen del registro histórico oficial y no pueden editarse.")} />}
                                                                                    </div>
                                                                                </td>
                                                                                <td className="p-2 border-r border-amber-200 opacity-80">{lbPerc}%</td>
                                                                                
                                                                                <td className="p-1 border-r border-amber-100 bg-slate-50/30 font-black relative h-full group">
                                                                                    <div className="relative h-full w-full">
                                                                                        <input type="number" disabled={isDiagAuto} className={`w-full text-center bg-transparent outline-none focus:bg-white focus:ring-1 focus:ring-amber-400 rounded transition-all font-black ${rowColor} text-[11px] disabled:cursor-not-allowed`} value={diagVal || ''} onChange={e => handleManualGoalChange(seccion, comp, 'DIAGNOSTICO', lvl, e.target.value)} />
                                                                                        {isDiagAuto && <div className="absolute inset-0 z-20 cursor-not-allowed opacity-0" onClick={() => setGoalToastMsg("Los RESULTADOS DE DIAGNÓSTICO provienen del módulo de evaluaciones oficial.")} />}
                                                                                    </div>
                                                                                </td>
                                                                                <td className="p-2 border-r border-amber-200 bg-slate-50/30 opacity-80">{diagPerc}%</td>
                                                                                
                                                                                <td className="p-1 border-r border-amber-100">
                                                                                        <input type="number" min={0} className={`w-full text-center bg-transparent outline-none focus:bg-white focus:ring-1 focus:ring-amber-400 rounded transition-all font-black ${rowColor} text-[11px]`} value={metaVal || ''} onChange={e => handleManualGoalChange(seccion, comp, 'META', lvl, e.target.value)} />
                                                                                </td>
                                                                                <td className="p-2 opacity-80">{metaPerc}%</td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                                <tfoot className="bg-amber-100/20 font-black text-slate-800 text-[11px] border-t-2 border-amber-200">
                                                                    <tr className="h-10">
                                                                        <td className="border-r border-amber-200 uppercase tracking-widest">TOTAL SECCIÓN</td>
                                                                        <td className="border-r border-amber-100">{totalLBActual}</td>
                                                                        <td className="border-r border-amber-200">{totalLBPerc}%</td>
                                                                        <td className="border-r border-amber-100">{totalDiagActual}</td>
                                                                        <td className="border-r border-amber-200">{totalDiagPerc}%</td>
                                                                        <td className="border-r border-amber-200">
                                                                            {totalMetaActual} / {totalMatriculaReal}
                                                                        </td>
                                                                        <td className="border-r border-amber-200">
                                                                            {totalMetaPerc}%
                                                                        </td>
                                                                    </tr>
                                                                </tfoot>
                                                            </table>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </>
                )}
                
            </div>

            {/* MODAL DE ADMINISTRACIÓN DE PROGRAMACIONES */}
            {isManageModalOpen && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl overflow-hidden border border-slate-200 flex flex-col h-[80vh]">
                        <div className="p-8 text-white flex justify-between items-center" style={{ backgroundColor: themeColor }}>
                            <div>
                                <h3 className="text-2xl font-black uppercase tracking-tight leading-none italic">Gestor de Programaciones</h3>
                                <p className="text-[10px] font-bold text-white/70 mt-2 uppercase tracking-[0.2em]">Registros guardados en Servidor SQL</p>
                            </div>
                            <button onClick={() => setIsManageModalOpen(false)} className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-2xl transition-all">✕</button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                            {allSavedProgramsList.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4 opacity-50 italic">
                                    <span className="text-6xl">📁</span>
                                    <p className="font-black text-xs uppercase tracking-widest">No hay programaciones guardadas todavía.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {allSavedProgramsList.map((prog, idx) => (
                                        <div 
                                            key={idx} 
                                            onClick={() => handleLoadSpecific(prog)}
                                            className="group bg-slate-50 border border-slate-200 p-5 rounded-[2rem] hover:bg-white hover:border-blue-300 hover:shadow-xl transition-all cursor-pointer relative overflow-hidden"
                                        >
                                            <button
                                                type="button"
                                                onClick={(event) => handleDeleteSpecific(prog, event)}
                                                disabled={deletingProgramId === prog.id}
                                                className="absolute top-3 right-3 z-20 w-9 h-9 rounded-full bg-white text-rose-600 border border-rose-100 shadow-sm hover:bg-rose-50 hover:border-rose-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-lg font-black transition-all"
                                                title="Eliminar programacion"
                                                aria-label={`Eliminar programacion de ${prog.areaName}`}
                                            >
                                                {deletingProgramId === prog.id ? '...' : '×'}
                                            </button>
                                            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-full translate-x-12 -translate-y-12 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                            <div className="flex items-center gap-4 relative z-10">
                                                <div className="w-14 h-14 rounded-2xl bg-white flex flex-col items-center justify-center shadow-sm border border-slate-100 shrink-0">
                                                    <span className="text-[8px] font-black text-slate-400 uppercase">AÑO</span>
                                                    <span className="text-lg font-black text-blue-600">{prog.id.split('-')[0]}</span>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="font-black text-slate-800 text-sm uppercase truncate pr-4">{prog.areaName}</h4>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="px-2 py-0.5 rounded-lg bg-slate-200 text-slate-600 text-[9px] font-black uppercase">{prog.grade}</span>
                                                        <span className="px-2 py-0.5 rounded-lg bg-indigo-100 text-indigo-700 text-[9px] font-black uppercase">Sec. {prog.section}</span>
                                                    </div>
                                                </div>
                                                <span className="text-2xl opacity-0 group-hover:opacity-100 transition-opacity">🚀</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="p-6 bg-slate-50 border-t border-slate-100 text-center">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">Haga clic en una tarjeta para cargar la planificación en el editor principal.</p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

