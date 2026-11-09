import { OPEN_SESSION_REGISTER_EVENT, isSessionRegisterTarget, type SessionRegisterTarget } from './utils/sessionRegisterNavigation';
import React, { lazy, Suspense, useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { DatosGeneralesView } from './components/DatosGeneralesView';
import { SyncLifecycleManager } from './components/SyncLifecycleManager';
import { BackgroundSyncIndicator } from './components/BackgroundSyncIndicator';
import { mergeRecoveryProgress } from './utils/backgroundSyncStatus';
import { AppUpdaterOverlay } from './components/AppUpdaterOverlay';
import { GeneralNotesOverlay, GeneralNotesFloatingButton } from './components/GeneralNotesOverlay';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { ModuleStatus, ModuleKey } from './types';
import { INITIAL_MODULE_STATUS } from './constants';
import { bootstrapPortableState, saveCloudFrontendState, getDatosGenerales, getEstudiantes, getModuleStatus } from './services/apiService';
import { LoginScreen } from './components/auth/LoginScreen';
import { useAuth } from './components/auth/AuthContext';
import { CLOUD_SYNC_EVENT, collectArmiLocalState, applyArmiLocalState, emitCloudSyncUpdated } from './utils/cloudSyncState';
import { observePortableStorage } from './utils/observePortableStorage';
import {needsAcademicViewRefresh} from './utils/moduleStateRefresh';
import './styles/buttons.css';
import './styles/table.css';

// Load each workspace when it is opened; the login and initial screen do not
// need the lesson editor, gradebook, charts or document generation libraries.
const lazyWorkspace = <T extends React.ComponentType<any>,>(load: () => Promise<{ default: T }>) => {
  let pending: Promise<{ default: T }> | undefined;
  const prepare = () => pending ??= load().catch(error => { pending = undefined; throw error; });
  return Object.assign(lazy(prepare), { preload: () => { void prepare().catch(() => {}); } });
};
const CalendarView = lazyWorkspace(() => import('./components/CalendarView').then(module => ({ default: module.CalendarView })));
const AreasGradosView = lazyWorkspace(() => import('./components/AreasGradosView').then(module => ({ default: module.AreasGradosView })));
const ScheduleView = lazyWorkspace(() => import('./components/ScheduleView').then(module => ({ default: module.ScheduleView })));
const DatabaseManager = lazyWorkspace(() => import('./components/DatabaseManager').then(module => ({ default: module.DatabaseManager })));
const AccessControlView = lazyWorkspace(() => import('./components/AccessControlView').then(module => ({ default: module.AccessControlView })));
const StudentsView = lazyWorkspace(() => import('./components/StudentsView').then(module => ({ default: module.StudentsView })));
const AnnualProgramView = lazyWorkspace(() => import('./components/AnnualProgramView').then(module => ({ default: module.AnnualProgramView })));
const UnitsView = lazyWorkspace(() => import('./components/UnitsView').then(module => ({ default: module.UnitsView })));
const SessionsView = lazyWorkspace(() => import('./components/SessionsView').then(module => ({ default: module.SessionsView })));
const EvaluationView = lazyWorkspace(() => import('./components/evaluation/EvaluationView').then(module => ({ default: module.EvaluationView })));

const prepareWorkspace = (module: ModuleKey | 'database_admin', section?: string) => {
  if (module === 'database_admin') {
    (section === 'control_acceso' ? AccessControlView : DatabaseManager).preload();
    return;
  }
  const workspaces = { calendario: CalendarView, areas_grados: AreasGradosView, horario: ScheduleView,
    estudiantes: StudentsView, programacion_anual: AnnualProgramView, unidades_didacticas: UnitsView,
    sesiones: SessionsView, evaluacion: EvaluationView };
  workspaces[module as keyof typeof workspaces]?.preload();
};

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
  const [sessionRegisterTarget, setSessionRegisterTarget] = useState<SessionRegisterTarget | null>(null);
  useEffect(() => {
    const openRegister = (event: Event) => {
      const target = (event as CustomEvent).detail;
      if (!isSessionRegisterTarget(target)) return;
      setSessionRegisterTarget(target);
      setCurrentModule('sesiones');
      setCurrentSection('sesiones');
    };
    window.addEventListener(OPEN_SESSION_REGISTER_EVENT, openRegister);
    return () => window.removeEventListener(OPEN_SESSION_REGISTER_EVENT, openRegister);
  }, []);
  const [currentModule, setCurrentModule] = useState<ModuleKey | 'database_admin'>('datos_generales');
  const [currentSection, setCurrentSection] = useState<string>('institucion');
  const [moduleStatus, setModuleStatus] = useState<ModuleStatus>(INITIAL_MODULE_STATUS);
  const [teacherName, setTeacherName] = useState<string>('');
  const [birthdayToast, setBirthdayToast] = useState<{ title: string; message: string } | null>(null);
  const [generalNotesOpen, setGeneralNotesOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [portableReady, setPortableReady] = useState(false);
  const [portableError, setPortableError] = useState('');
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const bootstrapBaseline = useRef<{ session: string; keys: Record<string, string> } | null>(null);
  const bootstrapEditedKeys = useRef<string[]>([]);
  const [localStateRevision, setLocalStateRevision] = useState(0);
  const displayedLocalState = useRef<Record<string, string> | null>(null);
  if (displayedLocalState.current === null) displayedLocalState.current = collectArmiLocalState();
  useEffect(() => {
    const refresh = (event: Event) => {
      const keys = collectArmiLocalState();
      const before = displayedLocalState.current;
      displayedLocalState.current = keys;
      const receivedKeys = (event as CustomEvent<{ changedKeys?: string[] }>).detail?.changedKeys;
      const academicChanged = receivedKeys
        ? needsAcademicViewRefresh({}, Object.fromEntries(receivedKeys.map(key => [key, 'received-change'])))
        : needsAcademicViewRefresh(before, keys);
      if (academicChanged) {
        setLocalStateRevision(value => value + 1);
      }
    };
    window.addEventListener(CLOUD_SYNC_EVENT, refresh);
    return () => window.removeEventListener(CLOUD_SYNC_EVENT, refresh);
  }, []);
  useEffect(() => {
    const reload = () => { setPortableReady(false); setBootstrapAttempt((value) => value + 1); };
    window.addEventListener('armi-portable-configuration-changed', reload);
    return () => window.removeEventListener('armi-portable-configuration-changed', reload);
  }, []);
  useEffect(() => {
    if (!session) { setPortableReady(false); return; }
    let active = true;
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout>;
    const identity = `${session.user.id}:${session.authenticatedAt}`;
    if (bootstrapBaseline.current?.session !== identity) bootstrapBaseline.current = { session: identity, keys: collectArmiLocalState() };
    setPortableReady(false); setPortableError('');
    const recover = async () => {
      try {
        const result = await bootstrapPortableState(collectArmiLocalState(), controller.signal);
        if (!active) return;
        if (!result.success) throw new Error(result.message || 'No se pudo recuperar la configuración.');
        setPortableError('');
        const current = collectArmiLocalState();
        const merged = mergeRecoveryProgress(bootstrapBaseline.current!.keys, current, result.data?.frontendState?.keys || current);
        applyArmiLocalState(merged.keys);
        bootstrapBaseline.current = { session: identity, keys: merged.baseline };
        if (Object.keys({ ...current, ...merged.keys }).some(key => current[key] !== merged.keys[key])) emitCloudSyncUpdated();
        // Editing is now allowed during recovery. Preserve and publish those
        // edits instead of replacing them with the delayed response.
        bootstrapEditedKeys.current = merged.changedKeys;
        if (result.data?.recoveryPending) { retryTimer = setTimeout(recover, 5000); return; }
        if (!active) return;
        bootstrapBaseline.current = { session: identity, keys: collectArmiLocalState() };
        setPortableReady(true);
      } catch (error) {
        if (active) { setPortableError(String(error)); retryTimer = setTimeout(recover, 10000); }
      }
    };
    void recover();
    return () => { active = false; clearTimeout(retryTimer); controller.abort(); };
  }, [session, bootstrapAttempt]);
  useEffect(() => {
    if (portableReady || !session) return;
    const unsubscribe = window.armiApp?.onBackendRecovered?.(() => setBootstrapAttempt(value => value + 1));
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [portableReady, session]);
  useEffect(() => {
    if (!portableReady) return;
    const initialKeys = bootstrapEditedKeys.current;
    bootstrapEditedKeys.current = [];
    return observePortableStorage(async (keys) => (await saveCloudFrontendState(collectArmiLocalState(), keys)).success, initialKeys);
  }, [portableReady]);

  useEffect(() => {
    if (!loading) window.armiApp?.notifyStartupReady?.();
  }, [loading]);

  const refreshData = useCallback(async () => {
    try {
      const [status, generalData] = await Promise.all([getModuleStatus(), getDatosGenerales()]);
      setModuleStatus(status);
      if (generalData && generalData.teacher) {
        setTeacherName(generalData.teacher);
      }
    } catch (e) {
      console.warn('Could not fetch initial app data', e);
    }
  }, []);

  useEffect(() => {
    if (session) refreshData();
  }, [session, portableReady, refreshData]);

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

    let timer = window.setTimeout(() => {
      void runBirthdayCheck();
    }, 1200);

    const handleSyncRefresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
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


  const handleModuleSuccess = refreshData;

  const handleNavigate = (module: ModuleKey | 'database_admin', section?: string) => {
    setSessionRegisterTarget(null);
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
    } else if (module === 'database_admin') {
        setCurrentSection(section || 'bases_datos');
    }
    if (section) setCurrentSection(section);
  };

  const content = useMemo(() => {
    switch (currentModule) {
      case 'database_admin':
        return currentSection === 'control_acceso' ? <AccessControlView /> : <DatabaseManager />;
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
        return <SessionsView key={sessionRegisterTarget?.sessionId || 'sessions'} navigationTarget={sessionRegisterTarget} onSuccess={handleModuleSuccess} activeSection={currentSection} />;
      case 'evaluacion':
        return <EvaluationView activeSection={currentSection} />;
      default:
        return (
          <div className="animate-fade-in p-10 text-center">
            <h2 className="text-xl text-slate-400">Seleccione un módulo para comenzar</h2>
          </div>
        );
    }
  }, [currentModule, currentSection, sessionRegisterTarget, handleModuleSuccess]);

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
        <div className="armi-floating-controls print:hidden">
          <div id="armi-grading-mode-control" className="flex shrink-0 items-center" />
          <GeneralNotesFloatingButton onClick={() => setGeneralNotesOpen(true)} />
          <AppUpdaterOverlay />
        </div>
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
            onPrepareNavigate={prepareWorkspace}
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
              flex-1 p-6 pb-20 transition-all duration-500 ease-in-out
              ${isSidebarCollapsed ? 'ml-[6rem]' : 'ml-[19rem]'}
              print:ml-0 print:p-0
          `}
        >
          <div className="max-w-6xl mx-auto pt-2 print:max-w-none print:mx-0 print:pt-0">
             <SyncLifecycleManager />
             <Suspense fallback={<div role="status" className="p-6 text-sm text-slate-500">Cargando módulo…</div>}>
               <React.Fragment key={localStateRevision}>{content}</React.Fragment>
             </Suspense>
          </div>
        </main>
        <BackgroundSyncIndicator collapsed={isSidebarCollapsed} ready={portableReady} error={portableError} onRetry={() => setBootstrapAttempt(value => value + 1)} />
      </div>
    </AppErrorBoundary>
  );
};

export default App;
