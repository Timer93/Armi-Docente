
import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { DatosGeneralesView } from './components/DatosGeneralesView';
import { CalendarView } from './components/CalendarView';
import { AreasGradosView } from './components/AreasGradosView';
import { StudentsView } from './components/StudentsView';
import { ScheduleView } from './components/ScheduleView';
import { AnnualProgramView } from './components/AnnualProgramView';
import { DatabaseManager } from './components/DatabaseManager';
import { UnitsView } from './components/UnitsView';
import { SessionsView } from './components/SessionsView';
import { EvaluationView } from './components/evaluation/EvaluationView';
import { SyncLifecycleManager } from './components/SyncLifecycleManager';
import { AppUpdaterOverlay } from './components/AppUpdaterOverlay';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { ModuleStatus, ModuleKey } from './types';
import { INITIAL_MODULE_STATUS } from './constants';
import { getCloudSyncStatus, getDatosGenerales, getEstudiantes, getModuleStatus, CloudSyncStatusData } from './services/apiService';
import { LoginScreen } from './components/auth/LoginScreen';
import { useAuth } from './components/auth/AuthContext';
import { CLOUD_SYNC_EVENT } from './utils/cloudSyncState';
import './styles/buttons.css';
import './styles/table.css';


import { DiagnosticEvaluationView } from './components/DiagnosticEvaluationView';

const BIRTHDAY_TOAST_SEEN_KEY = 'armi_birthdays_toast_seen';

const toIsoDate = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toMonthDay = (isoDate: string) => String(isoDate || '').slice(5, 10);

const isBirthdaySyncReady = (status: CloudSyncStatusData | null) => {
  if (!status) return false;
  if (status.config.mode !== 'apps_script_drive') return true;
  const conflictCount = status.config.remoteActivity?.conflicts?.count || 0;
  return conflictCount === 0 && status.comparison === 'in-sync';
};

const readCalendarState = () => {
  try {
    return JSON.parse(window.localStorage.getItem('armi_calendar_state') || '{}') as Record<string, string>;
  } catch {
    return {};
  }
};

const readHolidayList = () => {
  try {
    return JSON.parse(window.localStorage.getItem('armi_holidays_v7') || '[]') as Array<{ date?: string; mmdd?: string; type?: string }>;
  } catch {
    return [];
  }
};

const isNonTeachingDay = (date: Date, calendarState: Record<string, string>, holidays: Array<{ date?: string; mmdd?: string; type?: string }>) => {
  const iso = toIsoDate(date);
  const mmdd = toMonthDay(iso);
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return true;
  const holiday = holidays.find((item) => item.date === iso || (item.mmdd === mmdd && item.type !== 'I'));
  if (holiday && holiday.type !== 'I') return true;
  const code = String(calendarState[iso] || '').trim().toUpperCase();
  return !!code && code !== 'A';
};

const collectBirthdayWindow = () => {
  const today = new Date();
  const calendarState = readCalendarState();
  const holidays = readHolidayList();
  const dates: Date[] = [today];
  const cursor = new Date(today);

  for (let index = 0; index < 10; index += 1) {
    cursor.setDate(cursor.getDate() - 1);
    if (!isNonTeachingDay(cursor, calendarState, holidays)) break;
    dates.unshift(new Date(cursor));
  }

  return dates.map((date) => ({
    iso: toIsoDate(date),
    mmdd: toMonthDay(toIsoDate(date)),
    label: toIsoDate(date) === toIsoDate(today)
      ? 'hoy'
      : date.toLocaleDateString('es-PE', { weekday: 'long', day: '2-digit', month: '2-digit' }),
  }));
};

const buildBirthdayToastPayload = (students: Awaited<ReturnType<typeof getEstudiantes>>) => {
  const birthdayWindow = collectBirthdayWindow();
  const labelsByMonthDay = new Map(birthdayWindow.map((item) => [item.mmdd, item.label]));
  const matches = students
    .filter((student) => String(student.estado || 'A').toUpperCase() === 'A')
    .map((student) => ({
      ...student,
      birthDate: String(student.fechaNacimiento || '').trim(),
    }))
    .filter((student) => /^\d{4}-\d{2}-\d{2}$/.test(student.birthDate) && labelsByMonthDay.has(toMonthDay(student.birthDate)))
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'es'))
    .map((student) => ({
      name: String(student.name || '').trim(),
      label: labelsByMonthDay.get(toMonthDay(student.birthDate)) || 'hoy',
    }));

  if (matches.length === 0) return null;

  const title = matches.length === 1 ? 'Cumpleaños detectado' : `Cumpleaños detectados: ${matches.length}`;
  const visibleNames = matches.slice(0, 4).map((item) => `${item.name} (${item.label})`);
  const extra = matches.length > 4 ? ` y ${matches.length - 4} más` : '';
  const message = visibleNames.join(', ') + extra;
  const token = `${toIsoDate(new Date())}|${matches.map((item) => `${item.name}:${item.label}`).join('|')}`;
  return { title, message, token };
};


const App: React.FC = () => {
  const { loading, session, logout } = useAuth();
  const [currentModule, setCurrentModule] = useState<ModuleKey | 'database_admin'>('datos_generales');
  const [currentSection, setCurrentSection] = useState<string>('institucion');
  const [moduleStatus, setModuleStatus] = useState<ModuleStatus>(INITIAL_MODULE_STATUS);
  const [teacherName, setTeacherName] = useState<string>('');
  const [birthdayToast, setBirthdayToast] = useState<{ title: string; message: string } | null>(null);
  
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const refreshData = async () => {
    try {
      const status = await getModuleStatus();
      setModuleStatus(status);
      const generalData = await getDatosGenerales();
      if (generalData && generalData.teacher) {
        setTeacherName(generalData.teacher);
      }
    } catch (e) {
      console.warn('Could not fetch initial app data', e);
    }
  };

  useEffect(() => {
    if (session) refreshData();
  }, [session]);

  useEffect(() => {
    if (!birthdayToast) return undefined;
    const timer = window.setTimeout(() => setBirthdayToast(null), 8500);
    return () => window.clearTimeout(timer);
  }, [birthdayToast]);

  useEffect(() => {
    if (!session) return undefined;

    let cancelled = false;

    const runBirthdayCheck = async () => {
      const syncResponse = await getCloudSyncStatus();
      if (!syncResponse.success || !syncResponse.data || !isBirthdaySyncReady(syncResponse.data) || cancelled) return;

      const students = await getEstudiantes();
      if (cancelled) return;

      const payload = buildBirthdayToastPayload(students);
      if (!payload) return;
      if (window.localStorage.getItem(BIRTHDAY_TOAST_SEEN_KEY) === payload.token) return;

      window.localStorage.setItem(BIRTHDAY_TOAST_SEEN_KEY, payload.token);
      setBirthdayToast({ title: payload.title, message: payload.message });
    };

    const timer = window.setTimeout(() => {
      void runBirthdayCheck();
    }, 1200);

    const handleSyncRefresh = () => {
      window.setTimeout(() => {
        void runBirthdayCheck();
      }, 600);
    };

    window.addEventListener(CLOUD_SYNC_EVENT, handleSyncRefresh);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener(CLOUD_SYNC_EVENT, handleSyncRefresh);
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const moduleAccess = session.user.permissions?.modules || INITIAL_MODULE_STATUS;
    const firstAllowedModule = (Object.entries(moduleAccess).find(([, allowed]) => allowed)?.[0] || 'datos_generales') as ModuleKey;
    if (moduleAccess[currentModule as ModuleKey] === false) {
      setCurrentModule(firstAllowedModule);
      setCurrentSection(firstAllowedModule === 'datos_generales' ? 'institucion' : currentSection);
    }
    if (!teacherName) {
      setTeacherName(session.user.displayName || '');
    }
  }, [currentModule, currentSection, session, teacherName]);

  const handleModuleSuccess = () => {
    refreshData();
  };

  const handleNavigate = (module: ModuleKey | 'database_admin', section?: string) => {
    setCurrentModule(module);
    if (module === 'datos_generales') {
        setCurrentSection(section || 'institucion');
    } else if (module === 'calendario') {
        setCurrentSection(section || 'calendario_anual');
    } else if (module === 'areas_grados') {
        setCurrentSection(section || 'areas');
    } else if (module === 'estudiantes') {
        setCurrentSection(section || 'lista_estudiantes');
    } else if (module === 'horario') {
        setCurrentSection(section || 'horario_semanal');
    }
    if (section) setCurrentSection(section);
  };

  const renderContent = () => {
    switch (currentModule) {
      case 'database_admin':
        return <DatabaseManager />;
      case 'datos_generales':
        return <DatosGeneralesView onSuccess={handleModuleSuccess} activeSection={currentSection} />;
      case 'calendario':
        return <CalendarView onSuccess={handleModuleSuccess} activeSection={currentSection} />;
      case 'areas_grados':
        return <AreasGradosView onSuccess={handleModuleSuccess} activeSection={currentSection} />;
      case 'estudiantes':
        return <StudentsView onSuccess={handleModuleSuccess} activeSection={currentSection} />;
      case 'horario':
        return <ScheduleView onSuccess={handleModuleSuccess} activeSection={currentSection} />;
      case 'programacion_anual':
        return (
          <AnnualProgramView
            onSuccess={handleModuleSuccess}
            activeSection={currentSection}
          />
        );

      case 'unidades_didacticas':
        return <UnitsView onSuccess={handleModuleSuccess} activeSection={currentSection} />;
      case 'sesiones':
        return <SessionsView onSuccess={handleModuleSuccess} activeSection={currentSection} />;
      case 'evaluacion':
        return <EvaluationView activeSection={currentSection} />;
      default:
        return (
          <div className="animate-fade-in p-10 text-center">
            <h2 className="text-xl text-slate-400">Seleccione un módulo para comenzar</h2>
          </div>
        );
    }
  };

  const sessionModuleAccess = session?.user.permissions?.modules || INITIAL_MODULE_STATUS;
  const hasFullAccess = session?.user.permissions?.features?.includes('full_access') || session?.user.extra?.fullAccess === true;
  const effectiveModuleStatus = Object.entries(moduleStatus).reduce((acc, [key, value]) => {
    acc[key as ModuleKey] = hasFullAccess ? true : sessionModuleAccess[key as ModuleKey] === false ? false : value;
    return acc;
  }, { ...INITIAL_MODULE_STATUS } as ModuleStatus);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="rounded-[2rem] border border-white/10 bg-white/5 px-8 py-6 text-center shadow-2xl">
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-300">Armi Docente</p>
          <p className="mt-3 text-sm font-semibold text-slate-200">Preparando sesión segura...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  return (
    <AppErrorBoundary onReset={logout}>
      <div className="flex min-h-screen bg-[#eaebef] print:block print:bg-white">
        <AppUpdaterOverlay />
        {birthdayToast ? (
          <div className="fixed right-5 top-5 z-[95] max-w-md rounded-[1.8rem] border border-amber-200 bg-white/95 px-5 py-4 text-slate-800 shadow-[0_18px_45px_rgba(15,23,42,0.18)] backdrop-blur print:hidden">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-500">{birthdayToast.title}</p>
            <p className="mt-2 text-sm font-bold leading-relaxed">{birthdayToast.message}</p>
          </div>
        ) : null}
        <div className="print:hidden">
          <Sidebar
            status={effectiveModuleStatus}
            currentModule={currentModule as ModuleKey}
            currentSection={currentSection}
            onNavigate={handleNavigate}
            teacherName={teacherName || session.user.displayName}
            isCollapsed={isSidebarCollapsed}
            toggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            moduleAccess={sessionModuleAccess}
            onLogout={logout}
            userRoleLabel={session.user.permissions?.role || 'docente'}
            profileSession={session}
          />
        </div>
        <main
          className={`
              flex-1 p-6 transition-all duration-500 ease-in-out
              ${isSidebarCollapsed ? 'ml-[6rem]' : 'ml-[19rem]'}
              print:ml-0 print:p-0
          `}
        >
          <div className="max-w-6xl mx-auto pt-2 print:max-w-none print:mx-0 print:pt-0">
             <SyncLifecycleManager />
             {renderContent()}
          </div>
        </main>
      </div>
    </AppErrorBoundary>
  );
};

export default App;
