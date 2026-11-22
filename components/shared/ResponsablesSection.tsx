import React, { useId } from 'react';

export interface ResponsablesData {
  teacher: string;
  director: string;
  subdirector?: string;
  pedagogical_coordinator?: string;
  toe_coordinator?: string;
}

interface Props {
  value: ResponsablesData;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  maxLength?: number;
}

// Una sola presentación para escritorio y web. Cada entorno aporta su guardado.
export function ResponsablesSection({ value, onChange, disabled, maxLength }: Props) {
  const prefix = useId();
  const fields = [
    { name: 'teacher', label: 'Docente de Área (Usuario)', icon: '👨‍🏫', color: 'bg-blue-100 text-blue-600', placeholder: 'Ingrese nombres y apellidos', highlight: true },
    { name: 'director', label: 'Director(a) de la I.E.', icon: '👨‍💼', color: 'bg-slate-100 text-slate-600', placeholder: 'Nombre del Director' },
    { name: 'subdirector', label: 'Subdirector(a)', icon: '📋', color: 'bg-slate-100 text-slate-600', placeholder: 'Nombre del Subdirector' },
    { name: 'pedagogical_coordinator', label: 'Coord. Pedagógico', icon: '📚', color: 'bg-orange-100 text-orange-600', placeholder: 'Nombre del Coordinador' },
    { name: 'toe_coordinator', label: 'Coord. de Tutoría (TOE)', icon: '🤝', color: 'bg-emerald-100 text-emerald-600', placeholder: 'Nombre del Coordinador TOE' },
  ] as const;
  const card = (field: typeof fields[number]) => {
    const highlight = 'highlight' in field && field.highlight;
    return <div key={field.name} className={`relative overflow-hidden rounded-3xl border transition-all duration-300 group ${highlight ? 'bg-gradient-to-br from-blue-50 to-white border-blue-300 shadow-md hover:shadow-lg' : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'}`}>
      {highlight && <div className="absolute top-0 left-0 w-2 h-full bg-blue-500" />}
      <div className="p-5 flex gap-5">
        <div aria-hidden="true" className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-inner shrink-0 ${field.color}`}>{field.icon}</div>
        <div className="flex-1 min-w-0">
          <label htmlFor={`${prefix}-${field.name}`} className={`block text-xs font-black uppercase tracking-widest mb-3 ${highlight ? 'text-blue-700' : 'text-slate-500'}`}>{field.label}</label>
          <input id={`${prefix}-${field.name}`} type="text" name={field.name} value={value[field.name] || ''} onChange={onChange} disabled={disabled} maxLength={maxLength} placeholder={field.placeholder} className={`w-full bg-transparent border-b outline-none text-sm py-2 transition-colors text-slate-800 ${highlight ? 'font-bold border-blue-200 focus:border-blue-500' : 'font-medium border-slate-200 focus:border-slate-500'}`} />
        </div>
      </div>
    </div>;
  };
  return <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 animate-fade-in">
    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-8 border-b pb-2">👥 Equipo Responsable</h3>
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="mb-8">{card(fields[0])}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">{fields.slice(1).map(card)}</div>
    </div>
  </div>;
}
