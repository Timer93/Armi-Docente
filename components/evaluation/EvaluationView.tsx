import React, { useEffect, useState } from 'react';
import { EvaluationInstruments } from './EvaluationInstruments';
import { EvidenceBank } from './EvidenceBank';
import { UnitRegisterView } from './UnitRegisterView';
import { BimesterRegisterView } from './BimesterRegisterView';

interface Props {
  activeSection?: string;
  onSuccess?: () => void;
}

export const EvaluationView: React.FC<Props> = ({ activeSection = 'instrumentos' }) => {
  const [currentSubSection, setCurrentSubSection] = useState(activeSection);
  const sectionLabels: Record<string, string> = {
    instrumentos: 'Instrumentos',
    registro_unidad: 'Registro por Unidad',
    registro_bimestre: 'Registro por Bimestre',
    evidencias: 'Banco de Evidencias'
  };
  const validSubSections = new Set([
    'instrumentos',
    'registro_unidad',
    'registro_bimestre',
    'evidencias'
  ]);

  useEffect(() => {
    setCurrentSubSection(validSubSections.has(activeSection) ? activeSection : 'instrumentos');
  }, [activeSection]);

  const renderSubSection = () => {
    switch (currentSubSection) {
      case 'instrumentos':
        return <EvaluationInstruments />;
      case 'registro_unidad':
        return <UnitRegisterView />;
      case 'registro_bimestre':
        return <BimesterRegisterView />;
      case 'evidencias':
        return <EvidenceBank />;
      default:
        return <EvaluationInstruments />;
    }
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="bg-white rounded-[2.5rem] p-8 shadow-xl border border-slate-200 overflow-hidden relative print:hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-500 to-teal-500"></div>
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-4">
            <div className="bg-emerald-100 p-4 rounded-3xl text-sm font-black text-emerald-700 shadow-inner">EVAL</div>
            <div>
              <h1 className="text-3xl font-black italic font-serif tracking-tight uppercase leading-none text-slate-800">
                {sectionLabels[currentSubSection] || 'Instrumentos'}
              </h1>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Gestion pedagogica integral por competencias</p>
            </div>
          </div>
        </div>
      </div>

      <div className="transition-all duration-500">
        {renderSubSection()}
      </div>
    </div>
  );
};
