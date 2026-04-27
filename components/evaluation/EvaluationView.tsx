import React, { useEffect, useState } from 'react';
import { EvaluationInstruments } from './EvaluationInstruments';
import { AuxiliaryRegister } from './AuxiliaryRegister';
import { EvidenceBank } from './EvidenceBank';
import { AnalysisReports } from './AnalysisReports';
import { SmartFeedback } from './SmartFeedback';
import { ScaleConfig } from './ScaleConfig';
import { UnitRegisterView } from './UnitRegisterView';
import { BimesterRegisterView } from './BimesterRegisterView';

interface Props {
  activeSection?: string;
  onSuccess?: () => void;
}

export const EvaluationView: React.FC<Props> = ({ activeSection = 'instrumentos' }) => {
  const [currentSubSection, setCurrentSubSection] = useState(activeSection);
  const validSubSections = new Set([
    'instrumentos',
    'registro',
    'registro_unidad',
    'registro_bimestre',
    'evidencias',
    'reportes',
    'retroalimentacion',
    'configuracion'
  ]);

  useEffect(() => {
    setCurrentSubSection(validSubSections.has(activeSection) ? activeSection : 'instrumentos');
  }, [activeSection]);

  const renderSubSection = () => {
    switch (currentSubSection) {
      case 'instrumentos':
        return <EvaluationInstruments />;
      case 'registro':
        return <AuxiliaryRegister />;
      case 'registro_unidad':
        return <UnitRegisterView />;
      case 'registro_bimestre':
        return <BimesterRegisterView />;
      case 'evidencias':
        return <EvidenceBank />;
      case 'reportes':
        return <AnalysisReports />;
      case 'retroalimentacion':
        return <SmartFeedback />;
      case 'configuracion':
        return <ScaleConfig />;
      default:
        return <EvaluationInstruments />;
    }
  };

  const menuItems = [
    { id: 'instrumentos', label: 'Instrumentos', icon: 'TAB' },
    { id: 'registro', label: 'Registro Auxiliar', icon: 'REG' },
    { id: 'registro_unidad', label: 'Registro por Unidad', icon: 'UNI' },
    { id: 'registro_bimestre', label: 'Registro por Bimestre', icon: 'BIM' },
    { id: 'evidencias', label: 'Banco de Evidencias', icon: 'EVD' },
    { id: 'reportes', label: 'Analisis y Reportes', icon: 'REP' },
    { id: 'retroalimentacion', label: 'Retroalimentacion IA', icon: 'AI' },
    { id: 'configuracion', label: 'Configuracion', icon: 'CFG' }
  ];

  return (
    <div className="animate-fade-in space-y-6">
      <div className="bg-white rounded-[2.5rem] p-8 shadow-xl border border-slate-200 overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-500 to-teal-500"></div>
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-4">
            <div className="bg-emerald-100 p-4 rounded-3xl text-sm font-black text-emerald-700 shadow-inner">EVAL</div>
            <div>
              <h1 className="text-3xl font-black italic font-serif tracking-tight uppercase leading-none text-slate-800">Modulo: Evaluacion</h1>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Gestion pedagogica integral por competencias</p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentSubSection(item.id)}
              className={`
                px-6 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all
                flex items-center gap-3
                ${currentSubSection === item.id
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200 scale-105'
                  : 'bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600'}
              `}
            >
              <span className="text-[9px] bg-white/20 px-2 py-1 rounded-md">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="transition-all duration-500">
        {renderSubSection()}
      </div>
    </div>
  );
};
