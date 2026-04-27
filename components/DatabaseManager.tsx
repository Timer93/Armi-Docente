
import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { 
    getSystemHealth, 
    getAdminTables, 
    getAdminTableData, 
    deleteAdminRow, 
    updateAdminRow, 
    bulkImportTable,
    clearAdminTable
} from '../services/apiService';

// --- COMPONENTE TOAST MEJORADO ---
const Toast: React.FC<{ message: string; type: 'success' | 'error' | 'info'; onClose: () => void }> = ({ message, type, onClose }) => {
    useEffect(() => {
        if (type !== 'error') {
            const timer = setTimeout(onClose, 5000);
            return () => clearTimeout(timer);
        }
    }, [onClose, type]);

    const styles = {
        success: 'bg-emerald-600 text-white shadow-[0_15px_30px_rgba(16,185,129,0.3)]',
        error: 'bg-red-600 text-white shadow-[0_15px_30px_rgba(220,38,38,0.3)] ring-4 ring-red-100',
        info: 'bg-blue-600 text-white shadow-[0_15px_30px_rgba(37,99,235,0.3)]'
    };

    return (
        <div className={`
            fixed top-10 right-10 z-[99999] px-6 py-5 rounded-[2rem] flex items-center gap-4 border border-white/20 
            animate-fade-in backdrop-blur-xl ${styles[type]} min-w-[320px]
        `}>
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center text-xl shrink-0">
                {type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️'}
            </div>
            <div className="flex flex-col flex-1">
                <span className="text-[10px] font-black uppercase tracking-widest opacity-80">Mensaje del Sistema</span>
                <p className="text-xs font-bold leading-tight">{message}</p>
            </div>
            <button onClick={onClose} className="ml-2 w-8 h-8 rounded-full hover:bg-black/10 transition-colors">✕</button>
        </div>
    );
};

// --- COMPONENTE MODAL DE ACCIÓN CENTRADO ---
const ActionModal: React.FC<{
    title: string;
    message: string;
    details?: string;
    confirmLabel: string;
    icon: string;
    onConfirm: () => void;
    onCancel: () => void;
    isLoading?: boolean;
    variant?: 'blue' | 'red';
}> = ({ title, message, details, confirmLabel, icon, onConfirm, onCancel, isLoading, variant = 'blue' }) => {
    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-fade-in">
            <div className="bg-white w-full max-w-md rounded-[3rem] shadow-[0_40px_80px_-15px_rgba(0,0,0,0.35)] overflow-hidden border border-slate-100 relative transform scale-100 transition-transform">
                <div className={`h-2 w-full ${variant === 'blue' ? 'bg-blue-600' : 'bg-red-600'}`}></div>
                <div className="p-10 flex flex-col items-center text-center">
                    <div className={`w-24 h-24 rounded-[2.5rem] flex items-center justify-center text-5xl mb-8 shadow-inner border-2 ${variant === 'blue' ? 'bg-blue-50 border-blue-100' : 'bg-red-50 border-red-100'}`}>
                        {icon}
                    </div>
                    <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight leading-none mb-4">{title}</h3>
                    <p className="text-sm font-bold text-slate-500 leading-relaxed px-4">{message}</p>
                    {details && (
                        <div className="mt-6 px-4 py-2 bg-slate-50 rounded-2xl border border-slate-100">
                            <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{details}</span>
                        </div>
                    )}
                    
                    <div className="flex flex-col w-full gap-4 mt-10">
                        <button 
                            onClick={onConfirm} 
                            disabled={isLoading}
                            className={`btn-water w-full py-5 rounded-[2rem] text-white font-black text-[11px] uppercase tracking-[0.2em] shadow-xl disabled:opacity-50 h-[64px] ${variant === 'blue' ? 'bg-blue-600' : 'bg-red-600'}`}
                        >
                            {isLoading ? <div className="w-5 h-5 border-3 border-white/30 border-t-white rounded-full animate-spin mx-auto"></div> : confirmLabel}
                        </button>
                        <button 
                            onClick={onCancel} 
                            disabled={isLoading}
                            className="w-full py-2 text-slate-400 font-black text-[10px] uppercase tracking-widest hover:text-slate-600 transition-colors disabled:opacity-30"
                        >
                            Cancelar Operación
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const DatabaseManager: React.FC = () => {
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [tableData, setTableData] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  
  const [editingRowId, setEditingRowId] = useState<any>(null);
  const [editFormData, setEditFormData] = useState<any>(null);
  const [savingRow, setSavingRow] = useState(false);
  
  const [toasts, setToasts] = useState<{id: number, msg: string, type: 'success' | 'error' | 'info'}[]>([]);
  const [confirmModal, setConfirmModal] = useState<{show: boolean, type: 'import' | 'clear', data?: any, count?: number} | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const addToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
      setToasts(prev => [...prev, { id: Date.now() + Math.random(), msg, type }]);
  };

  const loadSystemInfo = async () => {
    setLoading(true);
    try {
        const healthData = await getSystemHealth().catch(() => ({ success: false, status: 'offline' }));
        setHealth(healthData);
        const { tables: tableList, isDemo: demoActive } = await getAdminTables();
        setTables(tableList);
        setIsDemo(demoActive);
        if (tableList.length > 0 && !selectedTable) setSelectedTable(tableList[0]);
    } catch (e) { addToast("Error de conexión SQL", "error"); } 
    finally { setLoading(false); }
  };

  useEffect(() => { loadSystemInfo(); }, []);

  useEffect(() => {
    if (selectedTable) { 
        fetchTableData(selectedTable); 
        setColumnFilters({});
        setEditingRowId(null);
    }
  }, [selectedTable]);

  const fetchTableData = async (name: string) => {
    if (isDemo) return;
    setDataLoading(true);
    try {
        const data = await getAdminTableData(name);
        setTableData(data);
    } catch (e) { addToast(`Error al leer ${name}`, "error"); } 
    finally { setDataLoading(false); }
  };

  const handleFileSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !selectedTable) return;
      const reader = new FileReader();
      reader.onload = async (evt) => {
          try {
              const bstr = evt.target?.result;
              const wb = XLSX.read(bstr, { type: 'binary' });
              const ws = wb.Sheets[wb.SheetNames[0]];
              const data = XLSX.utils.sheet_to_json(ws);
              if (data.length > 0) setConfirmModal({ show: true, type: 'import', data: data, count: data.length });
              else addToast("El Excel está vacío", "info");
          } catch (err: any) { addToast("Error al procesar Excel", "error"); }
      };
      reader.readAsBinaryString(file);
  };

  const handleExportExcel = () => {
      if (tableData.length === 0) {
          addToast("No hay datos para exportar", "info");
          return;
      }
      try {
          const ws = XLSX.utils.json_to_sheet(tableData);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, selectedTable.substring(0, 31));
          XLSX.writeFile(wb, `ARMI_${selectedTable.toUpperCase()}_${new Date().getTime()}.xlsx`);
          addToast("Tabla exportada correctamente", "success");
      } catch (err) {
          addToast("Error al exportar a Excel", "error");
      }
  };

  const executeImport = async () => {
      if (!confirmModal?.data || !selectedTable) return;
      setIsProcessing(true);
      try {
          const res = await bulkImportTable(selectedTable, confirmModal.data);
          if (res.success) {
              addToast(res.message || "Sincronización completada", "success");
              fetchTableData(selectedTable);
              setConfirmModal(null);
          } else addToast(res.message || "Fallo en la importación", "error");
      } catch (e) { addToast("Error de comunicación", "error"); }
      finally { setIsProcessing(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const executeClear = async () => {
      setIsProcessing(true);
      try {
          const res = await clearAdminTable(selectedTable);
          if (res.success) {
              addToast("Tabla vaciada correctamente", "success");
              fetchTableData(selectedTable);
              setConfirmModal(null);
          } else addToast("Error al limpiar tabla", "error");
      } catch (e) { addToast("Error de conexión", "error"); }
      finally { setIsProcessing(false); }
  };

  const startEditing = (row: any) => {
      const id = row.id || row.id_programa;
      setEditingRowId(id);
      setEditFormData({ ...row });
  };

  const saveEdit = async () => {
      if (!editFormData || isDemo) return;
      setSavingRow(true);
      try {
          const res = await updateAdminRow(selectedTable, editingRowId, editFormData);
          if (res.success) {
              addToast("Cambios guardados", "success");
              setEditingRowId(null);
              fetchTableData(selectedTable);
          } else addToast(res.message || "Fallo al guardar", "error");
      } catch (e) { addToast("Error de red", "error"); } 
      finally { setSavingRow(false); }
  };

  const handleDeleteRow = async (id: any) => {
      if (confirm(`¿Eliminar permanentemente este registro?`)) {
          const success = await deleteAdminRow(selectedTable, id);
          if (success) { addToast("Registro borrado", "success"); fetchTableData(selectedTable); }
          else addToast("No se pudo borrar", "error");
      }
  };

  const filteredData = tableData.filter(row => {
    return Object.entries(columnFilters).every(([col, val]) => {
        if (!val) return true;
        return String(row[col] || '').toLowerCase().includes(String(val).toLowerCase());
    });
  });

  const displayColumns = tableData.length > 0 
    ? Object.keys(tableData[0]).filter(k => k !== 'updated_at') 
    : [];

  return (
    <div className="animate-fade-in space-y-6 pb-20 relative">
        <div className="fixed top-0 right-0 flex flex-col gap-4 p-10 pointer-events-none z-[99999]">
            {toasts.map(t => (
                <div key={t.id} className="pointer-events-auto">
                    <Toast message={t.msg} type={t.type} onClose={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />
                </div>
            ))}
        </div>

        {confirmModal?.show && confirmModal.type === 'import' && (
            <ActionModal title="Confirmar Importación" message={`Se han detectado datos válidos. ¿Sincronizar con "${selectedTable}"?`} details={`Lote detectado: ${confirmModal.count} registros`} confirmLabel="Sincronizar Lote" icon="📦" isLoading={isProcessing} onConfirm={executeImport} onCancel={() => setConfirmModal(null)} />
        )}

        {confirmModal?.show && confirmModal.type === 'clear' && (
            <ActionModal title="Vaciar Tabla" message={`⚠️ Estás a punto de ELIMINAR TODO de "${selectedTable}".`} confirmLabel="Confirmar Borrado" icon="🗑️" variant="red" isLoading={isProcessing} onConfirm={executeClear} onCancel={() => setConfirmModal(null)} />
        )}

        <div className="bg-slate-900 text-white p-8 rounded-[3rem] shadow-2xl border border-slate-800 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-indigo-600"></div>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative z-10">
                <div className="flex items-center gap-4">
                    <div className="bg-white/10 p-4 rounded-3xl border border-white/20 shadow-inner text-3xl">⚙️</div>
                    <div>
                        <h2 className="text-3xl font-black tracking-tight uppercase leading-none">SQL Console v5.0</h2>
                        <div className="flex items-center gap-2 mt-2">
                             <div className={`w-2 h-2 rounded-full ${health?.success ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></div>
                             <p className="text-blue-400 text-[9px] font-black uppercase tracking-[0.3em]">{health?.success ? 'Sistema Online' : 'Fallo de Conexión'}</p>
                        </div>
                    </div>
                </div>
                <button onClick={loadSystemInfo} className="btn-water water-white w-14 h-14 flex items-center justify-center text-xl transition-transform hover:rotate-180 duration-700">🔄</button>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-1 bg-white p-6 rounded-[2.5rem] shadow-lg border border-slate-200 h-fit">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 pl-2">Origen de Datos</h3>
                <div className="space-y-2 max-h-[550px] overflow-y-auto custom-scrollbar pr-2">
                    {loading ? <div className="flex justify-center p-10"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div></div> : tables.map(t => (
                        <button key={t} onClick={() => setSelectedTable(t)} className={`w-full text-left px-5 py-4 rounded-2xl text-[11px] font-black transition-all flex items-center justify-between group ${selectedTable === t ? 'bg-blue-600 text-white shadow-lg translate-x-2' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
                            <span className="truncate">{t.replace(/_/g, ' ').toUpperCase()}</span>
                            {selectedTable === t && <span className="text-[10px] animate-pulse">▶</span>}
                        </button>
                    ))}
                </div>
            </div>

            <div className="lg:col-span-3">
                <div className="bg-white rounded-[3rem] shadow-xl border border-slate-200 overflow-hidden flex flex-col min-h-[650px]">
                    {selectedTable ? (
                        <>
                            <div className="bg-slate-50 p-6 border-b border-slate-200 flex flex-col md:flex-row justify-between items-center gap-4">
                                <div className="flex flex-col">
                                    <h4 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">{selectedTable.replace(/_/g, ' ')}</h4>
                                    <span className="text-[10px] font-bold text-blue-600 uppercase mt-1 tracking-widest">{filteredData.length} registros cargados</span>
                                </div>
                                <div className="flex gap-3">
                                    <button onClick={handleExportExcel} disabled={dataLoading || tableData.length === 0} className="btn-water water-white px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase flex items-center gap-2">🟢 Exportar Excel</button>
                                    <button onClick={() => fileInputRef.current?.click()} disabled={isProcessing || isDemo} className="btn-water water-blue px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase flex items-center gap-2">📥 Importar Excel</button>
                                    <button onClick={() => setConfirmModal({show: true, type: 'clear'})} disabled={isDemo} className="btn-water water-red px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase flex items-center gap-2">🗑️ Limpiar</button>
                                    <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleFileSelection} />
                                </div>
                            </div>

                            <div className="flex-1 overflow-auto custom-scrollbar">
                                {dataLoading ? <div className="h-64 flex flex-col items-center justify-center gap-4 text-slate-300"><div className="w-12 h-12 border-[6px] border-blue-600 border-t-transparent rounded-full animate-spin"></div><p className="font-black uppercase tracking-[0.3em] text-[10px]">Consultando SQL...</p></div> : tableData.length === 0 ? <div className="p-24 text-center text-slate-300 flex flex-col items-center gap-6"><div className="w-28 h-28 rounded-[2.5rem] bg-slate-50 flex items-center justify-center text-6xl opacity-20 border-4 border-dashed border-slate-200">📂</div><p className="font-black uppercase tracking-[0.2em] text-xs">Tabla vacía</p></div> : (
                                    <table className="w-full text-left border-separate border-spacing-0 table-fixed min-w-[1500px]">
                                        <thead className="bg-slate-800 text-white sticky top-0 z-20 shadow-md">
                                            <tr className="divide-x divide-white/10">
                                                <th className="p-4 w-24 text-center bg-slate-900 border-b border-white/10">Acción</th>
                                                {displayColumns.map((col, idx) => {
                                                    const isId = col === 'id' || col === 'id_programa' || idx === 0;
                                                    return (
                                                        <th key={col} className={`p-4 border-b border-white/10 ${isId ? 'w-20 text-center' : 'min-w-[180px]'}`}>
                                                            <div className="flex flex-col gap-2">
                                                                <span className="uppercase font-black text-[9px] tracking-widest truncate">{col.replace(/_/g, ' ')}</span>
                                                                <input type="text" placeholder="..." value={columnFilters[col] || ''} onChange={e => setColumnFilters({...columnFilters, [col]: e.target.value})} className="w-full bg-slate-700/50 border border-slate-600 rounded-xl px-2 py-1.5 text-[9px] font-bold text-white outline-none focus:border-blue-400 text-center" />
                                                            </div>
                                                        </th>
                                                    );
                                                })}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 bg-white">
                                            {filteredData.map((row, rIdx) => {
                                                const id = row.id || row.id_programa;
                                                const isEditing = editingRowId === id;
                                                return (
                                                    <tr key={rIdx} className={`hover:bg-blue-50/20 transition-colors group ${isEditing ? 'bg-amber-50 ring-2 ring-amber-300 z-10' : ''}`}>
                                                        <td className="p-2 text-center border-r border-slate-100 sticky left-0 bg-inherit z-10">
                                                            {isEditing ? (
                                                                <div className="flex justify-center gap-2">
                                                                    <button onClick={saveEdit} disabled={savingRow} className="w-10 h-10 bg-emerald-500 text-white rounded-2xl flex items-center justify-center shadow-lg hover:scale-110 disabled:opacity-50">✔️</button>
                                                                    <button onClick={() => setEditingRowId(null)} className="w-10 h-10 bg-slate-200 text-slate-600 rounded-2xl flex items-center justify-center hover:scale-110">✕</button>
                                                                </div>
                                                            ) : (
                                                                <div className="flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <button onClick={() => startEditing(row)} className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all">✏️</button>
                                                                    <button onClick={() => handleDeleteRow(id)} className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center hover:bg-rose-600 hover:text-white transition-all">🗑️</button>
                                                                </div>
                                                            )}
                                                        </td>
                                                        {displayColumns.map((col, idx) => {
                                                            const isId = col === 'id' || col === 'id_programa' || idx === 0;
                                                            return (
                                                                <td key={col} className={`p-4 text-[11px] border-r border-slate-50 ${isId ? 'font-mono text-center opacity-40 text-[10px]' : 'text-slate-600 font-medium group-hover:whitespace-normal truncate'}`}>
                                                                    {isEditing && !isId ? (
                                                                        <input className="w-full bg-white border-2 border-amber-300 rounded-xl px-3 py-2 text-[11px] font-black text-slate-800 shadow-inner outline-none" value={editFormData[col] || ''} onChange={e => setEditFormData({...editFormData, [col]: e.target.value})} />
                                                                    ) : (
                                                                        String(row[col] || '-')
                                                                    )}
                                                                </td>
                                                            );
                                                        })}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-300 gap-6 p-20">
                            <div className="w-32 h-32 rounded-[3rem] bg-slate-50 flex items-center justify-center text-7xl opacity-20 border-4 border-dashed border-slate-200 animate-pulse">🏛️</div>
                            <div className="text-center">
                                <p className="font-black uppercase tracking-[0.25em] text-sm text-slate-400">Seleccione un origen de datos</p>
                                <p className="text-[10px] font-bold opacity-50 mt-2 max-w-xs mx-auto">Elija una tabla para gestionar la información persistente.</p>
                            </div>
                        </div>
                    )}
                    
                    <div className="bg-slate-800 p-5 border-t border-slate-700 text-[10px] font-black text-slate-400 uppercase tracking-widest flex justify-between items-center shadow-inner">
                        <div className="flex items-center gap-4">
                            <span className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${health?.success ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-red-500'}`}></span> {health?.success ? 'SQL Conectado' : 'Sin Conexión'}</span>
                            <span className="text-slate-600">|</span>
                            <span>Build 2025.04.R1</span>
                        </div>
                        <span className="opacity-50 text-[9px]">ARMI DOCENTE © TERMINAL DE ADMINISTRACIÓN DE DATOS</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
};
