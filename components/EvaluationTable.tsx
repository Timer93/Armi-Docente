import React from 'react';
import { Student, EvaluationLevel } from '../types';

interface EvaluationTableProps {
  students: Student[];
  competencies: string[];
  onLevelChange: (
    studentId: string | number,
    competencyName: string,
    level: EvaluationLevel
  ) => void;
  onDescriptionChange: (
    studentId: string | number,
    competencyName: string,
    text: string
  ) => void;
  onDescriptionBlur: () => void;
}


const EvaluationTable: React.FC<EvaluationTableProps> = ({ 
  students, 
  competencies,
  onLevelChange, 
  onDescriptionChange,
  onDescriptionBlur
}) => {
  const normalize = (value: string | number | undefined | null) => String(value || '').trim().toLowerCase();
  const getRowStateClass = (estado: string | undefined) => {
    const normalizedEstado = normalize(estado);
    if (normalizedEstado === 'r' || normalizedEstado.includes('retir')) {
      return {
        row: 'bg-slate-900/95 text-white hover:bg-slate-800',
        numberCell: 'bg-slate-950/90 text-white',
        nameCell: 'bg-slate-900 text-white group-hover:bg-slate-800'
      };
    }
    if (normalizedEstado === 't' || normalizedEstado.includes('traslad')) {
      return {
        row: 'bg-violet-700/10 text-violet-950 hover:bg-violet-700/20',
        numberCell: 'bg-violet-700/20 text-violet-900',
        nameCell: 'bg-violet-700/10 text-violet-950 group-hover:bg-violet-700/20'
      };
    }
    if (normalizedEstado === 'na' || normalizedEstado.includes('no asiste')) {
      return {
        row: 'bg-rose-700/10 text-rose-950 hover:bg-rose-700/20',
        numberCell: 'bg-rose-700/20 text-rose-900',
        nameCell: 'bg-rose-700/10 text-rose-950 group-hover:bg-rose-700/20'
      };
    }
    return {
      row: 'hover:bg-blue-50/30',
      numberCell: 'bg-slate-50/50 text-slate-400',
      nameCell: 'bg-white text-slate-700 group-hover:bg-blue-50/30'
    };
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse min-w-full">
          <thead className="bg-slate-800 text-white text-[10px] font-black uppercase">
              {/* Primera fila de encabezados: Nombres de Competencias */}
              <tr className="divide-x divide-white/10 border-b border-white/20">
                  <th rowSpan={2} className="px-4 py-3 w-12 text-center bg-slate-900 border-b-0">N°</th>
                  <th rowSpan={2} className="px-4 py-3 min-w-[200px] bg-slate-900 border-b-0">Estudiante</th>
                  {competencies.map((comp, idx) => (
                      <th key={idx} colSpan={2} className="px-4 py-2 text-center bg-slate-800 border-b border-white/10 min-w-[300px]">
                          {comp}
                      </th>
                  ))}
                  {competencies.length === 0 && <th colSpan={2} className="px-4 py-2 text-center italic text-slate-400">Sin competencias cargadas</th>}
              </tr>
              {/* Segunda fila de encabezados: Nivel y Conclusión */}
              <tr className="divide-x divide-white/10 bg-slate-700">
                  {competencies.map((_, idx) => (
                      <React.Fragment key={idx}>
                          <th className="px-2 py-2 w-24 text-center">Nivel Logro</th>
                          <th className="px-2 py-2">Conclusión Descriptiva</th>
                      </React.Fragment>
                  ))}
              </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-[11px] bg-white">
              {students.map((s, idx) => {
                  const rowStateClass = getRowStateClass(s.estado);
                  return (
                  <tr key={s.id} className={`${rowStateClass.row} transition-colors group divide-x divide-slate-100`}>
                      <td className={`px-4 py-2 text-center font-bold ${rowStateClass.numberCell}`}>{idx + 1}</td>
                      <td className={`px-4 py-2 font-black uppercase sticky left-0 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.05)] ${rowStateClass.nameCell}`}>
                        <div>{s.name}</div>
                        {s.estado && String(s.estado).trim().toUpperCase() !== 'A' && (
                          <div className="mt-1 text-[9px] font-black tracking-widest opacity-80">{String(s.estado).trim().toUpperCase()}</div>
                        )}
                      </td>
                      {competencies.map((comp, cIdx) => {
                          const evaluation = s.evaluations?.[comp] || { level: EvaluationLevel.NE, description: '' };
                          return (
                              <React.Fragment key={cIdx}>
                                  <td className="px-2 py-2">
                                      <select 
                                          className={`w-full border-2 rounded-lg px-2 py-1 font-black text-center outline-none transition-all ${
                                            evaluation.level === EvaluationLevel.AD ? 'border-sky-300 text-sky-700 bg-sky-50' :
                                            evaluation.level === EvaluationLevel.A ? 'border-emerald-300 text-emerald-700 bg-emerald-50' :
                                            evaluation.level === EvaluationLevel.B ? 'border-orange-300 text-orange-700 bg-orange-50' :
                                            evaluation.level === EvaluationLevel.C ? 'border-rose-300 text-rose-700 bg-rose-50' :
                                            'border-slate-200 text-slate-400'
                                          }`}
                                          value={evaluation.level}
                                          // Fix: s.id is string | number, which is now compatible with onLevelChange
                                          onChange={(e) => onLevelChange(s.id, comp, e.target.value as EvaluationLevel)}
                                      >
                                          {Object.values(EvaluationLevel).map(lvl => (
                                              <option key={lvl} value={lvl}>{lvl}</option>
                                          ))}
                                      </select>
                                  </td>
                                  <td className="px-2 py-2">
                                      <textarea 
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5 focus:bg-white focus:border-blue-400 outline-none italic text-slate-600 leading-tight resize-none min-h-[40px]"
                                        value={evaluation.description}
                                        onChange={(e) => onDescriptionChange(s.id, comp, e.target.value)}
                                        onBlur={onDescriptionBlur}
                                        placeholder="Evidencia o sugerencia..."
                                        rows={1}
                                       />
                                  </td>
                              </React.Fragment>
                          );
                      })}
                  </tr>
              )})}
          </tbody>
      </table>
    </div>
  );
};

export default EvaluationTable;
