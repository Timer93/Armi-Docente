
import React, { useState, useEffect, useRef } from 'react';
import { ModuleStatus, ModuleKey, AuthSession } from '../types';
import { saveImageAssetFile } from '../services/apiService';
import { CloudSyncPanel } from './CloudSyncPanel';
import {
  PROFILE_IMAGE_UPDATED_EVENT,
  persistProfileImage,
  readImageFileAsDataUrl,
  resolveProfileImageSource,
} from '../utils/imageStorage';

const ACADEMIC_TITLE_PATTERNS = [
  'lic.',
  'lic',
  'mg.',
  'mg',
  'mgs.',
  'mgs',
  'msc.',
  'msc',
  'mag.',
  'mag',
  'dr.',
  'dr',
  'dra.',
  'dra',
  'ing.',
  'ing',
  'prof.',
  'prof',
  'mtro.',
  'mtro',
  'mtra.',
  'mtra',
];

const normalizeAcademicToken = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const toTitleToken = (value: string) => {
  const cleaned = String(value || '').trim().replace(/\.+$/g, '');
  if (!cleaned) return '';
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1).toLowerCase()}.`;
};

const buildSidebarDisplayName = (rawName?: string, session?: AuthSession | null) => {
  const source = String(rawName || session?.user?.displayName || session?.user?.username || '').trim();
  if (!source) return 'Docente';

  const words = source.split(/\s+/).filter(Boolean);
  if (!words.length) return 'Docente';

  const firstTokenNormalized = normalizeAcademicToken(words[0]);
  const hasAcademicTitle = ACADEMIC_TITLE_PATTERNS.includes(firstTokenNormalized);
  const title = hasAcademicTitle ? toTitleToken(words[0]) : '';
  const nameTokens = hasAcademicTitle ? words.slice(1) : words;

  let visibleNames = nameTokens;
  if (nameTokens.length > 2) {
    visibleNames = nameTokens.slice(2, 5);
  }

  const baseName = visibleNames.join(' ').trim() || source;
  return [title, baseName].filter(Boolean).join(' ').trim();
};

interface SidebarProps {
  status: ModuleStatus;
  currentModule: ModuleKey;
  currentSection?: string;
  onNavigate: (module: ModuleKey, section?: string) => void;
  teacherName?: string;
  isCollapsed: boolean;
  toggleCollapse: () => void;
  moduleAccess?: Partial<Record<ModuleKey, boolean>>;
  onLogout?: () => void;
  userRoleLabel?: string;
  profileSession?: AuthSession | null;
}

interface SubMenuItem {
  id: string;
  label: string;
}

interface MenuItem {
  key: ModuleKey;
  label: string;
  icon: React.ReactNode;
  subItems?: SubMenuItem[];
  separatorBefore?: boolean;
}

const Icons = {
  Dashboard: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z" /></svg>,
  Calendar: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
  Briefcase: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>,
  Users: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
  Clock: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Books: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>,
  Pencil: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>,
  Chart: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  Sun: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
  Moon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>,
  ChevronLeft: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg>,
  ChevronRight: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>,
  Help: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Database: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>,
  Camera: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
};

const MENU_ITEMS: MenuItem[] = [
  { 
    key: 'datos_generales', 
    label: 'Datos Generales', 
    icon: Icons.Dashboard,
    subItems: [
        { id: 'institucion', label: 'Institución' },
        { id: 'responsables', label: 'Responsables' },
        { id: 'contexto', label: 'Contexto' },
        { id: 'calendarizacion', label: 'Calendarización MINEDU' }
    ]
  },
  { 
    key: 'calendario', 
    label: 'Calendario', 
    icon: Icons.Calendar,
    subItems: [
      { id: 'calendario_anual', label: 'Calendario Anual' },
      { id: 'feriados', label: 'Feriados' },
      { id: 'calendarizacion_resumen', label: 'Calendarización IE' }
    ]
  },
  {
    key: 'areas_grados',
    label: 'Áreas y Grados',
    icon: Icons.Briefcase,
    subItems: [
        { id: 'areas', label: 'Áreas a Cargo' },
        { id: 'grados', label: 'Grados a Cargo' },
    ]
  },
  {
    key: 'estudiantes',
    label: 'Estudiantes',
    icon: Icons.Users,
      subItems: [
        { id: 'lista_estudiantes', label: 'Lista de Estudiantes' },
        { id: 'asistencia', label: 'Asistencia' },
        { id: 'retiros_traslados', label: 'Retiros y traslados' },
        { id: 'egresados', label: 'Egresados' },
      ]
    },
  {
    key: 'horario',
    label: 'Horario Semanal',
    icon: Icons.Clock,
    subItems: [
        { id: 'horario_semanal', label: 'Horario semanal' },
        { id: 'resumen_semanal', label: 'Resumen semanal' },
    ]
  },
  { 
    key: 'programacion_anual', 
    label: 'Programación Anual', 
    icon: Icons.Chart, 
    separatorBefore: true,
    subItems: [
        { id: 'planificacion', label: 'Planificación Anual' },
        { id: 'evaluacion_diagnostica', label: 'Evaluación Diagnóstica' }
    ]
  }, 
  { key: 'unidades_didacticas', label: 'Unidades Didácticas', icon: Icons.Books },
  { key: 'sesiones', label: 'Sesiones', icon: Icons.Pencil },
  { 
    key: 'evaluacion', 
    label: 'Evaluación', 
    icon: Icons.Chart,
    subItems: [
        { id: 'instrumentos', label: 'Instrumentos' },
        { id: 'registro', label: 'Registro Auxiliar' },
        { id: 'registro_unidad', label: 'Registro por Unidad' },
        { id: 'registro_bimestre', label: 'Registro por Bimestre' },
        { id: 'evidencias', label: 'Banco de Evidencias' },
        { id: 'reportes', label: 'Análisis y Reportes' },
        { id: 'retroalimentacion', label: 'Retroalimentación IA' },
        { id: 'configuracion', label: 'Configuración' }
    ]
  },
];

export const Sidebar: React.FC<SidebarProps> = ({ status, currentModule, currentSection, onNavigate, teacherName, isCollapsed, toggleCollapse, moduleAccess, onLogout, userRoleLabel, profileSession }) => {
  const appVersion = __APP_VERSION__;
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [expandedMenus, setExpandedMenus] = useState<string[]>(['datos_generales']);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'error' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hiddenEvaluationSubmenuIds = new Set(['registro', 'reportes', 'retroalimentacion', 'configuracion']);
  const visibleMenuItems = MENU_ITEMS
    .filter((item) => moduleAccess?.[item.key] !== false)
    .map((item) => item.key === 'evaluacion'
      ? {
          ...item,
          subItems: Array.isArray(item.subItems)
            ? item.subItems.filter((subItem) => !hiddenEvaluationSubmenuIds.has(subItem.id))
            : item.subItems
        }
      : item
    );
  const sidebarDisplayName = buildSidebarDisplayName(teacherName, profileSession);

  useEffect(() => {
    setProfileImage(resolveProfileImageSource(profileSession, profileSession?.user?.avatarUrl));

    const handleProfileUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<string | null>;
      setProfileImage(customEvent.detail || resolveProfileImageSource(profileSession, profileSession?.user?.avatarUrl));
    };

    window.addEventListener(PROFILE_IMAGE_UPDATED_EVENT, handleProfileUpdated as EventListener);

    return () => {
      window.removeEventListener(PROFILE_IMAGE_UPDATED_EVENT, handleProfileUpdated as EventListener);
    };
  }, [profileSession]);

  const isLocked = (key: ModuleKey, index: number) => {
    if (index === 0) return false;
    const prevKey = visibleMenuItems[index - 1].key;
    return !status[prevKey];
  };

  const toggleSubmenu = (key: string) => {
    setExpandedMenus(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleMenuClick = (item: MenuItem, index: number) => {
    const locked = isLocked(item.key, index);
    
    if (locked) {
        const prevKey = visibleMenuItems[index - 1].key;
        const prevLabel = visibleMenuItems[index - 1].label;
        setToast({ 
            msg: `⚠️ Para entrar aquí, primero debe pulsar el botón "GUARDAR PLANIFICACIÓN" (💾) en el módulo de ${prevLabel}.`, 
            type: 'error' 
        });
        setTimeout(() => setToast(null), 5000);
        return;
    }

    if (item.subItems) {
        if (isCollapsed) {
            toggleCollapse();
            setTimeout(() => toggleSubmenu(item.key), 200);
        } else {
            toggleSubmenu(item.key);
        }
        if (currentModule !== item.key) {
            onNavigate(item.key, item.subItems[0].id);
        }
    } else {
        onNavigate(item.key);
    }
  };

  const getInitials = (name: string) => {
    if (!name) return 'D';
    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          void readImageFileAsDataUrl(file).then((result) => {
              setProfileImage(result);
              persistProfileImage(result, profileSession);
              void saveImageAssetFile({
                  imageData: result,
                  kind: 'profile',
                  userKey: profileSession?.user?.sync?.userKey || profileSession?.user?.id || profileSession?.user?.username,
              });
          });
      }
  };

  return (
    <aside 
        className={`
            h-screen fixed left-0 top-0 z-[100] flex flex-col py-4 pl-4 pr-0 transition-all duration-500 ease-in-out
            ${isCollapsed ? 'w-20' : 'w-72'}
        `}
    >
        {toast && (
            <div className="fixed bottom-10 left-10 z-[1000] animate-fade-in pointer-events-none">
                <div className="bg-slate-900 text-white px-8 py-5 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 flex items-center gap-5 backdrop-blur-2xl">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-2xl shrink-0 animate-pulse">🔒</div>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-500 mb-1">Módulo Bloqueado</span>
                        <p className="text-[11px] font-bold leading-tight max-w-[280px]">{toast.msg}</p>
                    </div>
                </div>
            </div>
        )}

        <button 
            onClick={toggleCollapse}
            className={`
                absolute top-12 -right-3 w-7 h-7 rounded-full flex items-center justify-center shadow-lg z-50 transition-colors border
                ${isDarkMode 
                    ? 'bg-[#27272a] text-slate-300 border-white/10 hover:bg-amber-500 hover:text-white hover:border-amber-500' 
                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                }
            `}
        >
            {isCollapsed ? Icons.ChevronRight : Icons.ChevronLeft}
        </button>

      <div className={`
        relative flex-1 min-h-0 rounded-3xl flex flex-col shadow-2xl overflow-visible transition-all duration-500
        ${isDarkMode 
            ? 'bg-gradient-to-b from-[#18181b] to-[#09090b] text-slate-200 border border-white/5' 
            : 'bg-white text-slate-700 border border-slate-200'
        }
      `}>
        
        <div className={`
            flex items-center transition-all duration-300
            ${isCollapsed ? 'p-4 justify-center flex-col gap-4' : 'p-6 justify-between'}
        `}>
           <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
              <div className="relative group cursor-pointer">
                <div className="w-12 h-12 rounded-full border-2 border-white overflow-hidden shadow-lg flex items-center justify-center bg-gradient-to-tr from-amber-500 to-orange-600">
                    {profileImage ? (
                        <img src={profileImage} alt="Perfil" className="w-full h-full object-cover" />
                    ) : (
                        <span className="text-white font-bold text-sm">
                            {getInitials(sidebarDisplayName)}
                        </span>
                    )}
                </div>
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute -bottom-1 -right-1 bg-slate-800 text-white p-1 rounded-full border border-slate-600 hover:bg-blue-600 transition-colors shadow-sm"
                    title="Cambiar foto"
                >
                    {Icons.Camera}
                </button>
                <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/*"
                    onChange={handleFileChange} 
                />
                <span className="absolute top-0 right-0 w-3 h-3 bg-emerald-400 border-2 border-[#18181b] rounded-full"></span>
              </div>
              <div className={`flex flex-col transition-all duration-300 overflow-hidden ${isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                  <span className={`text-sm font-bold leading-tight whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                    {sidebarDisplayName}
                  </span>
                  <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider whitespace-nowrap">{userRoleLabel || 'Maestro EPT'}</span>
              </div>
           </div>
        </div>

        <div className={`transition-all duration-300 ${isCollapsed ? 'opacity-0 h-0 mb-2' : 'opacity-100 mb-4'}`}>
             <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-8">Menu Principal</h3>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 custom-scrollbar">
            <div className="space-y-2">
                {visibleMenuItems.map((item, index) => {
                    const locked = isLocked(item.key, index);
                    const active = currentModule === item.key;
                    const completed = status[item.key];
                    const isExpanded = expandedMenus.includes(item.key);
                    
                    return (
                        <div key={item.key}>
                            {item.separatorBefore && (
                                <div className={`my-4 border-t ${isDarkMode ? 'border-white/10' : 'border-slate-300'}`}></div>
                            )}
                            <button
                                onClick={() => handleMenuClick(item, index)}
                                title={isCollapsed ? item.label : ''}
                                className={`
                                    w-full flex items-center rounded-2xl text-sm font-medium transition-all duration-300 group relative
                                    ${isCollapsed ? 'justify-center py-3 px-0' : 'justify-between py-3 px-3'}
                                    ${active 
                                        ? (isDarkMode ? 'bg-[#27272a] text-white shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-400/25' : 'bg-slate-100 text-slate-900 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-400/25') 
                                        : (isDarkMode ? 'text-slate-400 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50')
                                    }
                                    ${locked ? 'opacity-40 grayscale cursor-help' : ''}
                                `}
                            >
                                <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
                                    <span className={`transition-transform duration-300 shrink-0 ${active ? 'text-amber-500 scale-110' : 'group-hover:text-slate-300'}`}>
                                        {item.icon}
                                    </span>
                                    <span className={`transition-all duration-300 whitespace-nowrap ${isCollapsed ? 'w-0 opacity-0 overflow-hidden' : 'w-auto opacity-100'}`}>
                                        {item.label}
                                    </span>
                                </div>
                                {active && (!item.subItems || !currentSection) && (
                                    <span
                                        className={`pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.15),0_0_18px_rgba(16,185,129,0.8)] transition-all duration-500 ${isCollapsed ? 'right-1.5' : 'right-3'}`}
                                        style={{ transitionTimingFunction: 'cubic-bezier(0.22, 1.25, 0.36, 1)' }}
                                    />
                                )}
                                {!isCollapsed && locked && (
                                    <span className="text-slate-500 text-[10px] opacity-40 group-hover:opacity-100 transition-opacity">🚫</span>
                                )}
                                {!isCollapsed && item.subItems && !locked && (
                                    <svg 
                                        className={`w-4 h-4 text-slate-500 transition-transform duration-300 ${isExpanded ? 'rotate-90 text-amber-500' : ''}`} 
                                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                )}
                            </button>
                            <div className={`
                                overflow-hidden transition-all duration-300 ease-in-out
                                ${isExpanded && !isCollapsed && !locked ? 'max-h-64 opacity-100 mt-1' : 'max-h-0 opacity-0 mt-0'}
                            `}>
                                {item.subItems && (
                                    <div className="ml-4 flex flex-col relative">
                                        <div className={`absolute left-2.5 top-0 bottom-4 w-px ${isDarkMode ? 'bg-slate-700' : 'bg-slate-300'}`}></div>
                                        {item.subItems.map((sub) => {
                                            const isSubActive = active && currentSection === sub.id;
                                            return (
                                                <div 
                                                    key={sub.id} 
                                                    className={`
                                                        relative pl-8 py-1.5 group cursor-pointer rounded-lg mb-0.5 transition-all
                                                        ${isSubActive 
                                                            ? (isDarkMode ? 'bg-white/10 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-400/20' : 'bg-blue-50 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-400/20') 
                                                            : 'hover:bg-white/5'
                                                        }
                                                    `}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onNavigate(item.key, sub.id);
                                                    }}
                                                >
                                                    <div className={`absolute left-2.5 top-1/2 w-4 h-px ${isSubActive ? 'bg-amber-500' : (isDarkMode ? 'bg-slate-700' : 'bg-slate-300')}`}></div>
                                                    {isSubActive && (
                                                        <span
                                                            className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.15),0_0_18px_rgba(16,185,129,0.8)] transition-all duration-500"
                                                            style={{ transitionTimingFunction: 'cubic-bezier(0.22, 1.25, 0.36, 1)' }}
                                                        />
                                                    )}
                                                    <span className={`
                                                        text-xs font-medium text-left block w-full truncate transition-colors
                                                        ${isSubActive 
                                                            ? (isDarkMode ? 'text-white font-bold' : 'text-blue-700 font-bold') 
                                                            : (isDarkMode ? 'text-slate-500 hover:text-white' : 'text-slate-400 hover:text-slate-800')
                                                        }
                                                    `}>
                                                        {sub.label}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
                 <div className="mt-4 pt-4 border-t border-slate-700/30">
                     <button
                        onClick={() => onNavigate('database_admin' as any)}
                        className={`
                            w-full flex items-center rounded-2xl text-sm font-medium transition-all duration-300 group
                            ${isCollapsed ? 'justify-center py-3 px-0' : 'justify-start py-3 px-3 gap-3'}
                            ${isDarkMode ? 'text-slate-500 hover:text-red-400 hover:bg-white/5' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'}
                        `}
                        title="Administración BD"
                     >
                         <span className="group-hover:scale-110 transition-transform">{Icons.Database}</span>
                         <span className={`transition-all duration-300 whitespace-nowrap ${isCollapsed ? 'w-0 opacity-0 overflow-hidden' : 'w-auto opacity-100'}`}>
                            Administrar BD
                         </span>
                     </button>
                 </div>
            </div>
        </div>

        <div className={`
             mt-auto shrink-0 transition-all duration-500 border-t 
             ${isDarkMode ? 'border-white/5 bg-black/20' : 'border-slate-100 bg-slate-50'}
        `}>
             {onLogout ? (
                <div className={`px-3 pt-3 ${isCollapsed ? 'pb-0' : ''}`}>
                    <button
                        type="button"
                        onClick={onLogout}
                        className={`w-full rounded-2xl border px-3 py-2.5 text-sm font-bold transition ${isDarkMode ? 'border-white/10 bg-white/5 text-slate-200 hover:bg-rose-500/15 hover:text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-rose-50 hover:text-rose-700'}`}
                    >
                        {isCollapsed ? '↦' : 'Cerrar sesión'}
                    </button>
                </div>
             ) : null}
             <div className={`flex items-center py-4 ${isCollapsed ? 'flex-col gap-4' : 'justify-around px-2'}`}>
                <button className={`p-2 rounded-full transition-colors ${isDarkMode ? 'text-slate-500 hover:text-white hover:bg-white/10' : 'text-slate-400 hover:text-slate-800 hover:bg-slate-200'}`}>{Icons.Help}</button>
                <CloudSyncPanel compact />
                <button 
                    onClick={() => setIsDarkMode(!isDarkMode)}
                    className={`p-2 rounded-full transition-all ${isDarkMode ? 'text-amber-400 hover:bg-white/10' : 'text-slate-400 hover:text-slate-800 hover:bg-slate-200'}`}
                 >
                    {isDarkMode ? Icons.Sun : Icons.Moon}
                </button>
             </div>
             {!isCollapsed && (
                 <div className="text-center pb-4 px-4">
                    <p className={`text-[10px] font-medium ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>© 2025 Armi Docente</p>
                    <p className={`mt-1 text-[10px] font-black uppercase tracking-[0.18em] ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>v{appVersion}</p>
                 </div>
             )}
        </div>
      </div>
    </aside>
  );
};
