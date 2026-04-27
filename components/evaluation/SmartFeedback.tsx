
import React, { useState } from 'react';
import { GoogleGenAI } from "@google/genai";

export const SmartFeedback: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [feedback, setFeedback] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const generateFeedback = async () => {
    if (!prompt) return;
    setIsLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Como docente experto, genera una retroalimentación constructiva y sugerencias de mejora para un estudiante con el siguiente desempeño: ${prompt}. La respuesta debe ser en formato JSON con campos: feedback (mensaje para el estudiante), suggestions (lista de 3 puntos de mejora) y risk_level (bajo, medio, alto).`,
        config: { responseMimeType: "application/json" }
      });
      
      const result = JSON.parse(response.text || '{}');
      setFeedback(JSON.stringify(result, null, 2));
    } catch (e) {
      console.error(e);
      setFeedback('Error al generar retroalimentación');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[2rem] p-8 shadow-lg border border-slate-100">
        <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight italic mb-8">Retroalimentación Inteligente (IA)</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Desempeño del Estudiante</label>
              <textarea 
                className="w-full p-6 h-48 bg-slate-50 border border-slate-200 rounded-[2rem] outline-none focus:border-emerald-500 text-xs font-bold text-slate-700 shadow-inner resize-none italic"
                placeholder="Ej: El estudiante identifica los componentes de una computadora pero tiene dificultades para explicar la función de la memoria RAM..."
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
              />
            </div>
            <button 
              onClick={generateFeedback}
              disabled={isLoading || !prompt}
              className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl hover:bg-emerald-700 transition-all disabled:opacity-50"
            >
              {isLoading ? 'Generando...' : 'Generar Retroalimentación con IA'}
            </button>
          </div>

          <div className="bg-slate-900 rounded-[2rem] p-8 text-emerald-400 font-mono text-xs overflow-auto h-[400px] shadow-2xl border border-emerald-900/30">
            <div className="flex items-center gap-2 mb-4 border-b border-emerald-900/30 pb-4">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-[10px] uppercase font-black tracking-widest text-emerald-600">IA Response Output</span>
            </div>
            {feedback ? (
              <pre className="whitespace-pre-wrap">{feedback}</pre>
            ) : (
              <div className="h-full flex items-center justify-center text-emerald-900/50 italic">
                Esperando entrada para procesar...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
