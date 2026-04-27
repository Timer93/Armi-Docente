
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CurricularArea, TeachingAssignment } from '../types';
import { getDatosGenerales, updateModuleStatus } from '../services/apiService'; 
import { Input } from './Input';
import { Select } from './Select';
import { TextArea } from './TextArea';
import '../styles/buttons.css';
import WaterButton from "./WaterButton";



interface Props {
  activeSection: string;
  onSuccess: () => void;
}

const OFFICIAL_AREAS_NAMES = [
    'Arte y Cultura',
    'Castellano como Segunda Lengua',
    'Ciencia y Tecnología',
    'Ciencias Sociales',
    'Comunicación',
    'Desarrollo Personal, Ciudadanía y Cívica',
    'Educación Física',
    'Educación para el Trabajo',
    'Educación Religiosa',
    'Inglés como Lengua Extranjera',
    'Matemática',
    'Tutoría y Orientación Educativa'
];

const getAreaIcon = (name: string) => {
    const icons: Record<string, string> = {
        'Arte y Cultura': '🎨',
        'Castellano como Segunda Lengua': '🗣️',
        'Ciencia y Tecnología': '🔬',
        'Ciencias Sociales': '🌍',
        'Comunicación': '✍️',
        'Desarrollo Personal, Ciudadanía y Cívica': '🤝',
        'Educación Física': '⚽',
        'Educación para el Trabajo': '🛠️',
        'Educación Religiosa': '⛪',
        'Inglés como Lengua Extranjera': '🇬🇧',
        'Matemática': '📐',
        'Tutoría y Orientación Educativa': '💡'
    };
    return icons[name] || '📚';
};

const SECTION_OPTIONS = [
    { value: 'U', label: 'U (Única)' },
    { value: 'A', label: 'A' },
    { value: 'B', label: 'B' },
    { value: 'C', label: 'C' },
    { value: 'D', label: 'D' },
    { value: 'E', label: 'E' },
];

export const AreasGradosView: React.FC<Props> = ({ activeSection, onSuccess }) => {
    const [areas, setAreas] = useState<CurricularArea[]>([]);
    const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
    const [educationLevel, setEducationLevel] = useState<string>('Secundaria'); 
    const [toast, setToast] = useState<{msg: string, type: 'error' | 'success'} | null>(null);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);

    // Estados para la confirmación de eliminación
    const [confirmDeleteAreaId, setConfirmDeleteAreaId] = useState<string | null>(null);
    const [confirmDeleteAssignmentId, setConfirmDeleteAssignmentId] = useState<string | null>(null);

    const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
    const [formAreaId, setFormAreaId] = useState('');
    const [formGrade, setFormGrade] = useState('');
    const [formSection, setFormSection] = useState('');
    const [formChar, setFormChar] = useState('');
    const [saving, setSaving] = useState(false);
    const [savedOk, setSavedOk] = useState(false);

    const [selectedAreaFromOfficial, setSelectedAreaFromOfficial] = useState('');

    const currentYear = new Date().getFullYear();

    const gradeOptions = useMemo(() => {
        const isPrimaria = educationLevel === 'Primaria';
        const limit = isPrimaria ? 6 : 5;
        const options = [];
        const suffixes = ['ro', 'do', 'ro', 'to', 'to', 'to'];
        for (let i = 1; i <= limit; i++) {
            const label = `${i}${suffixes[i-1]}`;
            options.push({ value: label, label: label });
        }
        return options;
    }, [educationLevel]);

    useEffect(() => {
        getDatosGenerales().then(data => {
            if (data.level) setEducationLevel(data.level);
        });

        const savedAreas = localStorage.getItem('armi_areas');
        if (savedAreas) {
            setAreas(JSON.parse(savedAreas));
        } else {
            setAreas([]);
            localStorage.setItem('armi_areas', JSON.stringify([]));
        }

        const savedAssign = localStorage.getItem('armi_assignments');
        if (savedAssign) setAssignments(JSON.parse(savedAssign));
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (!selectedAssignmentId) return;
            const target = event.target as HTMLElement;
            const isProtected = target.closest('.zona-edicion-grados') || target.closest('.dropdown-enter');
            if (!isProtected) {
                handleCleanForm();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [selectedAssignmentId]);

    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    const showToast = (msg: string, type: 'error' | 'success') => {
        setToast({ msg, type });
    };

    const saveAreasToLocal = (newAreas: CurricularArea[]) => {
        setAreas(newAreas);
        localStorage.setItem('armi_areas', JSON.stringify(newAreas));
    };

    const saveAssignmentsToLocal = async (newAssigns: TeachingAssignment[]) => {
        setAssignments(newAssigns);
        localStorage.setItem('armi_assignments', JSON.stringify(newAssigns));
        
        // Sincronizar estado del módulo con el servidor
        try {
            await updateModuleStatus('areas_grados', newAssigns.length > 0);
            onSuccess();
        } catch (e) {
            console.error("Error al actualizar estado del módulo Areas/Grados", e);
        }
    };

    const handleAddArea = () => {
        if (!selectedAreaFromOfficial) return;
        if (areas.some(a => a.name === selectedAreaFromOfficial)) {
            showToast('⚠️ El área ya está agregada.', 'error');
            return;
        }
        const newArea: CurricularArea = {
            id: Date.now().toString(),
            name: selectedAreaFromOfficial
        };
        saveAreasToLocal([...areas, newArea]);
        setSelectedAreaFromOfficial('');
        showToast('Área agregada correctamente', 'success');
    };

    const handleDeleteAreaRequest = (id: string) => {
        setConfirmDeleteAreaId(id);
    };

    const confirmDeleteArea = () => {
        if (!confirmDeleteAreaId) return;
        saveAreasToLocal(areas.filter(a => a.id !== confirmDeleteAreaId));
        saveAssignmentsToLocal(assignments.filter(a => a.areaId !== confirmDeleteAreaId));
        setConfirmDeleteAreaId(null);
        showToast('Área eliminada correctamente', 'success');
    };

    const cancelDeleteArea = () => {
        setConfirmDeleteAreaId(null);
    };

    const handleSelectRow = (assign: TeachingAssignment) => {
        setSelectedAssignmentId(assign.id);
        setFormAreaId(assign.areaId);
        setFormGrade(assign.grade);
        setFormSection(assign.section);
        setFormChar(assign.studentCharacterization);
    };

    const handleCleanForm = () => {
        setSelectedAssignmentId(null);
        setFormAreaId('');
        setFormGrade('');
        setFormSection('');
        setFormChar('');
    };

    const handleSaveAssignment = async () => {
        setLoading(true);
        setSaving(true);
        setSavedOk(false);
        setSuccess(false);

        if (!formAreaId || !formGrade || !formSection) {
            showToast('⚠️ Complete Área, Grado y Sección', 'error');
            setLoading(false);
            setSaving(false);

            return;
        }
        const isDuplicate = assignments.some(a => 
            a.areaId === formAreaId && 
            a.grade === formGrade && 
            a.section === formSection && 
            a.id !== selectedAssignmentId
        );
        if (isDuplicate) {
            showToast('⛔ Esta combinación ya existe.', 'error');
            setLoading(false);
            setSaving(false);

            return;
        }
        const areaObj = areas.find(a => a.id === formAreaId);
        if (!areaObj) {
            setLoading(false);
            setSaving(false);
            return;
        }
        const newItem: TeachingAssignment = {
            id: selectedAssignmentId || Date.now().toString(),
            areaId: formAreaId,
            areaName: areaObj.name,
            grade: formGrade,
            section: formSection,
            studentCharacterization: formChar
        };
        if (selectedAssignmentId) {
            const updated = assignments.map(a => a.id === selectedAssignmentId ? newItem : a);
            await saveAssignmentsToLocal(updated);
            showToast('Registro actualizado', 'success');
        } else {
            await saveAssignmentsToLocal([...assignments, newItem]);
            showToast('Asignación agregada', 'success');
        }
        setLoading(false);
        setSaving(false);
        setSavedOk(true);
        setTimeout(() => {
            setSavedOk(false);
        }, 1200);

        handleCleanForm();

    };

    const handleDeleteAssignmentRequest = (id: string) => {
        setConfirmDeleteAssignmentId(id);
    };

    const confirmDeleteAssignment = () => {
        if (!confirmDeleteAssignmentId) return;
        saveAssignmentsToLocal(assignments.filter(a => a.id !== confirmDeleteAssignmentId));
        if (selectedAssignmentId === confirmDeleteAssignmentId) handleCleanForm();
        setConfirmDeleteAssignmentId(null);
        showToast('Asignación eliminada', 'success');
    };

    const cancelDeleteAssignment = () => {
        setConfirmDeleteAssignmentId(null);
    };

    if (activeSection === 'areas') {
        const areaToDelete = areas.find(a => a.id === confirmDeleteAreaId);
        return (
            <div className="animate-fade-in flex flex-col h-full space-y-8">
                 {/* Toast de Confirmación Fijo */}
                 {confirmDeleteAreaId && (
                    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-fade-in p-4">
                        <div className="bg-white rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-slate-200 w-full max-w-md overflow-hidden animate-scale-in">
                            <div className="bg-rose-50 p-8 flex flex-col items-center text-center">
                                <div className="w-20 h-20 bg-rose-100 rounded-full flex items-center justify-center text-4xl mb-4 shadow-inner">⚠️</div>
                                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight leading-tight">¿Eliminar Área?</h3>
                                <p className="text-[10px] font-bold text-rose-600 uppercase tracking-widest mt-2 mb-4">Esta acción no se puede deshacer</p>
                                <div className="bg-white/80 border border-rose-200 px-6 py-3 rounded-2xl shadow-sm w-full">
                                    <span className="text-sm font-black text-slate-700 uppercase italic">{areaToDelete?.name}</span>
                                </div>
                                <p className="text-[10px] text-slate-400 font-bold mt-4 leading-relaxed uppercase">Se borrarán todas las asignaciones vinculadas a esta área.</p>
                            </div>
                            <div className="p-6 bg-slate-50 flex gap-3 border-t border-slate-100">
                                <button onClick={cancelDeleteArea} className="flex-1 py-4 rounded-2xl bg-white border border-slate-200 text-slate-400 font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 hover:text-slate-600 transition-all">Cancelar</button>
                                <button onClick={confirmDeleteArea} className="flex-1 py-4 rounded-2xl bg-rose-600 text-white font-black text-[10px] uppercase tracking-widest shadow-lg shadow-rose-200 hover:bg-rose-700 active:scale-95 transition-all">Sí, Eliminar</button>
                            </div>
                        </div>
                    </div>
                 )}

                 <div className="bg-slate-900 text-white p-8 rounded-[3rem] shadow-2xl relative overflow-hidden flex justify-between items-center">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-indigo-600"></div>
                    <div className="flex items-center gap-4">
                        <div className="bg-white/10 p-3 rounded-2xl border border-white/20 shadow-inner">
                            <span className="text-3xl">📚</span>
                        </div>
                        <div className="flex flex-col">
                            <h1 className="text-3xl font-black tracking-tight uppercase leading-none">Áreas a Cargo {currentYear}</h1>
                            <span className="text-[10px] text-blue-400 font-black tracking-widest uppercase mt-2 italic">Configuración de Carga Curricular</span>
                        </div>
                    </div>
                 </div>
                 
                 <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 flex-1">
                     <div className="lg:col-span-2 bg-white p-10 rounded-[3rem] shadow-xl border border-slate-200 h-fit flex flex-col gap-8 relative z-40 overflow-visible">
                         <div className="space-y-4">
                            <h3 className="font-black text-slate-400 mb-6 text-[10px] uppercase tracking-widest flex items-center gap-2">
                                <span className="w-2 h-4 bg-blue-500 rounded-full"></span>
                                Agregar Nueva Área
                            </h3>
                            <div className="flex items-end gap-4 overflow-visible">
                                <div className="flex-1">
                                    <Select 
                                        label="Seleccionar Área Oficial" 
                                        name="officialArea" 
                                        options={OFFICIAL_AREAS_NAMES.map(name => ({ value: name, label: name }))}
                                        value={selectedAreaFromOfficial}
                                        onChange={(e) => setSelectedAreaFromOfficial(e.target.value)}
                                        placeholder="Elija el área..."
                                        searchable={true}
                                    />
                                </div>
                                <button 
                                    onClick={handleAddArea}
                                    disabled={!selectedAreaFromOfficial}
                                    className="btn-3d-plus shrink-0 mb-0.5"
                                    title="Agregar a Mi Lista"
                                >
                                    <span>+</span>
                                </button>
                            </div>
                         </div>
                     </div>

                     <div className="lg:col-span-3 bg-white rounded-[3rem] shadow-xl border border-slate-200 overflow-hidden flex flex-col min-h-[500px]">
                         <div className="bg-slate-50 px-8 py-5 border-b border-slate-200 font-black text-slate-700 text-[10px] uppercase tracking-widest flex justify-between items-center shadow-inner">
                             <span>Mis Áreas Registradas</span>
                             <span className="bg-white px-3 py-1 rounded-full shadow-sm text-blue-600 border border-slate-200 font-black">{areas.length}</span>
                         </div>
                         <div className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-slate-50/20">
                             {areas.length === 0 ? (
                                 <div className="p-20 text-center text-slate-300 italic flex flex-col items-center">
                                     <span className="text-6xl mb-4 opacity-20">📁</span>
                                     <p className="font-black uppercase tracking-widest text-[10px]">Sin áreas seleccionadas todavía</p>
                                 </div>
                             ) : (
                                <div className="flex flex-col gap-4">
                                    {areas.sort((a,b) => a.name.localeCompare(b.name)).map(area => (
                                        <div key={area.id} className="bg-white px-6 py-4 rounded-[2rem] border border-slate-200 shadow-sm flex items-center gap-6 group hover:border-blue-300 hover:shadow-lg transition-all relative overflow-hidden w-full">
                                            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-black text-2xl border border-blue-100 shadow-inner group-hover:bg-blue-600 group-hover:text-white transition-all shrink-0">
                                                {getAreaIcon(area.name)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <span className="font-black text-slate-800 text-sm uppercase tracking-tight leading-tight block truncate pr-10">{area.name}</span>
                                            </div>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleDeleteAreaRequest(area.id); }}
                                                className="btn-3d-minus scale-75 group-hover:scale-90 transition-all opacity-0 group-hover:opacity-100 shrink-0"
                                                title="Eliminar Área"
                                            >
                                                <span>-</span>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                             )}
                         </div>
                     </div>
                 </div>
                 {toast && (
                    <div className={`fixed top-8 right-8 z-[200] px-8 py-4 rounded-[2rem] shadow-2xl border-l-[6px] text-xs font-black animate-fade-in flex items-center gap-4 ${toast.type === 'error' ? 'bg-white border-red-500 text-red-700' : 'bg-white border-emerald-500 text-emerald-700'}`}>
                        <span className="text-2xl">{toast.type === 'error' ? '🚫' : '✅'}</span>
                        <span className="uppercase tracking-widest">{toast.msg}</span>
                    </div>
                 )}
            </div>
        );
    }

    return (
        <div className="animate-fade-in relative flex flex-col h-full space-y-6">
             {toast && (
                <div className={`fixed top-8 right-8 z-[200] px-8 py-4 rounded-[2rem] shadow-2xl border-l-[6px] text-xs font-black animate-fade-in flex items-center gap-4 ${toast.type === 'error' ? 'bg-white border-red-500 text-red-700' : 'bg-white border-emerald-500 text-emerald-700'}`}>
                    <span className="text-2xl">{toast.type === 'error' ? '🚫' : '✅'}</span>
                    <span className="uppercase tracking-widest">{toast.msg}</span>
                </div>
             )}

             {/* Toast de Confirmación para Asignación */}
             {confirmDeleteAssignmentId && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-fade-in p-4">
                    <div className="bg-white rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-slate-200 w-full max-w-md overflow-hidden animate-scale-in">
                        <div className="bg-rose-50 p-8 flex flex-col items-center text-center">
                            <div className="w-20 h-20 bg-rose-100 rounded-full flex items-center justify-center text-4xl mb-4 shadow-inner">⚠️</div>
                            <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight leading-tight">¿Eliminar Asignación?</h3>
                            <p className="text-[10px] font-bold text-rose-600 uppercase tracking-widest mt-2 mb-4">Se borrará el registro de este grado y sección</p>
                            <div className="bg-white/80 border border-rose-200 px-6 py-3 rounded-2xl shadow-sm w-full">
                                {(() => {
                                    const a = assignments.find(x => x.id === confirmDeleteAssignmentId);
                                    return <span className="text-sm font-black text-slate-700 uppercase italic">{a?.areaName} - {a?.grade} {a?.section}</span>;
                                })()}
                            </div>
                        </div>
                        <div className="p-6 bg-slate-50 flex gap-3 border-t border-slate-100">
                            <button onClick={cancelDeleteAssignment} className="flex-1 py-4 rounded-2xl bg-white border border-slate-200 text-slate-400 font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 hover:text-slate-600 transition-all">Cancelar</button>
                            <button onClick={confirmDeleteAssignment} className="flex-1 py-4 rounded-2xl bg-rose-600 text-white font-black text-[10px] uppercase tracking-widest shadow-lg shadow-rose-200 hover:bg-rose-700 active:scale-95 transition-all">Sí, Eliminar</button>
                        </div>
                    </div>
                </div>
             )}

             <div className="bg-slate-900 text-white p-6 rounded-[2.5rem] flex justify-between items-center shadow-xl relative overflow-hidden">
                 <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-indigo-600"></div>
                 <div className="flex items-center gap-4">
                     <div className="bg-white/10 p-2.5 rounded-2xl border border-white/20 shadow-inner">
                        <span className="text-2xl">🏢</span>
                     </div>
                     <div className="flex flex-col">
                        <h2 className="font-black text-2xl tracking-tight leading-none uppercase">Grados a Cargo</h2>
                        <span className="text-[10px] text-blue-400 font-black tracking-widest uppercase mt-1 italic">Asignación de Secciones y Caracterización</span>
                     </div>
                 </div>
                 <div className="text-right text-[10px] font-black uppercase text-slate-500 tracking-widest leading-none">
                     Planificación Curricular {currentYear}
                 </div>
             </div>

             <div className="bg-white border border-slate-200 p-6 shadow-xl mb-6 rounded-[2.5rem] zona-edicion-grados relative z-[100]">


                 <div className="grid grid-cols-12 gap-4 items-end">
                     <div className="col-span-12 md:col-span-5">
                         <Select 
                            label="ÁREA CURRICULAR" 
                            name="area" 
                            options={areas.map(a => ({ value: a.id, label: a.name }))}
                            value={formAreaId}
                            onChange={(e) => setFormAreaId(e.target.value)}
                            searchable={true}
                            placeholder="Buscar o seleccionar..."
                         />
                     </div>
                     <div className="col-span-12 md:col-span-2">
                         <Select 
                            label="GRADO"
                            name="grade" 
                            options={gradeOptions}
                            value={formGrade}
                            onChange={(e) => setFormGrade(e.target.value)}
                         />
                     </div>
                     <div className="col-span-12 md:col-span-2">
                         <Select
                            label="SECCIÓN"
                            name="section"
                            options={SECTION_OPTIONS}
                            value={formSection}
                            onChange={(e) => setFormSection(e.target.value)}
                         />
                     </div>
                     <div className="col-span-12 md:col-span-3 flex justify-end gap-3 pb-1">
                        <button 
                            onClick={handleSaveAssignment} 
                            className={`btn-3d-plus ${saving ? 'animate-pulse' : ''}`} 
                            title="Guardar Registro"
                            disabled={saving}
                        >
                            <span>
                                {savedOk ? '✔' : '+'}
                            </span>
                        </button>

                        <button 
                            onClick={handleCleanForm} 
                            className="btn-3d-clear" 
                            title="Limpiar Formulario"
                        >
                            
                            <span>🧹</span>
                        </button>
                     </div>
                 </div>
             </div>

             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-[600px]">
                 <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-300 flex flex-col overflow-hidden h-full zona-edicion-grados">
                     <div className="bg-slate-800 text-white px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em]">
                        <span>
                            Caracterización de Estudiantes
                            {formGrade && formSection ? ` - ${formGrade} ${formSection}` : ''}
                        </span>
                    </div>

                     <textarea
                        className="flex-1 w-full p-8 resize-none focus:outline-none focus:bg-slate-50 text-xs leading-relaxed text-slate-700 text-justify font-medium"
                        placeholder="Describa aquí el perfil, necesidades e intereses de los estudiantes..."
                        value={formChar}
                        onChange={(e) => setFormChar(e.target.value)}
                     />
                 </div>

                 <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-200 flex flex-col overflow-hidden h-full zona-edicion-grados">
                     <div className="bg-slate-900 text-white p-6 shadow-lg relative z-10">
                        <div className="flex justify-between items-center">
                            <h3 className="font-black text-xs tracking-widest uppercase">Tabla de Asignaciones</h3>
                            <div className="bg-white/10 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-white/20">
                                {assignments.length} Filas
                            </div>
                        </div>
                     </div>
                     <div className="overflow-auto flex-1 custom-scrollbar">
                         <table className="w-full text-[11px] text-left border-collapse table-fixed">
                             <thead className="bg-slate-800 text-white text-[9px] uppercase font-black tracking-widest sticky top-0 z-20 shadow-md">
                                 <tr className="divide-x divide-white/10">
                                     <th className="p-4 text-center w-12">N°</th>
                                     <th className="p-4">Área Curricular</th>
                                     <th className="p-4 text-center w-20">Grado</th>
                                     <th className="p-4 text-center w-20">Sec</th>
                                     <th className="p-4 text-center w-16">EST..</th>
                                     <th className="p-4 text-center w-16">Acción</th>
                                 </tr>
                             </thead>
                             <tbody className="divide-y divide-slate-100">
                                 {assignments.length === 0 ? (
                                     <tr><td colSpan={6} className="p-20 text-center text-slate-400 italic uppercase font-bold text-[9px] tracking-widest">Sin asignaciones registradas</td></tr>
                                 ) : (
                                     assignments.map((assign, index) => {
                                         const isSelected = selectedAssignmentId === assign.id;
                                         const hasChar = assign.studentCharacterization && assign.studentCharacterization.length > 10;
                                         return (
                                            <tr key={assign.id} onClick={(e) => { e.stopPropagation(); handleSelectRow(assign); }} className={`cursor-pointer transition-all duration-200 group ${isSelected ? 'bg-blue-50/80 ring-2 ring-inset ring-blue-200 shadow-inner' : 'hover:bg-slate-50'}`}>
                                                <td className="py-1 text-center font-black opacity-30 border-r border-slate-100/10 select-none cursor-default">{index + 1}</td>
                                                <td className={`py-1 font-black uppercase transition-colors ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>{assign.areaName}</td>
                                                <td className="py-1 text-center"><span className="px-2 py-0.5 rounded-lg border border-slate-200 bg-slate-50 font-black">{assign.grade}</span></td>
                                                <td className="py-1 text-center"><span className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-100 font-black">{assign.section}</span></td>
                                                <td className="py-1 text-center">
                                                    <div className="flex justify-center">{hasChar ? <span className="text-emerald-500">✅</span> : <span className="text-slate-300 opacity-20 group-hover:opacity-100">❌</span>}</div>
                                                </td>
                                                <td className="py-1 text-center">
                                                    <div className="flex justify-center">
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); handleDeleteAssignmentRequest(assign.id); }}
                                                            className="btn-3d-minus scale-75 opacity-0 group-hover:opacity-100 transition-all"
                                                            title="Eliminar Asignación"
                                                        >
                                                            <span>-</span>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                         );
                                     })
                                 )}
                             </tbody>
                         </table>
                     </div>
                 </div>
             </div>
        </div>
    );
};
