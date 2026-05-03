
import React, { useState, useEffect, useMemo } from 'react';
import { getDatosGenerales, getEstudiantes, saveDatosGenerales, updateModuleStatus } from '../services/apiService';
import { INITIAL_GENERAL_DATA } from '../constants';
import { Input } from './Input';
import { Select } from './Select';
import { GeneralData, Student } from '../types';

interface Props {
  activeSection: string;
  onSuccess?: () => void;
}

// Types for Calendar
type DayType = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'I';

interface CalendarDayState {
  [dateIso: string]: DayType;
}

interface Holiday {
  id: string;
  date: string; // Formato YYYY-MM-DD
  mmdd: string; // "MM-DD"
  name: string;
  type: DayType;
}

const DEFAULT_HOLIDAYS_LIST: Holiday[] = [
  { id: 'def-1', date: '2025-01-01', mmdd: '01-01', name: 'Año Nuevo', type: 'F' },
  { id: 'def-2', date: '2025-05-01', mmdd: '05-01', name: 'Día del Trabajo', type: 'F' },
  { id: 'def-3', date: '2025-06-29', mmdd: '06-29', name: 'San Pedro y San Pablo', type: 'F' },
  { id: 'def-4', date: '2025-07-28', mmdd: '07-28', name: 'Fiestas Patrias', type: 'F' },
  { id: 'def-5', date: '2025-07-29', mmdd: '07-29', name: 'Fiestas Patrias', type: 'F' },
  { id: 'def-6', date: '2025-08-06', mmdd: '08-06', name: 'Batalla de Junín', type: 'F' },
  { id: 'def-7', date: '2025-08-30', mmdd: '08-30', name: 'Santa Rosa de Lima', type: 'F' },
  { id: 'def-8', date: '2025-10-08', mmdd: '10-08', name: 'Combate de Angamos', type: 'F' },
  { id: 'def-9', date: '2025-11-01', mmdd: '11-01', name: 'Todos los Santos', type: 'F' },
  { id: 'def-10', date: '2025-12-08', mmdd: '12-08', name: 'Inmaculada Concepción', type: 'F' },
  { id: 'def-11', date: '2025-12-09', mmdd: '12-09', name: 'Batalla de Ayacucho', type: 'F' },
  { id: 'def-12', date: '2025-12-25', mmdd: '12-25', name: 'Navidad', type: 'F' },
];

const LEGEND = [
  { code: 'A', label: 'Día efectivo de aprendizaje escolar', short: 'Escolar', color: 'bg-[#c6efce]', text: 'text-green-900', border: 'border-green-600', light: 'bg-[#e8f5e9]' },
  { code: 'B', label: 'Periodo de planificación y reajuste', short: 'Planificación', color: 'bg-[#bdd7ee]', text: 'text-blue-900', border: 'border-blue-500', light: 'bg-[#e3f2fd]' },
  { code: 'C', label: 'Jornadas de reflexión', short: 'Reflexión', color: 'bg-[#ffeb9c]', text: 'text-orange-900', border: 'border-orange-500', light: 'bg-[#fff8e1]' },
  { code: 'D', label: 'Sábados o domingos', short: 'Descanso', color: 'bg-white', text: 'text-slate-900', border: 'border-slate-300', light: 'bg-slate-50' },
  { code: 'E', label: 'Vacaciones estudiantiles', short: 'Vacaciones', color: 'bg-[#b4c6e7]', text: 'text-purple-900', border: 'border-purple-400', light: 'bg-[#f3e5f5]' },
  { code: 'F', label: 'Feriados', short: 'Feriado', color: 'bg-[#ffc7ce]', text: 'text-red-900', border: 'border-red-500', light: 'bg-[#fff1f1]' },
  { code: 'G', label: 'Clausura', short: 'Clausura', color: 'bg-[#fbbf24]', text: 'text-amber-950', border: 'border-amber-600', light: 'bg-[#fff9c4]' },
  { code: 'I', label: 'Informativas', short: 'Informativa', color: 'bg-[#dbeafe]', text: 'text-sky-900', border: 'border-sky-500', light: 'bg-[#eff6ff]' },
];

const MONTH_ABBR = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC'];
const MONTHS_ORDER = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MONTH_NAMES = ['marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const MONTH_TEXT_COLORS = [
    'text-blue-600',    // ENE
    'text-pink-600',    // FEB
    'text-emerald-600', // MAR
    'text-orange-600',  // ABR
    'text-purple-600',  // MAY
    'text-cyan-600',    // JUN
    'text-rose-600',    // JUL
    'text-amber-600',   // AGO
    'text-teal-600',    // SET
    'text-indigo-600',  // OCT
    'text-slate-600',   // NOV
    'text-red-700'      // DIC
];

const UNIT_FILL_COLORS = ['#ccfbf1', '#ffedd5', '#dbeafe', '#ffe4e6', '#ede9fe', '#ecfccb', '#fef9c3', '#e2e8f0'];
const UNIT_TEXT_COLORS = ['#0f766e', '#f97316', '#1d4ed8', '#be123c', '#6d28d9', '#4d7c0f', '#ca8a04', '#334155'];
const UNIT_MARK_COLORS = ['#0f766e', '#f97316', '#1d4ed8', '#be123c', '#6d28d9', '#4d7c0f', '#facc15', '#334155'];
const toIsoOrEmpty = (value?: string) => {
    const raw = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};

const isIsoWithinRange = (value: string, start: string, end: string) => {
    if (!value || !start || !end) return false;
    return value >= start && value <= end;
};

const INSTITUTIONAL_DATE_TABLES: Array<Array<{ key: keyof GeneralData; label: string; matchTerms: string[] }>> = [
    [
        { key: 'ie_anniversary_date', label: 'ANIVERSARIO DE LA IE', matchTerms: ['aniversario de la ie', 'aniversario ie', 'aniversario de la institucion educativa', 'aniversario institucion educativa'] },
        { key: 'achievement_day_1_date', label: 'DIA DEL LOGRO 1', matchTerms: ['dia del logro 1', 'día del logro 1', 'primer dia del logro', 'primer día del logro'] },
    ],
    [
        { key: 'community_anniversary_date', label: 'ANIVERSARIO DE LA COMUNIDAD', matchTerms: ['aniversario de la comunidad', 'aniversario comunidad'] },
        { key: 'achievement_day_2_date', label: 'DIA DEL LOGRO 2', matchTerms: ['dia del logro 2', 'día del logro 2', 'segundo dia del logro', 'segundo día del logro'] },
    ],
    [
        { key: 'province_anniversary_date', label: 'ANIVERSARIO DE LA PROVINCIA', matchTerms: ['aniversario de la provincia', 'aniversario provincia'] },
        { key: 'other_important_date', label: 'CONCURSO DEL AREA', matchTerms: ['otra fecha importante'] },
    ],
];

const CONTEST_DEFINITIONS = [
    { label: 'PREMIO JOSE MARIA ARGUEDAS', matchTerms: ['premio jose maria arguedas', 'jose maria arguedas'] },
    { label: 'CREA Y EMPRENDE', matchTerms: ['crea y emprende'] },
    { label: 'EUREKA', matchTerms: ['eureka', 'feria de ciencia y tecnologia', 'feria de ciencia y tecnología'] },
    { label: 'ONEM', matchTerms: ['onem', 'olimpiada nacional escolar de matematica', 'olimpiada nacional escolar de matemática'] },
    { label: 'EL PERU LEE', matchTerms: ['el peru lee', 'el perú lee'] },
    { label: 'JUEGOS FLORALES ESCOLARES NACIONALES', matchTerms: ['juegos florales escolares nacionales', 'juegos florales'] },
    { label: 'CONCURSO JOSE FAUSTINO SANCHEZ CARRION', matchTerms: ['jose faustino sanchez carrion', 'josé faustino sánchez carrión'] },
    { label: 'IDEAS EN ACCION', matchTerms: ['ideas en accion', 'ideas en acción'] },
    { label: 'JUEGOS DEPORTIVOS ESCOLARES NACIONALES', matchTerms: ['juegos deportivos escolares nacionales', 'juegos deportivos'] },
];

const formatCalendarInfoDate = (value?: string) => {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'SIN FECHA';
    const parsed = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return 'SIN FECHA';
    return parsed.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const normalizeEventLabel = (value?: string) =>
    String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

export const CalendarView: React.FC<Props> = ({ activeSection, onSuccess }) => {
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [calendarState, setCalendarState] = useState<CalendarDayState>({});
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [generalData, setGeneralData] = useState<GeneralData>(INITIAL_GENERAL_DATA);
  const [selectedTool, setSelectedTool] = useState<DayType>('A');
  const [isDirty, setIsDirty] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'paint' | 'erase' | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [isSavingInstitutionalDates, setIsSavingInstitutionalDates] = useState(false);
  
  const [isAdding, setIsAdding] = useState(false);
  const [editingHolidayId, setEditingHolidayId] = useState<string | null>(null);
  const [hDate, setHDate] = useState('');
  const [hName, setHName] = useState('');
  const [hType, setHType] = useState<DayType>('F');
  
  useEffect(() => {
    const init = async () => {
      const genData = await getDatosGenerales();
      setGeneralData(genData);
      if (genData.year) setYear(parseInt(genData.year));

      const savedCal = localStorage.getItem('armi_calendar_state');
      if (savedCal) setCalendarState(JSON.parse(savedCal));
      
      const savedHolidays = localStorage.getItem('armi_holidays_v7');
      if (savedHolidays) {
          setHolidays(JSON.parse(savedHolidays));
      } else {
          setHolidays(DEFAULT_HOLIDAYS_LIST);
          localStorage.setItem('armi_holidays_v7', JSON.stringify(DEFAULT_HOLIDAYS_LIST));
      }

      const dbStudents = await getEstudiantes();
      setStudents(Array.isArray(dbStudents) ? dbStudents : []);
    };
    init();

    const handleGlobalMouseUp = () => {
      setIsDragging(false);
      setDragMode(null);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const showToast = (message: string, type: 'success' | 'warning' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleSave = async () => {
    // VALIDACIÓN CRÍTICA: ¿Hay datos reales?
    const totalPainted = Object.keys(calendarState).length;
    const hasSchoolDays = Object.values(calendarState).includes('A');
    const hasHolidays = holidays.length > 0;

    if (totalPainted === 0 && !hasHolidays) {
        showToast('⚠️ No se puede guardar un calendario vacío. Pinte los días lectivos.', 'error');
        return;
    }

    if (!hasSchoolDays) {
        showToast('⚠️ Falta marcar los días efectivos de aprendizaje (Color Verde - A).', 'error');
        return;
    }

    localStorage.setItem('armi_calendar_state', JSON.stringify(calendarState));
    localStorage.setItem('armi_holidays_v7', JSON.stringify(holidays));
    
    // Sincronizar con API
    try {
        const res = await updateModuleStatus('calendario', true);
        if (res.success) {
            showToast('✅ ¡Planificación sincronizada y módulo desbloqueado!', 'success');
            setIsDirty(false);
            if (onSuccess) onSuccess();
        } else {
            showToast('❌ Error de servidor al sincronizar progreso.', 'error');
        }
    } catch (e) {
        showToast('❌ Error de conexión con la base de datos.', 'error');
    }
  };

  const handleResetCalendar = () => {
      if (confirm(`¿Limpiar todo el calendario del año ${year}?`)) {
          setCalendarState({});
          setIsDirty(true);
          showToast('Calendario reiniciado localmente.', 'warning');
      }
  }

  const handleInstitutionalDateChange = async (key: keyof GeneralData, value: string) => {
      const nextData = { ...generalData, [key]: value };
      setGeneralData(nextData);
      setIsSavingInstitutionalDates(true);
      try {
          const result = await saveDatosGenerales(nextData);
          if (!result.success) {
              showToast(result.message || 'No se pudo guardar la fecha informativa.', 'error');
              return;
          }
          showToast('Fecha informativa guardada.', 'success');
      } catch (error: any) {
          showToast(error?.message || 'No se pudo guardar la fecha informativa.', 'error');
      } finally {
          setIsSavingInstitutionalDates(false);
      }
  };

  const getDayStatus = (date: Date): DayType | null => {
    const iso = date.toISOString().split('T')[0];
    const mmdd = iso.substring(5);
    const recurrentEvent = holidays.find(h => h.mmdd === mmdd && h.type !== 'I');
    if (recurrentEvent) return recurrentEvent.type;
    const day = date.getDay();
    if (day === 0 || day === 6) return 'D';
    if (calendarState[iso]) return calendarState[iso];
    return null;
  };

  const calculateHoursPerDay = () => {
    if (generalData.level === 'Primaria') return 6;
    if (generalData.school_shift === 'JEC') return 9;
    return 7; 
  };

  const globalStats = useMemo(() => {
    const counts: Record<string, number> = { A:0, B:0, C:0, D:0, E:0, F:0, G:0, I:0 };
    MONTHS_ORDER.forEach(monthIndex => {
        const y = monthIndex === 0 ? year + 1 : year;
        const daysInMonth = new Date(y, monthIndex + 1, 0).getDate();
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(y, monthIndex, d);
            const status = getDayStatus(date);
            if (status && counts[status] !== undefined) counts[status]++;
        }
    });
    return counts;
  }, [calendarState, holidays, year]);

  const institutionalAutoDates = useMemo(() => {
    const resolved: Partial<Record<keyof GeneralData, string>> = {};

    INSTITUTIONAL_DATE_TABLES.flat().forEach((row) => {
      const matchedHoliday = holidays.find((holiday) => {
        const normalizedName = normalizeEventLabel(holiday.name);
        return row.matchTerms.some((term) => normalizedName.includes(normalizeEventLabel(term)));
      });

      if (matchedHoliday?.date) {
        resolved[row.key] = matchedHoliday.date;
      }
    });

    return resolved;
  }, [holidays]);

  const detectedAreaContest = useMemo(() => {
    const informativeHolidays = holidays.filter((holiday) => holiday.type === 'I');
    for (const contest of CONTEST_DEFINITIONS) {
      const matchedHoliday = informativeHolidays.find((holiday) => {
        const normalizedName = normalizeEventLabel(holiday.name);
        return contest.matchTerms.some((term) => normalizedName.includes(normalizeEventLabel(term)));
      });
      if (matchedHoliday) {
        return {
          label: contest.label,
          date: matchedHoliday.date,
        };
      }
    }
    return null;
  }, [holidays]);

  const clausuraDate = useMemo(() => {
    const holiday = holidays.find(h => h.type === 'G');
    if (holiday) {
        const [m, d] = holiday.mmdd.split('-');
        return `${d}/${m}/${year}`;
    }
    const stateDate = Object.entries(calendarState).find(([_, type]) => type === 'G');
    if (stateDate) {
        const [y, m, d] = stateDate[0].split('-');
        return `${d}/${m}/${y}`;
    }
    return '-';
  }, [holidays, calendarState, year]);

  const numUniqueSections = useMemo(() => {
    const sections = new Set<string>();

    students.forEach((student) => {
      const grade = String(student.grade || '').trim().toUpperCase();
      const rawSection = String(student.section || '').trim().toUpperCase();
      if (!grade || !rawSection) return;

      const normalizedSections = rawSection
        .replace(/\bUNICA\b/g, 'U')
        .replace(/\bUNICA\)?/g, 'U')
        .replace(/\bY\b/g, ',')
        .split(/[,/|;&+-]+/)
        .map((part) => part.replace(/[^A-Z0-9]/g, '').trim())
        .filter(Boolean);

      const sectionParts = normalizedSections.length > 0 ? normalizedSections : [rawSection.replace(/[^A-Z0-9]/g, '')];
      sectionParts.forEach((section) => {
        if (section) sections.add(`${grade}-${section}`);
      });
    });

    return sections.size;
  }, [students]);

  const unitDateRanges = useMemo(() => (
    Array.from({ length: 8 }, (_, index) => {
      const unitNumber = index + 1;
      const start = toIsoOrEmpty(generalData[`u${unitNumber}_start` as keyof GeneralData] as string | undefined);
      const end = toIsoOrEmpty(generalData[`u${unitNumber}_end` as keyof GeneralData] as string | undefined);
      return {
        unitNumber,
        start,
        end,
        fill: UNIT_FILL_COLORS[index],
        text: UNIT_TEXT_COLORS[index],
      };
    }).filter((item) => item.start && item.end)
  ), [generalData]);

  const getUnitFillStyle = (date: Date | null) => {
    if (!date) return undefined;
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return undefined;
    const iso = date.toISOString().split('T')[0];
    const unitRange = unitDateRanges.find((item) => isIsoWithinRange(iso, item.start, item.end));
    if (!unitRange) return undefined;
    return { backgroundColor: unitRange.fill, color: unitRange.text } as React.CSSProperties;
  };

  const getUnitAccentColor = (date: Date | null) => {
    if (!date) return '';
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return '';
    const iso = date.toISOString().split('T')[0];
    const unitRange = unitDateRanges.find((item) => isIsoWithinRange(iso, item.start, item.end));
    if (!unitRange) return '';
    return UNIT_MARK_COLORS[Math.max(0, unitRange.unitNumber - 1)] || '';
  };

  const paintDay = (date: Date) => {
      const iso = date.toISOString().split('T')[0];
      const mmdd = iso.substring(5);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const isAutomatic = holidays.some(h => h.mmdd === mmdd && h.type !== 'I');
      if (isWeekend || isAutomatic) return;
      if (calendarState[iso] === selectedTool) return;
      setCalendarState(prev => ({ ...prev, [iso]: selectedTool }));
      setIsDirty(true);
  };

  const unpaintDay = (date: Date) => {
      const iso = date.toISOString().split('T')[0];
      const mmdd = iso.substring(5);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const isAutomatic = holidays.some(h => h.mmdd === mmdd && h.type !== 'I');
      if (isWeekend || isAutomatic) return;
      if (!calendarState[iso]) return;
      setCalendarState(prev => {
          const newState = { ...prev };
          delete newState[iso];
          return newState;
      });
      setIsDirty(true);
  };

  const handleMouseDown = (e: React.MouseEvent, date: Date) => { 
    e.preventDefault(); 
    if (e.button === 0) { // Clic izquierdo
      setDragMode('paint');
      setIsDragging(true); 
      paintDay(date); 
    } else if (e.button === 2) { // Clic derecho
      setDragMode('erase');
      setIsDragging(true);
      unpaintDay(date);
    }
  };

  const handleRightClick = (e: React.MouseEvent, date: Date) => {
      e.preventDefault();
      // Ya manejado por el sistema de arrastre unificado
  };

  const handleMouseEnter = (date: Date) => { 
    if (isDragging) {
      if (dragMode === 'paint') paintDay(date);
      else if (dragMode === 'erase') unpaintDay(date);
    }
  };

  const getDaysArray = (year: number, monthIndex: number) => {
    const date = new Date(year, monthIndex, 1);
    const result = [];
    let firstDayIndex = date.getDay() - 1;
    if (firstDayIndex === -1) firstDayIndex = 6; 
    for (let i = 0; i < firstDayIndex; i++) result.push(null);
    while (date.getMonth() === monthIndex) {
      result.push(new Date(date)); date.setDate(date.getDate() + 1);
    }
    return result;
  };

  const handleAddHoliday = () => {
      if (!hDate || !hName) return;
      const mmdd = hDate.substring(5);
      
      const newHolidays: Holiday[] = editingHolidayId 
        ? holidays.map(h => h.id === editingHolidayId ? { ...h, date: hDate, mmdd, name: hName, type: hType } : h)
        : [...holidays, { id: Date.now().toString(), date: hDate, mmdd, name: hName, type: hType }].sort((a,b) => a.mmdd.localeCompare(b.mmdd));
      
      setHolidays(newHolidays);
      localStorage.setItem('armi_holidays_v7', JSON.stringify(newHolidays));
      handleCloseModal();
      setIsDirty(true);
      showToast(editingHolidayId ? 'Evento actualizado correctamente.' : 'Evento registrado correctamente.', 'success');
  };

  const handleEditClick = (h: Holiday) => {
      setEditingHolidayId(h.id);
      setHDate(h.date);
      setHName(h.name);
      setHType(h.type);
      setIsAdding(true);
  };

  const handleCloseModal = () => {
      setEditingHolidayId(null);
      setHDate('');
      setHName('');
      setHType('F');
      setIsAdding(false);
  };

  const handleDeleteHoliday = (id: string) => {
      if (confirm('¿Eliminar evento?')) {
          const newHolidays = holidays.filter(h => h.id !== id);
          setHolidays(newHolidays);
          localStorage.setItem('armi_holidays_v7', JSON.stringify(newHolidays));
          setIsDirty(true);
      }
  };

  const renderMonthRow = (monthIndex: number, label: string) => {
    const currentYear = monthIndex === 0 ? year + 1 : year;
    const daysInMonth = new Date(currentYear, monthIndex + 1, 0).getDate();
    const firstDayOfWeek = new Date(currentYear, monthIndex, 1).getDay();
    const startOffset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
    const cells = [];
    for(let i=0; i<startOffset; i++) cells.push(null);
    for(let d=1; d<=daysInMonth; d++) cells.push(new Date(currentYear, monthIndex, d));
    while(cells.length % 7 !== 0) cells.push(null);
    let daysEffective = 0;
    const hoursPerDay = calculateHoursPerDay();
    const dateCells = cells.map((date) => {
        if (!date) return { date: null, type: null };
        const status = getDayStatus(date);
        if (status === 'A') daysEffective++;
        return { date, type: status };
    });
    return (
        <React.Fragment key={monthIndex}>
            <tr className="border-b border-slate-400">
                <td rowSpan={2} className="bg-[#e2efda] border-r border-slate-400 text-center font-bold text-xs uppercase text-slate-800 px-2">{label}</td>
                <td className="bg-[#fff2cc] border-r border-slate-300 text-center text-[10px] font-bold px-1 h-5">Fecha</td>
                {dateCells.map((cell, i) => (
                    <td
                        key={`d-${i}`}
                        className={`border-r border-slate-300 text-center text-[10px] h-5 ${i % 7 === 6 ? 'border-r-2 border-r-slate-500' : ''} ${!cell.date ? 'bg-black' : 'bg-white'}`}
                        style={!cell.date ? undefined : getUnitFillStyle(cell.date)}
                    >
                        {cell.date ? cell.date.getDate() : ''}
                    </td>
                ))}
                {[...Array(42 - dateCells.length)].map((_, i) => <td key={`pad-d-${i}`} className="bg-black border-r border-slate-300"></td>)}
                <td rowSpan={2} className="bg-[#e2f0d9] border-l-2 border-slate-500 text-center font-bold text-xs text-slate-800">{daysEffective}</td>
                <td rowSpan={2} className="bg-[#c6e0b4] border-l border-slate-300 text-center font-bold text-xs text-slate-800">{daysEffective * hoursPerDay}</td>
                <td rowSpan={2} className="bg-[#a9d08e] border-l border-slate-300 text-center font-bold text-xs text-slate-800">{daysEffective * hoursPerDay}</td>
            </tr>
            <tr className="border-b-2 border-slate-800">
                <td className="bg-[#fff2cc] border-r border-slate-300 text-center text-[10px] font-bold px-1 h-5">Tipo</td>
                {dateCells.map((cell, i) => {
                    const config = cell.type ? LEGEND.find(l => l.code === cell.type) : null;
                    const bgColor = config ? config.color : (cell.date ? 'bg-white' : 'bg-black');
                    return (
                        <td key={`t-${i}`} className={`border-r border-slate-300 text-center text-[10px] font-bold h-5 ${i % 7 === 6 ? 'border-r-2 border-r-slate-500' : ''} ${bgColor} ${config?.text || ''}`}>
                            {cell.date ? (cell.type || '') : ''}
                        </td>
                    );
                })}
                {[...Array(42 - dateCells.length)].map((_, i) => <td key={`pad-t-${i}`} className="bg-black border-r border-slate-300"></td>)}
            </tr>
        </React.Fragment>
    );
  };

  const renderMonth = (monthIndex: number) => {
    const currentYear = monthIndex === 0 ? year + 1 : year;
    const date = new Date(currentYear, monthIndex, 1);
    const monthName = new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(date).toUpperCase();
    const days = getDaysArray(currentYear, monthIndex);
    return (
        <div key={`${currentYear}-${monthIndex}`} className="bg-white rounded-lg overflow-hidden shadow-sm select-none border border-slate-200">
            <div className="bg-slate-800 text-white text-center py-1.5 text-xs font-bold uppercase tracking-wider">{monthName}</div>
            <div className="grid grid-cols-7 bg-slate-100 border-b border-slate-200">
                {['L','M','M','J','V','S','D'].map((d, i) => (
                    <div key={i} className={`text-center text-[10px] font-bold py-1 ${i===6 ? 'text-red-500' : 'text-slate-600'}`}>{d}</div>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-slate-200 border-l border-b border-slate-200">
                {days.map((d, i) => {
                    if (!d) return <div key={i} className="bg-white min-h-[2.5rem]"></div>;
                    const status = getDayStatus(d);
                    const config = status ? LEGEND.find(l => l.code === status) : null;
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    const mmdd = d.toISOString().split('T')[0].substring(5);
                    const blockingHoliday = holidays.find(h => h.mmdd === mmdd && h.type !== 'I');
                    const informativeHoliday = holidays.find(h => h.mmdd === mmdd && h.type === 'I');
                    const isAutomatic = holidays.some(h => h.mmdd === mmdd && h.type !== 'I');
                    const unitAccentColor = getUnitAccentColor(d);
                    let bgClass = 'bg-white', textClass = 'text-slate-700', borderClass = '';
                    if (config) {
                        bgClass = config.color; textClass = config.text || 'text-slate-900';
                        borderClass = config.border ? `ring-1 ring-inset ${config.border.replace('border-', 'ring-')}` : '';
                    } else if (isWeekend) { bgClass = 'bg-slate-50'; textClass = 'text-red-400'; }
                    return (
                        <div key={i} 
                            onMouseDown={(e) => handleMouseDown(e, d)} 
                            onMouseEnter={() => handleMouseEnter(d)} 
                            onContextMenu={(e) => e.preventDefault()}
                            className={`min-h-[2.5rem] flex flex-col items-center justify-center text-xs font-medium transition-colors relative overflow-hidden ${bgClass} ${textClass} ${borderClass} ${(isWeekend || isAutomatic) ? 'cursor-not-allowed opacity-90' : 'cursor-pointer hover:brightness-95 hover:z-10'}`} 
                            title={blockingHoliday?.name || informativeHoliday?.name || (isWeekend ? 'Fines de semana bloqueados' : '')}
                        >
                            {unitAccentColor ? (
                                <span className="pointer-events-none absolute inset-px">
                                    <span
                                        className="absolute right-0 top-0 h-[6px] w-[6px]"
                                        style={{ backgroundColor: unitAccentColor, clipPath: 'polygon(100% 0, 0 0, 100% 100%)' }}
                                    />
                                </span>
                            ) : null}
                            <span>{d.getDate()}</span>
                            {status && <span className="text-[8px] font-extrabold opacity-75 leading-none mt-0.5">{status}</span>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
  };
  
  if (activeSection === 'feriados') {
      return (
          <div className="animate-fade-in pb-12">
              <div className="flex justify-between items-center mb-10 px-4">
                  <h1 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-4">
                      <span className="p-3 bg-white rounded-3xl shadow-sm border border-slate-200">🗓️</span>
                      <div className="flex flex-col">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] leading-none mb-1">Módulo Calendario</span>
                          <span>AÑO LECTIVO {year}</span>
                      </div>
                  </h1>
              </div>

              <div className="bg-white p-10 rounded-[3rem] shadow-xl border border-slate-200 relative">
                <div className="flex items-center gap-4 mb-10">
                    <div className="bg-red-50 p-2.5 rounded-2xl">
                        <span className="text-xl">🚩</span>
                    </div>
                    <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">Feriados y Eventos Automáticos</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {holidays.map(h => {
                        const [m, d] = h.mmdd.split('-');
                        const monthIdx = parseInt(m) - 1;
                        const monthName = MONTH_ABBR[monthIdx] || m;
                        const monthColorClass = MONTH_TEXT_COLORS[monthIdx] || 'text-red-500';
                        const typeConfig = LEGEND.find(l => l.code === h.type) || LEGEND[5];
                        return (
                            <div key={h.id} 
                                onClick={() => handleEditClick(h)}
                                className={`${typeConfig.light} p-6 rounded-[2.5rem] border ${typeConfig.border.replace('border-', 'border-opacity-30 border-')} border-l-[10px] ${typeConfig.border.replace('border-', 'border-l-')} shadow-sm flex items-center gap-8 group hover:shadow-lg hover:scale-[1.02] cursor-pointer transition-all hover:border-opacity-100 relative overflow-visible`}
                            >
                                <div className={`${typeConfig.light} w-24 h-24 rounded-[2.5rem] flex flex-col items-center justify-center border ${typeConfig.border.replace('border-', 'border-opacity-20 border-')} shrink-0 relative overflow-hidden shadow-inner`}>
                                    <div className="flex items-start gap-1 relative z-10">
                                        <span className="text-red-500 font-black text-4xl leading-none">{d}</span>
                                        <span className={`${monthColorClass} font-black text-[12px] pt-1 uppercase leading-none`}>{monthName}</span>
                                    </div>
                                    <div className={`absolute top-0 right-0 w-8 h-8 opacity-10 -translate-y-4 translate-x-4 rotate-45 ${typeConfig.color}`}></div>
                                </div>
                                <div className="flex-1">
                                    <h4 className="text-slate-800 font-black text-sm uppercase leading-tight tracking-tight mb-2">{h.name}</h4>
                                    <span className={`${typeConfig.text} text-[9px] font-black uppercase tracking-[0.2em] px-3 py-1 rounded-full border border-current/10 bg-white/40 shadow-sm`}>
                                        {typeConfig.short.toUpperCase()}
                                    </span>
                                </div>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleDeleteHoliday(h.id); }} 
                                    className="absolute -top-2 -right-2 z-[60] bg-white w-9 h-9 rounded-full shadow-2xl border border-slate-200 flex items-center justify-center transition-all hover:bg-red-600 hover:text-white" 
                                    title="Eliminar"
                                >
                                    🗑️
                                </button>
                            </div>
                        );
                    })}

                    <button onClick={() => setIsAdding(true)} className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-[2.5rem] p-10 flex flex-col items-center justify-center gap-4 group hover:border-purple-400 hover:bg-purple-50 transition-all min-h-[140px] shadow-inner">
                        <div className="w-14 h-14 rounded-full bg-white flex items-center justify-center text-4xl font-black text-purple-600 shadow-sm transition-transform group-hover:scale-110">+</div>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] group-hover:text-purple-600">Nuevo Feriado</span>
                    </button>
                </div>
              </div>

              {isAdding && (
                  <div className="fixed inset-0 z-[10001] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-fade-in" onClick={handleCloseModal}>
                      <div className="bg-white w-full max-w-md rounded-[3rem] shadow-[0_30px_60px_rgba(0,0,0,0.3)] overflow-hidden border border-slate-100 relative border-l-[10px] border-l-blue-600 transform scale-100" onClick={e => e.stopPropagation()}>
                          <div className="p-10 space-y-8">
                              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.25em]">{editingHolidayId ? 'Editar Evento Registrado' : 'Configurar Fecha Fija'}</h3>
                              
                              <div className="space-y-6">
                                  <Input label="Fecha (Día y Mes)" type="date" value={hDate} onChange={e => setHDate(e.target.value)} icon="📅" />
                                  <Input label="Descripción del Evento" placeholder="Ej: Navidad / Aniversario" value={hName} onChange={e => setHName(e.target.value)} icon="📝" />
                                  <Select 
                                    label="Tipo de Día" 
                                    name="type" 
                                    value={hType} 
                                    onChange={e => setHType(e.target.value as DayType)}
                                    options={LEGEND.filter(l => l.code !== 'D' && l.code !== 'A').map(l => ({ value: l.code, label: `${l.code} - ${l.label}` }))}
                                    icon="🏷️"
                                  />
                              </div>

                              <div className="flex flex-col gap-4">
                                  <button onClick={handleAddHoliday} disabled={!hDate || !hName} className="w-full bg-[#94a3b8] text-white py-5 rounded-[2rem] font-black text-[11px] uppercase tracking-[0.25em] shadow-lg hover:bg-blue-600 transition-all disabled:opacity-50 h-[60px]">
                                      {editingHolidayId ? 'Actualizar Registro' : 'Registrar Evento Fijo'}
                                  </button>
                                  <button onClick={handleCloseModal} className="w-full text-slate-400 font-black text-[10px] uppercase tracking-widest py-2 hover:text-slate-600 transition-colors">Cancelar</button>
                              </div>

                              <p className="text-[10px] text-slate-400 italic leading-relaxed text-center px-6 border-t pt-6 border-slate-50 font-medium">
                                  * Los eventos registrados aquí son <span className="font-bold">recurrentes</span>. Solo se guardan el día y el mes, por lo que aparecerán todos los años automáticamente.
                              </p>
                          </div>
                      </div>
                  </div>
              )}
          </div>
      );
  }

  if (activeSection === 'calendarizacion_resumen') {
  const hoursPerDay = calculateHoursPerDay();
  return (
        <div className="calendar-ie-print-sheet relative animate-fade-in bg-white p-6 rounded-[2rem] shadow-xl min-w-[1000px] overflow-x-auto border border-slate-200 print:min-w-0 print:overflow-visible print:border-0 print:shadow-none print:rounded-none print:p-0 print:space-y-0">
            <style>{`
                @media print {
                    @page {
                        size: landscape;
                        margin: 6mm;
                    }

                    .calendar-ie-print-sheet {
                        zoom: 0.82;
                    }

                    .calendar-ie-print-footer {
                        display: flex;
                    }
                }
            `}</style>
            <div className="absolute right-6 top-6 z-10 print:hidden">
                <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white/95 px-1 py-1 text-sm font-black text-slate-700 shadow-lg backdrop-blur transition hover:bg-slate-50"
                >
                    <span>🖨️</span>
                </button>
            </div>
            <div className="flex items-center justify-between mb-6 border-b-4 border-black pb-4 px-2 print:mb-2 print:pb-2">
                <div className="w-20 h-20 flex items-center justify-center overflow-hidden">
                    {generalData.insignia ? (
                        <img src={generalData.insignia} alt="Insignia" className="max-w-full max-h-full object-contain" />
                    ) : (
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-[8px] text-center font-bold border-2 border-red-800 text-red-800 uppercase">Insignia</div>
                    )}
                </div>
                <h1 className="text-3xl font-black text-center text-black uppercase font-serif tracking-wide">
                    Calendarización del Año Escolar {year} <span className="text-xl block mt-1 font-bold font-sans">- Nivel {generalData.level || 'Secundaria'} -</span>
                </h1>
                <div className="w-20 h-20 flex items-center justify-center overflow-hidden">
                    {generalData.logo ? (
                        <img src={generalData.logo} alt="Logo" className="max-w-full max-h-full object-contain" />
                    ) : (
                        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-[8px] text-center font-bold border-2 border-blue-800 text-blue-800 uppercase">Logo UGEL</div>
                    )}
                </div>
            </div>
            <div className="grid grid-cols-[auto_1fr_auto_auto] gap-0 border-2 border-black bg-[#548235] text-white text-xs font-bold mb-6 rounded-lg overflow-hidden print:mb-2">
                <div className="px-4 py-1.5 border-r border-white">UGEL: <span className="font-normal bg-[#548235] text-white px-2 py-0.5 ml-2 uppercase border border-white/40 rounded">{generalData.ugel || '...'}</span></div>
                <div className="px-4 py-1.5 border-r border-white">INSTITUCIÓN EDUCATIVA: <span className="font-normal bg-[#548235] text-white px-2 py-0.5 ml-2 uppercase border border-white/40 rounded">{generalData.institution || '...'}</span></div>
                <div className="px-4 py-1.5 border-r border-white">DISTRITO: <span className="font-normal bg-[#548235] text-white px-2 py-0.5 ml-2 uppercase border border-white/40 rounded">{generalData.district || '...'}</span></div>
                <div className="px-4 py-1.5">AÑO: <span className="font-normal bg-[#548235] text-white px-2 py-0.5 ml-2 border border-white/40 rounded">{year}</span></div>
            </div>
            <div className="flex gap-4 mb-6 items-start print:mb-2">
                {/* Columna 1: Nota + Resumen General */}
                <div className="flex-1 flex flex-col gap-4">
                    <div className="border border-slate-600 text-[9px] rounded-xl overflow-hidden shadow-sm">
                        <div className="bg-[#a9d08e] font-bold px-3 py-0.5 border-b border-slate-600 italic leading-tight">Nota:</div>
                        <div className="grid grid-cols-[90px_1fr] border-b border-slate-400"><div className="bg-[#548235] text-white px-3 py-0.5 font-bold leading-tight">Inicial</div><div className="bg-[#e2efda] px-3 py-0.5 leading-tight">900 horas efectivas.</div></div>
                        <div className="grid grid-cols-[90px_1fr] border-b border-slate-400"><div className="bg-[#548235] text-white px-3 py-0.5 font-bold leading-tight">Primaria</div><div className="bg-[#e2efda] px-3 py-0.5 leading-tight">1100 horas efectivas.</div></div>
                        <div className="grid grid-cols-[90px_1fr]"><div className="bg-[#548235] text-white px-3 py-0.5 font-bold leading-tight">Secundaria</div><div className="bg-[#e2efda] px-3 py-0.5 leading-tight">JER: 1200 / JEC: 1600 horas.</div></div>
                    </div>

                    <div className="rounded-xl overflow-hidden border border-black shadow-sm">
                        <table className="w-full text-[9px] border-collapse h-full">
                            <tbody>
                                <tr className="border-b border-slate-400">
                                    <td className="bg-[#548235] text-white px-2 py-1 font-bold uppercase text-[9px] border-r border-white/20">Número de secciones</td>
                                    <td className="bg-slate-100 px-3 py-1 text-center font-black text-slate-800">{numUniqueSections.toString().padStart(2, '0')} secciones</td>
                                </tr>
                                <tr className="border-b border-slate-400">
                                    <td className="bg-[#548235] text-white px-2 py-1 font-bold uppercase text-[9px] border-r border-white/20">Número de horas lectivas diarias</td>
                                    <td className="bg-slate-100 px-3 py-1 text-center font-black text-slate-800">{hoursPerDay.toString().padStart(2, '0')} horas lectivas</td>
                                </tr>
                                <tr className="h-full">
                                    <td className="bg-[#548235] text-white px-2 py-1 font-bold uppercase text-[9px] border-r border-white/20">Tipo de organización anual</td>
                                    <td className="bg-slate-100 px-3 py-0.5 text-center font-black text-slate-800 uppercase leading-tight">Bimestral</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Columna 2: Leyenda "Tipos de día" */}
                <div className="flex-1">
                     <div className="rounded-xl overflow-hidden border border-black shadow-sm h-full">
                         <table className="w-full text-[9px] border-collapse">
                            <thead><tr className="bg-[#548235] text-white"><th colSpan={3} className="py-1.5 font-black uppercase tracking-tight">LEYENDA "Tipos de día"</th></tr></thead>
                            <tbody>
                                {LEGEND.filter(l => l.code !== 'I').map(l => (
                                    <tr key={l.code} className="border-t border-slate-400">
                                        <td className={`w-8 text-center font-black border-r border-slate-400 ${l.color} ${l.text} py-0.5 leading-tight`}>{l.code}</td>
                                        <td className="px-3 py-0.5 bg-[#e2efda] uppercase text-[8px] font-bold leading-tight">{l.label}</td>
                                        <td className="w-12 text-center font-black bg-[#e2efda] border-l border-slate-400">{globalStats[l.code] || 0}</td>
                                    </tr>
                                ))}
                            </tbody>
                         </table>
                     </div>
                </div>

                {/* Columna 3: Temporalización Bimestral */}
                <div className="flex-1">
                    <div className="rounded-xl overflow-hidden border border-black shadow-sm h-full">
                        <table className="w-full text-[9px] border-collapse">
                            <thead>
                                <tr className="bg-[#548235] text-white border-b border-slate-400">
                                    <th colSpan={3} className="py-1.5 font-black uppercase tracking-tight">TEMPORALIZACIÓN BIMESTRAL</th>
                                </tr>
                                <tr className="bg-black text-white divide-x divide-white border-b border-white">
                                    <th className="py-0.5 uppercase text-[8px] leading-tight">BIMESTRES</th>
                                    <th className="py-0.5 uppercase text-[8px] leading-tight">INICIO</th>
                                    <th className="py-1 uppercase text-[9px]">TÉRMINO</th>
                                </tr>
                            </thead>
                            <tbody className="text-center font-black bg-[#e2efda] uppercase divide-y divide-slate-400">
                                <tr className="divide-x divide-slate-400">
                                    <td className="py-0.5 px-1 text-left bg-emerald-50/50 leading-tight">I BIMESTRE</td>
                                    <td>{generalData.b1_start}</td>
                                    <td>{generalData.b1_end}</td>
                                </tr>
                                <tr className="divide-x divide-slate-400">
                                    <td className="py-0.5 px-1 text-left bg-emerald-50/50 leading-tight">II BIMESTRE</td>
                                    <td>{generalData.b2_start}</td>
                                    <td>{generalData.b2_end}</td>
                                </tr>
                                <tr className="divide-x divide-slate-400 bg-[#fff2cc] text-amber-900 font-black">
                                    <td className="py-0.5 px-1 text-left leading-tight">VACACIONES</td>
                                    <td>{generalData.vac_start}</td>
                                    <td>{generalData.vac_end}</td>
                                </tr>
                                <tr className="divide-x divide-slate-400">
                                    <td className="py-0.5 px-1 text-left bg-emerald-50/50 leading-tight">III BIMESTRE</td>
                                    <td>{generalData.b3_start}</td>
                                    <td>{generalData.b3_end}</td>
                                </tr>
                                <tr className="divide-x divide-slate-400">
                                    <td className="py-0.5 px-1 text-left bg-emerald-50/50 leading-tight">IV BIMESTRE</td>
                                    <td>{generalData.b4_start}</td>
                                    <td>{generalData.b4_end}</td>
                                </tr>
                                <tr className="divide-x divide-slate-400 bg-[#edf6e8]">
                                    <td className="py-0.5 px-1 text-left font-black text-slate-800 leading-tight">CLAUSURA</td>
                                    <td colSpan={2} className="text-center text-slate-900">{clausuraDate}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            <div className="overflow-hidden border-2 border-black rounded-xl shadow-lg">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="bg-[#548235] text-white text-[10px] uppercase font-bold text-center">
                                <th rowSpan={2} colSpan={2} className="w-20 border-r border-white py-1.5">MES</th>
                                {[1,2,3,4,5,6].map(w => <th key={w} colSpan={7} className="border-r border-white">Semana {w}</th>)}
                                <th className="w-12 bg-[#548235] leading-3 px-1 border-r border-white">N° días</th>
                                <th className="w-16 bg-[#548235] leading-3 px-1 border-r border-white">Horas Lectivas</th>
                                <th className="w-16 bg-[#548235] leading-3 px-1">Horas Efect.</th>
                            </tr>
                            <tr className="bg-[#ffc000] text-black text-[9px] font-bold text-center border-b-2 border-black">
                                {[1,2,3,4,5,6].map(w => (
                                    <React.Fragment key={w}>
                                        <th className="w-5 bg-yellow-300 border-r border-slate-400/50">lu</th><th className="w-5 bg-yellow-300 border-r border-slate-400/50">ma</th><th className="w-5 bg-yellow-300 border-r border-slate-400/50">mi</th><th className="w-5 bg-yellow-300 border-r border-slate-400/50">ju</th><th className="w-5 bg-yellow-300 border-r border-slate-400/50">vi</th><th className="w-5 bg-yellow-300 border-r border-slate-400/50">sá</th><th className="w-5 bg-yellow-300 border-r-2 border-white">do</th>
                                    </React.Fragment>
                                ))}
                                <th className="bg-[#548235] border-r border-white"></th><th className="bg-[#548235] border-r border-white"></th><th className="bg-[#548235]"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {MONTHS_ORDER.map((mIndex, i) => renderMonthRow(mIndex, MONTH_NAMES[i]))}
                            <tr className="bg-[#548235] text-white font-black text-sm border-t-2 border-black">
                                <td colSpan={44} className="text-right pr-6 py-2 uppercase tracking-widest">Total Anual</td>
                                <td className="text-center border-l-2 border-black bg-[#e2f0d9] text-slate-800">{globalStats['A']}</td>
                                <td className="text-center border-l border-slate-300 bg-[#c6e0b4] text-slate-800">{globalStats['A'] * hoursPerDay}</td>
                                <td className="text-center border-l border-slate-300 bg-[#a9d08e] text-slate-800">{globalStats['A'] * hoursPerDay}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 print:mt-2 print:gap-2">
                {INSTITUTIONAL_DATE_TABLES.map((tableRows, tableIndex) => (
                    <div key={tableIndex} className="rounded-xl overflow-hidden border border-black shadow-sm bg-white">
                        <table className="w-full border-collapse text-[9px]">
                            <tbody>
                                {tableRows.map((row, rowIndex) => {
                                    const autoDate = row.key === 'other_important_date'
                                        ? (detectedAreaContest?.date || institutionalAutoDates[row.key])
                                        : institutionalAutoDates[row.key];
                                    const manualDate = String(generalData[row.key] || '');
                                    const effectiveDate = autoDate || manualDate;
                                    const effectiveLabel = row.key === 'other_important_date'
                                        ? (detectedAreaContest?.label || row.label)
                                        : row.label;
                                    return (
                                    <tr key={row.key} className={rowIndex === 0 ? '' : 'border-t border-slate-400'}>
                                        <td className="w-[69%] bg-[#548235] px-2 py-[3px] text-[8px] font-black uppercase tracking-[0.08em] text-white border-r border-white/20 leading-tight">
                                            {effectiveLabel}
                                        </td>
                                        <td className="bg-[#e2efda] px-1 py-[2px] uppercase">
                                            <div className="print:hidden">
                                                {autoDate ? (
                                                    <div className="flex min-h-[18px] items-center justify-between gap-1 rounded-md border border-[#548235]/15 bg-white px-1.5 py-[1px] text-[8px] font-black text-slate-800">
                                                        <span>{formatCalendarInfoDate(effectiveDate)}</span>
                                                        <span className="rounded bg-[#548235]/10 px-1 py-0.5 text-[7px] tracking-[0.08em] text-[#548235]">AUTO</span>
                                                    </div>
                                                ) : (
                                                    <input
                                                        type="date"
                                                        value={manualDate}
                                                        onChange={(e) => void handleInstitutionalDateChange(row.key, e.target.value)}
                                                        className="h-5 w-full rounded-md border border-[#548235]/20 bg-white px-1 py-0 text-[8px] font-black uppercase text-slate-800 outline-none transition focus:border-[#548235] focus:ring-2 focus:ring-[#548235]/20"
                                                    />
                                                )}
                                            </div>
                                            <div className="hidden min-h-[16px] items-center justify-center text-center text-[8px] font-black text-slate-800 print:flex">
                                                {formatCalendarInfoDate(effectiveDate)}
                                            </div>
                                        </td>
                                    </tr>
                                )})}
                            </tbody>
                        </table>
                    </div>
                ))}
            </div>
            {isSavingInstitutionalDates ? (
                <div className="mt-2 text-right text-[9px] font-black uppercase tracking-[0.14em] text-[#548235] print:hidden">
                    Guardando fechas informativas...
                </div>
            ) : null}
            <div className="calendar-ie-print-footer mt-4 hidden items-center justify-between px-1 text-[11px] italic text-slate-500/80 print:mt-2">
                <span>Área: Institucional</span>
                <span>Docente: {generalData.teacher || 'Docente'}</span>
            </div>
        </div>
      );
  }

  return (
    <div className="relative select-none pb-20">
        {activeSection === 'calendario_anual' && (
            <div className="fixed top-1/2 right-12 -translate-y-1/2 flex flex-col gap-10 z-[9999] pointer-events-none">
                <button onClick={handleSave} className="btn-water water-blue !overflow-visible w-24 h-24 rounded-full text-4xl shadow-[0_20px_50px_rgba(0,0,0,0.4)] pointer-events-auto group relative transition-transform hover:scale-110 active:scale-95">
                    <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center text-white">{'\u{1F4BE}'}</span>
                    <span className="relative z-10">💾</span>
                    <span className="tooltip hidden">Guardar Planificación</span>
                    {isDirty && (
                        <span className="absolute -top-3 -right-3 z-30 flex h-8 w-8">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-amber-500 text-[10px] font-black text-white shadow-[0_10px_24px_rgba(245,158,11,0.45)]">!</span>
                        </span>
                    )}
                </button>
                <button onClick={handleResetCalendar} className="btn-water water-red !overflow-visible w-24 h-24 rounded-full text-4xl shadow-[0_20px_50px_rgba(0,0,0,0.4)] pointer-events-auto group relative transition-transform hover:scale-110 active:scale-95">
                    <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center text-white">{'\u{1F5D1}\uFE0F'}</span>
                    <span className="relative z-10">🗑️</span>
                    <span className="tooltip hidden">Limpiar Calendario</span>
                </button>
            </div>
        )}

        {toast && (
            <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[10000] animate-fade-in pointer-events-none">
                <div className={`px-10 py-5 rounded-[2.5rem] shadow-2xl backdrop-blur-xl border border-white/40 flex items-center gap-4 ${toast.type === 'success' ? 'bg-emerald-600/90 text-white' : toast.type === 'warning' ? 'bg-amber-600/90 text-white' : 'bg-rose-600/90 text-white'}`}>
                    <span className="text-2xl">{toast.type === 'success' ? '✅' : toast.type === 'warning' ? '🧹' : '🚫'}</span>
                    <span className="font-black text-sm uppercase tracking-widest">{toast.message}</span>
                </div>
            </div>
        )}

        <div className="animate-fade-in">
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-4">
                    <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                        🗓️ <span className="text-xl">Calendario Académico Anual</span>
                        <span className="text-sm font-normal text-slate-400 mx-2">/</span>
                        <span className="text-base text-blue-600 font-semibold">{year}</span>
                    </h1>
                </div>
                <div className="flex gap-3">
                    <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${isDirty ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                        {isDirty ? '● Cambios sin guardar' : '✓ Sincronizado'}
                    </div>
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6 sticky top-0 z-20 backdrop-blur-md bg-white/90">
                <div className="flex justify-between items-center mb-3">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Herramientas de Pintado:</p>
                    <div className="text-[9px] text-slate-400 font-black uppercase flex gap-4">
                        <span>💡 Click Derecho o Arrastrar (Der) para despintar</span>
                        <span className="text-blue-600">Tip: Mantén presionado para pintar rápido</span>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {LEGEND.filter(l => l.code !== 'D' && l.code !== 'I').map((item) => (
                        <button key={item.code} onClick={() => setSelectedTool(item.code as DayType)} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px] font-black uppercase tracking-tighter transition-all ${selectedTool === item.code ? 'ring-2 ring-offset-1 ring-blue-500 shadow-md transform scale-105' : 'hover:bg-slate-50 opacity-80'} ${item.color} ${item.text} ${item.border}`}>
                            <span className="w-5 h-5 flex items-center justify-center bg-white/50 rounded-full">{item.code}</span>
                            {item.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="bg-[#1e293b] p-6 rounded-[2.5rem] mx-auto shadow-2xl overflow-hidden border border-slate-700">
                <div className="text-center text-white text-3xl font-black pb-8 uppercase tracking-[0.2em] font-serif" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.5)' }}>AÑO ACADÉMICO {year}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {MONTHS_ORDER.slice().sort((a,b)=>a-b).map((idx) => renderMonth(idx))}
                </div>
            </div>
            
            <div className="bg-slate-800 text-slate-300 p-6 rounded-[2rem] mt-6 text-[10px] flex flex-wrap justify-center gap-8 border border-slate-700 shadow-lg">
                <span className="font-black text-white uppercase tracking-[0.25em] border-r border-white/10 pr-6">Leyenda Oficial:</span>
                {LEGEND.filter(l => l.code !== 'I').map(l => (
                    <div key={l.code} className="flex items-center gap-2 group cursor-help">
                        <span className={`w-5 h-5 flex items-center justify-center text-[9px] font-black text-slate-900 rounded-lg shadow-inner group-hover:scale-110 transition-transform ${l.color}`}>{l.code}</span>
                        <span className="font-bold text-slate-400 group-hover:text-white transition-colors uppercase tracking-tighter">{l.label}</span>
                    </div>
                ))}
            </div>
        </div>
    </div>
  );
};
