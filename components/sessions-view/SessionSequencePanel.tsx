import React from 'react';
import ReactQuill from 'react-quill-new';
import { QUILL_MODULES } from './shared';

type SessionSequencePanelProps = {
    themeColor: string;
    sessionData: any;
    tiempoValues: Array<string | number>;
    handleInputChange: (path: string, value: any) => void;
    debouncedSync: (
        value: string,
        activityPath: string,
        resourcePath: string
    ) => void;
    handleSaveAsTemplate: () => void;
    handleExportJson: () => void;
    handleImportJson: (event: React.ChangeEvent<HTMLInputElement>) => void;
    handleRestoreTemplate: () => void;
};

export const SessionSequencePanel: React.FC<SessionSequencePanelProps> = ({
    themeColor,
    sessionData,
    tiempoValues,
    handleInputChange,
    debouncedSync,
    handleSaveAsTemplate,
    handleExportJson,
    handleImportJson,
    handleRestoreTemplate
}) => (
                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
                        <div className="bg-slate-50 px-6 py-2 border-b border-slate-200 flex justify-end gap-3">
                        <button onClick={handleSaveAsTemplate} className="btn-3d-darkgreen scale-90" title="Anclar como Plantilla de Área (SQL)">
                            <span>⚓</span>
                        </button>
                        <button onClick={handleExportJson} className="btn-3d-orange scale-90" title="Exportar Plantilla (.JSON)">
                            <span>⬇</span>
                        </button>
                        <label className="btn-3d-grey scale-90 cursor-pointer" title="Importar Plantilla (.JSON)">
                            <span>⬆</span>
                            <input type="file" className="hidden" accept=".json" onChange={handleImportJson} />
                        </label>
                            <button onClick={handleRestoreTemplate} className="btn-3d-clear scale-90" title="Restaurar Plantilla Global">
                            <span>↻</span>
                            </button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-[10px]">
                                <thead>
                                    <tr className="text-white font-black uppercase text-[9px] tracking-widest" style={{ backgroundColor: themeColor }}>
                                        <th className="border border-white/30 p-3 w-24 text-center">FASES</th>
                                        <th colSpan={2} className="border border-white/30 p-3 w-64 text-center">PROCESOS PEDAGÓGICOS</th>
                                        <th className="border border-white/30 p-3 text-center">ESTRATEGIAS / ACTIVIDADES</th>
                                        <th className="border border-white/30 p-3 w-64 text-center">MEDIOS, MATERIALES Y/O RECURSOS</th>
                                        <th className="border border-white/30 p-3 w-24 text-center">TIEMPO</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {/* ================= INICIO ================= */}
                                    <tr>
                                        <td rowSpan={2} className="border border-black/20 p-4 font-black text-center align-middle bg-slate-50">INICIO</td>
                                        {/* MOTIVACIÓN TRANSVERSAL TOTAL */}
                                        <td rowSpan={6} className="border border-black/20 bg-slate-100 align-middle">
                                            <div className="h-full flex items-center justify-center">
                                                <span className="font-black tracking-widest text-[9px]" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>MOTIVACIÓN</span>
                                            </div>
                                        </td>
                                        <td className="border border-black/20 p-4 font-black text-center bg-slate-50/40">RECUPERACIÓN DE SABERES PREVIOS</td>
                                        <td data-session-field="secuencia.inicio.saberes" className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.inicio.saberes}
                                                onChange={(val) => {
                                                    handleInputChange('secuencia.inicio.saberes', val);
                                                    debouncedSync(val, 'secuencia.inicio.saberes', 'secuencia.inicio.saberes_recursos');
                                                }}
                                            />
                                        </td>
                                        <td data-session-field="secuencia.inicio.saberes_recursos" className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.inicio.saberes_recursos}
                                                onChange={(val) => handleInputChange('secuencia.inicio.saberes_recursos', val)}
                                            />
                                        </td>
                                        <td className="border border-black/20 text-center font-black bg-slate-50">{tiempoValues[0]}</td>
                                    </tr>
                                    <tr>
                                        <td className="border border-black/20 p-4 font-black text-center bg-slate-50/40">CONFLICTO COGNITIVO</td>
                                        <td data-session-field="secuencia.inicio.conflicto" className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.inicio.conflicto}
                                                onChange={(val) => {
                                                    handleInputChange('secuencia.inicio.conflicto', val);
                                                    debouncedSync(val, 'secuencia.inicio.conflicto', 'secuencia.inicio.conflicto_recursos');
                                                }}
                                            />
                                        </td>
                                        <td data-session-field="secuencia.inicio.conflicto_recursos" className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.inicio.conflicto_recursos}
                                                onChange={(val) => handleInputChange('secuencia.inicio.conflicto_recursos', val)}
                                            />
                                        </td>
                                        <td className="border border-black/20 text-center font-black bg-slate-50">{tiempoValues[1]}</td>
                                    </tr>
                                    {/* ================= DESARROLLO ================= */}
                                    <tr>
                                        <td rowSpan={3} className="border border-black/20 p-4 font-black text-center align-middle bg-slate-50">DESARROLLO</td>
                                        <td className="border border-black/20 p-4 font-black text-center bg-slate-50/40">CONSTRUCCIÓN DEL CONOCIMIENTO</td>
                                        <td data-session-field="secuencia.proceso.construccion" className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.proceso.construccion}
                                                onChange={(val) => {
                                                    handleInputChange('secuencia.proceso.construccion', val);
                                                    debouncedSync(val, 'secuencia.proceso.construccion', 'secuencia.proceso.construccion_recursos');
                                                }}
                                            />
                                        </td>
                                        <td data-session-field="secuencia.proceso.construccion_recursos" className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.proceso.construccion_recursos}
                                                onChange={(val) => handleInputChange('secuencia.proceso.construccion_recursos', val)}
                                            />
                                        </td>
                                        <td className="border border-black/20 text-center font-black bg-slate-50">{tiempoValues[2]}</td>
                                    </tr>
                                    <tr>
                                        <td className="border border-black/20 p-4 font-black text-center bg-slate-50/40">APLICACIÓN DE LO APRENDIDO</td>
                                        <td data-session-field="secuencia.proceso.aplicacion" className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.proceso.aplicacion}
                                                onChange={(val) => {
                                                    handleInputChange('secuencia.proceso.aplicacion', val);
                                                    debouncedSync(val, 'secuencia.proceso.aplicacion', 'secuencia.proceso.aplicacion_recursos');
                                                }}
                                            />
                                        </td>
                                        <td data-session-field="secuencia.proceso.aplicacion_recursos" className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.proceso.aplicacion_recursos}
                                                onChange={(val) => handleInputChange('secuencia.proceso.aplicacion_recursos', val)}
                                            />
                                        </td>
                                        <td className="border border-black/20 text-center font-black bg-slate-50">{tiempoValues[3]}</td>
                                    </tr>
                                    <tr>
                                        <td className="border border-black/20 p-4 font-black text-center bg-slate-50/40">METACOGNICIÓN</td>
                                        <td data-session-field="secuencia.proceso.metacognicion" className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.proceso.metacognicion}
                                                onChange={(val) => {
                                                    handleInputChange('secuencia.proceso.metacognicion', val);
                                                    debouncedSync(val, 'secuencia.proceso.metacognicion', 'secuencia.proceso.metacognicion_recursos');
                                                }}
                                            />
                                        </td>
                                        <td data-session-field="secuencia.proceso.metacognicion_recursos" className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.proceso.metacognicion_recursos}
                                                onChange={(val) => handleInputChange('secuencia.proceso.metacognicion_recursos', val)}
                                            />
                                        </td>
                                        <td className="border border-black/20 text-center font-black bg-slate-50">{tiempoValues[4]}</td>
                                    </tr>
                                    {/* ================= SALIDA ================= */}
                                    <tr>
                                        <td className="border border-black/20 p-4 font-black text-center align-middle bg-slate-50">SALIDA</td>
                                        <td className="border border-black/20 p-4 font-black text-center bg-slate-50/40">EVALUACIÓN</td>
                                        <td data-session-field="secuencia.salida.evaluacion" className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.salida.evaluacion}
                                                onChange={(val) => {
                                                    handleInputChange('secuencia.salida.evaluacion', val);
                                                    debouncedSync(val, 'secuencia.salida.evaluacion', 'secuencia.salida.evaluacion_recursos');
                                                }}
                                            />
                                        </td>
                                        <td data-session-field="secuencia.salida.evaluacion_recursos" className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.salida.evaluacion_recursos}
                                                onChange={(val) => handleInputChange('secuencia.salida.evaluacion_recursos', val)}
                                            />
                                        </td>
                                        <td className="border border-black/20 text-center font-black bg-slate-50">{tiempoValues[5]}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                    

);

