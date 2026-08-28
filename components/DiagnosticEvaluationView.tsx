
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { getEstudiantes, saveResultadosDiagnostico, getResultadosDiagnostico, deleteResultadosDiagnostico, getDatosGenerales, saveDatosGenerales, getCompetencias } from '../services/apiService';
import { Type } from "@google/genai";
import { createGeminiClient, generateGeminiContent } from '../utils/gemini';
import * as XLSX from 'xlsx';
import Header from './Header';
import EvaluationTable from './EvaluationTable';
import SummarySection from './SummarySection';
import { INITIAL_HEADER_INFO } from '../constants';
import { HeaderInfo, Student, EvaluationLevel, GeneralData, TeachingAssignment } from '../types';

// =========================================================================================
// 🧠 CONFIGURACIÓN DEL PROMPT (MODIFICA ESTO PARA MEJORAR LAS RESPUESTAS)
// =========================================================================================
const PROMPT_SISTEMA = (area: string, competencias: string[]) => `
ActÃºa como un Especialista PedagÃ³gico del Ministerio de EducaciÃ³n del PerÃº (MINEDU). 
Tu tarea es generar conclusiones descriptivas para la EvaluaciÃ³n DiagnÃ³stica del Ã¡rea de ${area}.

INSTRUCCIONES:
1. BasÃ¡ndote en el CurrÃ­culo Nacional (CNEB), genera una conclusiÃ³n breve para cada nivel de logro (AD, A, B, C).
2. Las conclusiones deben centrarse en el progreso de las siguientes competencias: ${competencias.join(', ')}.
3. El tono debe ser profesional, alentador y basado en evidencias.
4. MÃ¡ximo 250 caracteres por conclusiÃ³n (considerando espacios).
5. Usa verbos en presente (ej. "Muestra", "Logra", "Requiere").
6. Considera que cada conslusiÃ³n debe contener: logros + dificultades + sugerencias.

FORMATO DE SALIDA:
Debes retornar estrictamente un objeto JSON con este formato:
{
  "conclusiones": [
    { "level": "AD", "text": "texto aquÃ­" },
    { "level": "A", "text": "texto aquÃ­" },
    { "level": "B", "text": "texto aquÃ­" },
    { "level": "C", "text": "texto aquÃ­" }
  ]
}
`;
// =========================================================================================

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
                        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center text-3xl mb-6 shadow-inner">AI</div>
                        <h3 className="text-xl font-black uppercase tracking-tight leading-tight mb-4">Asistente IA Armi</h3>
                        <p className="text-[10px] font-bold text-blue-100 leading-relaxed uppercase tracking-wider">ConfiguraciÃ³n necesaria para habilitar la generaciÃ³n automÃ¡tica de conclusiones pedagÃ³gicas.</p>
                    </div>
                    <div className="mt-8 space-y-4">
                        <div className="flex gap-3 items-start">
                            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black shrink-0">1</span>
                            <p className="text-[9px] font-bold leading-tight uppercase">Ingresa a <a href="https://aistudio.google.com/app/apikey" target="_blank" className="underline decoration-2 underline-offset-2">Google AI Studio</a>.</p>
                        </div>
                        <div className="flex gap-3 items-start">
                            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black shrink-0">2</span>
                            <p className="text-[9px] font-bold leading-tight uppercase">Pulsa "Create API Key".</p>
                        </div>
                        <div className="flex gap-3 items-start">
                            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black shrink-0">3</span>
                            <p className="text-[9px] font-bold leading-tight uppercase">Copia el codigo y pegalo aqui.</p>
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
                            <label className="block text-[10px] font-black text-slate-500 mb-3 ml-1 uppercase tracking-widest">Copia tu API KEY aqui:</label>
                            <div className="relative">
                                <input 
                                    type="password"
                                    value={inputKey}
                                    onChange={(e) => setInputKey(e.target.value)}
                                    placeholder="AIzaSy..."
                                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-sm font-mono focus:border-blue-500 focus:bg-white transition-all outline-none shadow-inner"
                                />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300">KEY</div>
                            </div>
                        </div>
                        <div className="bg-amber-50 p-5 rounded-2xl border border-amber-100 flex gap-4">
                            <span className="text-xl shrink-0">INFO</span>
                            <p className="text-[10px] text-amber-700 font-bold leading-relaxed uppercase">Tu llave se guardarÃ¡ en armi.db de forma privada.</p>
                        </div>
                    </div>

                    <button 
                        onClick={() => onSave(inputKey)}
                        disabled={!inputKey || isSaving}
                        className="btn-water water-blue w-full py-5 rounded-[2rem] text-white font-black text-[11px] uppercase tracking-[0.2em] shadow-xl disabled:opacity-50 mt-8 h-[64px]"
                    >
                        {isSaving ? "Guardando en SQL..." : "Activar Motor PedagÃ³gico"}
                    </button>
                </div>
            </div>
        </div>
    );
};

const Toast: React.FC<{ message: string; subtext?: string; onClose: () => void }> = ({ message, subtext, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 7000);
        return () => clearTimeout(timer);
    }, [onClose]);
    return (
        <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[6000] animate-fade-in w-full max-w-md px-4">
            <div className="bg-slate-900 text-white px-6 py-5 rounded-[2.5rem] shadow-2xl border border-white/10 flex items-start gap-5 backdrop-blur-xl">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-2xl shrink-0">!</div>
                <div className="flex flex-col flex-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500 mb-1">Sistema ARMI</span>
                    <span className="text-[11px] font-bold uppercase tracking-tight leading-tight">{message}</span>
                    {subtext && <span className="text-[9px] font-medium text-slate-400 mt-2 leading-relaxed italic">{subtext}</span>}
                </div>
                <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">✕</button>
            </div>
        </div>
    );
};

export const DiagnosticEvaluationView: React.FC = () => {
  const [headerInfo, setHeaderInfo] = useState<HeaderInfo>(INITIAL_HEADER_INFO);
  const [students, setStudents] = useState<Student[]>([]);
  const [competenciesList, setCompetenciesList] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'saved'>('saved');
  const [generalData, setGeneralData] = useState<GeneralData | null>(null);
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [toastData, setToastData] = useState<{ msg: string; sub?: string } | null>(null);
  const [showAuthScreen, setShowAuthScreen] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  
  const debouncedSave = useRef(
    debounce((updated: Student[]) => {
      persistEvaluationChange(updated);
    }, 800)
  ).current;

  const [themeIndex, setThemeIndex] = useState(() => {
      const saved = localStorage.getItem('armi_diag_theme');
      return saved ? parseInt(saved) : 0;
  });

  const toggleTheme = () => {
      const next = (themeIndex + 1) % THEME_COLORS.length;
      setThemeIndex(next);
      localStorage.setItem('armi_diag_theme', next.toString());
  };

  const loadAssets = useCallback(async () => {
    try {
      const gd = await getDatosGenerales();
      if (gd) {
        setGeneralData(gd);
        setHeaderInfo(prev => ({
          ...prev,
          grel: gd.region || '',
          ugel: gd.ugel || '',
          iiee: gd.institution || '',
          distrito: gd.district || '',
          nivel: gd.level || 'SECUNDARIA',
          docente: gd.teacher || '',
          anio: gd.year || new Date().getFullYear().toString()
        }));
      }
      const savedAssign = localStorage.getItem('armi_assignments');
      if (savedAssign) setAssignments(JSON.parse(savedAssign));
    } catch (e) {
      console.error("Error al cargar activos:", e);
    }
  }, []);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    if (headerInfo.area && headerInfo.grado) {
      getCompetencias(headerInfo.grado, headerInfo.area).then(res => {
        const unique = Array.from(new Set(res.map(c => c.competencias))).sort();
        setCompetenciesList(unique);
      });
    } else {
      setCompetenciesList([]);
    }
  }, [headerInfo.area, headerInfo.grado]);

  const loadDiagnosticData = useCallback(async () => {
    const { area, grado, seccion, anio, nivel } = headerInfo;
    if (!area || !grado || !seccion || !anio) return;

    setSyncStatus('syncing');
    try {
      const allStudents = await getEstudiantes();
      const filteredRoster = allStudents
        .filter(s => s.grade === grado && s.section === seccion && (!nivel || s.nivel === nivel))
        .map(s => ({ ...s, evaluations: s.evaluations || {} }));

      const results = await getResultadosDiagnostico(area, grado, seccion, anio, nivel);
      if (results && results.length > 0) {
        const studentsMap: Record<string, Student> = {};

        filteredRoster.forEach((student) => {
          studentsMap[String(student.id)] = {
            ...student,
            evaluations: {}
          } as Student;
        });

        results.forEach((r: any) => {
          const studentId = String(r.estudiante_id);
          if (!studentsMap[studentId]) {
            studentsMap[studentId] = {
              id: r.estudiante_id,
              name: r.estudiante_nombre,
              grade: r.grado,
              section: r.seccion,
              nivel: r.nivel,
              evaluations: {}
            } as Student;
          }
          studentsMap[studentId].evaluations![r.competencia] = {
            level: r.nivel_logro as EvaluationLevel,
            description: r.conclusion_descriptiva || ''
          };
        });
        setStudents(
          Object.values(studentsMap).sort((a, b) =>
            String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' })
          )
        );
        setSyncStatus('saved');
      } else {
        setStudents(
          filteredRoster
            .map(s => ({ ...s, evaluations: {} }))
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' }))
        );
        setSyncStatus('idle');
      }
    } catch (e) {
      console.error("Error cargando contexto:", e);
      setSyncStatus('idle');
    }
  }, [headerInfo]);

  useEffect(() => {
    if (headerInfo.area && headerInfo.grado && headerInfo.seccion && headerInfo.anio) {
        loadDiagnosticData();
    } else {
        setStudents([]);
    }
  }, [headerInfo.area, headerInfo.grado, headerInfo.seccion, headerInfo.anio, headerInfo.nivel, loadDiagnosticData]);

  const persistEvaluationChange = async (updatedStudents: Student[]) => {
      if (!headerInfo.area || !headerInfo.grado || !headerInfo.seccion || !headerInfo.anio) return;
      setSyncStatus('syncing');
      try {
          const resultsToSync: any[] = [];
          updatedStudents.forEach(s => {
            competenciesList.forEach(comp => {
              const evalData = s.evaluations?.[comp] ?? { level: EvaluationLevel.NE, description: '' };
              resultsToSync.push({
                estudiante_id: String(s.id),
                estudiante_nombre: s.name,
                area: headerInfo.area,
                grado: headerInfo.grado,
                seccion: headerInfo.seccion,
                nivel: headerInfo.nivel,
                competencia: comp,
                nivel_logro: evalData.level,
                conclusion_descriptiva: evalData.description,
                anio: headerInfo.anio
              });
            });
          });
          if (resultsToSync.length > 0) {
              const res = await saveResultadosDiagnostico(resultsToSync);
              if (res.success) setSyncStatus('saved');
              else setSyncStatus('idle');
          } else {
              setSyncStatus('saved');
          }
      } catch (e) {
          setSyncStatus('idle');
      }
  };

  const handleDeleteDiagnosticData = async () => {
    if (!headerInfo.area || !headerInfo.grado || !headerInfo.seccion || !headerInfo.anio) return;
    const confirmed = window.confirm(`¿Eliminar todos los registros de diagnóstico de ${headerInfo.area} ${headerInfo.grado} "${headerInfo.seccion}" del año ${headerInfo.anio}?`);
    if (!confirmed) return;
    setSyncStatus('syncing');
    try {
      const res = await deleteResultadosDiagnostico(headerInfo.area, headerInfo.grado, headerInfo.seccion, headerInfo.anio, headerInfo.nivel);
      if (res.success) {
        setToastData({ msg: 'Registros eliminados.', sub: 'Se borraron los datos del contexto actual.' });
        await loadDiagnosticData();
      } else {
        setSyncStatus('idle');
        setToastData({ msg: 'No se pudo eliminar.', sub: res.message || 'Intente nuevamente.' });
      }
    } catch (e) {
      setSyncStatus('idle');
      setToastData({ msg: 'Error al eliminar.', sub: 'No se pudo conectar con el servidor local.' });
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = () => {
    if (students.length === 0 || competenciesList.length === 0) {
      setToastData({ msg: 'No hay datos para exportar.', sub: 'Selecciona un contexto con estudiantes cargados.' });
      return;
    }

    const rows = students.map((student, index) => {
      const base: Record<string, string | number> = {
        N: index + 1,
        ESTUDIANTE: student.name,
      };

      competenciesList.forEach((comp) => {
        const evaluation = student.evaluations?.[comp];
        base[`${comp} - NIVEL`] = evaluation?.level || 'NE';
        base[`CONCLUSION DESCRIPTIVA`] = evaluation?.description || '';
      });

      return base;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Diagnostico');
    const safeArea = String(headerInfo.area || 'AREA').replace(/[\\/:*?"<>|]+/g, '_');
    XLSX.writeFile(wb, `DIAGNOSTICO_${safeArea}_${headerInfo.grado || 'GRADO'}_${headerInfo.seccion || 'SECCION'}_${headerInfo.anio || 'ANIO'}.xlsx`);
  };

  const handleSaveIAKey = async (key: string) => {
    if (!generalData) return;
    setSavingKey(true);
    try {
        const updated = { ...generalData, gemini_api_key: key };
        const res = await saveDatosGenerales(updated);
        if (res.success) {
            setGeneralData(updated);
            setShowAuthScreen(false);
            setToastData({ msg: "Llave guardada correctamente.", sub: "Ahora puedes usar la generacion automatica." });
        }
    } catch (e) {
        setToastData({ msg: "Error al guardar llave", sub: "No se pudo conectar con el servidor local." });
    } finally {
        setSavingKey(false);
    }
  };

  const assignmentOptions = useMemo(() => {
    const areas = Array.from(new Set(assignments.map(a => a.areaName))).sort();
    const filteredGrades = assignments.filter(a => !headerInfo.area || a.areaName === headerInfo.area).map(a => a.grade);
    const grades = Array.from(new Set(filteredGrades)).sort();
    const filteredSections = assignments.filter(a => (!headerInfo.area || a.areaName === headerInfo.area) && (!headerInfo.grado || a.grade === headerInfo.grado)).map(a => a.section);
    const sections = Array.from(new Set(filteredSections)).sort();
    return { areas, grades, sections };
  }, [assignments, headerInfo.area, headerInfo.grado]);

  const handleHeaderChange = (field: keyof HeaderInfo, value: string) => {
    setHeaderInfo(prev => {
        const next = { ...prev, [field]: value };
        if (field === 'area') { next.grado = ''; next.seccion = ''; }
        if (field === 'grado') { next.seccion = ''; }
        return next;
    });
  };

  const handleLevelChange = (studentId: string | number, competencyName: string, level: EvaluationLevel) => {
    const newStudents = students.map(s => {
      if (s.id === studentId) {
        const evaluations = { ...s.evaluations };
        evaluations[competencyName] = { 
          level, 
          description: level === EvaluationLevel.NE ? 'No se presentó o no presentó la evaluación' : (evaluations[competencyName]?.description || '')
        };
        return { ...s, evaluations };
      }
      return s;
    });
    setStudents(newStudents);
    persistEvaluationChange(newStudents);
  };

  const handleDescriptionChange = (studentId: string | number, competencyName: string, text: string) => {
    const newStudents = students.map(s => {
      if (s.id === studentId) {
        const evaluations = { ...s.evaluations };
        evaluations[competencyName] = { ...evaluations[competencyName], description: text };
        return { ...s, evaluations };
      }
      return s;
    });
    setStudents(newStudents);
    setSyncStatus('idle');
    debouncedSave(newStudents);
  };

  const generateConclusionsWithAI = async () => {
    if (isGenerating || students.length === 0 || competenciesList.length === 0) return;

    let apiKey = generalData?.gemini_api_key || process.env.API_KEY || '';
    const isInvalid = !apiKey || apiKey === 'undefined' || apiKey === 'null' || apiKey.trim().length < 10;

    if (isInvalid) {
        setShowAuthScreen(true);
        return;
    }

    setIsGenerating(true);
    setToastData(null);
    
    try {
      const ai = createGeminiClient(apiKey);
      const preferredGeminiModel = String(generalData?.gemini_model || '').trim();
      
      // AHORA USA LA CONSTANTE PARA EL PROMPT
      const prompt = PROMPT_SISTEMA(headerInfo.area, competenciesList);

      const response = await generateGeminiContent(ai, {
        contents: [{ parts: [{ text: prompt }] }],
        config: { 
          responseMimeType: "application/json", 
          temperature: 0.7,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              conclusiones: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    level: { type: Type.STRING },
                    text: { type: Type.STRING }
                  },
                  required: ["level", "text"]
                }
              }
            },
            required: ["conclusiones"]
          }
        }
      }, preferredGeminiModel);

      if (!response.text) throw new Error("EMPTY_RESPONSE");
      
      const data = JSON.parse(response.text);
      const suggestions = data.conclusiones;
      
      const newStudents = students.map(s => {
        const newEvals = { ...s.evaluations };
        competenciesList.forEach(comp => {
          const currentLevel = newEvals[comp]?.level || EvaluationLevel.NE;
          
          // --- 🛠️ LÓGICA DE REEMPLAZO ---
          // Actualmente dice: si tiene nota Y (estÃ¡ vacÃ­o o es solo espacios).
          // SI DESEAS REEMPLAZAR TODO, cambia la condiciÃ³n por: if (currentLevel !== EvaluationLevel.NE)
          const isEmpty = !newEvals[comp]?.description || newEvals[comp]?.description.trim() === '';
          
          if (currentLevel !== EvaluationLevel.NE) { // if (currentLevel !== EvaluationLevel.NE && isEmpty) { para llenar solo los que estan en blanco
            const suggest = suggestions.find((su: any) => su.level === currentLevel);
            if (suggest) newEvals[comp] = { ...newEvals[comp], description: suggest.text };
          }
        });
        return { ...s, evaluations: newEvals };
      });

      setStudents(newStudents);
      persistEvaluationChange(newStudents);
      setToastData({ msg: "✅ Sugerencias generadas con éxito.", sub: "Se completaron conclusiones descriptivas automáticas basadas en la CNEB." });
      
    } catch (error: any) {
      console.error("AI failure:", error);
      let mainError = "Error de comunicación con Google Gemini.";
      let subError = "Verifique su conexión o la validez de su API KEY.";

      const errorStr = String(error).toLowerCase();
      const isAuthError = error.status === 401 || error.status === 403 || errorStr.includes("api_key") || errorStr.includes("unauthorized") || errorStr.includes("invalid");

      if (isAuthError) {
          mainError = "Llave IA No VÃ¡lida";
          subError = "La llave actual no funciona. Por favor ingrese una nueva llave vÃ¡lida de Google AI Studio.";
          setShowAuthScreen(true); 
      } else if (error.message?.includes("quota") || error.status === 429) {
          mainError = "LÃ­mite de cuota excedido";
          subError = "Has usado muchas veces la IA en poco tiempo. Espera un minuto.";
      }
      
      setToastData({ msg: mainError, sub: subError });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="diagnostic-print-page min-h-screen bg-[#f8fafc] p-4 md:p-8 print:p-0">
      {toastData && <Toast message={toastData.msg} subtext={toastData.sub} onClose={() => setToastData(null)} />}
      
      {showAuthScreen && (
          <AuthOverlay 
            onSave={handleSaveIAKey} 
            onClose={() => setShowAuthScreen(false)} 
            isSaving={savingKey}
          />
      )}

      <div className="max-w-full mx-auto bg-white border border-gray-200 shadow-xl rounded-2xl p-6 md:p-8 overflow-hidden relative print:shadow-none print:border-none print:rounded-none print:p-4 print:pb-16">
        <button onClick={toggleTheme} className="absolute top-4 right-4 z-50 w-10 h-10 rounded-full bg-white border border-slate-200 shadow-lg flex items-center justify-center hover:scale-110 active:scale-95 transition-all group print:hidden" title="Cambiar Tema"><span className="text-xl group-hover:rotate-12 transition-transform duration-300">🎨</span></button>

        <Header info={headerInfo} onInfoChange={handleHeaderChange} insignia={generalData?.insignia} logo={generalData?.logo} motto={generalData?.motto} themeColor={THEME_COLORS[themeIndex]} options={assignmentOptions} />
        
        <div className="flex flex-col gap-10">
          <div className="w-full">
            <div className="flex flex-wrap justify-between items-center mb-4 gap-4">
              <h2 className="text-base font-bold text-gray-800 flex items-center gap-2"><span className="w-2 h-6 rounded-full inline-block" style={{ backgroundColor: THEME_COLORS[themeIndex] }}></span> LISTADO DE ESTUDIANTES ({students.length})</h2>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 shadow-inner mr-2">
                    {syncStatus === 'syncing' ? (
                        <><div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div><span className="text-[10px] font-black text-blue-600 uppercase tracking-widest italic">Sincronizando...</span></>
                    ) : syncStatus === 'saved' ? (
                        <><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Sincronizado SQL</span></>
                    ) : (
                        <><div className="w-2 h-2 rounded-full bg-amber-400"></div><span className="text-[10px] font-black text-amber-600 uppercase tracking-widest italic">Cambios Pendientes</span></>
                    )}
                </div>

                <div className="flex gap-2 print:hidden">
                    <button 
                        onClick={() => setShowAuthScreen(true)} 
                        className="bg-slate-100 hover:bg-slate-200 text-slate-600 w-10 h-10 rounded-xl flex items-center justify-center transition-all border border-slate-200 shadow-sm group"
                        title="Configurar Llave IA"
                    >
                        <span className="text-lg group-hover:rotate-6 transition-transform duration-300">🧠</span>
                    </button>

                    <button
                        onClick={handleDeleteDiagnosticData}
                        disabled={!headerInfo.area || !headerInfo.grado || !headerInfo.seccion || !headerInfo.anio}
                        className="bg-rose-50 hover:bg-rose-100 text-rose-600 w-10 h-10 rounded-xl flex items-center justify-center transition-all border border-rose-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5"
                        title="Eliminar diagnóstico del contexto actual"
                    >
                        <span className="text-lg">🗑️</span>
                    </button>

                    <button
                        onClick={handlePrint}
                        disabled={students.length === 0}
                        className="bg-amber-50 hover:bg-amber-100 text-amber-700 w-10 h-10 rounded-xl flex items-center justify-center transition-all border border-amber-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5"
                        title="Imprimir"
                    >
                        <span className="text-lg">🖨️</span>
                    </button>

                    <button
                        onClick={handleExportExcel}
                        disabled={students.length === 0}
                        className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 w-10 h-10 rounded-xl flex items-center justify-center transition-all border border-emerald-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5"
                        title="Exportar a Excel"
                    >
                        <span className="text-lg">📗</span>
                    </button>

                    <button onClick={generateConclusionsWithAI} disabled={isGenerating || students.length === 0 || competenciesList.length === 0} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 disabled:bg-gray-400 transition-all shadow-md active:scale-95">
                    {isGenerating ? (
                        <svg className="animate-spin h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    ) : (
                        <span className="text-sm">✨</span>
                    )}
                    Auto-generar Sugerencias (IA)
                    </button>
                </div>
              </div>
            </div>
            
            <div className="rounded-xl border border-gray-100 overflow-hidden shadow-sm">
                {students.length > 0 ? (
                  <EvaluationTable students={students} competencies={competenciesList} onLevelChange={handleLevelChange} onDescriptionChange={handleDescriptionChange} onDescriptionBlur={() => persistEvaluationChange(students)} />
                ) : (
                  <div className="p-20 text-center bg-slate-50 text-slate-400"><div className="text-5xl mb-4 opacity-20">SQL</div><p className="font-black uppercase tracking-widest text-xs">Seleccione Grado y Seccion para cargar matriz SQL</p></div>
                )}
            </div>
          </div>
          <div className="w-full pt-6 border-t border-gray-100">
              <SummarySection
                students={students}
                competencies={competenciesList}
                grade={headerInfo.grado}
                section={headerInfo.seccion}
                labelColor={THEME_COLORS[themeIndex]}
              />
          </div>
        </div>
      </div>
      <footer className="max-w-full mx-auto mt-8 flex flex-wrap justify-between items-center gap-4 text-[10px] text-gray-400 font-medium px-4 print:hidden">
        <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>SGE - ARMI DOCENTE © 2025</div>
        <div className="bg-white px-3 py-1 rounded-full shadow-sm border border-gray-100 uppercase font-black tracking-tighter">Dashboard Diagnóstico JEC <span className="text-blue-500 ml-1">PRO v4.5</span></div>
      </footer>
      <div className="hidden print:flex fixed bottom-0 left-0 right-0 px-8 py-3 text-[10px] font-black uppercase tracking-widest text-slate-600 border-t border-slate-300 bg-white items-center justify-between">
        <span>{headerInfo.area || 'ÁREA CURRICULAR'}</span>
        <span>{headerInfo.docente || 'DOCENTE'}</span>
      </div>
    </div>
  );
};

export default DiagnosticEvaluationView;

function debounce<T extends (...args: any[]) => void>(fn: T, delay: number) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const THEME_COLORS = [
    '#8b6d00', // Mostaza (Imagen)
    '#1e40af', // Azul PedagÃ³gico
    '#334155', // Slate Profesional
    '#15803d', // Verde Ã‰xito
    '#ff9100', // Naranja
    '#00a2ff', // Celeste
];
