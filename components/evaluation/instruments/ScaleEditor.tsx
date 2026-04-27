import React from 'react';
import { getScaleLabels, SCALE_LEVEL_COLORS } from './scale';

interface ScaleEditorProps {
  structure: any;
  onLabelChange: (idx: number, value: string) => void;
  onCountsChange: (patch: Partial<{ competenciesCount: number; capacitiesPerCompetency: number; criteriaPerCapacity: number }>) => void;
}

export const ScaleEditor: React.FC<ScaleEditorProps> = ({ structure, onLabelChange, onCountsChange }) => (
  <div className="bg-slate-100 rounded-2xl p-4 border border-slate-300 space-y-4">
    <h4 className="text-[11px] font-black uppercase text-slate-700 border-b border-slate-300 pb-2">Constructor de Escala de Valoración</h4>
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      {getScaleLabels(structure).map((label, idx) => (
        <input
          key={`scale-label-${idx}`}
          className="p-3 rounded-2xl border-0 text-sm font-black text-white"
          style={{ backgroundColor: SCALE_LEVEL_COLORS[idx] || '#6b7280' }}
          value={label}
          onChange={(e) => onLabelChange(idx, e.target.value)}
        />
      ))}
    </div>
    <div className="grid grid-cols-1 md:grid-cols-[220px_140px] gap-3 items-center">
      <label className="text-[12px] font-black text-slate-700">Cantidad de competencias:</label>
      <input
        className="p-2 rounded-2xl border border-slate-300 text-xs font-black bg-white"
        type="number"
        min={1}
        max={10}
        value={structure?.scale?.competenciesCount || structure?.competencies?.length || 1}
        onChange={(e) => onCountsChange({ competenciesCount: Number(e.target.value) })}
      />
      <label className="text-[12px] font-black text-slate-700">Capacidades por competencia:</label>
      <input
        className="p-2 rounded-2xl border border-slate-300 text-xs font-black bg-white"
        type="number"
        min={1}
        max={10}
        value={structure?.scale?.capacitiesPerCompetency || 2}
        onChange={(e) => onCountsChange({ capacitiesPerCompetency: Number(e.target.value) })}
      />
      <label className="text-[12px] font-black text-slate-700">Criterios por capacidad:</label>
      <input
        className="p-2 rounded-2xl border border-slate-300 text-xs font-black bg-white"
        type="number"
        min={1}
        max={10}
        value={structure?.scale?.criteriaPerCapacity || 2}
        onChange={(e) => onCountsChange({ criteriaPerCapacity: Number(e.target.value) })}
      />
    </div>
    <p className="text-[10px] text-slate-500">La plantilla genera competencias, capacidades y criterios base. Luego puedes editar sus nombres y colores en la tabla.</p>
  </div>
);
