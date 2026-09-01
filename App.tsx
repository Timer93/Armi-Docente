
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
import { AppUpdaterOverlay, APP_UPDATER_EXPANDED_EVENT } from './components/AppUpdaterOverlay';
import { GeneralNotesOverlay, GeneralNotesFloatingButton } from './components/GeneralNotesOverlay';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { ModuleStatus, ModuleKey } from './types';
import { INITIAL_MODULE_STATUS } from './constants';
import { getDatosGenerales, getEstudiantes, getModuleStatus } from './services/apiService';
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

const normalizeBirthdayText = (value: unknown) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const birthdayDaysAhead = (birthDate: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [, month, day] = birthDate.split('-').map(Number);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(today.getFullYear(), month - 1, day);
  if (next < start) next = new Date(today.getFullYear() + 1, month - 1, day);
  return Math.round((next.getTime() - start.getTime()) / 86_400_000);
};

const buildBirthdayToastPayload = (students: Awaited<ReturnType<typeof getEstudiantes>>) => {
  let assignments: Array<{ areaName?: string; grade?: string; section?: string }> = [];
  try {
    assignments = JSON.parse(window.localStorage.getItem('armi_assignments') || '[]');
  } catch {
    assignments = [];
  }
  const tutorLoads = assignments.filter((assignment) => {
    const area = normalizeBirthdayText(assignment.areaName);
    return area.includes('tutoria') && area.includes('orientacion educativa');
  });
  const belongsToTutorLoad = (grade: unknown, section: unknown) => tutorLoads.some((assignment) => {
    const sameGrade = normalizeBirthdayText(assignment.grade) === normalizeBirthdayText(grade);
    const assignedSections = normalizeBirthdayText(assignment.section).split(/\s+y\s+|\s*,\s*/).filter(Boolean);
    return sameGrade && assignedSections.includes(normalizeBirthdayText(section));
  });
  const matches = students
    .filter((student) => String(student.estado || 'A').toUpperCase() === 'A')
    .map((student) => ({
      ...student,
      birthDate: String(student.fechaNacimiento || '').trim(),
      daysAhead: birthdayDaysAhead(String(student.fechaNacimiento || '').trim()),
      tutorPriority: belongsToTutorLoad(student.grade, student.section),
    }))
    .filter((student) => student.daysAhead !== null && student.daysAhead <= 2)
    .sort((left, right) => Number(right.tutorPriority) - Number(left.tutorPriority)
      || Number(left.daysAhead) - Number(right.daysAhead)
      || String(left.name || '').localeCompare(String(right.name || ''), 'es'))
    .map((student) => ({
      name: String(student.name || '').trim(),
      label: student.daysAhead === 0 ? 'hoy' : student.daysAhead === 1 ? 'mañana' : 'en 2 días',
      tutorPriority: student.tutorPriority,
    }));

  if (matches.length === 0) return null;

  const todayCount = matches.filter((item) => item.label === 'hoy').length;
  const title = todayCount > 0 ? `🎉 Hoy hay ${todayCount === 1 ? 'un cumpleaños' : `${todayCount} cumpleaños`} en el aula` : '🎂 Cumpleaños próximos';
  const visibleNames = matches.slice(0, 4).map((item) => `${item.tutorPriority ? '⭐ ' : ''}${item.name} (${item.label})`);
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
  const [generalNotesOpen, setGeneralNotesOpen] = useState(false);
  const [isUpdaterExpanded, setIsUpdaterExpanded] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!loading) window.armiApp?.notifyStartupReady?.();
  }, [loading]);

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

  useEffect(() => {
    const handleUpdaterExpanded = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>;
      setIsUpdaterExpanded(Boolean(customEvent.detail));
    };

    window.addEventListener(APP_UPDATER_EXPANDED_EVENT, handleUpdaterExpanded as EventListener);
    return () => {
      window.removeEventListener(APP_UPDATER_EXPANDED_EVENT, handleUpdaterExpanded as EventListener);
    };
  }, []);

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
      <div className="min-h-screen bg-[#eaebef]" aria-label="Preparando ARMI Docente" />
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  return (
    <AppErrorBoundary onReset={logout}>
      <div className="flex min-h-screen bg-[#eaebef] print:block print:bg-white">
        <AppUpdaterOverlay />
        {!isUpdaterExpanded ? <GeneralNotesFloatingButton onClick={() => setGeneralNotesOpen(true)} /> : null}
        <GeneralNotesOverlay visible={generalNotesOpen} onClose={() => setGeneralNotesOpen(false)} />
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
