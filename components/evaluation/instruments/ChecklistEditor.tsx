import React from 'react';
import { CHECKLIST_OPTION_PRESETS, getChecklistOptionConfig, normalizeChecklistOptionValue } from './checklist';
import { clampCount } from './common';

interface ChecklistEditorProps {
  structure: any;
  onCountsChange: (patch: Partial<{ competenciesCount: number; capacitiesPerCompetency: number; criteriaPerCapacity: number }>) => void;
  onOptionsChange: (value: string) => void;
  onCustomOptionChange: (field: 'positive' | 'negative', value: string) => void;
}

export const ChecklistEditor: React.FC<ChecklistEditorProps> = ({ structure, onCountsChange, onOptionsChange, onCustomOptionChange }) => {
  const checklistOptionValue = normalizeChecklistOptionValue(structure?.expectedLabel);
  const checklistOptionConfig = getChecklistOptionConfig(structure?.expectedLabel);

  return (
    <div className="bg-slate-100 rounded-2xl p-4 border border-slate-300 space-y-4">
      <h4 className="text-[11px] font-black uppercase text-slate-700 border-b border-slate-300 pb-2">Constructor de Lista de Cotejo</h4>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_46px] gap-3 items-center">
        <div className="space-y-3">
          <div className="grid grid-cols-[200px_120px] gap-3 items-center">
            <label className="text-[12px] font-black text-slate-700">Cantidad de competencias:</label>
            <input className="p-2 rounded-xl border border-slate-300 text-xs font-black bg-white" type="number" min={1} max={10} value={structure?.competenciesCount || structure?.competencies?.length || 1} onChange={(e) => onCountsChange({ competenciesCount: clampCount(e.target.value, 1, 1, 10) })} />
          </div>
          <div className="grid grid-cols-[200px_120px] gap-3 items-center">
            <label className="text-[12px] font-black text-slate-700">Capacidades por competencia:</label>
            <input className="p-2 rounded-xl border border-slate-300 text-xs font-black bg-white" type="number" min={1} max={10} value={structure?.capacitiesPerCompetency || structure?.competencies?.[0]?.capacities?.length || 2} onChange={(e) => onCountsChange({ capacitiesPerCompetency: clampCount(e.target.value, 2, 1, 10) })} />
          </div>
          <div className="grid grid-cols-[200px_120px] gap-3 items-center">
            <label className="text-[12px] font-black text-slate-700">Criterios por capacidad:</label>
            <input className="p-2 rounded-xl border border-slate-300 text-xs font-black bg-white" type="number" min={1} max={20} value={structure?.criteriaPerCapacity || structure?.competencies?.[0]?.capacities?.[0]?.criteria?.length || 3} onChange={(e) => onCountsChange({ criteriaPerCapacity: clampCount(e.target.value, 3, 1, 20) })} />
          </div>
          <div className="grid grid-cols-[200px_120px] gap-3 items-center">
            <label className="text-[12px] font-black text-slate-700">Opciones:</label>
            <select className="p-2 rounded-xl border border-slate-300 text-xs font-black bg-white" value={checklistOptionValue} onChange={(e) => onOptionsChange(e.target.value)}>
              {CHECKLIST_OPTION_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>{preset.label}</option>
              ))}
            </select>
          </div>
          {checklistOptionValue === 'custom' && (
            <div className="grid grid-cols-[200px_1fr] gap-3 items-start">
              <label className="text-[12px] font-black text-slate-700 pt-2">Etiquetas personalizadas:</label>
              <div className="grid grid-cols-2 gap-3">
                <input className="p-2 rounded-xl border border-slate-300 text-xs font-black bg-white" value={checklistOptionConfig.positive} onChange={(e) => onCustomOptionChange('positive', e.target.value)} placeholder="Opción positiva" />
                <input className="p-2 rounded-xl border border-slate-300 text-xs font-black bg-white" value={checklistOptionConfig.negative} onChange={(e) => onCustomOptionChange('negative', e.target.value)} placeholder="Opción negativa" />
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="text-[10px] text-slate-500">La plantilla define la jerarquía base. En sesiones, las filas finales se expanden según competencias, capacidades y criterios disponibles en la sesión.</p>
    </div>
  );
};
