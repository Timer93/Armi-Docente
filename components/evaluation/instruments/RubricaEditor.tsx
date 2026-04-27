import React from 'react';
import { RUBRICA_HEADER_COLORS } from './common';

interface RubricaEditorProps {
  structure: any;
  onLevelChange: (idx: number, value: string) => void;
  onCriteriaCountChange: (value: string) => void;
}

export const RubricaEditor: React.FC<RubricaEditorProps> = ({ structure, onLevelChange, onCriteriaCountChange }) => (
  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
    <h4 className="text-[11px] font-black uppercase text-slate-700 border-b border-slate-200 pb-2">Constructor de Rúbrica</h4>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {(structure?.levels || []).map((lv: any, idx: number) => {
        const chipBg = RUBRICA_HEADER_COLORS[idx] || '#0f172a';
        return (
          <input
            key={lv.id || idx}
            className="p-2 rounded-xl border border-slate-200 text-xs font-black text-white"
            style={{ backgroundColor: chipBg }}
            value={lv.label || ''}
            onChange={(e) => onLevelChange(idx, e.target.value)}
          />
        );
      })}
    </div>
    <div className="grid grid-cols-1 md:grid-cols-[170px_1fr] gap-3 items-center">
      <label className="text-[10px] font-black text-slate-700">Cantidad de criterios:</label>
      <input className="p-2 rounded-xl border border-slate-300 text-xs font-black w-full md:max-w-[120px] bg-white" type="number" min={1} max={30} value={structure?.criteriaCount || structure?.criteria?.length || 4} onChange={(e) => onCriteriaCountChange(e.target.value)} />
    </div>
    <p className="text-[10px] text-slate-500">Se generará la estructura con criterios vacíos para completar luego en la plantilla.</p>
  </div>
);
