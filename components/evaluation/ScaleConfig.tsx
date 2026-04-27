
import React, { useState } from 'react';

export const ScaleConfig: React.FC = () => {
  const [scaleType, setScaleType] = useState<'literal' | 'vigesimal'>('literal');

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[2rem] p-8 shadow-lg border border-slate-100">
        <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight italic mb-8">Configuración de Escalas</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Tipo de Escala Principal</h3>
              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={() => setScaleType('literal')}
                  className={`p-6 rounded-2xl border-2 transition-all text-center ${scaleType === 'literal' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <span className="block text-2xl mb-2">ABC</span>
                  <span className="text-[10px] font-black uppercase text-slate-800">Literal (AD, A, B, C)</span>
                </button>
                <button 
                  onClick={() => setScaleType('vigesimal')}
                  className={`p-6 rounded-2xl border-2 transition-all text-center ${scaleType === 'vigesimal' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <span className="block text-2xl mb-2">20</span>
                  <span className="text-[10px] font-black uppercase text-slate-800">Vigesimal (0 - 20)</span>
                </button>
              </div>
            </div>

            <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Pesos por Competencia</h3>
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-black text-slate-600 uppercase">Competencia {i}</span>
                    <div className="flex items-center gap-3">
                      <input type="number" className="w-16 p-2 border border-slate-200 rounded-lg text-xs font-bold text-center" defaultValue={33} />
                      <span className="text-[10px] font-black text-slate-400">%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Equivalencias de Escala</h3>
              <div className="space-y-3">
                {[
                  { label: 'AD (Logro Destacado)', range: '18 - 20', color: 'bg-blue-500' },
                  { label: 'A (Logro Esperado)', range: '14 - 17', color: 'bg-emerald-500' },
                  { label: 'B (En Proceso)', range: '11 - 13', color: 'bg-orange-500' },
                  { label: 'C (En Inicio)', range: '00 - 10', color: 'bg-rose-500' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${item.color}`}></div>
                      <span className="text-[10px] font-black text-slate-600 uppercase">{item.label}</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-400">{item.range}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <button className="w-full bg-slate-800 text-white py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl hover:bg-slate-900 transition-all">
              Guardar Configuración Global
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
