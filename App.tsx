
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
import { CloudSyncPanel } from './components/CloudSyncPanel';
import { SyncLifecycleManager } from './components/SyncLifecycleManager';
import { AppUpdaterOverlay } from './components/AppUpdaterOverlay';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { ModuleStatus, ModuleKey } from './types';
import { INITIAL_MODULE_STATUS } from './constants';
import { getModuleStatus, getDatosGenerales } from './services/apiService';
import { LoginScreen } from './components/auth/LoginScreen';
import { useAuth } from './components/auth/AuthContext';
import './styles/buttons.css';
import './styles/table.css';


import { DiagnosticEvaluationView } from './components/DiagnosticEvaluationView';


const App: React.FC = () => {
  const { loading, session, logout } = useAuth();
  const [currentModule, setCurrentModule] = useState<ModuleKey | 'database_admin'>('datos_generales');
  const [currentSection, setCurrentSection] = useState<string>('institucion');
  const [moduleStatus, setModuleStatus] = useState<ModuleStatus>(INITIAL_MODULE_STATUS);
  const [teacherName, setTeacherName] = useState<string>('');
  
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
             <div className="mb-4 flex justify-end">
               <CloudSyncPanel />
             </div>
             {renderContent()}
          </div>
        </main>
      </div>
    </AppErrorBoundary>
  );
};

export default App;
