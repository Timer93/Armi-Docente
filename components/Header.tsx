
import React, { useState } from 'react';
import { HeaderInfo } from '../types';

interface HeaderProps {
  info: HeaderInfo;
  onInfoChange: (field: keyof HeaderInfo, value: string) => void;
  insignia?: string;
  logo?: string;
  motto?: string;
  themeColor: string;
  options: {
    areas: string[];
    grades: string[];
    sections: string[];
  };
}

const Header: React.FC<HeaderProps> = ({ 
  info, 
  onInfoChange, 
  insignia, 
  logo, 
  motto, 
  themeColor,
  options 
}) => {
  const [showYearPicker, setShowYearPicker] = useState(false);
  const labelStyle = { backgroundColor: themeColor };
  
  const years = Array.from({ length: 5 }, (_, i) => (new Date().getFullYear() - 1 + i).toString());

  return (
    <div className="w-full mb-6 print:mb-2">
      <div className="text-center text-xl font-black border-b-2 border-black pb-2 mb-4 uppercase tracking-tight flex items-center justify-center gap-2">
        <span>Resultados de Evaluacion Diagnostica - {info.area}</span>
        <div className="relative">
            <span 
                onClick={() => setShowYearPicker(!showYearPicker)}
                className="cursor-pointer text-blue-600 hover:text-blue-800 transition-colors border-b-2 border-dotted border-blue-400 pb-0.5 px-1 rounded hover:bg-blue-50"
                title="Haga clic para cambiar el anio"
            >
                {info.anio}
            </span>
            {showYearPicker && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-white border border-slate-200 shadow-2xl rounded-2xl p-2 z-[500] animate-fade-in flex flex-col gap-1 min-w-[100px]">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest text-center py-1">Periodo</p>
                    {years.map(y => (
                        <button 
                            key={y} 
                            onClick={() => { onInfoChange('anio', y); setShowYearPicker(false); }}
                            className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${info.anio === y ? 'bg-blue-600 text-white shadow-lg' : 'hover:bg-slate-100 text-slate-600'}`}
                        >
                            {y}
                        </button>
                    ))}
                </div>
            )}
        </div>
      </div>
      
      <div className="flex justify-between items-start gap-4">
        {/* Left Logo (Insignia IE) */}
        <div className="flex flex-col items-center w-28 shrink-0">
          <div className="w-20 h-20 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-center overflow-hidden mb-1 shadow-sm">
            {insignia ? (
              <img 
                src={insignia} 
                alt="Insignia IE" 
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-[8px] text-slate-400 font-bold uppercase text-center">Insignia<br/>IE</span>
            )}
          </div>
          <span className="text-[9px] text-center italic font-black leading-tight text-gray-600 px-1 line-clamp-2 uppercase">
            {motto || "Cargando lema..."}
          </span>
        </div>

        {/* Info Grid */}
        <div className="flex-1 grid grid-cols-12 border border-black shadow-sm overflow-hidden rounded-[1.75rem] print:rounded-none print:overflow-visible print:border-[1.5px] print:outline print:outline-[1.5px] print:outline-black print:outline-offset-0">
          <div style={labelStyle} className="col-span-2 text-white p-1.5 text-[10px] font-black border-r border-b border-black uppercase flex items-center">GREL/DRE</div>
          <div className="col-span-4 p-1.5 text-[11px] border-r border-b border-black bg-white">
            <input 
              className="w-full focus:outline-none uppercase font-bold text-slate-700" 
              value={info.grel} 
              onChange={(e) => onInfoChange('grel', e.target.value)} 
            />
          </div>
          <div style={labelStyle} className="col-span-2 text-white p-1.5 text-[10px] font-black border-r border-b border-black uppercase flex items-center">UGEL</div>
          <div className="col-span-4 p-1.5 text-[11px] border-b border-black bg-white">
            <input 
              className="w-full focus:outline-none uppercase font-bold text-slate-700" 
              value={info.ugel} 
              onChange={(e) => onInfoChange('ugel', e.target.value)} 
            />
          </div>

          <div style={labelStyle} className="col-span-2 text-white p-1.5 text-[10px] font-black border-r border-b border-black uppercase flex items-center">IIEE</div>
          <div className="col-span-4 p-1.5 text-[11px] border-r border-b border-black bg-white">
            <input 
              className="w-full focus:outline-none uppercase font-bold text-slate-700" 
              value={info.iiee} 
              onChange={(e) => onInfoChange('iiee', e.target.value)} 
            />
          </div>
          <div style={labelStyle} className="col-span-2 text-white p-1.5 text-[10px] font-black border-r border-b border-black uppercase flex items-center">Distrito</div>
          <div className="col-span-4 p-1.5 text-[11px] border-b border-black bg-white">
            <input 
              className="w-full focus:outline-none uppercase font-bold text-slate-700" 
              value={info.distrito} 
              onChange={(e) => onInfoChange('distrito', e.target.value)} 
            />
          </div>

          <div style={labelStyle} className="col-span-2 text-white p-1.5 text-[10px] font-black border-r border-b border-black uppercase flex items-center">Area Curricular</div>
          <div className="col-span-10 p-0 border-b border-black bg-white">
            <select 
              className="w-full h-full px-1.5 focus:outline-none uppercase font-black text-slate-500 text-[11px] appearance-none cursor-pointer bg-transparent" 
              value={info.area} 
              onChange={(e) => onInfoChange('area', e.target.value)} 
            >
                <option value="">Seleccione Area...</option>
                {options.areas.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          <div style={labelStyle} className="col-span-2 text-white p-1.5 text-[10px] font-black border-r border-b border-black uppercase flex items-center">Nivel</div>
          <div className="col-span-2 p-1.5 text-[11px] border-r border-b border-black bg-white font-bold text-slate-700 uppercase">{info.nivel}</div>
          
          <div style={labelStyle} className="col-span-1 text-white p-1.5 text-[10px] font-black border-r border-b border-black uppercase flex items-center justify-center">Grado</div>
          <div className="col-span-1 p-0 border-r border-b border-black bg-white">
             <select 
                className="w-full h-full text-center font-black text-[11px] outline-none appearance-none cursor-pointer bg-transparent text-slate-500" 
                value={info.grado} 
                onChange={(e) => onInfoChange('grado', e.target.value)}
             >
                <option value="">-</option>
                {options.grades.map(g => <option key={g} value={g}>{g}</option>)}
             </select>
          </div>
          
          <div style={labelStyle} className="col-span-1 text-white p-1.5 text-[10px] font-black border-r border-b border-black uppercase flex items-center justify-center">Secc.</div>
          <div className="col-span-1 p-0 border-r border-b border-black bg-white">
             <select 
                className="w-full h-full text-center font-black text-[11px] outline-none appearance-none cursor-pointer bg-transparent text-slate-500" 
                value={info.seccion} 
                onChange={(e) => onInfoChange('seccion', e.target.value)}
             >
                <option value="">-</option>
                {options.sections.map(s => <option key={s} value={s}>{s}</option>)}
             </select>
          </div>
          <div className="col-span-4 bg-slate-50/50 border-b border-black"></div>

          <div style={labelStyle} className="col-span-2 text-white p-1.5 text-[10px] font-black border-r border-black uppercase flex items-center">Docente</div>
          <div className="col-span-10 p-1.5 text-[11px] bg-white">
            <input 
              className="w-full focus:outline-none uppercase font-black text-black-500" 
              value={info.docente} 
              onChange={(e) => onInfoChange('docente', e.target.value)} 
            />
          </div>
        </div>

        {/* Right Logo (UGEL/DRE Logo) */}
        <div className="w-32 flex flex-col items-center shrink-0">
           <div className="w-20 h-20 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-center overflow-hidden shadow-sm">
            {logo ? (
              <img 
                src={logo} 
                alt="Logo UGEL" 
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-[8px] text-slate-400 font-bold uppercase text-center">Logo<br/>MINEDU</span>
            )}
          </div>
          <div className="text-[9px] font-black text-center mt-2 leading-tight text-blue-900 uppercase">
            Jornada Escolar<br/><span className="text-xs">COMPLETA</span><br/>SECUNDARIA
          </div>
        </div>
      </div>
    </div>
  );
};

export default Header;


