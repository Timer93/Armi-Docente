
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { CurricularArea, ScheduleConfig, ScheduleEntry, ScheduleBreak, TeachingAssignment } from '../types';
import { getDatosGenerales, updateModuleStatus } from '../services/apiService';

interface Props {
  activeSection: string;
  onSuccess: () => void;
}

const DEFAULT_ACTIVITIES = [
    "Atención a Padres",
    "Atención al Estudiante",
    "Trabajo ColeGIADO",
    "Elaboración de Materiales",
    "Hora de Libre Disponibilidad"
];

const DEFAULT_CONFIG: ScheduleConfig = {
    startTime: '08:00',
    classDuration: 45,
    totalHours: 7, 
    breaks: [
        { id: 'b1', afterHour: 3, duration: 20, label: 'RECREO', shortCode: 'R1' }
    ],
    customActivities: DEFAULT_ACTIVITIES
};

const DAYS = ['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES'] as const;
const UNITS_COUNT = [1, 2, 3, 4, 5, 6, 7, 8];

const AREA_COLORS = [
    'bg-sky-500 text-white border-sky-600', 
    'bg-emerald-500 text-white border-emerald-600', 
    'bg-amber-400 text-black border-amber-500', 
    'bg-indigo-500 text-white border-indigo-600', 
    'bg-rose-400 text-white border-rose-500', 
    'bg-purple-500 text-white border-purple-600',
    'bg-teal-500 text-white border-teal-600',
    'bg-cyan-500 text-white border-cyan-600'
];

const CUSTOM_COLORS = [
    'bg-slate-600 text-white border-slate-700',
    'bg-orange-500 text-white border-orange-600',
    'bg-pink-500 text-white border-pink-600',
    'bg-lime-600 text-white border-lime-700'
];

const CARD_COLOR_OPTIONS = [
    { value: 'preset-sky', label: 'Azul cielo', bg: '#0ea5e9', border: '#0284c7', text: '#ffffff', legacy: 'bg-sky-500 text-white border-sky-600' },
    { value: 'preset-emerald', label: 'Verde esmeralda', bg: '#10b981', border: '#059669', text: '#ffffff', legacy: 'bg-emerald-500 text-white border-emerald-600' },
    { value: 'preset-amber', label: 'Ambar', bg: '#fbbf24', border: '#f59e0b', text: '#111827', legacy: 'bg-amber-400 text-black border-amber-500' },
    { value: 'preset-indigo', label: 'Indigo', bg: '#6366f1', border: '#4f46e5', text: '#ffffff', legacy: 'bg-indigo-500 text-white border-indigo-600' },
    { value: 'preset-rose', label: 'Rosa intenso', bg: '#f43f5e', border: '#e11d48', text: '#ffffff', legacy: 'bg-rose-500 text-white border-rose-600' },
    { value: 'preset-purple', label: 'Morado', bg: '#a855f7', border: '#9333ea', text: '#ffffff', legacy: 'bg-purple-500 text-white border-purple-600' },
    { value: 'preset-teal', label: 'Turquesa', bg: '#14b8a6', border: '#0f766e', text: '#ffffff', legacy: 'bg-teal-500 text-white border-teal-600' },
    { value: 'preset-cyan', label: 'Cian', bg: '#06b6d4', border: '#0891b2', text: '#ffffff', legacy: 'bg-cyan-500 text-white border-cyan-600' },
    { value: 'preset-slate', label: 'Pizarra', bg: '#334155', border: '#1e293b', text: '#ffffff', legacy: 'bg-slate-700 text-white border-slate-800' },
    { value: 'preset-orange', label: 'Naranja', bg: '#f97316', border: '#ea580c', text: '#ffffff', legacy: 'bg-orange-500 text-white border-orange-600' },
    { value: 'preset-pink', label: 'Fucsia', bg: '#ec4899', border: '#db2777', text: '#ffffff', legacy: 'bg-pink-500 text-white border-pink-600' },
    { value: 'preset-lime', label: 'Lima', bg: '#65a30d', border: '#4d7c0f', text: '#ffffff', legacy: 'bg-lime-600 text-white border-lime-700' }
] as const;

const STANDARD_COLOR_OPTIONS = [
    { value: 'standard-red', label: 'Rojo', bg: '#ff0000', border: '#cc0000', text: '#ffffff' },
    { value: 'standard-orange', label: 'Naranja', bg: '#ff9900', border: '#d97706', text: '#111827' },
    { value: 'standard-yellow', label: 'Amarillo', bg: '#ffff00', border: '#d4b000', text: '#111827' },
    { value: 'standard-green', label: 'Verde', bg: '#34c759', border: '#16a34a', text: '#ffffff' },
    { value: 'standard-blue', label: 'Azul', bg: '#007aff', border: '#1d4ed8', text: '#ffffff' },
    { value: 'standard-cyan', label: 'Celeste', bg: '#00c7ff', border: '#0891b2', text: '#111827' },
    { value: 'standard-navy', label: 'Azul oscuro', bg: '#0f3d91', border: '#1e3a8a', text: '#ffffff' },
    { value: 'standard-purple', label: 'Morado', bg: '#7c3aed', border: '#6d28d9', text: '#ffffff' }
] as const;

const TEXT_COLOR_OPTIONS = [
    { value: 'auto', label: 'Auto', color: '#111827', style: 'half' },
    { value: '#ffffff', label: 'Blanco', color: '#ffffff', style: 'solid' },
    { value: '#111827', label: 'Negro', color: '#111827', style: 'solid' },
    { value: '#334155', label: 'Pizarra', color: '#334155', style: 'solid' },
    { value: '#1d4ed8', label: 'Azul', color: '#1d4ed8', style: 'solid' },
    { value: '#be123c', label: 'Rojo vino', color: '#be123c', style: 'solid' }
] as const;

type ScheduleColorMode = 'area' | 'grade_section';

interface ScheduleColorSettings {
    mode: ScheduleColorMode;
    areaColors: Record<string, string>;
    areaTextColors: Record<string, string>;
    gradeSectionColors: Record<string, string>;
    gradeSectionTextColors: Record<string, string>;
    customTypeColors: Record<string, string>;
    customTypeTextColors: Record<string, string>;
}

interface ResolvedCardColor {
    bg: string;
    border: string;
    text: string;
    value: string;
    textValue: string;
}

const DEFAULT_COLOR_SETTINGS: ScheduleColorSettings = {
    mode: 'area',
    areaColors: {},
    areaTextColors: {},
    gradeSectionColors: {},
    gradeSectionTextColors: {},
    customTypeColors: {},
    customTypeTextColors: {}
};

const dayNumberToText = (day: number) => {
    return ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'][day];
};

const isCustomColorValue = (value?: string) => !!value && value.startsWith('custom:');

const hexToRgb = (hex: string) => {
    const normalized = hex.replace('#', '');
    const full = normalized.length === 3 ? normalized.split('').map(char => char + char).join('') : normalized;
    const safeHex = full.padEnd(6, '0').slice(0, 6);
    return {
        r: parseInt(safeHex.slice(0, 2), 16),
        g: parseInt(safeHex.slice(2, 4), 16),
        b: parseInt(safeHex.slice(4, 6), 16)
    };
};

const rgbToHex = (r: number, g: number, b: number) => {
    const toHex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const adjustHexColor = (hex: string, amount: number) => {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHex(r + amount, g + amount, b + amount);
};

const getContrastText = (hex: string) => {
    const { r, g, b } = hexToRgb(hex);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.62 ? '#111827' : '#ffffff';
};

const toProperPlaceName = (value?: string) => {
    if (!value?.trim()) return '';

    const lowercaseWords = new Set([
        'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'al'
    ]);

    return value
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map((word, index) => {
            if (index > 0 && lowercaseWords.has(word)) {
                return word;
            }
            return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ');
};

const getTextTriggerIconStyle = (color: string): React.CSSProperties => ({
    color,
    textShadow: color.toLowerCase() === '#ffffff'
        ? '0 0 0.5px #0f172a, 0 0 2px rgba(15, 23, 42, 0.9)'
        : 'none'
});

const withAlpha = (hex: string, alpha: number) => {
    if (!hex || hex === 'transparent') return 'transparent';
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const ScheduleView: React.FC<Props> = ({ activeSection, onSuccess }) => {
    const [config, setConfig] = useState<ScheduleConfig>(DEFAULT_CONFIG);
    const [entries, setEntries] = useState<ScheduleEntry[]>([]);
    const [areas, setAreas] = useState<CurricularArea[]>([]);
    const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [isColorManagerOpen, setIsColorManagerOpen] = useState(false);
    const [activeColorPopover, setActiveColorPopover] = useState<string | null>(null);
    const [inlinePopoverState, setInlinePopoverState] = useState<{
        id: string;
        top: number;
        left: number;
        width: number;
        openUp: boolean;
    } | null>(null);
    const [configTab, setConfigTab] = useState<'general' | 'breaks' | 'activities'>('general');
    const [isDirty, setIsDirty] = useState(false);
    const [colorSettings, setColorSettings] = useState<ScheduleColorSettings>(DEFAULT_COLOR_SETTINGS);
    
    const [institutionName, setInstitutionName] = useState('Institución Educativa');
    const [year, setYear] = useState(new Date().getFullYear().toString());
    const [insignia, setInsignia] = useState('');
    const [logo, setLogo] = useState('');
    const [generalData, setGeneralData] = useState<any>(null);
    const [calendarMap, setCalendarMap] = useState<Record<string, string>>({});
    
    const [editCell, setEditCell] = useState<{day: string, hourIndex: number} | null>(null);
    const [editType, setEditType] = useState<'class' | 'custom'>('class');
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, day: string, hourIndex: number } | null>(null);
    const [editingActivity, setEditingActivity] = useState<string | null>(null);
    const [editingActivityValue, setEditingActivityValue] = useState('');

    const [tempEntry, setTempEntry] = useState<{
        areaId: string; 
        grade: string; 
        section: string;
        customActivity: string;
    }>({
        areaId: '', 
        grade: '', 
        section: '',
        customActivity: ''
    });

    const dragItem = useRef<{
        type: 'entry' | 'break';
        day?: string;
        hourIndex?: number;
        id?: string;
    } | null>(null);
    
    const [isDragging, setIsDragging] = useState(false);
    const [dragOverHour, setDragOverHour] = useState<number | null>(null);

    useEffect(() => {
        const savedAreas = localStorage.getItem('armi_areas');
        if (savedAreas) setAreas(JSON.parse(savedAreas));
        const savedAssign = localStorage.getItem('armi_assignments');
        if (savedAssign) setAssignments(JSON.parse(savedAssign));
        const savedCalendar = localStorage.getItem('armi_calendar_state');
        if (savedCalendar) setCalendarMap(JSON.parse(savedCalendar));

        const savedConfigStr = localStorage.getItem('armi_schedule_config');
        const savedEntries = localStorage.getItem('armi_schedule_entries');
        const savedColorSettings = localStorage.getItem('armi_schedule_color_settings');

        getDatosGenerales().then(genData => {
            setGeneralData(genData);
            if (genData.institution) setInstitutionName(genData.institution);
            if (genData.year) setYear(genData.year);
            if (genData.insignia) setInsignia(genData.insignia);
            if (genData.logo) setLogo(genData.logo);

            const isJEC = genData.school_shift === 'JEC';
            const calculatedTotalHours = isJEC ? 9 : 7; 

            if (savedConfigStr) {
                const parsed = JSON.parse(savedConfigStr);
                if (!parsed.breaks) parsed.breaks = DEFAULT_CONFIG.breaks;
                if (!parsed.customActivities) parsed.customActivities = DEFAULT_CONFIG.customActivities;
                if (!parsed.totalHours || parsed.totalHours === 7) parsed.totalHours = calculatedTotalHours;
                setConfig(parsed);
            } else {
                const initialBreaks = isJEC 
                        ? [
                            { id: 'b1', afterHour: 2, duration: 15, label: 'RECREO', shortCode: 'R1' },
                            { id: 'b2', afterHour: 5, duration: 30, label: 'ALMUERZO', shortCode: '🍽️' },
                            { id: 'b3', afterHour: 7, duration: 15, label: 'RECREO', shortCode: 'R2' }
                          ]
                        : [{ id: 'b1', afterHour: 3, duration: 30, label: 'RECREO', shortCode: 'R1' }];
                
                setConfig({ ...DEFAULT_CONFIG, totalHours: calculatedTotalHours, breaks: initialBreaks });
            }
        });
        
        if (savedEntries) setEntries(JSON.parse(savedEntries));
        if (savedColorSettings) {
            try {
                setColorSettings({ ...DEFAULT_COLOR_SETTINGS, ...JSON.parse(savedColorSettings) });
            } catch {
                setColorSettings(DEFAULT_COLOR_SETTINGS);
            }
        }

        const closeMenu = () => {
            setContextMenu(null);
            setActiveColorPopover(null);
            setInlinePopoverState(null);
        };
        window.addEventListener('click', closeMenu);
        window.addEventListener('scroll', closeMenu);
        return () => {
            window.removeEventListener('click', closeMenu);
            window.removeEventListener('scroll', closeMenu);
        };
    }, []);

    useEffect(() => {
        if (!activeColorPopover) {
            setInlinePopoverState(null);
        }
    }, [activeColorPopover]);

    const saveAll = async () => {
        console.log('GUARDANDO HORARIO', entries);

        localStorage.setItem('armi_schedule_config', JSON.stringify(config));
        localStorage.setItem('armi_schedule_entries', JSON.stringify(entries));
        localStorage.setItem('armi_schedule_color_settings', JSON.stringify(colorSettings));
        try {
            await updateModuleStatus('horario', entries.length > 0);
            onSuccess();
            setIsDirty(false);
        } catch (e) {
            console.error("Error al actualizar estado del módulo Horario", e);
        }
    };

    const addMinutes = (time: string, mins: number): string => {
        const [h, m] = time.split(':').map(Number);
        const date = new Date();
        date.setHours(h, m + mins);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
    };
    
    const addMinutesRaw = (time: string, mins: number): string => {
        const [h, m] = time.split(':').map(Number);
        const date = new Date();
        date.setHours(h, m + mins);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    };

    const ALL_FILL_OPTIONS = [...STANDARD_COLOR_OPTIONS, ...CARD_COLOR_OPTIONS];

    const resolveColorValue = (value: string, textOverride?: string): ResolvedCardColor => {
        const preset = ALL_FILL_OPTIONS.find(option => option.value === value || ('legacy' in option && option.legacy === value));
        if (preset) {
            return {
                bg: preset.bg,
                border: preset.border,
                text: textOverride && textOverride !== 'auto' ? textOverride : preset.text,
                value: preset.value,
                textValue: textOverride || 'auto'
            };
        }

        if (isCustomColorValue(value)) {
            const hex = value.replace('custom:', '') || '#64748b';
            if (hex === 'transparent') {
                return {
                    bg: 'transparent',
                    border: '#94a3b8',
                    text: textOverride && textOverride !== 'auto' ? textOverride : '#111827',
                    value,
                    textValue: textOverride || 'auto'
                };
            }
            const defaultText = getContrastText(hex);
            return {
                bg: hex,
                border: adjustHexColor(hex, -28),
                text: textOverride && textOverride !== 'auto' ? textOverride : defaultText,
                value,
                textValue: textOverride || 'auto'
            };
        }

        return {
            bg: '#64748b',
            border: '#475569',
            text: textOverride && textOverride !== 'auto' ? textOverride : '#ffffff',
            value: 'custom:#64748b',
            textValue: textOverride || 'auto'
        };
    };

    const getDefaultAreaColor = (areaId: string) => {
        const areaIndex = areas.findIndex(a => a.id === areaId);
        const legacy = areaIndex >= 0 ? AREA_COLORS[areaIndex % AREA_COLORS.length] : 'bg-slate-500 text-white border-slate-600';
        return resolveColorValue(legacy);
    };

    const getDefaultGradeSectionColor = (grade: string, section: string) => {
        const key = `${grade}${section}`;
        let hash = 0;
        for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
        return resolveColorValue(AREA_COLORS[Math.abs(hash) % AREA_COLORS.length]);
    };

    const getDefaultCustomTypeColor = (typeName: string) => {
        let hash = 0;
        for (let i = 0; i < typeName.length; i++) hash = typeName.charCodeAt(i) + ((hash << 5) - hash);
        return resolveColorValue(CUSTOM_COLORS[Math.abs(hash) % CUSTOM_COLORS.length]);
    };

    const getEntryColor = (entry: ScheduleEntry) => {
        if (entry.isCustom) {
            return resolveColorValue(
                colorSettings.customTypeColors[entry.areaName] || getDefaultCustomTypeColor(entry.areaName).value,
                colorSettings.customTypeTextColors[entry.areaName]
            );
        }
        if (colorSettings.mode === 'grade_section') {
            const groupKey = `${entry.grade}::${entry.section}`;
            return resolveColorValue(
                colorSettings.gradeSectionColors[groupKey] || getDefaultGradeSectionColor(entry.grade, entry.section).value,
                colorSettings.gradeSectionTextColors[groupKey]
            );
        }
        return resolveColorValue(
            colorSettings.areaColors[entry.areaId] || getDefaultAreaColor(entry.areaId).value,
            colorSettings.areaTextColors[entry.areaId]
        );
    };

    const getColorControlConfigForEntry = (entry: ScheduleEntry) => {
        if (entry.isCustom) {
            return {
                controlId: `entry-custom-${entry.areaName}`,
                fillValue: colorSettings.customTypeColors[entry.areaName] || getDefaultCustomTypeColor(entry.areaName).value,
                textValue: colorSettings.customTypeTextColors[entry.areaName] || 'auto',
                onFillSelect: (color: string) => handleCustomTypeColorChange(entry.areaName, color),
                onTextSelect: (color: string) => handleCustomTypeTextColorChange(entry.areaName, color)
            };
        }

        if (colorSettings.mode === 'grade_section') {
            const groupKey = `${entry.grade}::${entry.section}`;
            return {
                controlId: `entry-group-${groupKey}`,
                fillValue: colorSettings.gradeSectionColors[groupKey] || getDefaultGradeSectionColor(entry.grade, entry.section).value,
                textValue: colorSettings.gradeSectionTextColors[groupKey] || 'auto',
                onFillSelect: (color: string) => handleGradeSectionColorChange(groupKey, color),
                onTextSelect: (color: string) => handleGradeSectionTextColorChange(groupKey, color)
            };
        }

        return {
            controlId: `entry-area-${entry.areaId}`,
            fillValue: colorSettings.areaColors[entry.areaId] || getDefaultAreaColor(entry.areaId).value,
            textValue: colorSettings.areaTextColors[entry.areaId] || 'auto',
            onFillSelect: (color: string) => handleAreaColorChange(entry.areaId, color),
            onTextSelect: (color: string) => handleAreaTextColorChange(entry.areaId, color)
        };
    };

    const getBadgeStyle = (grade: string, section: string) => {
        const key = `${grade}${section}`;
        let hash = 0;
        for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
        const badgeColors = [
            'bg-white text-slate-800', 'bg-yellow-100 text-yellow-900 border-yellow-300',
            'bg-pink-100 text-pink-900 border-pink-300', 'bg-indigo-100 text-indigo-900 border-indigo-300',
            'bg-lime-100 text-lime-900 border-lime-300', 'bg-orange-100 text-orange-900 border-orange-300'
        ];
        return badgeColors[Math.abs(hash) % badgeColors.length];
    };

    // --- Helpers para Resumen Semanal ---
    const getRowColorClass = (item: any) => {
        const base = getEntryColor(item);
        return base.text === '#111827' ? 'text-slate-700' : 'text-slate-600';
    };

    const getBadgeTextColorClass = (grade: string, section: string) => {
        const key = `${grade}${section}`;
        let hash = 0;
        for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
        const badgeColors = [
            'text-slate-800', 'text-yellow-600',
            'text-pink-600', 'text-indigo-600',
            'text-lime-600', 'text-orange-600'
        ];
        return badgeColors[Math.abs(hash) % badgeColors.length];
    };

    const availableGradesForArea = useMemo(() => {
        if (!tempEntry.areaId) return [];
        const filtered = assignments.filter(a => a.areaId === tempEntry.areaId);
        const uniqueGrades = Array.from(new Set(filtered.map(a => a.grade)));
        return uniqueGrades.sort();
    }, [tempEntry.areaId, assignments]);

    const availableSectionsForAreaGrade = useMemo(() => {
        if (!tempEntry.areaId || !tempEntry.grade) return [];
        const filtered = assignments.filter(a => a.areaId === tempEntry.areaId && a.grade === tempEntry.grade);
        const uniqueSections = Array.from(new Set(filtered.map(a => a.section)));
        return uniqueSections.sort();
    }, [tempEntry.areaId, tempEntry.grade, assignments]);

    const printAreaLabel = useMemo(() => {
        const uniqueAreas = Array.from(
            new Set(
                entries
                    .filter(entry => !entry.isCustom && entry.areaName?.trim())
                    .map(entry => entry.areaName.trim())
            )
        );

        if (uniqueAreas.length > 0) {
            return uniqueAreas.join(' / ');
        }

        const assignedAreas = Array.from(
            new Set(
                assignments
                    .map(assignment => assignment.areaName?.trim())
                    .filter(Boolean) as string[]
            )
        );

        return assignedAreas.length > 0 ? assignedAreas.join(' / ') : '-';
    }, [entries, assignments]);

    const printTeacherLabel = generalData?.teacher?.trim() || '-';
    const districtLabel = toProperPlaceName(generalData?.district) || '-';
    const provinceLabel = toProperPlaceName(generalData?.province);
    const managementWeeksU1 = Math.min(3, Math.max(0, parseInt(generalData?.management_weeks_u1 || '0', 10) || 0));

    const gradeSectionOptions = useMemo(() => {
        const grouped = new Set<string>();
        assignments.forEach(item => {
            if (item.grade && item.section) grouped.add(`${item.grade}::${item.section}`);
        });
        entries.forEach(item => {
            if (!item.isCustom && item.grade && item.section && item.grade !== '-') grouped.add(`${item.grade}::${item.section}`);
        });
        return Array.from(grouped)
            .map(value => {
                const [grade, section] = value.split('::');
                return { key: value, grade, section };
            })
            .sort((a, b) => a.grade.localeCompare(b.grade) || a.section.localeCompare(b.section));
    }, [assignments, entries]);

    const handlePrintSchedule = () => {
        const previousTitle = document.title;
        const printableArea = printAreaLabel !== '-' ? printAreaLabel : 'Horario';
        const printableInstitution = institutionName?.trim() || 'Institucion Educativa';
        const printableLocation = [districtLabel, provinceLabel].filter(Boolean).join(' - ');
        const nextTitle = [printableArea, printableInstitution, printableLocation || year]
            .filter(Boolean)
            .join(' - ');

        document.title = nextTitle;

        const restoreTitle = () => {
            document.title = previousTitle;
            window.removeEventListener('afterprint', restoreTitle);
        };

        window.addEventListener('afterprint', restoreTitle);
        window.print();
        window.setTimeout(restoreTitle, 1000);
    };

    const handleColorModeChange = (mode: ScheduleColorMode) => {
        setColorSettings(prev => ({ ...prev, mode }));
        setIsDirty(true);
    };

    const handleAreaColorChange = (areaId: string, color: string) => {
        setColorSettings(prev => ({
            ...prev,
            areaColors: {
                ...prev.areaColors,
                [areaId]: color
            }
        }));
        setIsDirty(true);
    };

    const handleAreaTextColorChange = (areaId: string, color: string) => {
        setColorSettings(prev => ({
            ...prev,
            areaTextColors: {
                ...prev.areaTextColors,
                [areaId]: color
            }
        }));
        setIsDirty(true);
    };

    const handleGradeSectionColorChange = (key: string, color: string) => {
        setColorSettings(prev => ({
            ...prev,
            gradeSectionColors: {
                ...prev.gradeSectionColors,
                [key]: color
            }
        }));
        setIsDirty(true);
    };

    const handleGradeSectionTextColorChange = (key: string, color: string) => {
        setColorSettings(prev => ({
            ...prev,
            gradeSectionTextColors: {
                ...prev.gradeSectionTextColors,
                [key]: color
            }
        }));
        setIsDirty(true);
    };

    const handleCustomTypeColorChange = (typeName: string, color: string) => {
        setColorSettings(prev => ({
            ...prev,
            customTypeColors: {
                ...prev.customTypeColors,
                [typeName]: color
            }
        }));
        setIsDirty(true);
    };

    const handleCustomTypeTextColorChange = (typeName: string, color: string) => {
        setColorSettings(prev => ({
            ...prev,
            customTypeTextColors: {
                ...prev.customTypeTextColors,
                [typeName]: color
            }
        }));
        setIsDirty(true);
    };

    const handleResetColorSettings = () => {
        setColorSettings({
            mode: 'area',
            areaColors: {},
            areaTextColors: {},
            gradeSectionColors: {},
            gradeSectionTextColors: {},
            customTypeColors: {},
            customTypeTextColors: {}
        });
        setIsDirty(true);
    };

    const openInlineColorPopover = (
        event: React.MouseEvent<HTMLButtonElement>,
        popoverId: string,
        width: number,
        estimatedHeight: number
    ) => {
        event.stopPropagation();
        const nextId = activeColorPopover === popoverId ? null : popoverId;
        setActiveColorPopover(nextId);

        if (!nextId) {
            setInlinePopoverState(null);
            return;
        }

        const rect = event.currentTarget.getBoundingClientRect();
        const gap = 8;
        const spaceBelow = window.innerHeight - rect.bottom;
        const openUp = spaceBelow < estimatedHeight && rect.top > estimatedHeight * 0.45;
        const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
        const top = openUp ? rect.top - gap : rect.bottom + gap;

        setInlinePopoverState({
            id: popoverId,
            top,
            left,
            width,
            openUp
        });
    };

    const renderSelectionMarker = (previewStyle: React.CSSProperties, borderColor: string) => (
        <span
            className="absolute inset-[3px] rounded-[1px] border-2 shadow-[0_0_0_1px_rgba(15,23,42,0.35)]"
            style={{ ...previewStyle, borderColor }}
        />
    );

    const renderSwatchButton = (color: string, isSelected: boolean, onClick: () => void, label: string, textColor = '#ffffff') => (
        <button
            key={label + color}
            type="button"
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            draggable={false}
            onMouseDown={e => e.stopPropagation()}
            className={`relative h-5 w-5 rounded-[2px] border cursor-pointer transition-all hover:scale-110 ${isSelected ? 'border-slate-900 ring-2 ring-slate-900/20' : 'border-slate-300 hover:border-slate-500'}`}
            style={{ backgroundColor: color }}
            title={label}
        >
            {isSelected && renderSelectionMarker({ backgroundColor: color }, textColor)}
        </button>
    );

    const renderTextSwatchButton = (value: string, selectedValue: string, onClick: () => void, label: string, color: string, styleType: string) => (
        <button
            key={value}
            type="button"
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            draggable={false}
            onMouseDown={e => e.stopPropagation()}
            className={`relative h-5 w-5 rounded-[2px] border cursor-pointer transition-all hover:scale-110 ${selectedValue === value ? 'border-slate-900 ring-2 ring-slate-900/20' : 'border-slate-300 hover:border-slate-500'}`}
            style={styleType === 'half' ? { background: 'linear-gradient(135deg, #111827 0 50%, #ffffff 50% 100%)' } : { backgroundColor: color }}
            title={label}
        >
            {selectedValue === value && renderSelectionMarker(
                styleType === 'half'
                    ? { background: 'linear-gradient(135deg, #111827 0 50%, #ffffff 50% 100%)' }
                    : { backgroundColor: color },
                styleType === 'half' ? '#ffffff' : getContrastText(color)
            )}
        </button>
    );

    const renderThemeColorColumns = (currentValue: string, onSelect: (color: string) => void) => {
        const shadeSteps = [190, 130, 70, 0, -55];

        return (
            <div className="border-t border-stone-300 pt-3">
                <div
                    className="grid gap-1"
                    style={{ gridTemplateColumns: `repeat(${CARD_COLOR_OPTIONS.length}, minmax(0, 1fr))` }}
                >
                    {CARD_COLOR_OPTIONS.map(option => (
                        <div key={`theme-column-${option.value}`} className="flex flex-col gap-1">
                            <button
                                type="button"
                                draggable={false}
                                onMouseDown={e => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); onSelect(option.value); setActiveColorPopover(null); }}
                                className={`relative h-[18px] w-[18px] rounded-[2px] border transition-all hover:scale-110 ${currentValue === option.value ? 'border-slate-900 ring-2 ring-slate-900/20' : 'border-slate-300 hover:border-slate-500'}`}
                                style={{ backgroundColor: option.bg }}
                                title={option.label}
                            >
                                {currentValue === option.value && renderSelectionMarker({ backgroundColor: option.bg }, option.text)}
                            </button>
                            {shadeSteps.map((step, index) => {
                                const shadeHex = adjustHexColor(option.bg, step);
                                const shadeValue = `custom:${shadeHex}`;
                                const isSelected = currentValue === shadeValue;
                                return (
                                    <button
                                        key={`${option.value}-shade-${index}`}
                                        type="button"
                                        draggable={false}
                                        onMouseDown={e => e.stopPropagation()}
                                        onClick={(e) => { e.stopPropagation(); onSelect(shadeValue); setActiveColorPopover(null); }}
                                        className={`relative h-[18px] w-[18px] rounded-[2px] border transition-all hover:scale-110 ${isSelected ? 'border-slate-900 ring-2 ring-slate-900/20' : 'border-slate-200 hover:border-slate-500'}`}
                                        style={{ backgroundColor: shadeHex }}
                                        title={`${option.label} tono ${index + 1}`}
                                    >
                                        {isSelected && renderSelectionMarker({ backgroundColor: shadeHex }, getContrastText(shadeHex))}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderThemeTextColumns = (currentValue: string, onSelect: (color: string) => void) => {
        const shadeSteps = [0, -35, -70, -105, -140];

        return (
            <div className="border-t border-stone-300 pt-3">
                <div
                    className="grid gap-1"
                    style={{ gridTemplateColumns: `repeat(${CARD_COLOR_OPTIONS.length}, minmax(0, 1fr))` }}
                >
                    {CARD_COLOR_OPTIONS.map(option => (
                        <div key={`theme-text-column-${option.value}`} className="flex flex-col gap-1">
                            {shadeSteps.map((step, index) => {
                                const shadeHex = adjustHexColor(option.bg, step);
                                const isSelected = currentValue === shadeHex;
                                return (
                                    <button
                                        key={`${option.value}-text-shade-${index}`}
                                        type="button"
                                        draggable={false}
                                        onMouseDown={e => e.stopPropagation()}
                                        onClick={(e) => { e.stopPropagation(); onSelect(shadeHex); setActiveColorPopover(null); }}
                                        className={`relative h-[18px] w-[18px] rounded-[2px] border transition-all hover:scale-110 ${isSelected ? 'border-slate-900 ring-2 ring-slate-900/20' : 'border-slate-200 hover:border-slate-500'}`}
                                        style={{ backgroundColor: shadeHex }}
                                        title={`${option.label} texto tono ${index + 1}`}
                                    >
                                        {isSelected && renderSelectionMarker({ backgroundColor: shadeHex }, getContrastText(shadeHex))}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderCompactColorControl = (

        controlId: string,
        fillValue: string,
        textValue: string,
        onFillSelect: (color: string) => void,
        onTextSelect: (color: string) => void
    ) => {
        const resolvedFill = resolveColorValue(fillValue, textValue);
        const paletteFill = isCustomColorValue(fillValue) ? fillValue.replace('custom:', '') : resolvedFill.bg;
        const paletteText = textValue && textValue !== 'auto' ? textValue : resolvedFill.text;
        const fillPopoverId = `${controlId}:fill`;
        const textPopoverId = `${controlId}:text`;

        return (
            <div className="relative flex items-center gap-1">
                    <div className="relative overflow-visible">
                        <button
                            type="button"
                            draggable={false}
                            onClick={(e) => { e.stopPropagation(); setActiveColorPopover(activeColorPopover === fillPopoverId ? null : fillPopoverId); }}
                            onMouseDown={e => e.stopPropagation()}
                            className="flex h-8 w-10 items-center justify-center rounded border border-slate-400 text-sm text-slate-700 shadow-sm cursor-pointer transition-all hover:brightness-105"
                            style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #e5e7eb 100%)' }}
                            title="Relleno"
                        >
                            <span className="relative inline-flex flex-col items-center leading-none">
                                <span>🪣</span>
                                <span className="mt-0.5 h-[3px] w-5 rounded-full" style={{ backgroundColor: paletteFill === 'transparent' ? '#d6d3d1' : paletteFill }} />
                            </span>
                        </button>
                        {activeColorPopover === fillPopoverId && (
                            <div onClick={e => e.stopPropagation()} className="absolute top-full left-0 mt-2 z-[120] w-[250px] rounded-md border border-stone-300 bg-stone-50 shadow-[0_16px_30px_rgba(0,0,0,0.18)] overflow-hidden">
                                <div className="px-3 py-2 text-sm font-black text-slate-800 border-b border-stone-300">Colores del tema</div>
                                <div className="p-3 space-y-3">
                                    {renderThemeColorColumns(resolvedFill.value, onFillSelect)}
                                    <div className="border-t border-stone-300 pt-3">
                                        <div className="text-sm font-black text-slate-800 mb-2">Colores estándar</div>
                                        <div className="flex flex-wrap gap-1">
                                            {STANDARD_COLOR_OPTIONS.map(option => renderSwatchButton(option.bg, resolvedFill.value === option.value, () => { onFillSelect(option.value); setActiveColorPopover(null); }, option.label, option.text))}
                                        </div>
                                    </div>
                                    <div className="border-t border-stone-300 pt-3 space-y-3">
                                        <button type="button" onClick={() => { onFillSelect('custom:transparent'); setActiveColorPopover(null); }} className="flex items-center gap-3 text-sm text-slate-700 hover:text-slate-900">
                                            <span className="h-6 w-6 border border-slate-400 bg-stone-200 shadow-inner" />
                                            <span className="underline">Sin relleno</span>
                                        </button>
                                        <label className="flex items-center gap-3 text-sm text-slate-700 hover:text-slate-900 cursor-pointer">
                                            <span className="h-6 w-6 rounded-full border border-slate-300 bg-white flex items-center justify-center text-[14px]">🎨</span>
                                            <span className="underline">Mas colores...</span>
                                            <input
                                                type="color"
                                                value={paletteFill === 'transparent' ? '#64748b' : paletteFill}
                                                onChange={e => onFillSelect(`custom:${e.target.value}`)}
                                                onInput={e => onFillSelect(`custom:${(e.target as HTMLInputElement).value}`)}
                                                className="h-7 w-7 cursor-pointer rounded-full border border-slate-300 bg-white p-0"
                                            />
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="relative overflow-visible">
                        <button
                            type="button"
                            draggable={false}
                            onClick={(e) => { e.stopPropagation(); setActiveColorPopover(activeColorPopover === textPopoverId ? null : textPopoverId); }}
                            onMouseDown={e => e.stopPropagation()}
                            className="flex h-8 w-10 items-center justify-center rounded border border-slate-400 text-sm text-slate-700 shadow-sm cursor-pointer transition-all hover:brightness-105"
                            style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #e5e7eb 100%)' }}
                            title="Texto"
                        >
                            <span className="relative inline-flex flex-col items-center leading-none font-black">
                                <span style={getTextTriggerIconStyle(paletteText)}>A</span>
                                <span className="mt-0.5 h-[3px] w-5 rounded-full" style={{ backgroundColor: paletteText }} />
                            </span>
                        </button>
                        {activeColorPopover === textPopoverId && (
                            <div onClick={e => e.stopPropagation()} className="absolute top-full left-0 mt-2 z-[120] w-[250px] rounded-md border border-stone-300 bg-stone-50 shadow-[0_16px_30px_rgba(0,0,0,0.18)] overflow-hidden">
                                <div className="px-3 py-2 text-sm font-black text-slate-800 border-b border-stone-300">Color de texto</div>
                                <div className="p-3 space-y-3">
                                    {renderThemeTextColumns(textValue || paletteText, onTextSelect)}
                                    <div className="flex flex-wrap gap-1.5">
                                        {TEXT_COLOR_OPTIONS.map(option => renderTextSwatchButton(option.value, textValue || 'auto', () => { onTextSelect(option.value); setActiveColorPopover(null); }, option.label, option.color, option.style))}
                                    </div>
                                    <div className="border-t border-stone-300 pt-3">
                                        <label className="flex items-center gap-3 text-sm text-slate-700 hover:text-slate-900 cursor-pointer">
                                            <span className="h-6 w-6 rounded-full border border-slate-300 bg-white flex items-center justify-center text-[14px]">🎨</span>
                                            <span className="underline">Mas colores...</span>
                                            <input
                                                type="color"
                                                value={paletteText}
                                                onChange={e => onTextSelect(e.target.value)}
                                                onInput={e => onTextSelect((e.target as HTMLInputElement).value)}
                                                className="h-7 w-7 cursor-pointer rounded-full border border-slate-300 bg-white p-0"
                                            />
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
            </div>
        );
    };

    const renderInlineEntryColorControl = (entry: ScheduleEntry) => {
        const config = getColorControlConfigForEntry(entry);
        const resolvedFill = resolveColorValue(config.fillValue, config.textValue);
        const paletteFill = isCustomColorValue(config.fillValue) ? config.fillValue.replace('custom:', '') : resolvedFill.bg;
        const paletteText = config.textValue && config.textValue !== 'auto' ? config.textValue : resolvedFill.text;
        const fillPopoverId = `${config.controlId}:fill`;
        const textPopoverId = `${config.controlId}:text`;

        return (
            <>
                <div className="relative">
                    <button
                        type="button"
                        draggable={false}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={(e) => openInlineColorPopover(e, fillPopoverId, 250, 360)}
                        className="w-5 h-5 rounded-full border border-slate-300 shadow-md flex items-center justify-center text-[10px] hover:scale-110 transition-all"
                        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(226,232,240,0.98) 100%)' }}
                        title="Color de relleno"
                    >
                        <span className="relative inline-flex flex-col items-center leading-none">
                            <span className="text-[9px]">🪣</span>
                            <span className="mt-[1px] h-[2px] w-3 rounded-full" style={{ backgroundColor: paletteFill === 'transparent' ? '#d6d3d1' : paletteFill }} />
                        </span>
                    </button>
                    {activeColorPopover === fillPopoverId && inlinePopoverState?.id === fillPopoverId && createPortal(
                        <div
                            onClick={e => e.stopPropagation()}
                            onMouseDown={e => e.stopPropagation()}
                            className="fixed z-[1200] rounded-md border border-stone-300 bg-stone-50 shadow-[0_16px_30px_rgba(0,0,0,0.18)] overflow-hidden"
                            style={{
                                width: `${inlinePopoverState.width}px`,
                                left: `${inlinePopoverState.left}px`,
                                top: `${inlinePopoverState.top}px`,
                                transform: inlinePopoverState.openUp ? 'translateY(-100%)' : 'none'
                            }}
                        >
                            <div className="px-3 py-2 text-sm font-black text-slate-800 border-b border-stone-300">Colores del tema</div>
                            <div className="p-3 space-y-3">
                                {renderThemeColorColumns(resolvedFill.value, config.onFillSelect)}
                                <div className="border-t border-stone-300 pt-3">
                                    <div className="text-sm font-black text-slate-800 mb-2">Colores estándar</div>
                                    <div className="flex flex-wrap gap-1">
                                        {STANDARD_COLOR_OPTIONS.map(option => renderSwatchButton(option.bg, resolvedFill.value === option.value, () => { config.onFillSelect(option.value); setActiveColorPopover(null); }, option.label, option.text))}
                                    </div>
                                </div>
                                <div className="border-t border-stone-300 pt-3 space-y-3">
                                    <button type="button" onClick={() => { config.onFillSelect('custom:transparent'); setActiveColorPopover(null); }} className="flex items-center gap-3 text-sm text-slate-700 hover:text-slate-900">
                                        <span className="h-6 w-6 border border-slate-400 bg-stone-200 shadow-inner" />
                                        <span className="underline">Sin relleno</span>
                                    </button>
                                    <label className="flex items-center gap-3 text-sm text-slate-700 hover:text-slate-900 cursor-pointer">
                                        <span className="h-6 w-6 rounded-full border border-slate-300 bg-white flex items-center justify-center text-[14px]">🎨</span>
                                        <span className="underline">Mas colores...</span>
                                        <input
                                            type="color"
                                            value={paletteFill === 'transparent' ? '#64748b' : paletteFill}
                                            onChange={e => config.onFillSelect(`custom:${e.target.value}`)}
                                            onInput={e => config.onFillSelect(`custom:${(e.target as HTMLInputElement).value}`)}
                                            className="h-7 w-7 cursor-pointer rounded-full border border-slate-300 bg-white p-0"
                                        />
                                    </label>
                                </div>
                            </div>
                        </div>,
                        document.body
                    )}
                </div>
                <div className="relative">
                    <button
                        type="button"
                        draggable={false}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={(e) => openInlineColorPopover(e, textPopoverId, 250, 360)}
                        className="w-5 h-5 rounded-full border border-slate-300 shadow-md flex items-center justify-center text-[10px] hover:scale-110 transition-all"
                        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(226,232,240,0.98) 100%)' }}
                        title="Color de texto"
                    >
                        <span className="relative inline-flex flex-col items-center leading-none font-black">
                            <span style={getTextTriggerIconStyle(paletteText)}>A</span>
                            <span className="mt-[1px] h-[2px] w-3 rounded-full" style={{ backgroundColor: paletteText }} />
                        </span>
                    </button>
                    {activeColorPopover === textPopoverId && inlinePopoverState?.id === textPopoverId && createPortal(
                        <div
                            onClick={e => e.stopPropagation()}
                            onMouseDown={e => e.stopPropagation()}
                            className="fixed z-[1200] rounded-md border border-stone-300 bg-stone-50 shadow-[0_16px_30px_rgba(0,0,0,0.18)] overflow-hidden"
                            style={{
                                width: `${inlinePopoverState.width}px`,
                                left: `${inlinePopoverState.left}px`,
                                top: `${inlinePopoverState.top}px`,
                                transform: inlinePopoverState.openUp ? 'translateY(-100%)' : 'none'
                            }}
                        >
                            <div className="px-3 py-2 text-sm font-black text-slate-800 border-b border-stone-300">Color de texto</div>
                            <div className="p-3 space-y-3">
                                {renderThemeTextColumns(config.textValue || paletteText, config.onTextSelect)}
                                <div className="flex flex-wrap gap-1.5">
                                    {TEXT_COLOR_OPTIONS.map(option => renderTextSwatchButton(option.value, config.textValue || 'auto', () => { config.onTextSelect(option.value); setActiveColorPopover(null); }, option.label, option.color, option.style))}
                                </div>
                                <div className="border-t border-stone-300 pt-3">
                                    <label className="flex items-center gap-3 text-sm text-slate-700 hover:text-slate-900 cursor-pointer">
                                        <span className="h-6 w-6 rounded-full border border-slate-300 bg-white flex items-center justify-center text-[14px]">🎨</span>
                                        <span className="underline">Mas colores...</span>
                                        <input
                                            type="color"
                                            value={paletteText}
                                            onChange={e => config.onTextSelect(e.target.value)}
                                            onInput={e => config.onTextSelect((e.target as HTMLInputElement).value)}
                                            className="h-7 w-7 cursor-pointer rounded-full border border-slate-300 bg-white p-0"
                                        />
                                    </label>
                                </div>
                            </div>
                        </div>,
                        document.body
                    )}
                </div>
            </>
        );
    };

    const summaryData = useMemo(() => {
        const groups: Record<string, any> = {};
        entries.forEach(e => {
            const key = e.isCustom ? `custom-${e.areaName}` : `${e.areaName}-${e.grade}-${e.section}`;
            if (!groups[key]) {
                groups[key] = {
                    areaId: e.areaId,
                    areaName: e.areaName,
                    grade: e.grade,
                    section: e.section,
                    isCustom: e.isCustom,
                    horasSemanales: 0,
                    hoursByDay: {} as Record<string, number[]>
                };
            }
            groups[key].horasSemanales++;
            if (!groups[key].hoursByDay[e.day]) groups[key].hoursByDay[e.day] = [];
            groups[key].hoursByDay[e.day].push(e.hourIndex);
        });

        const countBlocks = (hours: number[]) => {
            if (hours.length === 0) return 0;
            const sorted = [...hours].sort((a, b) => a - b);
            let blocks = 1;
            for (let i = 1; i < sorted.length; i++) {
                const prevHour = sorted[i-1];
                const currentHour = sorted[i];
                const isCorrelative = currentHour === prevHour + 1;
                const hasBreakBetween = config.breaks.some(b => b.afterHour === prevHour);
                if (!isCorrelative || hasBreakBetween) {
                    blocks++;
                }
            }
            return blocks;
        };

        return Object.values(groups).map(g => {
            let clasesSemanales = 0;
            Object.values(g.hoursByDay).forEach((hList: any) => {
                clasesSemanales += countBlocks(hList);
            });

            let totalAnualClases = 0;
            const unitResumes = UNITS_COUNT.map(uIdx => {
                const rawStart = generalData?.[`u${uIdx}_start` || ''];
                const end = generalData?.[`u${uIdx}_end` || ''];
                let start = rawStart;
                let totalClases = 0;
                let fechasClases: string[] = [];

                if (uIdx === 1 && rawStart && managementWeeksU1 > 0) {
                    const shiftedStart = new Date(`${rawStart}T00:00:00`);
                    shiftedStart.setDate(shiftedStart.getDate() + (managementWeeksU1 * 7));
                    const shiftedIso = shiftedStart.toISOString().split('T')[0];
                    if (!end || shiftedIso <= end) {
                        start = shiftedIso;
                    } else {
                        start = end;
                    }
                }

                if (start && end && calendarMap) {
                    let cur = new Date(start + 'T00:00:00');
                    const last = new Date(end + 'T00:00:00');
                    while (cur <= last) {
                        const iso = cur.toISOString().split('T')[0];
                        const dayName = dayNumberToText(cur.getDay());
                        if (calendarMap[iso] === 'A' && g.hoursByDay[dayName]) {
                            totalClases += countBlocks(g.hoursByDay[dayName]);
                            fechasClases.push(iso);
                        }
                        cur.setDate(cur.getDate() + 1);
                    }
                }
                totalAnualClases += totalClases;
                return { uIdx, start, end, totalClases, fechasClases };
            });

            return {
                ...g,
                clasesSemanales,
                totalAnualClases,
                unitResumes
            };
        });
    }, [entries, calendarMap, generalData, config.breaks]);

    const generateRows = () => {
        let currentTime = config.startTime;
        const rows = [];
        const sortedBreaks = [...config.breaks].sort((a,b) => a.afterHour - b.afterHour);
        for (let h = 1; h <= config.totalHours; h++) {
            const endTime = addMinutesRaw(currentTime, config.classDuration);
            rows.push({ type: 'class', index: h, start: addMinutes(currentTime, 0), end: addMinutes(currentTime, config.classDuration) });
            currentTime = endTime;
            const breakFound = sortedBreaks.find(b => b.afterHour === h);
            if (breakFound) {
                const breakEnd = addMinutesRaw(currentTime, breakFound.duration);
                rows.push({ type: 'break', ...breakFound, start: addMinutes(currentTime, 0), end: addMinutes(currentTime, breakFound.duration) });
                currentTime = breakEnd;
            }
        }
        return rows;
    };

    const handleAddBreak = () => {
        const lastHour = config.breaks.length > 0 ? Math.max(...config.breaks.map(b => b.afterHour)) : 2;
        const nextHour = Math.min(lastHour + 2, config.totalHours - 1);
        const newBreak: ScheduleBreak = { id: Date.now().toString(), afterHour: nextHour, duration: 15, label: 'RECREO', shortCode: '' };
        setConfig({...config, breaks: autoLabelBreaks([...config.breaks, newBreak])});
        setIsDirty(true);
    };

    const autoLabelBreaks = (currentBreaks: ScheduleBreak[]) => {
        const sorted = [...currentBreaks].sort((a, b) => a.afterHour - b.afterHour);
        let recreoCount = 0;
        return sorted.map(b => {
            let newCode = '';
            const type = b.label.toUpperCase().includes('ALMUERZO') ? 'ALMUERZO' : 'RECREO';
            if (type === 'ALMUERZO') { newCode = '🍽️'; } else { recreoCount++; newCode = `R${recreoCount}`; }
            return { ...b, shortCode: newCode, label: type }; 
        });
    };

    const handleRemoveBreak = (id: string) => {
        setConfig({...config, breaks: autoLabelBreaks(config.breaks.filter(b => b.id !== id))});
        setIsDirty(true);
    };

    const handleTypeChange = (id: string, newType: string) => {
        const updated = config.breaks.map(b => b.id === id ? { ...b, label: newType, duration: newType === 'ALMUERZO' ? 45 : 15 } : b);
        setConfig({...config, breaks: autoLabelBreaks(updated)});
        setIsDirty(true);
    };

    const handleDurationChange = (id: string, mins: number) => {
        setConfig({...config, breaks: config.breaks.map(b => b.id === id ? { ...b, duration: mins } : b)});
        setIsDirty(true);
    };

    const handleMoveBreak = (id: string, direction: -1 | 1) => {
        const updated = config.breaks.map(b => {
            if (b.id === id) {
                let newHour = b.afterHour + direction;
                if (newHour < 1) newHour = 1;
                if (newHour >= config.totalHours) newHour = config.totalHours - 1;
                return { ...b, afterHour: newHour };
            }
            return b;
        });
        setConfig({...config, breaks: autoLabelBreaks(updated)});
        setIsDirty(true);
    };

    const handleAddCustomActivity = (name: string) => {
        const normalizedName = name.trim();
        if (!normalizedName || config.customActivities.includes(normalizedName)) return;
        setConfig({...config, customActivities: [...config.customActivities, normalizedName]});
        setIsDirty(true);
    };

    const handleRemoveCustomActivity = (name: string) => {
        setConfig({...config, customActivities: config.customActivities.filter(a => a !== name)});
        setIsDirty(true);
    };

    const startEditingCustomActivity = (name: string) => {
        setEditingActivity(name);
        setEditingActivityValue(name);
    };

    const cancelEditingCustomActivity = () => {
        setEditingActivity(null);
        setEditingActivityValue('');
    };

    const handleRenameCustomActivity = (oldName: string, newName: string) => {
        const normalizedName = newName.trim();
        if (!normalizedName || normalizedName === oldName) {
            cancelEditingCustomActivity();
            return;
        }
        if (config.customActivities.includes(normalizedName)) return;

        setConfig(prev => ({
            ...prev,
            customActivities: prev.customActivities.map(activity => activity === oldName ? normalizedName : activity)
        }));

        setEntries(prev => prev.map(entry => (
            entry.isCustom && entry.areaName === oldName
                ? { ...entry, areaName: normalizedName }
                : entry
        )));

        setColorSettings(prev => {
            const customTypeColors = { ...prev.customTypeColors };
            const customTypeTextColors = { ...prev.customTypeTextColors };

            if (oldName in customTypeColors) {
                customTypeColors[normalizedName] = customTypeColors[oldName];
                delete customTypeColors[oldName];
            }

            if (oldName in customTypeTextColors) {
                customTypeTextColors[normalizedName] = customTypeTextColors[oldName];
                delete customTypeTextColors[oldName];
            }

            return {
                ...prev,
                customTypeColors,
                customTypeTextColors
            };
        });

        setTempEntry(prev => prev.customActivity === oldName ? { ...prev, customActivity: normalizedName } : prev);
        setIsDirty(true);
        cancelEditingCustomActivity();
    };

    const handleEntryDragStart = (e: React.DragEvent, day: string, hourIndex: number) => {
        dragItem.current = { type: 'entry', day, hourIndex };
        setIsDragging(true);
        e.dataTransfer.effectAllowed = 'move';
        setDragOverHour(null);
    };

    const handleBreakDragStart = (e: React.DragEvent, breakId: string) => {
        dragItem.current = { type: 'break', id: breakId };
        setIsDragging(true);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragEnd = () => { setIsDragging(false); setDragOverHour(null); dragItem.current = null; };

    const handleDragOver = (e: React.DragEvent, hourIndex: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragItem.current?.type === 'break' && dragOverHour !== hourIndex) setDragOverHour(hourIndex);
    };

    const handleDrop = (e: React.DragEvent, targetDay: string | null, targetHour: number) => {
        e.preventDefault();
        setDragOverHour(null);
        setIsDragging(false);
        if (!dragItem.current) return;
        
        if (dragItem.current.type === 'break') {
            const breakId = dragItem.current.id!;
            if (targetHour >= config.totalHours) targetHour = config.totalHours - 1;
            if (targetHour < 1) targetHour = 1;
            const updated = config.breaks.map(b => b.id === breakId ? { ...b, afterHour: targetHour } : b);
            setConfig({...config, breaks: autoLabelBreaks(updated)});
            setIsDirty(true);
            dragItem.current = null;
            return;
        }

        if (dragItem.current.type === 'entry' && targetDay) {
            const { day: sourceDay, hourIndex: sourceHour } = dragItem.current;
            if (sourceDay === targetDay && sourceHour === targetHour) return;
            const sourceEntry = entries.find(e => e.day === sourceDay && e.hourIndex === sourceHour);
            const targetEntry = entries.find(e => e.day === targetDay && e.hourIndex === targetHour);
            if (!sourceEntry && !targetEntry) return;
            let newEntries = entries.filter(e => !((e.day === sourceDay && e.hourIndex === sourceHour) || (e.day === targetDay && e.hourIndex === targetHour)));
            if (sourceEntry) newEntries.push({ ...sourceEntry, day: targetDay as any, hourIndex: targetHour });
            if (targetEntry) newEntries.push({ ...targetEntry, day: sourceDay as any, hourIndex: sourceHour });
            setEntries(newEntries);
            setIsDirty(true);
            dragItem.current = null;
        }
    };

    const handleContextMenu = (e: React.MouseEvent, day: string, hourIndex: number) => {
        e.preventDefault();
        const hasEntry = entries.some(ent => ent.day === day && ent.hourIndex === hourIndex);
        if (hasEntry) {
            const container = e.currentTarget.closest('.animate-fade-in');
            if (!container) return;
            const rect = container.getBoundingClientRect();
            let x = e.clientX - rect.left;
            let y = e.clientY - rect.top;
            const menuSize = 180;
            const halfSize = menuSize / 2;
            if (x < halfSize) x = halfSize + 10;
            if (x + halfSize > rect.width) x = rect.width - halfSize - 10;
            if (y < halfSize) y = halfSize + 10;
            if (y + halfSize > rect.height) y = rect.height - halfSize - 10;
            setContextMenu({ x, y, day, hourIndex });
        }
    };

    const handleDuplicate = (direction: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT') => {
        const day = contextMenu?.day;
        const hourIndex = contextMenu?.hourIndex;
        if (!day || !hourIndex) return;

        const source = entries.find(e => e.day === day && e.hourIndex === hourIndex);
        if (!source) return;

        let targetDay = day;
        let targetHour = hourIndex;
        const dayIdx = DAYS.indexOf(day as any);

        if (direction === 'UP') targetHour--;
        if (direction === 'DOWN') targetHour++;
        if (direction === 'LEFT' && dayIdx > 0) targetDay = DAYS[dayIdx - 1];
        if (direction === 'RIGHT' && dayIdx < DAYS.length - 1) targetDay = DAYS[dayIdx + 1];

        if (targetHour < 1 || targetHour > config.totalHours || (direction === 'LEFT' && dayIdx === 0) || (direction === 'RIGHT' && dayIdx === DAYS.length - 1)) return;
        
        const isOccupied = entries.some(e => e.day === targetDay && e.hourIndex === targetHour);
        if (isOccupied) return;

        const newEntry: ScheduleEntry = {
            ...source,
            id: `${targetDay}-${targetHour}-${Date.now()}`,
            day: targetDay as any,
            hourIndex: targetHour
        };

        setEntries([...entries, newEntry]);
        setIsDirty(true);
        setContextMenu(null);
    };

    const handleDeleteEntry = (e: React.MouseEvent, day: string, hourIndex: number) => {
        e.stopPropagation();
        setEntries(entries.filter(ent => !(ent.day === day && ent.hourIndex === hourIndex)));
        setIsDirty(true);
    };

    const handleCellClick = (day: string, hourIndex: number) => {
        const existing = entries.find(e => e.day === day && e.hourIndex === hourIndex);
        if (existing) {
             setEditType(existing.isCustom ? 'custom' : 'class');
             setTempEntry({ areaId: existing.isCustom ? '' : existing.areaId, grade: existing.grade, section: existing.section, customActivity: existing.isCustom ? existing.areaName : '' });
        } else {
             setEditType('class');
             setTempEntry({ areaId: '', grade: '', section: '', customActivity: config.customActivities[0] || '' });
        }
        setEditCell({ day, hourIndex });
    };

    const handleSaveCell = () => {
        if (!editCell) return;
        const { day, hourIndex } = editCell;
        const filtered = entries.filter(e => !(e.day === day && e.hourIndex === hourIndex));
        if (editType === 'class') {
            if (tempEntry.areaId && tempEntry.grade && tempEntry.section) {
                const area = areas.find(a => a.id === tempEntry.areaId);
                filtered.push({ id: `${day}-${hourIndex}`, day: day as any, hourIndex, areaId: tempEntry.areaId, areaName: area?.name || '?', grade: tempEntry.grade, section: tempEntry.section, isCustom: false });
            }
        } else if (tempEntry.customActivity) {
            filtered.push({ id: `${day}-${hourIndex}`, day: day as any, hourIndex, areaId: 'custom', areaName: tempEntry.customActivity, grade: '-', section: '-', isCustom: true });
        }
        setEntries(filtered);
        setEditCell(null);
        setIsDirty(true);
    };

    const gridRows = generateRows();

    if (activeSection === 'resumen_semanal') {
        const totalSemanalReal = entries.length;
        const summaryLabelClass = "text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1.5 block";
        const summaryValueClass = "text-lg font-black text-slate-800 font-mono tracking-tight";
        
        return (
            <div className="animate-fade-in print:w-full print:absolute print:top-0 print:left-0 print:z-50 print:bg-white overflow-visible">
                <div className="bg-slate-800 text-white p-4 rounded-t-[2.5rem] mb-0 shadow-lg flex justify-between items-center print:hidden">
                    <h2 className="text-xl font-bold italic font-serif">Reporte de Carga Horaria Detallado</h2>
                    <button onClick={() => window.print()} className="bg-white text-slate-900 px-4 py-1 rounded-lg font-bold hover:bg-slate-200 text-sm flex items-center gap-2"><span>🖨️</span> Imprimir</button>
                </div>
                <div className="bg-white p-10 rounded-b-[2.5rem] border-x border-b border-slate-200 shadow-md min-h-[800px] print:shadow-none print:border-none print:rounded-none overflow-visible">
                     <div className="flex justify-between items-center mb-10 border-b-2 border-black pb-6">
                        <div className="w-20 h-20 rounded-full border-4 border-slate-800 flex items-center justify-center bg-slate-100 overflow-hidden">{insignia ? <img src={insignia} alt="Insignia" className="w-full h-full object-contain" /> : <span className="text-[10px] text-center font-bold">INSIGNIA<br/>IE</span>}</div>
                        <div className="text-center"><h1 className="text-3xl font-black uppercase tracking-wider font-serif">Consolidado de Horas y Clases</h1><p className="text-sm font-bold text-slate-500 mt-2 uppercase tracking-widest">Carga Curricular {year}</p></div>
                        <div className="w-20 h-20 rounded-full border-4 border-slate-800 flex items-center justify-center bg-slate-100 overflow-hidden">{logo ? <img src={logo} alt="Logo" className="w-full h-full object-contain" /> : <span className="text-[10px] text-center font-bold">LOGO<br/>UGEL</span>}</div>
                     </div>

                     <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12 bg-slate-50 p-8 rounded-[3rem] border border-slate-200 shadow-inner relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-100/50 rounded-full -translate-y-16 translate-x-16"></div>
                        <div className="relative flex flex-col"><span className={summaryLabelClass}>Hora de Entrada</span><span className={`${summaryValueClass} text-blue-600 font-mono`}>{addMinutes(config.startTime, 0)}</span></div>
                        <div className="relative flex flex-col border-l border-slate-200 pl-6"><span className={summaryLabelClass}>Horas Diario</span><span className={`${summaryValueClass} font-mono`}>{config.totalHours} <span className="text-[10px] font-bold text-slate-400">Pedag.</span></span></div>
                        <div className="relative flex flex-col border-l border-slate-200 pl-6"><span className={summaryLabelClass}>Duración Hora</span><span className={`${summaryValueClass} font-mono`}>{config.classDuration} <span className="text-[10px] font-bold text-slate-400">min.</span></span></div>
                        <div className="relative flex flex-col border-l border-slate-200 pl-6 bg-indigo-50/50 rounded-2xl p-2 -m-2"><span className={`${summaryLabelClass} text-indigo-500`}>Jornada Laboral</span><span className={`${summaryValueClass} text-indigo-700 font-mono`}>{totalSemanalReal} <span className="text-[10px] font-bold opacity-60">h. sem.</span></span></div>
                     </div>

                     <div className="overflow-visible">
                        {/* Wrapper para bordes redondeados. Se eliminó overflow-hidden y z-indexes fijos para permitir que tooltips floten arriba */}
                        <div className="rounded-[2rem] border border-slate-300 shadow-sm min-w-[1000px] overflow-visible">
                            <table className="w-full text-sm border-separate border-spacing-0 overflow-visible table-fixed">
                                <thead className="bg-slate-900 text-white relative">
                                    <tr className="divide-x divide-white">
                                        <th rowSpan={2} className="px-1 py-4 w-8 text-center text-[8px] font-black uppercase border-b border-white first:rounded-tl-[2rem]">#</th>
                                        <th rowSpan={2} className="px-4 py-4 w-[400px] text-left text-[9px] font-black uppercase tracking-widest border-b border-white">ÁREA / GRADO / SECCIÓN</th>
                                        <th colSpan={2} className="px-2 py-2 text-center bg-slate-800 text-[8px] font-black uppercase border-b border-white">Resumen Semanal</th>
                                        <th colSpan={9} className="px-2 py-2 text-center bg-indigo-900 text-[8px] font-black uppercase border-b border-white last:rounded-tr-[2rem]">Total de Clases por Unidad (Días Lectivos A)</th>
                                    </tr>
                                    <tr className="bg-slate-800 divide-x divide-white border-b border-white">
                                        <th className="py-2 w-14 text-center text-[7px] font-black uppercase">H. SEM</th>
                                        <th className="py-2 w-14 text-center text-[7px] font-black uppercase">SES. SEM</th>
                                        {UNITS_COUNT.map(u => <th key={u} className="py-2 w-12 text-center text-[7px] font-black uppercase">U{u}</th>)}
                                        <th className="py-2 w-14 text-center text-[7px] font-black uppercase bg-indigo-700">TOTAL ANUAL</th>
                                    </tr>
                                </thead>
                                <tbody className="relative">
                                    {summaryData.map((item, idx) => {
                                        const rowTextColor = getRowColorClass(item);
                                        const badgeTextColor = getBadgeTextColorClass(item.grade, item.section);
                                        const summaryCardColor = getEntryColor(item as ScheduleEntry);
                                        const rowTint = withAlpha(summaryCardColor.bg, 0.12);
                                        const rowAccent = withAlpha(summaryCardColor.border, 0.4);
                                        
                                        return (
                                            /* hover:z-[1000] permite que la fila actual y sus tooltips floten por encima de todo el contenedor, incluido el thead */
                                            <tr key={idx} className={`transition-colors group ${rowTextColor} relative hover:z-[1000]`} style={{ backgroundColor: rowTint }}>
                                                <td className="px-1 py-3 text-center font-black opacity-50 font-mono border-r border-b border-slate-300" style={{ backgroundColor: withAlpha(summaryCardColor.bg, 0.08), boxShadow: `inset 4px 0 0 ${rowAccent}` }}>{idx + 1}</td>
                                                <td className="px-4 py-3 border-r border-b border-slate-300" style={{ backgroundColor: withAlpha(summaryCardColor.bg, 0.06) }}>
                                                    <div className="flex flex-col">
                                                        <span className="font-black text-[11px] uppercase leading-tight truncate">{item.areaName}</span>
                                                        {!item.isCustom && <span className={`text-[8px] font-bold uppercase tracking-widest ${badgeTextColor}`}>{item.grade} "{item.section}"</span>}
                                                    </div>
                                                </td>
                                                <td className="px-1 py-3 text-center font-black text-base font-mono border-r border-b border-slate-300 bg-blue-50/20">{item.horasSemanales}</td>
                                                <td className="px-1 py-3 text-center font-black text-base font-mono border-r border-b border-slate-300 bg-emerald-50/20">{item.clasesSemanales}</td>
                                                {item.unitResumes.map((u: any, uIdx: number) => (
                                                    <td key={uIdx} className="px-1 py-3 text-center border-r border-b border-slate-300 group/cell relative overflow-visible cursor-help">
                                                        <span className={`font-black text-sm opacity-90 ${u.totalClases > 0 ? '' : 'text-slate-300 opacity-30'}`}>{u.totalClases || '-'}</span>
                                                        {u.totalClases > 0 && (
                                                            /* z-[99999] para asegurar prioridad máxima dentro del stacking context de la fila */
                                                            <div className="absolute bottom-[110%] left-1/2 -translate-x-1/2 mb-2 w-52 bg-slate-900 text-white rounded-2xl p-4 opacity-0 group-hover/cell:opacity-100 transition-all pointer-events-none shadow-[0_20px_50px_rgba(0,0,0,0.8)] z-[99999] text-left border border-white/10 scale-90 group-hover/cell:scale-100 ring-4 ring-black/5">
                                                                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10">
                                                                    <span className="text-xl">📅</span>
                                                                    <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest leading-none">Sesiones Unidad {u.uIdx}</p>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-2">
                                                                    {u.fechasClases.map((f: string, fi: number) => (
                                                                        <div key={fi} className="flex items-center gap-1.5">
                                                                            <div className="w-1 h-1 rounded-full bg-blue-500"></div>
                                                                            <span className="text-[9px] font-bold opacity-80 font-mono">{f.split('-').reverse().join('/')}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                                <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[8px] border-t-slate-900"></div>
                                                            </div>
                                                        )}
                                                    </td>
                                                ))}
                                                <td className="px-1 py-3 text-center font-black text-base font-mono bg-indigo-50/50 border-l border-b border-slate-300 text-indigo-900">{item.totalAnualClases}</td>
                                            </tr>
                                        );
                                    })}
                                    {summaryData.length === 0 && (<tr><td colSpan={13} className="p-20 text-center text-slate-300 font-black uppercase tracking-[0.3em] bg-slate-50/50">Configure su horario para generar el resumen</td></tr>)}
                                </tbody>
                                <tfoot className="bg-slate-900 text-white relative">
                                    <tr>
                                        <td colSpan={2} className="px-4 py-4 text-right font-black uppercase text-[9px] tracking-widest border-t border-white/10 rounded-bl-[2rem]">Total Jornada Laboral:</td>
                                        <td className="px-2 py-4 text-center font-black text-lg border-l border-white/10 font-mono bg-blue-600">{totalSemanalReal}</td>
                                        <td colSpan={10} className="bg-slate-800 border-t border-white/10 rounded-br-[2rem]"></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                     </div>
                     <div className="mt-8 p-6 bg-amber-50 rounded-[2rem] border border-amber-100 flex items-start gap-4">
                         <span className="text-2xl">💡</span>
                         <div>
                             <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest mb-1">Nota Pedagógica:</p>
                             <p className="text-[10px] font-bold text-amber-700 leading-relaxed uppercase tracking-tight italic">
                                Las clases por unidad se calculan automáticamente considerando bloques consecutivos como una sola sesión, siempre que no haya recreos o almuerzos intermedios. 
                                Se restan los feriados y semanas de diagnóstico configuradas antes de la Unidad 1. 
                                Pase el mouse sobre los números de unidad para ver las fechas exactas de las sesiones programadas.
                             </p>
                         </div>
                     </div>
                </div>
            </div>
        );
    }

    return (
        <div className="animate-fade-in pb-12 select-none relative schedule-print-page print:pb-0 print:bg-white">
            <div className="bg-white rounded-t-[2.5rem] shadow-md border-x border-t border-slate-200 p-6 mb-4 flex justify-between items-center relative overflow-hidden print:rounded-none print:shadow-none print:border-0 print:mb-2 print:p-3">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-600"></div>
                <div className="w-16 h-16 rounded-full border-2 border-slate-100 shadow-inner flex items-center justify-center bg-slate-50 text-[8px] text-center font-bold text-slate-400 overflow-hidden print:w-12 print:h-12">{insignia ? <img src={insignia} alt="Insignia" className="w-full h-full object-contain" /> : "INSIGNIA"}</div>
                <div className="flex-1 px-6 text-center">
                    <h1
                        className="text-[1.85rem] leading-none text-purple-900 print:text-[1.45rem]"
                        style={{ fontFamily: '"Script MT Bold", "Brush Script MT", cursive' }}
                    >
                        Institucion Educativa {institutionName}{generalData?.lugar ? ` - ${generalData.lugar}` : ''}
                    </h1>
                    <p
                        className="mt-1 text-lg leading-none text-purple-900 print:text-[1.3rem]"
                        style={{ fontFamily: '"Kaufmann BT", "Brush Script MT", cursive' }}
                    >
                        {districtLabel}{provinceLabel ? ` - ${provinceLabel}` : ''}
                    </p>
                    <p
                        className="mt-1 text-[1 rem] leading-none text-violet-700 print:text-[1.2rem]"
                        style={{ fontFamily: '"Brush Script MT", cursive' }}
                    >
                        {generalData?.motto?.trim() || `Horario Escolar ${year}`}
                    </p>
                </div>
                <div className="w-16 h-16 rounded-full border-2 border-slate-100 shadow-inner flex items-center justify-center bg-slate-50 text-[8px] text-center font-bold text-slate-400 overflow-hidden print:w-12 print:h-12">{logo ? <img src={logo} alt="Logo" className="w-full h-full object-contain" /> : "UGEL"}</div>
            </div>

            <div className="flex justify-between items-center mb-4 px-2 print:hidden">
                 <div className="flex items-center">
                    <div className="relative inline-flex items-center rounded-full border border-slate-300 bg-white p-1 shadow-sm">
                        <span className={`absolute top-1 bottom-1 w-9 rounded-full bg-slate-900 transition-all duration-200 ${colorSettings.mode === 'area' ? 'left-1' : 'left-10'}`}></span>
                        <button type="button" onClick={() => handleColorModeChange('area')} className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full text-sm transition-colors ${colorSettings.mode === 'area' ? 'text-white' : 'text-slate-500'}`} title="Color por area"><span>🧩</span></button>
                        <button type="button" onClick={() => handleColorModeChange('grade_section')} className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full text-sm transition-colors ${colorSettings.mode === 'grade_section' ? 'text-white' : 'text-slate-500'}`} title="Color por grado y seccion"><span>🎓</span></button>
                    </div>
                 </div>
                 <div className="flex items-center gap-3">
                     <button onClick={() => setIsConfigOpen(!isConfigOpen)} className={`text-xs px-3 py-1.5 rounded-lg border transition-colors font-bold flex items-center gap-2 ${isConfigOpen ? 'bg-slate-200 border-slate-400 text-slate-800' : 'bg-white border-slate-300 text-slate-600'}`}>⚙️ Configuración</button>
                     <button onClick={handlePrintSchedule} className="text-xs px-3 py-1.5 rounded-lg border transition-colors font-bold flex items-center gap-2 bg-white border-slate-300 text-slate-600 hover:bg-slate-50"><span>🖨️</span><span>Imprimir</span></button>
                     <div className="flex gap-2 items-center">
                        {isDirty && <span className="text-[10px] text-amber-600 font-bold animate-pulse bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">● Cambios sin guardar</span>}
                        <button onClick={saveAll} className="bg-emerald-600 text-white px-5 py-2 rounded-lg shadow-lg hover:bg-emerald-700 font-bold text-xs">💾 GUARDAR</button>
                     </div>
                 </div>
            </div>

            {isConfigOpen && (
                <div className="bg-white border border-slate-300 rounded-xl shadow-lg mb-6 overflow-hidden animate-fade-in print:hidden">
                    <div className="flex border-b border-slate-200 bg-slate-50">{['general', 'breaks', 'activities'].map(t => (<button key={t} onClick={() => setConfigTab(t as any)} className={`px-4 py-2 text-xs font-bold capitalize ${configTab === t ? 'bg-white text-blue-600 border-t-2 border-blue-600' : 'text-slate-500'}`}>{t === 'breaks' ? 'Recreos' : t === 'activities' ? 'Actividades' : t}</button>))}</div>
                    <div className="p-4">
                        {configTab === 'general' && (<div className="grid grid-cols-3 gap-4"><div><label className="block text-xs font-bold text-slate-500 mb-1">Inicio:</label><input type="time" className="w-full p-2 rounded border border-slate-300 bg-slate-50" value={config.startTime} onChange={e => setConfig({...config, startTime: e.target.value})} /></div><div><label className="block text-xs font-bold text-slate-500 mb-1">Minutos Clase:</label><input type="number" className="w-full p-2 rounded border border-slate-300 bg-slate-50" value={config.classDuration} onChange={e => setConfig({...config, classDuration: parseInt(e.target.value)})} /></div><div><label className="block text-xs font-bold text-slate-500 mb-1">Total Horas:</label><input type="number" className="w-full p-2 rounded border border-slate-300 bg-slate-50" value={config.totalHours} onChange={e => setConfig({...config, totalHours: parseInt(e.target.value)})} /></div></div>)}
                        {configTab === 'breaks' && (<div><div className="flex justify-between items-center mb-2"><p className="text-xs text-slate-500 italic">💡 Arrastra los recreos en la tabla para reubicarlos.</p><button onClick={handleAddBreak} className="text-xs bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg font-bold hover:bg-blue-200">+ Agregar Bloque</button></div><div className="space-y-2 max-h-52 overflow-y-auto pr-2 custom-scrollbar">{config.breaks.sort((a,b)=>a.afterHour - b.afterHour).map(b => (<div key={b.id} className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200 shadow-sm"><div className="flex flex-col gap-0.5"><button onClick={() => handleMoveBreak(b.id, -1)} className="w-5 h-4 flex items-center justify-center bg-white border border-slate-300 rounded hover:bg-blue-50 text-[8px]" disabled={b.afterHour <= 1}>▲</button><button onClick={() => handleMoveBreak(b.id, 1)} className="w-5 h-4 flex items-center justify-center bg-white border border-slate-300 rounded hover:bg-blue-50 text-[8px]" disabled={b.afterHour >= config.totalHours}>▼</button></div><div className="flex flex-col items-center px-1"><span className="text-[9px] font-bold text-slate-400 uppercase">Después de</span><span className="text-sm font-black text-slate-700">Hora {b.afterHour}</span></div><div className="h-8 w-px bg-slate-300 mx-1"></div><div className="flex-1"><select className="w-full text-xs p-1.5 rounded border border-slate-300 bg-white font-bold" value={b.label} onChange={e => handleTypeChange(b.id, e.target.value)}><option value="RECREO">RECREO</option><option value="ALMUERZO">ALMUERZO</option></select></div><div className="w-16"><input type="number" className="w-full p-1.5 text-xs border border-slate-300 rounded text-center font-bold" value={b.duration} onChange={e => handleDurationChange(b.id, parseInt(e.target.value))} /></div><div className="w-12 text-center"><div className={`text-xs font-black py-1.5 rounded ${b.label === 'ALMUERZO' ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}`}>{b.shortCode}</div></div><button onClick={() => handleRemoveBreak(b.id)} className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:text-red-500 ml-1">✕</button></div>))}</div></div>)}
                        {configTab === 'activities' && (
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <p className="text-xs text-slate-500 italic">Actividades sin grado/sección.</p>
                                    <div className="flex gap-2">
                                        <input id="newAct" type="text" className="p-1 text-xs border rounded" placeholder="Nueva..." />
                                        <button
                                            onClick={() => {
                                                const el = document.getElementById('newAct') as HTMLInputElement;
                                                handleAddCustomActivity(el.value);
                                                el.value = '';
                                            }}
                                            className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {config.customActivities.map(act => (
                                        <div key={act} className="bg-slate-50 p-2 rounded border text-xs">
                                            {editingActivity === act ? (
                                                <div className="space-y-2">
                                                    <input
                                                        autoFocus
                                                        type="text"
                                                        value={editingActivityValue}
                                                        onChange={e => setEditingActivityValue(e.target.value)}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') handleRenameCustomActivity(act, editingActivityValue);
                                                            if (e.key === 'Escape') cancelEditingCustomActivity();
                                                        }}
                                                        className="w-full rounded border border-blue-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500"
                                                    />
                                                    <div className="flex justify-end gap-2">
                                                        <button onClick={cancelEditingCustomActivity} className="px-2 py-1 rounded bg-slate-200 text-slate-600 text-[11px] font-bold">Cancelar</button>
                                                        <button onClick={() => handleRenameCustomActivity(act, editingActivityValue)} className="px-2 py-1 rounded bg-blue-600 text-white text-[11px] font-bold">Guardar</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex justify-between items-center gap-2">
                                                    <span className="flex-1">{act}</span>
                                                    <div className="flex items-center gap-2">
                                                        <button onClick={() => startEditingCustomActivity(act)} className="text-blue-500 hover:text-blue-700 font-bold" title="Editar actividad">✎</button>
                                                        <button onClick={() => handleRemoveCustomActivity(act)} className="text-red-400 hover:text-red-600" title="Eliminar actividad">×</button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {isColorManagerOpen && (
                <div className="fixed inset-0 z-[10020] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-5xl max-h-[88vh] overflow-hidden rounded-[2rem] bg-white shadow-2xl border border-slate-200 animate-fade-in">
                        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 bg-slate-50">
                            <div>
                                <h2 className="text-lg font-black uppercase tracking-tight text-slate-800">Administrador de color de tarjetas</h2>
                                <p className="text-xs font-medium text-slate-500">Seleccione si el horario se colorea por area o por grado y seccion, y asigne colores propios a cada tipo de actividad.</p>
                            </div>
                            <button onClick={() => setIsColorManagerOpen(false)} className="w-10 h-10 rounded-full border border-slate-300 text-slate-500 hover:text-slate-800 hover:bg-white text-lg">×</button>
                        </div>

                        <div className="overflow-y-auto max-h-[calc(88vh-88px)] p-6 space-y-6">
                            <div className="grid md:grid-cols-2 gap-4">
                                <button onClick={() => handleColorModeChange('area')} className={`text-left rounded-2xl border p-4 transition-all ${colorSettings.mode === 'area' ? 'border-blue-500 bg-blue-50 shadow-md' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-2">Modo principal</div>
                                    <div className="text-sm font-black text-slate-800">Colorear por area</div>
                                    <div className="text-xs text-slate-500 mt-1">Todas las tarjetas de la misma area comparten color.</div>
                                </button>
                                <button onClick={() => handleColorModeChange('grade_section')} className={`text-left rounded-2xl border p-4 transition-all ${colorSettings.mode === 'grade_section' ? 'border-blue-500 bg-blue-50 shadow-md' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-2">Modo principal</div>
                                    <div className="text-sm font-black text-slate-800">Colorear por grado y seccion</div>
                                    <div className="text-xs text-slate-500 mt-1">Todas las tarjetas del mismo grupo comparten color, sin importar el area.</div>
                                </button>
                            </div>

                            <div className="rounded-[2rem] border border-slate-200 overflow-visible">
                                <div className="px-5 py-4 bg-slate-900 text-white">
                                    <h3 className="text-sm font-black uppercase tracking-widest">Colores por area</h3>
                                </div>
                                <div className="p-4 grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                                    {areas.length === 0 && <div className="text-sm text-slate-500">No hay areas disponibles todavia.</div>}
                                    {areas.map(area => (
                                        <div key={area.id} className="rounded-xl border border-slate-200 p-3 bg-slate-50 overflow-visible">
                                            <div className="flex items-center justify-between gap-3 mb-2">
                                                <div>
                                                    <div className="text-xs font-black uppercase tracking-widest text-slate-400">Area</div>
                                                    <div className="text-sm font-black text-slate-800">{area.name}</div>
                                                </div>
                                            </div>
                                            {renderCompactColorControl(
                                                `area-${area.id}`,
                                                colorSettings.areaColors[area.id] || getDefaultAreaColor(area.id).value,
                                                colorSettings.areaTextColors[area.id] || 'auto',
                                                color => handleAreaColorChange(area.id, color),
                                                color => handleAreaTextColorChange(area.id, color)
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-[2rem] border border-slate-200 overflow-visible">
                                <div className="px-5 py-4 bg-slate-900 text-white">
                                    <h3 className="text-sm font-black uppercase tracking-widest">Colores por grado y seccion</h3>
                                </div>
                                <div className="p-4 grid sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                                    {gradeSectionOptions.length === 0 && <div className="text-sm text-slate-500">No hay combinaciones de grado y seccion disponibles todavia.</div>}
                                    {gradeSectionOptions.map(group => (
                                        <div key={group.key} className="rounded-xl border border-slate-200 p-3 bg-slate-50 overflow-visible">
                                            <div className="flex items-center justify-between gap-3 mb-2">
                                                <div>
                                                    <div className="text-xs font-black uppercase tracking-widest text-slate-400">Grupo</div>
                                                    <div className="text-sm font-black text-slate-800">{group.grade} "{group.section}"</div>
                                                </div>
                                            </div>
                                            {renderCompactColorControl(
                                                `group-${group.key}`,
                                                colorSettings.gradeSectionColors[group.key] || getDefaultGradeSectionColor(group.grade, group.section).value,
                                                colorSettings.gradeSectionTextColors[group.key] || 'auto',
                                                color => handleGradeSectionColorChange(group.key, color),
                                                color => handleGradeSectionTextColorChange(group.key, color)
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-[2rem] border border-slate-200 overflow-visible">
                                <div className="px-5 py-4 bg-slate-900 text-white">
                                    <h3 className="text-sm font-black uppercase tracking-widest">Colores por tipo de actividad</h3>
                                </div>
                                <div className="p-4 grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                                    {config.customActivities.length === 0 && <div className="text-sm text-slate-500">No hay tipos de actividad configurados todavia.</div>}
                                    {config.customActivities.map(activity => (
                                        <div key={activity} className="rounded-xl border border-slate-200 p-3 bg-slate-50 overflow-visible">
                                            <div className="flex items-center justify-between gap-3 mb-2">
                                                <div>
                                                    <div className="text-xs font-black uppercase tracking-widest text-slate-400">Tipo</div>
                                                    <div className="text-sm font-black text-slate-800">{activity}</div>
                                                </div>
                                            </div>
                                            {renderCompactColorControl(
                                                `custom-${activity}`,
                                                colorSettings.customTypeColors[activity] || getDefaultCustomTypeColor(activity).value,
                                                colorSettings.customTypeTextColors[activity] || 'auto',
                                                color => handleCustomTypeColorChange(activity, color),
                                                color => handleCustomTypeTextColorChange(activity, color)
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex justify-between items-center gap-3 pt-2">
                                <button onClick={handleResetColorSettings} className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 bg-white hover:bg-slate-50 text-xs font-bold uppercase tracking-widest">Restablecer colores</button>
                                <button onClick={() => setIsColorManagerOpen(false)} className="px-5 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-xs font-bold uppercase tracking-widest">Cerrar</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="relative bg-white shadow-2xl rounded-2xl overflow-visible border border-slate-300 print:shadow-none print:border print:border-slate-300 print:rounded-2xl">
                <div className="rounded-2xl overflow-hidden">
                <table className="w-full border-collapse table-fixed print:text-[10px]">
                    <thead className="bg-slate-800 text-white uppercase text-xs tracking-wider font-bold print:text-[9px]">
                        <tr><th className="py-4 px-1 w-10 text-center border-r-2 border-white print:py-3">H</th><th className="py-4 px-1 w-24 text-center border-r-2 border-white print:py-3 print:w-20">Hora</th>{DAYS.map(d => <th key={d} className="py-4 px-1 border-r-2 border-white last:border-0 print:py-3">{d}</th>)}</tr>
                    </thead>
                    <tbody className="text-xs print:text-[9px]">
                        {gridRows.map((row, idx) => {
                            const isGhost = isDragging && dragOverHour === row.index && dragItem.current?.type === 'break';
                            if (row.type !== 'class') {
                                const isLunch = row.label === 'ALMUERZO';
                                return (
                                    <tr key={`break-${idx}`} className={`${isLunch ? "bg-orange-50" : "bg-emerald-50"} cursor-grab active:cursor-grabbing hover:brightness-95 transition-all`} draggable onDragStart={(e) => handleBreakDragStart(e, (row as any).id)} onDragEnd={handleDragEnd} onDragOver={(e) => handleDragOver(e, row.index as number)}>
                                        <td className={`text-center py-2 border-r font-bold text-[10px] print:py-3 ${isLunch ? 'bg-orange-100 text-orange-800' : 'bg-emerald-100 text-emerald-800'}`}>{row.shortCode}</td>
                                        <td className={`text-center py-2 border-r font-mono text-[10px] print:py-3 ${isLunch ? 'bg-orange-50 text-orange-800' : 'bg-emerald-50 text-emerald-800'}`}><div>{row.start}</div><div>{row.end}</div></td>
                                        <td colSpan={5} className="text-center py-1 border-t border-b print:py-2"><div className={`mx-auto w-1/2 rounded-full text-[10px] font-bold uppercase tracking-[0.2em] shadow-sm py-0.5 print:py-1 ${isLunch ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}`}>{row.label} ({row.duration} min)</div></td>
                                    </tr>
                                )
                            }
                            return (
                                <React.Fragment key={`h-${row.index}`}>
                                    <tr className={`border-b border-slate-100 last:border-0 transition-all ${isGhost ? 'bg-blue-50/50' : 'hover:bg-slate-50'}`} onDragOver={(e) => handleDragOver(e, row.index as number)} onDrop={(e) => handleDrop(e, null, row.index as number)}>
                                        <td className="bg-slate-50 text-slate-500 text-center font-black border-r-2 border-white text-sm print:text-base">{row.index}</td>
                                        <td className="text-slate-500 text-center font-medium border-r-2 border-white text-[10px] px-1 leading-tight print:text-[11px]"><div>{row.start}</div><div className="text-slate-400">{row.end}</div></td>
                                        {DAYS.map(day => {
                                            const entry = entries.find(e => e.day === day && e.hourIndex === row.index);
                                            return (
                                                <td key={day} 
                                                    onContextMenu={(e) => handleContextMenu(e, day, row.index as number)}
                                                    onClick={() => handleCellClick(day, row.index as number)} 
                                                    onDragOver={(e) => handleDragOver(e, row.index as number)} 
                                                    onDrop={(e) => handleDrop(e, day, row.index as number)} 
                                                    className="border-r-2 border-white p-1 h-20 align-top relative group last:border-0 bg-slate-50/30 z-0 hover:z-[170] print:h-[5.25rem] print:p-1"
                                                >
                                                    {!entry && <div className="w-full h-full rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer"><span className="text-slate-300 font-bold text-lg">+</span></div>}
                                                    {entry && (
                                                        <div
                                                            draggable
                                                            onDragStart={(e) => handleEntryDragStart(e, day, row.index as number)}
                                                            onDragEnd={handleDragEnd}
                                                            className={`w-full h-full rounded-xl p-2 shadow-sm border cursor-grab active:cursor-grabbing hover:scale-[1.02] transition-transform flex flex-col justify-between text-center overflow-visible print:p-1.5 print:rounded-lg ${isDragging ? 'opacity-90 scale-95' : 'opacity-100'}`}
                                                            style={{
                                                                backgroundColor: getEntryColor(entry).bg,
                                                                borderColor: getEntryColor(entry).border,
                                                                color: getEntryColor(entry).text
                                                            }}
                                                        >
                                                            <div className="absolute -top-1 -right-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 hover:opacity-100 transition-all z-[160] print:hidden">
                                                                {renderInlineEntryColorControl(entry)}
                                                                <button 
                                                                onClick={(e) => { e.stopPropagation(); handleDeleteEntry(e, day, row.index as number); }}
                                                                className="w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center text-[10px] font-black hover:scale-125 transition-all shadow-md border border-white"
                                                                title="Eliminar registro"
                                                            >
                                                                ×
                                                                </button>
                                                            </div>
                                                            <div className="font-bold text-[10px] uppercase leading-tight line-clamp-3 drop-shadow-md pr-1 print:text-[15px]">{entry.areaName}</div>
                                                            {!entry.isCustom && <div className="flex justify-center mt-1 print:mt-1"><span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase shadow-sm border print:text-[7.5px] ${getBadgeStyle(entry.grade, entry.section)}`}>{entry.grade} "{entry.section}"</span></div>}
                                                        </div>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                    {isGhost && (
                                        <tr className="animate-pulse bg-blue-100 border-y-2 border-blue-400" onDragOver={(e) => handleDragOver(e, row.index as number)} onDrop={(e) => handleDrop(e, null, row.index as number)}>
                                            <td colSpan={7} className="h-8 text-center align-middle"><div className="flex items-center justify-center gap-2 text-blue-600 font-bold text-xs uppercase tracking-widest"><span>⬇️ Soltar aquí</span><span className="text-[10px] opacity-70">(Después de Hora {row.index})</span></div></td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
                </div>
            </div>

            <div className="hidden print:flex items-center justify-between gap-6 px-2 pt-3 text-[10px] font-bold text-slate-700">
                <div className="min-w-0 flex-1 border-t border-slate-400 pt-1.5">
                    <span className="uppercase tracking-wide text-slate-500">Area curricular: </span>
                    <span className="text-slate-900">{printAreaLabel}</span>
                </div>
                <div className="min-w-0 flex-1 border-t border-slate-400 pt-1.5 text-right">
                    <span className="uppercase tracking-wide text-slate-500">Docente: </span>
                    <span className="text-slate-900">{printTeacherLabel}</span>
                </div>
            </div>

            {contextMenu && (
                <div 
                    className="absolute z-[1000] bg-white rounded-2xl shadow-[0_30px_60px_rgba(0,0,0,0.4)] border border-slate-200 p-3 min-w-[160px] animate-fade-in ring-4 ring-black/5 print:hidden"
                    style={{ 
                        left: `${contextMenu.x}px`, 
                        top: `${contextMenu.y}px`,
                        transform: 'translate(-50%, -50%)' 
                    }}
                    onClick={e => e.stopPropagation()}
                    onContextMenu={e => e.preventDefault()}
                >
                    <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 text-center border-b border-slate-50 pb-2">Duplicar en Vacío</div>
                    <div className="grid grid-cols-3 gap-2 justify-items-center items-center">
                        <div className="col-start-2">
                            <button onClick={() => handleDuplicate('UP')} title="Duplicar Arriba" className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all border border-slate-200 shadow-sm text-lg font-black">↑</button>
                        </div>
                        <div className="col-start-1 row-start-2">
                            <button onClick={() => handleDuplicate('LEFT')} title="Duplicar Izquierda" className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all border border-slate-200 shadow-sm text-lg font-black">←</button>
                        </div>
                        <div className="col-start-2 row-start-2">
                            <button onClick={() => setContextMenu(null)} className="w-8 h-8 rounded-full text-slate-300 hover:text-slate-600 transition-colors flex items-center justify-center font-bold text-xs">✕</button>
                        </div>
                        <div className="col-start-3 row-start-2">
                            <button onClick={() => handleDuplicate('RIGHT')} title="Duplicar Derecha" className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all border border-slate-200 shadow-sm text-lg font-black">→</button>
                        </div>
                        <div className="col-start-2 row-start-3">
                            <button onClick={() => handleDuplicate('DOWN')} title="Duplicar Abajo" className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all border border-slate-200 shadow-sm text-lg font-black">↓</button>
                        </div>
                    </div>
                </div>
            )}

            {editCell && (
                <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center animate-fade-in backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-80 overflow-hidden transform scale-100 transition-all">
                        <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center">
                            <h3 className="font-bold text-slate-700">Editar Bloque</h3>
                            <button onClick={() => setEditCell(null)} className="text-slate-400 hover:text-slate-600">✕</button>
                        </div>
                        <div className="flex border-b border-slate-200">
                            <button onClick={() => setEditType('class')} className={`flex-1 py-3 text-xs font-bold uppercase ${editType === 'class' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'bg-slate-50 text-slate-400'}`}>🏫 Clase</button>
                            <button onClick={() => setEditType('custom')} className={`flex-1 py-3 text-xs font-bold uppercase ${editType === 'custom' ? 'bg-white text-pink-600 border-b-2 border-pink-600' : 'bg-slate-50 text-slate-400'}`}>✨ Actividad</button>
                        </div>
                        <div className="p-6 space-y-4">
                            {editType === 'class' ? (
                                <>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 block mb-1">Área Curricular</label>
                                        <select className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-slate-50 outline-none focus:border-blue-500 font-bold" value={tempEntry.areaId} onChange={e => setTempEntry({ ...tempEntry, areaId: e.target.value, grade: '', section: '' })}>
                                            <option value="">Elija el área...</option>
                                            {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div><label className="text-xs font-bold text-slate-500 block mb-1">Grado</label><select className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-slate-50 outline-none focus:border-blue-500 font-black disabled:opacity-50" value={tempEntry.grade} disabled={!tempEntry.areaId} onChange={e => setTempEntry({...tempEntry, grade: e.target.value, section: ''})}><option value="">Seleccionar...</option>{availableGradesForArea.map(g => <option key={g} value={g}>{g}</option>)}</select></div>
                                        <div><label className="text-xs font-bold text-slate-500 block mb-1">Sección</label><select className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-slate-50 outline-none focus:border-blue-500 font-black disabled:opacity-50" value={tempEntry.section} disabled={!tempEntry.grade} onChange={e => setTempEntry({...tempEntry, section: e.target.value})}><option value="">Seleccionar...</option>{availableSectionsForAreaGrade.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                                    </div>
                                </>
                            ) : (
                                <div>
                                    <label className="text-xs font-bold text-slate-500 block mb-1">Tipo de Actividad</label>
                                    <select className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-pink-50 text-pink-900 font-bold" value={tempEntry.customActivity} onChange={e => setTempEntry({...tempEntry, customActivity: e.target.value})}>{config.customActivities.map(act => <option key={act} value={act}>{act}</option>)}</select>
                                </div>
                            )}
                        </div>
                        <div className="p-4 bg-slate-50 flex justify-end gap-2 border-t border-slate-200">
                            <button onClick={() => setEditCell(null)} className="px-4 py-2 text-slate-500 font-bold text-xs">Cancelar</button>
                            <button onClick={handleSaveCell} className={`px-6 py-2 text-white font-bold text-xs rounded-lg shadow-lg ${editType === 'class' ? 'bg-gradient-to-r from-blue-600 to-indigo-600' : 'bg-gradient-to-r from-pink-500 to-rose-500'}`}>Asignar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
