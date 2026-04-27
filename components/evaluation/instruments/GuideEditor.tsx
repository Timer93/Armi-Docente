import React from 'react';
import { clampCount } from './common';

interface GuideEditorProps {
  structure: any;
  onCountsChange: (patch: Partial<{ competenciesCount: number; capacitiesPerCompetency: number; criteriaPerCapacity: number }>) => void;
  onCapacityNameChange: (competencyIndex: number, capacityIndex: number, value: string) => void;
  onCriterionNameChange: (competencyIndex: number, capacityIndex: number, criterionIndex: number, value: string) => void;
}

export const GuideEditor: React.FC<GuideEditorProps> = ({ structure, onCountsChange: _onCountsChange, onCapacityNameChange: _onCapacityNameChange, onCriterionNameChange: _onCriterionNameChange }) => (
  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
    <h4 className="text-[11px] font-black uppercase text-slate-700 border-b border-slate-200 pb-2">Constructor de Guía de Observación</h4>
    <div className="grid grid-cols-[220px_120px] gap-3 items-center">
      <label className="text-[12px] font-black text-slate-700">Cantidad de competencias:</label>
      <input className="p-2 rounded-xl border border-slate-300 text-xs font-black bg-slate-100 text-slate-500" type="number" min={1} max={1} value={1} disabled readOnly />
    </div>
    <div className="grid grid-cols-[220px_120px] gap-3 items-center">
      <label className="text-[12px] font-black text-slate-700">Capacidades por competencia:</label>
      <input className="p-2 rounded-xl border border-slate-300 text-xs font-black bg-white" type="number" min={1} max={6} value={structure?.capacitiesPerCompetency || structure?.competencies?.[0]?.capacities?.length || 4} onChange={(e) => _onCountsChange({ competenciesCount: 1, capacitiesPerCompetency: clampCount(e.target.value, 4, 1, 6) })} />
    </div>
    <div className="grid grid-cols-[220px_120px] gap-3 items-center">
      <label className="text-[12px] font-black text-slate-700">Criterios por capacidad:</label>
      <input className="p-2 rounded-xl border border-slate-300 text-xs font-black bg-white" type="number" min={1} max={10} value={structure?.criteriaPerCapacity || structure?.competencies?.[0]?.capacities?.[0]?.criteria?.length || 4} onChange={(e) => _onCountsChange({ competenciesCount: 1, criteriaPerCapacity: clampCount(e.target.value, 4, 1, 10) })} />
    </div>
    <p className="text-[10px] text-slate-500">La estructura de nombres se define en la tabla de diseño. Aquí solo ajustas cuántas capacidades y criterios tendrá la guía.</p>
  </div>
);
