
import React from 'react';
import { API_BASE_URL } from '../constants';

export const cargarProgramacion = async (id: string) => {
  try {
    const res = await fetch(`${API_BASE_URL}/programacion/${id}`);
    const data = await res.json();

    if (!data || data.message) {
        console.error("Error al cargar programación:", data.message || "No encontrado");
        return;
    }

    const documento = `
INSTITUCIÓN: ${data.institution || data.institucion || 'N/A'}
ÁREA: ${data.area_curricular || data.area || 'N/A'}
GRADO: ${data.grade || data.grado || 'N/A'}
DOCENTE: ${data.teacher || data.docente || 'N/A'}
HORAS: ${data.nro_pa || 'N/A'}
`;

    console.log(documento); // luego esto va a Word o PDF
    return documento;
  } catch (error) {
    console.error("Error de red al cargar programación:", error);
  }
};

const PlantillaProgramacion: React.FC<{ id_programa: string }> = ({ id_programa }) => {
    return (
        <div className="p-4 bg-white rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-sm font-bold text-slate-700 mb-4">Vista Previa de Plantilla (Consola)</h3>
            <button 
                onClick={() => cargarProgramacion(id_programa)}
                className="btn-water water-blue px-6 py-2 rounded-lg text-white font-bold text-xs uppercase tracking-widest"
            >
                Generar Documento en Log
            </button>
            <p className="mt-2 text-[10px] text-slate-400 italic">* Revise la consola del navegador para ver el resultado.</p>
        </div>
    );
};

export default PlantillaProgramacion;
