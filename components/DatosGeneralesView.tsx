
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GeneralData } from '../types';
import { INITIAL_GENERAL_DATA } from '../constants';
import { 
    saveDatosGenerales, 
    getDatosGenerales, 
    getDepartamentos, 
    getProvincias, 
    getDistritos, 
    getColegios,
    SchoolResult 
} from '../services/apiService';
import { Input } from './Input';
import { Select } from './Select';
import { TextArea } from './TextArea';
import { readImageFileAsDataUrl } from '../utils/imageStorage';
import { broadcastGeneralImagesUpdate } from '../utils/generalImageHelpers';
import { saveImageAssetFile } from '../services/apiService';

interface Props {
  onSuccess: () => void;
  activeSection: string;
}

const JORNADAS = [
  { value: 'JEC', label: 'JEC' },
  { value: 'JER', label: 'JER' },
];

const getWorkingDaysDuration = (startStr?: string, endStr?: string): string => {
  if (!startStr || !endStr) return "-";
  const [sYear, sMonth, sDay] = startStr.split('-').map(Number);
  const [eYear, eMonth, eDay] = endStr.split('-').map(Number);
  const start = new Date(sYear, sMonth - 1, sDay);
  const end = new Date(eYear, eMonth - 1, eDay);
  if (start > end) return "Error";
  let workingDays = 0;
  let currentDate = new Date(start);
  while (currentDate <= end) {
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) workingDays++;
    currentDate.setDate(currentDate.getDate() + 1);
  }
  const weeks = Math.floor(workingDays / 5);
  const days = workingDays % 5;
  return `${weeks} sem. y ${days} d.`;
};

const addThreeDays = (dateStr: string): string => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + 3);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const CustomDatePicker: React.FC<{
    name: string;
    value: string;
    onChange: (name: string, value: string) => void;
    disabled?: boolean;
    holidays?: { date: string, name: string }[];
    tone?: 'blue' | 'teal';
}> = ({ name, value, onChange, disabled, holidays = [], tone = 'blue' }) => {
    const [show, setShow] = useState(false);
    const [showMonthGrid, setShowMonthGrid] = useState(false);
    const [openUpwards, setOpenUpwards] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const [viewDate, setViewDate] = useState(() => {
        if (value) {
            const [y, m, d] = value.split('-').map(Number);
            return new Date(y, m - 1, 1);
        }
        return new Date();
    });

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setShow(false);
                setShowMonthGrid(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (show && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            setOpenUpwards(spaceBelow < 300);
        }
    }, [show]);

    const displayDate = (val: string) => {
        if (!val) return 'dd/mm/aa';
        const [y, m, d] = val.split('-');
        return `${d}/${m}/${y.substring(2)}`;
    };
    const toneClasses = tone === 'teal'
        ? {
            hoverBorder: 'hover:border-teal-400',
            hoverBg: 'hover:bg-teal-50/30',
            value: 'text-teal-700',
            icon: 'text-teal-500'
        }
        : {
            hoverBorder: 'hover:border-blue-400',
            hoverBg: 'hover:bg-blue-50/30',
            value: 'text-blue-700',
            icon: 'text-blue-500'
        };

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const currentMonth = viewDate.getMonth();
    const currentYear = viewDate.getFullYear();
    const getDaysInMonth = (month: number, year: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDay = (month: number, year: number) => {
        let d = new Date(year, month, 1).getDay();
        return d === 0 ? 6 : d - 1; 
    };
    const days = [];
    const prevDaysCount = getFirstDay(currentMonth, currentYear);
    const totalDays = getDaysInMonth(currentMonth, currentYear);
    for (let i = 0; i < prevDaysCount; i++) days.push(null);
    for (let d = 1; d <= totalDays; d++) days.push(new Date(currentYear, currentMonth, d));
    const handleSelect = (date: Date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        onChange(name, `${y}-${m}-${d}`);
        setShow(false);
    };
    const handleMonthSelect = (mIdx: number) => { setViewDate(new Date(currentYear, mIdx, 1)); setShowMonthGrid(false); };
    return (
        <div className="relative w-full" ref={containerRef}>
            <div onClick={() => !disabled && setShow(!show)} className={`flex items-center justify-between bg-white border border-slate-200 rounded-xl px-2 py-2 cursor-pointer transition-all shadow-sm ${disabled ? 'opacity-50 cursor-not-allowed bg-slate-50' : `${toneClasses.hoverBorder} ${toneClasses.hoverBg}`}`}>
                <span className={`text-[11px] font-mono font-bold ${value ? toneClasses.value : 'text-slate-400'}`}>{displayDate(value)}</span>
                <span className={`${toneClasses.icon} text-[10px] shrink-0 ml-1`}>📅</span>
            </div>
            {show && (
                <div className={`absolute z-[250] bg-white border border-slate-200 shadow-2xl rounded-2xl p-3 w-64 animate-fade-in ring-4 ring-black/5 ${openUpwards ? 'bottom-full mb-2' : 'top-full mt-2'}`}>
                    <div className="flex justify-between items-center mb-3">
                        <button type="button" onClick={(e) => { e.stopPropagation(); setViewDate(new Date(currentYear, currentMonth - 1, 1)); }} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-800 font-bold transition-colors">‹</button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setShowMonthGrid(!showMonthGrid); }} className="text-[10px] font-black uppercase text-slate-700 tracking-wider hover:bg-blue-50 px-3 py-1 rounded-lg transition-colors flex items-center gap-1">{monthNames[currentMonth]} {currentYear} <span className="text-[8px] opacity-40">{showMonthGrid ? '▲' : '▼'}</span></button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setViewDate(new Date(currentYear, currentMonth + 1, 1)); }} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-800 font-bold transition-colors">›</button>
                    </div>
                    {showMonthGrid ? (
                        <div className="grid grid-cols-3 gap-2 animate-fade-in p-1">
                            {monthNames.map((m, idx) => (<button key={m} type="button" onClick={() => handleMonthSelect(idx)} className={`py-2 rounded-lg text-[9px] font-black uppercase tracking-tighter transition-all ${idx === currentMonth ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-50 text-slate-500 hover:bg-blue-50 hover:text-blue-600'}`}>{m.substring(0, 3)}</button>))}
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-7 gap-1 text-[10px] text-center mb-1">{['L','M','M','J','V','S','D'].map((d, i) => (<div key={i} className={`font-bold py-1 ${i >= 5 ? 'text-red-500 bg-red-50 rounded' : 'text-slate-400'}`}>{d}</div>))}</div>
                            <div className="grid grid-cols-7 gap-1">
                                {days.map((date, i) => {
                                    if (!date) return <div key={i}></div>;
                                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                                    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                                    const holidayInfo = holidays.find(h => h.date === iso);
                                    const isSelected = value === iso;
                                    return (<button key={i} type="button" onClick={() => handleSelect(date)} title={holidayInfo?.name} className={`h-8 rounded-lg flex flex-col items-center justify-center transition-all relative ${isSelected ? 'bg-blue-600 text-white font-bold scale-110 shadow-md z-10' : 'hover:bg-blue-50 text-slate-700'} ${isWeekend && !isSelected ? 'text-red-500 bg-red-50/50' : ''}`}><span className="text-[10px]">{date.getDate()}</span>{holidayInfo && <span className="absolute bottom-1 w-1 h-1 rounded-full bg-amber-500 shadow-sm"></span>}</button>);
                                })}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

const ImageUploader: React.FC<{
    label: string;
    imageSrc?: string;
    onImageChange: (base64: string) => void;
    onRemove: () => void;
    placeholderIcon: string;
}> = ({ label, imageSrc, onImageChange, onRemove, placeholderIcon }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            void readImageFileAsDataUrl(file).then(onImageChange);
        }
    };
    return (
        <div className="flex flex-col items-center gap-3">
            <div className={`w-28 h-28 rounded-full border-4 border-dashed flex items-center justify-center relative overflow-hidden group transition-all shadow-sm ${imageSrc ? 'border-blue-400 bg-white' : 'border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer hover:border-blue-300'}`} onClick={() => !imageSrc && inputRef.current?.click()}>
                {imageSrc ? (
                    <>
                        <img src={imageSrc} alt={label} className="w-full h-full object-cover" />
                        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white font-bold text-xs"><span className="text-xl mb-1">🗑️</span>Eliminar</button>
                    </>
                ) : (
                    <div className="text-center p-2 flex flex-col items-center"><div className="text-2xl mb-1 opacity-50 grayscale">{placeholderIcon}</div><span className="text-[9px] text-slate-400 block leading-tight font-black uppercase">Subir</span></div>
                )}
                <input type="file" ref={inputRef} className="hidden" accept="image/*" onChange={handleFile} />
            </div>
            <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">{label}</span>
        </div>
    );
};

const CardSection: React.FC<{
    label: string; 
    icon: string; 
    color: string; 
    highlight?: boolean; 
    children: React.ReactNode;
}> = ({ label, icon, color, highlight, children }) => (
    <div className={`relative overflow-hidden rounded-3xl border transition-all duration-300 group ${highlight ? 'bg-gradient-to-br from-blue-50 to-white border-blue-300 shadow-md hover:shadow-lg' : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'}`}>
        {highlight && <div className="absolute top-0 left-0 w-2 h-full bg-blue-500"></div>}
        <div className="p-5 flex gap-5">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-inner shrink-0 ${color}`}>{icon}</div>
            <div className="flex-1">
                <label className={`block text-xs font-black uppercase tracking-widest mb-3 ${highlight ? 'text-blue-700' : 'text-slate-500'}`}>{label}</label>
                {children}
            </div>
        </div>
    </div>
);

export const DatosGeneralesView: React.FC<Props> = ({ onSuccess, activeSection }) => {
  const [formData, setFormData] = useState<GeneralData>(INITIAL_GENERAL_DATA);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string; subtext?: string } | null>(null);
  const [serverConnected, setServerConnected] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [allHolidays, setAllHolidays] = useState<{date: string, name: string}[]>([]);
  const [dptosList, setDptosList] = useState<string[]>([]);
  const [provsList, setProvsList] = useState<string[]>([]);
  const [distsList, setDistsList] = useState<string[]>([]);
  const [schoolsList, setSchoolsList] = useState<SchoolResult[]>([]);
  const latestFormDataRef = useRef<GeneralData>(INITIAL_GENERAL_DATA);
  const lastSavedPayloadRef = useRef('');
  const autosaveTimerRef = useRef<number | null>(null);
  const uploadedImageSignatureRef = useRef({ insignia: '', logo: '' });

  const loadData = useCallback(async (isRetry = false) => {
      if (isRetry) setRetrying(true);
      try {
        const data = await getDatosGenerales();
        const defaultLevel = data.level || 'Secundaria';
        const nextData = { ...INITIAL_GENERAL_DATA, ...data, level: defaultLevel };
        setFormData(nextData);
        latestFormDataRef.current = nextData;
        lastSavedPayloadRef.current = JSON.stringify(nextData);
        uploadedImageSignatureRef.current = {
            insignia: nextData.insignia || '',
            logo: nextData.logo || '',
        };
        setIsDirty(false);
        setLastSavedAt(data.updated_at || new Date().toISOString());
        const savedHolidays = localStorage.getItem('armi_holidays');
        if (savedHolidays) {
            try {
                const parsedHolidays = JSON.parse(savedHolidays);
                setAllHolidays(Array.isArray(parsedHolidays) ? parsedHolidays : []);
            } catch {
                localStorage.removeItem('armi_holidays');
                setAllHolidays([]);
            }
        }
        try {
            const dptos = await getDepartamentos();
            setDptosList(dptos);
            setServerConnected(true);
            if (data.department) {
                const provs = await getProvincias(data.department); setProvsList(provs);
                if (data.province) {
                    const dists = await getDistritos(data.department, data.province); setDistsList(dists);
                }
            }
        } catch (e: any) { setServerConnected(false); }
      } catch (err: any) { console.error(err); } finally { setLoading(false); setRetrying(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (message) { const timer = setTimeout(() => setMessage(null), 5000); return () => clearTimeout(timer); } }, [message]);
  useEffect(() => { latestFormDataRef.current = formData; }, [formData]);

  useEffect(() => {
    const fetchSchools = async () => {
        if (formData.department && formData.province && formData.district) {
            const res = await getColegios(formData.department, formData.province, formData.district, formData.level);
            setSchoolsList(res);
        } else { setSchoolsList([]); }
    };
    fetchSchools();
  }, [formData.department, formData.province, formData.district, formData.level]);

  const handleDepartmentChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      setFormData(prev => ({ ...prev, department: val, region: val, province: '', district: '', ugel: '', institution: '' }));
      setIsDirty(true); setProvsList([]); setDistsList([]);
      if (val) { const res = await getProvincias(val); setProvsList(res); }
  };
  const handleProvinceChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      setFormData(prev => ({ ...prev, province: val, district: '', ugel: '', institution: '' }));
      setIsDirty(true); setDistsList([]);
      if (val && formData.department) { const res = await getDistritos(formData.department, val); setDistsList(res); }
  };
  const handleDistrictChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      setFormData(prev => ({ ...prev, district: val, ugel: '', institution: '' }));
      setIsDirty(true);
  };
  const handleInstitutionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      const found = schoolsList.find(s => s.nombre_ie === val);
      setFormData(prev => ({ ...prev, institution: val, ugel: found ? found.d_dreugel : prev.ugel }));
      setIsDirty(true);
  };
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setIsDirty(true);
  };
  const handleCustomDateChange = (name: string, value: string) => {
    setFormData((prev) => {
        const newData = { ...prev, [name]: value };
        if (name === 'b1_start') newData.u1_start = value;
        if (name === 'b2_start') newData.u3_start = value;
        if (name === 'b3_start') newData.u5_start = value;
        if (name === 'b4_start') newData.u7_start = value;
        if (name === 'vac_start') newData.u_vac_start = value;
        
        if (name === 'b1_end') newData.u2_end = value;
        if (name === 'b2_end') newData.u4_end = value;
        if (name === 'b3_end') newData.u6_end = value;
        if (name === 'b4_end') newData.u8_end = value;
        if (name === 'vac_end') newData.u_vac_end = value;
        
        if (name === 'u1_end') newData.u2_start = addThreeDays(value);
        if (name === 'u3_end') newData.u4_start = addThreeDays(value);
        if (name === 'u5_end') newData.u6_start = addThreeDays(value);
        if (name === 'u7_end') newData.u8_start = addThreeDays(value);
        return newData;
    });
    setIsDirty(true);
  };
  const persistGeneralData = useCallback(async (dataToSave: GeneralData, options?: { silent?: boolean }) => {
    const payloadKey = JSON.stringify(dataToSave);
    if (payloadKey === lastSavedPayloadRef.current) {
        setIsDirty(false);
        return true;
    }

    setSaving(true);
    if (!options?.silent) setMessage(null);
    try {
      const result = await saveDatosGenerales(dataToSave);
      if (result.success) {
        broadcastGeneralImagesUpdate({
          insignia: dataToSave.insignia,
          logo: dataToSave.logo,
        });

        if (dataToSave.insignia && uploadedImageSignatureRef.current.insignia !== dataToSave.insignia) {
          uploadedImageSignatureRef.current.insignia = dataToSave.insignia;
          void saveImageAssetFile({ imageData: dataToSave.insignia, kind: 'general_insignia' });
        }
        if (!dataToSave.insignia) {
          uploadedImageSignatureRef.current.insignia = '';
        }

        if (dataToSave.logo && uploadedImageSignatureRef.current.logo !== dataToSave.logo) {
          uploadedImageSignatureRef.current.logo = dataToSave.logo;
          void saveImageAssetFile({ imageData: dataToSave.logo, kind: 'general_logo' });
        }
        if (!dataToSave.logo) {
          uploadedImageSignatureRef.current.logo = '';
        }

        lastSavedPayloadRef.current = payloadKey;
        setLastSavedAt(new Date().toISOString());
        setServerConnected(true);
        if (JSON.stringify(latestFormDataRef.current) === payloadKey) {
          setIsDirty(false);
        }
        if (!options?.silent) {
          setMessage({ type: 'success', text: '¡Éxito!', subtext: 'Los datos se han guardado correctamente en SQL.' });
        }
        onSuccess();
        return true;
      }

      setMessage({ type: 'error', text: 'Error al Guardar', subtext: result.message });
      return false;
    } catch (error: any) {
      setServerConnected(false);
      setMessage({ type: 'error', text: 'Fallo de Conexión', subtext: 'No se pudo contactar con el backend SQL.' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [onSuccess]);

  useEffect(() => {
    if (loading || !isDirty) return;
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void persistGeneralData(latestFormDataRef.current, { silent: true });
    }, 900);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [formData, isDirty, loading, persistGeneralData]);

  if (loading) return (<div className="flex flex-col justify-center items-center h-96 text-slate-400 gap-4"><div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div><p className="font-black uppercase tracking-widest text-[10px]">Cargando base de datos SQL...</p></div>);

  const thBase = "text-white px-2 py-3 text-center text-[10px] font-black uppercase tracking-widest border-r border-white/10";
  const cellBase = "p-1.5 border-b border-r border-slate-200";
  const ROMANS = ["", "I", "II", "III", "IV"];

  const renderSection = () => {
      switch (activeSection) {
        case 'institucion':
            return (
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 animate-fade-in relative">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-8 border-b pb-4 flex justify-between items-center">
                        <div className="flex items-center gap-3"><span className="p-2 bg-blue-50 rounded-xl text-blue-600">🏫</span><span>Configuración de la Institución</span>{serverConnected ? (<span className="text-emerald-500 bg-emerald-50 px-2 py-0.5 rounded text-[8px] border border-emerald-200 font-black">● SQL Server Activo</span>) : (<span className="text-amber-500 bg-emerald-50 px-2 py-0.5 rounded text-[8px] border border-amber-200 animate-pulse font-black">● Sesión Local</span>)}</div>
                        <button type="button" onClick={() => loadData(true)} disabled={retrying} className={`px-4 py-2 rounded-full text-[9px] font-black transition-all flex items-center gap-2 border ${retrying ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-600 hover:bg-slate-200 border-slate-200 shadow-sm uppercase'}`}><span className={retrying ? "animate-spin" : ""}>{retrying ? '⏳' : '🔄'}</span>{retrying ? 'Sincronizando...' : 'Recargar DB'}</button>
                    </h3>
                    <div className="flex flex-col lg:flex-row gap-10">
                        <div className="flex lg:flex-col justify-center items-center gap-10 bg-slate-50/50 p-8 rounded-[3rem] border border-slate-100 shadow-inner h-fit">
                            <div className="flex flex-col items-center">
                                <div className="mb-3 px-6 py-1.5 rounded-full bg-slate-800 text-white text-[9px] font-black uppercase tracking-[0.2em] shadow-md select-none border border-slate-700">
                                    Nivel {formData.level || 'Secundaria'}
                                </div>
                                <ImageUploader label="Insignia I.E." imageSrc={formData.insignia} placeholderIcon="🛡️" onImageChange={(val) => { setFormData({...formData, insignia: val}); setIsDirty(true); }} onRemove={() => { setFormData({...formData, insignia: ''}); setIsDirty(true); }} />
                            </div>
                            <div className="hidden lg:block w-8 h-px bg-slate-200"></div>
                            <ImageUploader label="Logo UGEL" imageSrc={formData.logo} placeholderIcon="🏛️" onImageChange={(val) => { setFormData({...formData, logo: val}); setIsDirty(true); }} onRemove={() => { setFormData({...formData, logo: ''}); setIsDirty(true); }} />
                        </div>
                        <div className="flex-1 space-y-8">
                            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-6">
                                <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-2 mb-2"><span className="w-1.5 h-3 bg-blue-500 rounded-full"></span> 1. Ubicación Geográfica</h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                                    <Select label="Departamento" name="department" value={formData.department} onChange={handleDepartmentChange} options={dptosList.map(d => ({ value: d, label: d }))} icon="🗺️" searchable={true} />
                                    <Select label="Provincia" name="province" value={formData.province} onChange={handleProvinceChange} options={provsList.map(p => ({ value: p, label: p }))} disabled={!formData.department} icon="📍" searchable={true} />
                                    <Select label="Distrito" name="district" value={formData.district} onChange={handleDistrictChange} options={distsList.map(d => ({ value: d, label: d }))} disabled={!formData.province} icon="🏘️" searchable={true} />
                                </div>
                            </div>
                            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-6">
                                <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-2 mb-2"><span className="w-1.5 h-3 bg-blue-500 rounded-full"></span> 2. Identificación de la I.E.</h4>
                                <div className="grid grid-cols-12 gap-6 items-start">
                                    <div className="col-span-12 md:col-span-12"><Select label="Institución Educativa" name="institution" value={formData.institution} onChange={handleInstitutionChange} options={schoolsList.map(s => ({ value: s.nombre_ie, label: `${s.nombre_ie} (${s.cod_mod})` }))} disabled={!formData.district} icon="🏫" searchable={true} /></div>
                                    <div className="col-span-12 md:col-span-12"><Input label="Lugar de la I.E." name="lugar" value={formData.lugar || ''} onChange={handleChange} placeholder="Ingrese lugar específico..." icon="📍" /></div>
                                    <div className="col-span-12 md:col-span-4"><Select label="JORNADA" name="school_shift" value={formData.school_shift} onChange={handleChange} options={JORNADAS} icon="⏰" /></div>
                                    <div className="col-span-12 md:col-span-8"><Input label="LEMA" name="motto" value={formData.motto} onChange={handleChange} placeholder="Ej: Dios, Patria y Honor" icon="📜" /></div>
                                    <div className="col-span-12 md:col-span-12"><Input label="NOMBRE DEL AÑO" name="year_name" value={formData.year_name || ''} onChange={handleChange} placeholder="Ej: Año de la recuperación y consolidación de la economía peruana" icon="📅" /></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            );
        case 'responsables':
            return (
                <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 animate-fade-in">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-8 border-b pb-2">👥 Equipo Responsable</h3>
                    <div className="space-y-6 max-w-5xl mx-auto">
                        <div className="mb-8"><CardSection label="Docente de Área (Usuario)" icon="👨‍🏫" color="bg-blue-100 text-blue-600" highlight={true}><input type="text" name="teacher" value={formData.teacher} onChange={handleChange} placeholder="Ingrese nombres y apellidos" className="w-full bg-transparent border-b border-blue-200 outline-none text-sm font-bold py-2 focus:border-blue-500 transition-colors text-slate-800" /></CardSection></div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <CardSection label="Director(a) de la I.E." icon="👨‍💼" color="bg-slate-100 text-slate-600"><input type="text" name="director" value={formData.director} onChange={handleChange} placeholder="Nombre del Director" className="w-full bg-transparent border-b border-slate-200 outline-none text-sm font-medium py-2 focus:border-slate-500 transition-colors" /></CardSection>
                            <CardSection label="Subdirector(a)" icon="📋" color="bg-slate-100 text-slate-600"><input type="text" name="subdirector" value={formData.subdirector} onChange={handleChange} placeholder="Nombre del Subdirector" className="w-full bg-transparent border-b border-slate-200 outline-none text-sm font-medium py-2 focus:border-slate-500 transition-colors" /></CardSection>
                            <CardSection label="Coord. Pedagógico" icon="📚" color="bg-orange-100 text-orange-600"><input type="text" name="pedagogical_coordinator" value={formData.pedagogical_coordinator} onChange={handleChange} placeholder="Nombre del Coordinador" className="w-full bg-transparent border-b border-orange-200 outline-none text-sm font-medium py-2 focus:border-orange-500 transition-colors" /></CardSection>
                            <CardSection label="Coord. de Tutoría (TOE)" icon="🤝" color="bg-emerald-100 text-emerald-600"><input type="text" name="toe_coordinator" value={formData.toe_coordinator} onChange={handleChange} placeholder="Nombre del Coordinador TOE" className="w-full bg-transparent border-b border-emerald-200 outline-none text-sm font-medium py-2 focus:border-emerald-500 transition-colors" /></CardSection>
                        </div>
                    </div>
                </div>
            );
        case 'contexto':
            return (
                <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 animate-fade-in">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-8 border-b pb-2">🌍 Contexto Educativo</h3>
                    <div className="max-w-5xl mx-auto py-4"><CardSection label="Descripción del Entorno y Contexto Pedagógico" icon="📝" color="bg-blue-100 text-blue-600" highlight={true}><TextArea label="" name="context_description" value={formData.context_description} onChange={handleChange} placeholder="Describa el entorno..." rows={14} className="bg-white/80 border-blue-100 focus:border-blue-500 min-h-[300px] shadow-inner text-sm leading-relaxed rounded-2xl mt-2" /></CardSection></div>
                </div>
            );
        case 'calendarizacion':
            return (
                <div className="bg-white rounded-3xl shadow-xl border border-slate-200 animate-fade-in relative">
                    <div className="bg-slate-800 text-white px-8 py-6 text-sm font-bold flex justify-between items-center relative overflow-hidden rounded-t-3xl"><div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-teal-400 to-blue-500"></div><div className="flex flex-col"><span className="text-xl tracking-tight flex items-center gap-2">🗓️ Calendarización MINEDU</span><span className="text-[10px] font-medium text-slate-400 uppercase tracking-[0.3em] mt-1">Cronograma Oficial del Año Escolar</span></div><div className="text-right flex items-center gap-4"><div className="flex items-center gap-2 text-[10px] bg-slate-700 px-4 py-2 rounded-full border border-slate-600 shadow-inner"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_red]"></span><span className="text-slate-300 font-black uppercase">Formato: dd/mm/aa</span></div></div></div>
                    <div className="p-8 overflow-visible">
                        <div className="mb-6 rounded-[2rem] border border-emerald-200 bg-emerald-50/70 px-6 py-5 shadow-sm">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-700">Semanas de diagnóstico previas a la Unidad 1</div>
                                    <div className="mt-1 text-sm font-bold text-slate-700">Estas semanas se descontarán del cálculo efectivo de clases de la Unidad 1 en el resumen semanal.</div>
                                </div>
                                <div className="inline-flex rounded-full border border-emerald-300 bg-white p-1 shadow-inner">
                                    {[0, 1, 2, 3].map(weeks => {
                                        const isActive = (formData.management_weeks_u1 || '0') === String(weeks);
                                        return (
                                            <button
                                                key={weeks}
                                                type="button"
                                                onClick={() => {
                                                    setFormData(prev => ({ ...prev, management_weeks_u1: String(weeks) }));
                                                    setIsDirty(true);
                                                }}
                                                className={`min-w-10 rounded-full px-3 py-2 text-xs font-black transition-all ${isActive ? 'bg-emerald-600 text-white shadow-md' : 'text-emerald-700 hover:bg-emerald-100'}`}
                                                title={`${weeks} semanas de diagnóstico`}
                                            >
                                                {weeks}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                        <div className="rounded-3xl border border-slate-300 shadow-sm bg-white overflow-visible">
                            <table className="w-full border-separate border-spacing-0 table-fixed">
                                <thead>
                                    <tr className="bg-slate-700"><th colSpan={4} className={thBase + " bg-slate-700 first:rounded-tl-3xl"}>BLOQUES BIMESTRALES</th><th colSpan={4} className={thBase + " bg-teal-700 border-r-0 last:rounded-tr-3xl"}>DESARROLLO DE UNIDADES</th></tr>
                                    <tr className="bg-slate-50 text-[9px] font-black uppercase tracking-widest border-b border-slate-300"><th className="py-3 border-r border-slate-200 w-20 text-center text-slate-500">BIMESTRE</th><th className="py-3 border-r border-slate-200 w-36 text-center text-slate-500">Inicio</th><th className="py-3 border-r border-slate-200 w-36 text-center text-slate-500">Término</th><th className="py-3 border-r border-slate-300 w-28 text-center text-slate-500">Duración</th><th className="py-3 border-r border-slate-200 w-24 text-center text-teal-700">Unid.</th><th className="py-3 border-r border-slate-200 w-36 text-center text-teal-700">Inicio</th><th className="py-3 border-r border-slate-200 w-36 text-center text-teal-700">Término</th><th className="py-3 w-28 text-center text-teal-700">Duración</th></tr>
                                </thead>
                                <tbody>
                                    {[1, 2, 'VAC', 3, 4].map((block, i) => {
                                        const isVac = block === 'VAC'; const bKey = isVac ? 'vac' : `b${block}`; const startKey = `${bKey}_start`; const endKey = `${bKey}_end`;
                                        const bLabel = isVac ? 'VAC' : ROMANS[Number(block)];
                                        if (isVac) { return (<tr key={bKey} className="bg-amber-50/30"><td className="text-center font-black text-xs py-4 border-b border-r border-slate-200 bg-amber-100 text-amber-800">{bLabel}</td><td className={cellBase}><CustomDatePicker name={startKey} value={(formData[startKey as keyof GeneralData] as string) || ''} holidays={allHolidays} onChange={handleCustomDateChange} /></td><td className={cellBase}><CustomDatePicker name={endKey} value={(formData[endKey as keyof GeneralData] as string) || ''} holidays={allHolidays} onChange={handleCustomDateChange} /></td><td className="text-center font-black text-[10px] text-blue-700 bg-blue-50/30 border-b border-r border-slate-300">{getWorkingDaysDuration(formData[startKey as keyof GeneralData] as string, formData[endKey as keyof GeneralData] as string)}</td><td className="text-center text-[10px] font-black text-amber-700 py-2 bg-amber-50 border-b border-r border-slate-200 uppercase tracking-widest">Gestión</td><td className={cellBase}><CustomDatePicker name="u_vac_start" value={formData.u_vac_start || ''} disabled tone="teal" holidays={allHolidays} onChange={handleCustomDateChange} /></td><td className={cellBase}><CustomDatePicker name="u_vac_end" value={formData.u_vac_end || ''} disabled tone="teal" holidays={allHolidays} onChange={handleCustomDateChange} /></td><td className="text-center font-bold text-teal-700 text-[10px] bg-slate-50 border-b border-slate-200 last:rounded-br-3xl">{getWorkingDaysDuration(formData.u_vac_start, formData.u_vac_end)}</td></tr>); }
                                        const u1 = (Number(block) * 2) - 1; const u2 = Number(block) * 2;
                                        return (<React.Fragment key={bKey}><tr><td rowSpan={2} className="text-center font-black text-xs py-4 border-b border-r border-slate-200 bg-slate-100 text-slate-600">{bLabel}</td><td rowSpan={2} className={cellBase}><CustomDatePicker name={startKey} value={(formData[startKey as keyof GeneralData] as string) || ''} holidays={allHolidays} onChange={handleCustomDateChange} /></td><td rowSpan={2} className={cellBase}><CustomDatePicker name={endKey} value={(formData[endKey as keyof GeneralData] as string) || ''} holidays={allHolidays} onChange={handleCustomDateChange} /></td><td rowSpan={2} className="text-center font-black text-[10px] text-blue-700 bg-blue-50/30 border-b border-r border-slate-300">{getWorkingDaysDuration(formData[startKey as keyof GeneralData] as string, formData[endKey as keyof GeneralData] as string)}</td><td className="text-center text-[10px] font-bold text-teal-800 py-3 bg-teal-50/50 border-r border-b border-slate-200 uppercase">Unidad {u1}</td><td className={cellBase}><CustomDatePicker name={`u${u1}_start`} value={formData[`u${u1}_start` as keyof GeneralData] as string || ''} disabled tone="teal" holidays={allHolidays} onChange={handleCustomDateChange} /></td><td className={cellBase}><CustomDatePicker name={`u${u1}_end`} value={formData[`u${u1}_end` as keyof GeneralData] as string || ''} tone="teal" holidays={allHolidays} onChange={handleCustomDateChange} /></td><td className="text-center font-bold text-teal-700 text-[10px] bg-slate-50 border-b border-slate-200">{getWorkingDaysDuration(formData[`u${u1}_start` as keyof GeneralData] as string, formData[`u${u1}_end` as keyof GeneralData] as string)}</td></tr><tr><td className="text-center text-[10px] font-bold text-teal-800 py-3 bg-teal-50/50 border-r border-b border-slate-200 uppercase">Unidad {u2}</td><td className={cellBase}><CustomDatePicker name={`u${u2}_start`} value={formData[`u${u2}_start` as keyof GeneralData] as string || ''} disabled tone="teal" holidays={allHolidays} onChange={handleCustomDateChange} /></td><td className={cellBase}><CustomDatePicker name={`u${u2}_end`} value={formData[`u${u2}_end` as keyof GeneralData] as string || ''} disabled tone="teal" holidays={allHolidays} onChange={handleCustomDateChange} /></td><td className="text-center font-bold text-teal-700 text-[10px] bg-slate-50 border-b border-slate-200">{getWorkingDaysDuration(formData[`u${u2}_start` as keyof GeneralData] as string, formData[`u${u2}_end` as keyof GeneralData] as string)}</td></tr></React.Fragment>);
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            );
        default: return <div>Sección no encontrada</div>;
      }
  };

  return (
    <div className="animate-fade-in pb-10">
      {message && (<div className="fixed top-8 left-1/2 -translate-x-1/2 z-[300] w-[400px] animate-fade-in"><div className={`px-6 py-5 rounded-[2.5rem] shadow-2xl border-l-[8px] flex items-start gap-4 bg-white ring-1 ring-black/5 ${message.type === 'success' ? 'border-emerald-500' : 'border-red-500'}`}><div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}><span className="text-2xl">{message.type === 'success' ? '✅' : '❌'}</span></div><div className="flex-1 pt-0.5"><span className={`block font-black text-sm uppercase tracking-tight ${message.type === 'success' ? 'text-emerald-900' : 'text-red-900'}`}>{message.text}</span><span className="block text-[11px] font-bold text-slate-500 mt-1 leading-snug">{message.subtext}</span></div><button onClick={() => setMessage(null)} className="text-slate-300 hover:text-slate-800 transition-colors">✕</button></div></div>)}
      
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
          <span className="p-2 bg-white rounded-2xl shadow-sm border border-slate-200">📋</span>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Configuración</span>
            <div className="flex items-center gap-2">
                <span>Datos Generales</span>
                <span className="text-3xl text-blue-600 font-black italic ml-1 select-none">{formData.year}</span>
                <span className="text-lg text-blue-600 font-black">/</span> 
                <span className="text-blue-600 uppercase text-lg">{activeSection.replace('_', ' ')}</span>
            </div>
          </div>
        </h1>
        
        <div className="flex gap-4">
            <div className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all shadow-sm flex items-center gap-2 ${
                saving
                  ? 'bg-sky-50 text-sky-700 border-sky-200'
                  : isDirty
                    ? 'bg-amber-50 text-amber-600 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}>
                <span className={`w-2 h-2 rounded-full ${
                    saving
                      ? 'bg-sky-500 animate-pulse'
                      : isDirty
                        ? 'bg-amber-500 animate-pulse'
                        : 'bg-emerald-500'
                }`}></span>
                {saving ? 'Guardando...' : isDirty ? 'Cambios pendientes' : 'Guardado automatico'}
            </div>
        </div>
      </div>

      <form className="flex flex-col gap-4">{renderSection()}</form>
    </div>
  );
};


