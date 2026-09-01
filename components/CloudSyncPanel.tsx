import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyCloudArtifact,
  CloudSyncStatusData,
  clearCloudVersionHistory,
  getCloudSyncStatus,
  mergeAttendanceFromCloudArtifact,
  mergeStudentsFromCloudArtifact,
  pickCloudSyncFolder,
  pullCloudSync,
  pullCloudArtifact,
  pushCloudSync,
  resolveCloudConflict,
  saveCloudFrontendState,
  saveCloudSyncConfig,
} from '../services/apiService';
import { useAuth } from './auth/AuthContext';
import { applyArmiLocalState, CLOUD_SYNC_EVENT, collectArmiLocalState, emitCloudSyncUpdated } from '../utils/cloudSyncState';
import driveIcon from '../src/Google_Drive_icon.svg';

type SyncAction = 'push' | 'pull' | null;

const RECENT_MANUAL_PUSH_MARK_KEY = 'armi-sync-recent-manual-push';

const markRecentManualPush = () => {
  window.localStorage.setItem(RECENT_MANUAL_PUSH_MARK_KEY, String(Date.now()));
};
type ToastState = { type: 'success' | 'warning' | 'error'; text: string } | null;
type ArtifactKind = 'version' | 'conflict' | 'current';
type ArtifactAction = 'inspect' | 'apply' | 'merge-attendance' | 'merge-students';

const reloadApplicationView = () => {
  window.setTimeout(() => {
    window.location.reload();
  }, 1200);
};

const buildDriveDiagnosticMessage = (status: CloudSyncStatusData | null | undefined, fallback?: string) => {
  const base = String(fallback || '').trim();
  if (!status || status.config.mode !== 'apps_script_drive') {
    return base || 'No se pudo recuperar la copia del usuario desde Drive.';
  }

  const remoteLookupMessage = String(status.config.remoteLookupMessage || '').trim();
  if (remoteLookupMessage) return remoteLookupMessage;

  const versionsCount = Number(status.config.remoteActivity?.versions?.count || 0);
  const conflictsCount = Number(status.config.remoteActivity?.conflicts?.count || 0);
  if (!status.mirrorManifest && (versionsCount > 0 || conflictsCount > 0)) {
    const parts = [];
    if (versionsCount > 0) parts.push(`${versionsCount} version${versionsCount === 1 ? '' : 'es'} en el historial`);
    if (conflictsCount > 0) parts.push(`${conflictsCount} conflicto${conflictsCount === 1 ? '' : 's'} protegido${conflictsCount === 1 ? '' : 's'}`);
    return `Drive si tiene ${parts.join(' y ')}, pero no se pudo leer la copia actual en la carpeta "current". Normalmente eso significa que falta "manifest.json" o "snapshot.zip" en la copia actual, o que Apps Script esta resolviendo mal esa subcarpeta.`;
  }

  return base || 'No se pudo recuperar la copia del usuario desde Drive.';
};

const comparisonMeta: Record<CloudSyncStatusData['comparison'], { label: string; tone: string; dot: string }> = {
  'local-mode': { label: 'Solo local', tone: 'text-slate-700 bg-slate-100 border-slate-200', dot: 'bg-slate-500' },
  'no-data': { label: 'Sin copias', tone: 'text-slate-700 bg-slate-100 border-slate-200', dot: 'bg-slate-500' },
  'mirror-missing': { label: 'Sin copia', tone: 'text-amber-800 bg-amber-50 border-amber-200', dot: 'bg-amber-500' },
  'mirror-newer': { label: 'Drive mas reciente', tone: 'text-blue-800 bg-blue-50 border-blue-200', dot: 'bg-sky-500' },
  'local-newer': { label: 'PC mas reciente', tone: 'text-emerald-800 bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500' },
  'in-sync': { label: 'Sincronizado', tone: 'text-emerald-800 bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500' },
  'diverged': { label: 'Diferencias detectadas', tone: 'text-rose-800 bg-rose-50 border-rose-200', dot: 'bg-rose-500' },
  'mirror-incomplete': { label: 'Copia danada', tone: 'text-rose-800 bg-rose-50 border-rose-200', dot: 'bg-rose-500' },
};

const syncEntityLabels: Record<string, string> = {
  programaciones: 'Programaciones',
  unidades: 'Unidades',
  sesiones: 'Sesiones',
  estudiantes: 'Estudiantes',
  egresados: 'Egresados',
  asistencias: 'Asistencias',
  evaluaciones: 'Evaluaciones',
  evidencias: 'Evidencias',
  rostros: 'Rostros',
};

const compareCopyEntityCounts = (status?: CloudSyncStatusData | null) => {
  const local = status?.localManifest?.summary?.entities;
  const mirror = status?.mirrorManifest?.summary?.entities;
  if (!local || !mirror) return { direction: 'unknown' as const, advantages: [] as string[] };
  const localEntities = local as Record<string, number | undefined>;
  const mirrorEntities = mirror as Record<string, number | undefined>;
  const localAdvantages: string[] = [];
  const mirrorAdvantages: string[] = [];
  Object.entries(syncEntityLabels).forEach(([key, label]) => {
    const localValue = Number(localEntities[key] || 0);
    const mirrorValue = Number(mirrorEntities[key] || 0);
    if (localValue > mirrorValue) localAdvantages.push(`${localValue - mirrorValue} ${label.toLowerCase()} más`);
    if (mirrorValue > localValue) mirrorAdvantages.push(`${mirrorValue - localValue} ${label.toLowerCase()} más`);
  });
  if (localAdvantages.length && !mirrorAdvantages.length) return { direction: 'local' as const, advantages: localAdvantages };
  if (mirrorAdvantages.length && !localAdvantages.length) return { direction: 'mirror' as const, advantages: mirrorAdvantages };
  return { direction: 'mixed' as const, advantages: [...localAdvantages, ...mirrorAdvantages] };
};

const formatEntitySummary = (summary?: { entities?: Record<string, number> } | null) => {
  const entities = summary?.entities || {};
  return Object.entries(syncEntityLabels)
    .map(([key, label]) => `${label}: ${Number(entities?.[key] || 0)}`)
    .join(' · ');
};

const formatArtifactMoment = (value?: string) => value ? new Date(value).toLocaleString() : 'Sin fecha';
const VERSION_HISTORY_VISIBILITY_KEY = 'armi_cloud_sync_show_version_history';

const removeConflictFromStatus = (status: CloudSyncStatusData | null, conflictId: string): CloudSyncStatusData | null => {
  if (!status) return status;

  const currentItems = Array.isArray(status.config.remoteActivity?.conflicts?.items)
    ? status.config.remoteActivity?.conflicts?.items
    : [];
  const nextItems = currentItems.filter((item) => String(item?.id || '').trim() !== conflictId);
  if (nextItems.length === currentItems.length) return status;

  return {
    ...status,
    config: {
      ...status.config,
      remoteActivity: {
        ...(status.config.remoteActivity || {}),
        conflicts: {
          ...(status.config.remoteActivity?.conflicts || { count: 0 }),
          count: Math.max(0, Number(status.config.remoteActivity?.conflicts?.count || currentItems.length) - 1),
          latestAt: nextItems[0]?.generatedAt || nextItems[0]?.createdAt || '',
          latestId: nextItems[0]?.id || '',
          latestUrl: nextItems[0]?.url || '',
          items: nextItems,
        },
      },
    },
  };
};

const manifestsLookEquivalent = (
  left?: { digest?: string; summary?: { entities?: Record<string, number> } | null } | null,
  right?: { digest?: string; summary?: { entities?: Record<string, number> } | null } | null,
) => {
  if (!left || !right) return false;
  if (left.digest && right.digest && left.digest === right.digest) return true;
  const entityKeys = Object.keys(syncEntityLabels);
  return entityKeys.every((key) => Number(left.summary?.entities?.[key] || 0) === Number(right.summary?.entities?.[key] || 0));
};

const iconButtonBase = 'flex h-9 w-9 items-center justify-center rounded-xl border transition disabled:opacity-50';

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const AttendanceMergeIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 2v4" />
    <path d="M16 2v4" />
    <rect x="3" y="4" width="18" height="18" rx="3" />
    <path d="M3 10h18" />
    <path d="m8 16 2 2 5-5" />
  </svg>
);

const StudentsMergeIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const RestoreIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v6h6" />
    <path d="M12 8v5l3 2" />
  </svg>
);

const ArchiveIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7h18" />
    <path d="M5 7h14v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" />
    <path d="M9 11h6" />
    <path d="M9 15h6" />
    <path d="M8 3h8l1 4H7l1-4Z" />
  </svg>
);

const LocalPcIcon = ({ className = 'h-4 w-4' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="12" rx="2.5" />
    <path d="M8 20h8" />
    <path d="M12 16v4" />
  </svg>
);

const VersionActionButton: React.FC<{
  label: string;
  title: string;
  loading: boolean;
  disabled: boolean;
  tone: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, title, loading, disabled, tone, onClick, children }) => (
  <button
    type="button"
    aria-label={loading ? label : title}
    title={loading ? label : title}
    onClick={onClick}
    disabled={disabled}
    className={`${iconButtonBase} ${tone}`}
  >
    {loading ? (
      <span className="h-4 w-4 animate-pulse rounded-full bg-current/45" aria-hidden="true" />
    ) : children}
  </button>
);

const ConflictActionButton: React.FC<{
  loadingLabel: string;
  title: string;
  loading: boolean;
  disabled: boolean;
  tone: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ loadingLabel, title, loading, disabled, tone, onClick, children }) => (
  <button
    type="button"
    aria-label={loading ? loadingLabel : title}
    title={loading ? loadingLabel : title}
    onClick={onClick}
    disabled={disabled}
    className={`${iconButtonBase} ${tone}`}
  >
    {loading ? (
      <span className="h-4 w-4 animate-pulse rounded-full bg-current/45" aria-hidden="true" />
    ) : children}
  </button>
);

export const CloudSyncPanel: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { session } = useAuth();
  const [status, setStatus] = useState<CloudSyncStatusData | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [activeAction, setActiveAction] = useState<SyncAction>(null);
  const [modalMessage, setModalMessage] = useState('Preparando sincronizacion...');
  const [modalOpen, setModalOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [artifactActionKey, setArtifactActionKey] = useState('');
  const [clearingHistory, setClearingHistory] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(VERSION_HISTORY_VISIBILITY_KEY) !== 'false';
  });
  const [configMode, setConfigMode] = useState<'local' | 'drive_mirror'>('local');
  const [autoSyncOnClose, setAutoSyncOnClose] = useState(true);
  const [syncUserKey, setSyncUserKey] = useState('default-user');
  const [syncUserLabel, setSyncUserLabel] = useState('Usuario local');
  const [mirrorPath, setMirrorPath] = useState('');
  const [browserOnline, setBrowserOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const autoBoundIdentityRef = useRef('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const detailsBodyRef = useRef<HTMLDivElement | null>(null);

  const refreshStatus = async () => {
    setLoadingStatus(true);
    setErrorMessage(null);
    const frontendStateResult = await saveCloudFrontendState(collectArmiLocalState());
    if (!frontendStateResult.success) {
      setErrorMessage(frontendStateResult.message || 'No pude comunicarme con el backend de sincronizacion.');
    }
    const response = await getCloudSyncStatus();
    if (response.success && response.data) {
      setStatus(response.data);
      setConfigMode(response.data.config.mode === 'drive_mirror' ? 'drive_mirror' : 'local');
      setAutoSyncOnClose(response.data.config.autoSyncOnClose);
      setSyncUserKey(response.data.config.syncUserKey || 'default-user');
      setSyncUserLabel(response.data.config.syncUserLabel || 'Usuario local');
      setMirrorPath(response.data.config.resolvedMirrorPath || response.data.config.mirrorPath || '');
    } else {
      setErrorMessage(response.message || 'No pude consultar el estado de sincronizacion.');
    }
    setLoadingStatus(false);
  };

  const runArtifactAction = async (
    artifactKind: ArtifactKind,
    artifactId: string | undefined,
    action: ArtifactAction,
  ) => {
    const key = `${action}:${artifactKind}:${artifactId || 'current'}`;
    setArtifactActionKey(key);
    setModalOpen(true);
    setErrorMessage(null);
    setModalMessage(
      action === 'merge-attendance'
        ? 'Fusionando asistencias de la copia seleccionada...'
        : action === 'merge-students'
          ? 'Fusionando estudiantes de la copia seleccionada...'
        : action === 'apply'
          ? 'Cargando la copia seleccionada en esta PC...'
          : 'Revisando la copia seleccionada...'
    );

    const payload = { artifactKind, artifactId };
    const response = action === 'merge-attendance'
      ? await mergeAttendanceFromCloudArtifact(payload)
      : action === 'merge-students'
        ? await mergeStudentsFromCloudArtifact(payload)
        : action === 'apply'
          ? await applyCloudArtifact(payload)
          : await pullCloudArtifact(payload);

    if (!response.success) {
      setErrorMessage(response.message || 'No se pudo completar la operacion con la copia seleccionada.');
      setToast({ type: 'error', text: response.message || 'No se pudo completar la operacion con la copia seleccionada.' });
      setArtifactActionKey('');
      await refreshStatus();
      return;
    }

    if (action === 'inspect') {
      const counts = response.data?.counts || {};
      setModalMessage(`Resumen de la copia seleccionada: Programaciones ${counts.programaciones || 0}, Unidades ${counts.unidades || 0}, Sesiones ${counts.sesiones || 0}, Asistencias ${counts.asistencias || 0}, Rostros ${counts.rostros || 0}.`);
      setToast({ type: 'success', text: 'Resumen de copia cargado.' });
      setArtifactActionKey('');
      return;
    }

    if (action === 'apply') {
      const remoteKeys = response.data?.frontendState?.keys || {};
      applyArmiLocalState(remoteKeys);
      setToast({ type: 'success', text: 'La copia seleccionada se cargo correctamente.' });
      setModalMessage('La copia seleccionada se cargo correctamente. Recargaremos la aplicacion para mostrar los datos recuperados.');
      setArtifactActionKey('');
      await refreshStatus();
      emitCloudSyncUpdated();
      reloadApplicationView();
      return;
    }

    setToast({
      type: 'success',
      text: response.message || (action === 'merge-students' ? 'Los estudiantes se fusionaron correctamente.' : 'La asistencia se fusiono correctamente.'),
    });
    setModalMessage(response.message || (action === 'merge-students'
      ? 'Los estudiantes se fusionaron correctamente con la copia seleccionada.'
      : 'La asistencia se fusiono correctamente con la copia seleccionada.'));
    setArtifactActionKey('');
    await refreshStatus();
    emitCloudSyncUpdated();
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    const updateOnlineState = () => setBrowserOnline(navigator.onLine);
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    const timer = window.setInterval(async () => {
      const response = await getCloudSyncStatus();
      if (response.success && response.data) setStatus(response.data);
    }, 15000);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const handleExternalRefresh = () => {
      void refreshStatus();
    };
    window.addEventListener(CLOUD_SYNC_EVENT, handleExternalRefresh);
    return () => window.removeEventListener(CLOUD_SYNC_EVENT, handleExternalRefresh);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setDetailsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!detailsOpen) return;
    detailsBodyRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [detailsOpen]);

  const sessionSyncProfile = useMemo(() => {
    const rawKey = session?.user?.sync?.userKey || session?.user?.id || session?.user?.username || '';
    const normalizedKey = String(rawKey || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return {
      syncUserKey: normalizedKey || 'default-user',
      syncUserLabel: session?.user?.sync?.userLabel || session?.user?.displayName || session?.user?.username || 'Usuario local',
      driveFolderName: session?.user?.sync?.driveFolderName || '',
      driveFolderUrl: session?.user?.sync?.driveFolderUrl || '',
      authenticated: !!session?.user,
    };
  }, [session]);

  useEffect(() => {
    if (!sessionSyncProfile.authenticated) return;
    setSyncUserKey(sessionSyncProfile.syncUserKey);
    setSyncUserLabel(sessionSyncProfile.syncUserLabel);
  }, [sessionSyncProfile]);

  useEffect(() => {
    if (!status || !sessionSyncProfile.authenticated || savingConfig) return;

    const needsIdentitySync = status.config.syncUserKey !== sessionSyncProfile.syncUserKey
      || status.config.syncUserLabel !== sessionSyncProfile.syncUserLabel;
    if (!needsIdentitySync) return;

    const syncFingerprint = [
      status.config.mode,
      status.config.autoSyncOnClose ? '1' : '0',
      sessionSyncProfile.syncUserKey,
      sessionSyncProfile.syncUserLabel,
    ].join('|');
    if (autoBoundIdentityRef.current === syncFingerprint) return;
    autoBoundIdentityRef.current = syncFingerprint;

    void (async () => {
      await saveCloudSyncConfig({
        mode: status.config.mode,
        mirrorPath: status.config.mode === 'drive_mirror'
          ? status.config.resolvedMirrorPath || status.config.mirrorPath
          : '',
        autoSyncOnClose: status.config.autoSyncOnClose,
        syncUserKey: sessionSyncProfile.syncUserKey,
        syncUserLabel: sessionSyncProfile.syncUserLabel,
      });
      await refreshStatus();
    })();
  }, [savingConfig, sessionSyncProfile, status]);

  useEffect(() => {
    if (!status || status.comparison !== 'mirror-newer') return;
    setDetailsOpen(true);
    setModalOpen(true);
    setModalMessage('Se detecto una copia mas reciente en Drive. Puedes descargarla antes de seguir trabajando.');
  }, [status]);

  const saveConfig = async (
    nextMode: 'local' | 'drive_mirror',
    nextAutoSyncOnClose = autoSyncOnClose,
    options?: { successMessage?: string; silent?: boolean; mirrorPath?: string }
  ) => {
    setSavingConfig(true);
    setErrorMessage(null);
    const response = await saveCloudSyncConfig({
      mode: nextMode,
      mirrorPath: nextMode === 'drive_mirror' ? options?.mirrorPath ?? mirrorPath : '',
      autoSyncOnClose: nextAutoSyncOnClose,
      syncUserKey,
      syncUserLabel,
    });

    if (!response.success) {
      const nextError = response.message || 'No pude guardar la configuracion de sincronizacion.';
      setErrorMessage(nextError);
      if (!options?.silent) {
        setToast({ type: 'error', text: nextError });
      }
    } else if (options?.successMessage && !options?.silent) {
      setToast({ type: 'success', text: options.successMessage });
    }

    setSavingConfig(false);
    await refreshStatus();
    emitCloudSyncUpdated();
    return response.success;
  };

  const executeSyncAction = async (
    action: SyncAction,
    actionStatus: CloudSyncStatusData | null = status,
    options?: { force?: boolean },
  ) => {
    if (!action) return;
    if (action === 'pull' && !actionStatus?.mirrorManifest) {
      const nextMessage = buildDriveDiagnosticMessage(
        actionStatus,
        'Todavia no existe una copia actual en Drive para este usuario. Primero debes subir una copia desde alguna PC.'
      );
      setActiveAction(null);
      setModalOpen(true);
      setErrorMessage(nextMessage);
      setToast({ type: 'error', text: nextMessage });
      setModalMessage(nextMessage);
      return;
    }
    setActiveAction(action);
    setModalOpen(true);
    setErrorMessage(null);
    setModalMessage(
      action === 'push'
        ? 'Creando una copia segura local y actualizando Drive...'
        : 'Creando un punto de restauracion local y cargando la ultima copia desde Drive...'
    );

    await saveCloudFrontendState(collectArmiLocalState());
    const response = action === 'push'
      ? await pushCloudSync({
          force: options?.force === true,
          reason: options?.force ? 'user-confirmed-protected-local-recovery' : 'manual-retry',
        })
      : await pullCloudSync();

    if (!response.success) {
      const nextMessage = action === 'pull'
        ? buildDriveDiagnosticMessage(actionStatus, response.message || 'La sincronizacion no termino correctamente.')
        : response.message || 'La sincronizacion no termino correctamente.';
      setActiveAction(null);
      await refreshStatus();
      setErrorMessage(nextMessage);
      setToast({ type: 'error', text: nextMessage });
      setModalMessage(nextMessage);
      return;
    }

    if (action === 'pull') {
      const remoteKeys = response.data?.frontendState?.keys || {};
      applyArmiLocalState(remoteKeys);
      setToast({ type: 'success', text: 'Copia descargada correctamente desde Drive.' });
      setModalMessage('La descarga termino correctamente. Recargaremos la aplicacion para mostrar los datos recuperados.');
      setActiveAction(null);
      await refreshStatus();
      emitCloudSyncUpdated();
      reloadApplicationView();
      return;
    }

    if (response.data?.skippedUpload) {
      markRecentManualPush();
      setToast({ type: 'success', text: response.data?.message || 'No hubo cambios nuevos para subir a Drive.' });
      setModalMessage(response.data?.message || 'No hubo cambios nuevos para subir a Drive.');
      setActiveAction(null);
      await refreshStatus();
      emitCloudSyncUpdated();
      return;
    }

    markRecentManualPush();
    const protectedPreviousDriveCopy = String(response.data?.protectedMirrorBackup || '').trim();
    const deliveryPending = response.data?.cloudDeliveryPending === true;
    setToast({
      type: deliveryPending ? 'warning' : 'success',
      text: protectedPreviousDriveCopy
        ? 'Drive fue respaldado y esta PC quedó como copia principal.'
        : deliveryPending
        ? response.data?.driveDesktop?.message || 'La copia quedo preparada, pero Google Drive sigue pendiente.'
        : 'Carpeta espejo actualizada correctamente.',
    });
    setModalMessage(protectedPreviousDriveCopy
      ? 'ARMI guardó primero la versión anterior de Drive en el historial protegido. Los datos de esta PC son ahora la copia principal.'
      : deliveryPending
        ? 'ARMI guardo la copia en la carpeta espejo, pero Google Drive debe reanudar la sincronizacion para enviarla a la nube.'
        : 'La carpeta espejo quedo actualizada. Google Drive para escritorio continuara la entrega en segundo plano.');
    setActiveAction(null);
    await refreshStatus();
    emitCloudSyncUpdated();
  };

  const clearVersionHistory = async () => {
    setClearingHistory(true);
    setErrorMessage(null);
    const response = await clearCloudVersionHistory();
    if (!response.success) {
      const nextError = response.message || 'No se pudo archivar el historial de versiones.';
      setErrorMessage(nextError);
      setToast({ type: 'error', text: nextError });
      setClearingHistory(false);
      await refreshStatus();
      return;
    }

    setToast({ type: 'success', text: response.message || 'Historial de versiones archivado correctamente.' });
    setClearingHistory(false);
    await refreshStatus();
    emitCloudSyncUpdated();
  };

  const markConflictResolved = async (artifactId: string) => {
    const key = `resolve:conflict:${artifactId}`;
    setArtifactActionKey(key);
    setErrorMessage(null);
    const response = await resolveCloudConflict({ artifactId });
    if (!response.success) {
      const nextError = response.message || 'No se pudo marcar el conflicto como resuelto.';
      setErrorMessage(nextError);
      setToast({ type: 'error', text: nextError });
      setArtifactActionKey('');
      await refreshStatus();
      return;
    }

    setStatus((current) => removeConflictFromStatus(current, artifactId));
    setToast({ type: 'success', text: response.message || 'Conflicto archivado y retirado de la lista.' });
    setArtifactActionKey('');
    await refreshStatus();
    emitCloudSyncUpdated();
  };

  const chooseMirrorFolder = async () => {
    const picked = await pickCloudSyncFolder();
    if (!picked.success || !picked.path) {
      if (!picked.cancelled) setToast({ type: 'error', text: picked.message || 'No se pudo seleccionar la carpeta.' });
      return;
    }
    const selectedRoot = picked.path;
    const cleanRoot = selectedRoot.replace(/[\\/]+$/, '');
    const selectedMirrorPath = /ARMI Sync[\\/]users[\\/][^\\/]+$/i.test(cleanRoot)
      ? cleanRoot
      : /ARMI Sync[\\/]users$/i.test(cleanRoot)
        ? `${cleanRoot}\\${syncUserKey}`
        : /ARMI Sync$/i.test(cleanRoot)
          ? `${cleanRoot}\\users\\${syncUserKey}`
          : `${cleanRoot}\\ARMI Sync\\users\\${syncUserKey}`;
    setMirrorPath(selectedMirrorPath);
    const saved = await saveConfig('drive_mirror', autoSyncOnClose, {
      mirrorPath: selectedMirrorPath,
      successMessage: 'Carpeta de Google Drive vinculada correctamente.',
    });
    if (!saved) return;

    setDetailsOpen(true);
    const freshResponse = await getCloudSyncStatus();
    const freshStatus = freshResponse.success ? freshResponse.data || null : null;
    if (!freshStatus) {
      setToast({ type: 'error', text: freshResponse.message || 'La carpeta se vinculo, pero no pude comprobar su contenido.' });
      return;
    }
    setStatus(freshStatus);

    if (!freshStatus.mirrorManifest) {
      setToast({ type: 'success', text: 'Carpeta lista. Iniciando la primera subida automaticamente...' });
      await executeSyncAction('push', freshStatus);
      return;
    }

    if (freshStatus.comparison === 'in-sync') {
      setToast({ type: 'success', text: 'Esta PC ya tiene la misma copia que la carpeta espejo.' });
      return;
    }

    setToast({ type: 'success', text: 'Se encontro una copia existente. Recuperandola automaticamente en esta PC...' });
    await executeSyncAction('pull', freshStatus);
  };

  const toggleVersionHistoryVisibility = () => {
    setShowVersionHistory((current) => {
      const next = !current;
      window.localStorage.setItem(VERSION_HISTORY_VISIBILITY_KEY, next ? 'true' : 'false');
      return next;
    });
  };

  const badge = comparisonMeta[status?.comparison || 'local-mode'] || comparisonMeta['no-data'];
  const isDriveMode = configMode === 'drive_mirror';
  const isMirrorMode = configMode === 'drive_mirror';
  const remoteFolderName = status?.config.remoteUser?.folderName || sessionSyncProfile.driveFolderName;
  const remoteFolderUrl = status?.config.remoteUser?.folderUrl || sessionSyncProfile.driveFolderUrl;
  const conflictsSummary = status?.config.remoteActivity?.conflicts;
  const versionsSummary = status?.config.remoteActivity?.versions;
  const latestConflict = conflictsSummary?.items?.[0] || null;
  const localEntitySummary = formatEntitySummary(status?.localManifest?.summary);
  const driveEntitySummary = formatEntitySummary(status?.mirrorManifest?.summary);
  const latestConflictEntitySummary = formatEntitySummary(latestConflict?.summary);
  const localMatchesLatestConflict = manifestsLookEquivalent(status?.localManifest, latestConflict as any);
  const localMatchesAnyConflict = Boolean(
    status?.localManifest && conflictsSummary?.items?.some((item) => manifestsLookEquivalent(status.localManifest, item as any))
  );
  const localMatchesAnyVersion = Boolean(
    status?.localManifest && versionsSummary?.items?.some((item) => manifestsLookEquivalent(status.localManifest, item as any))
  );
  const canPullFromDrive = !!status?.mirrorManifest
    && (status.comparison === 'mirror-newer' || status.comparison === 'diverged');
  const manualRecoveryNeeded = isDriveMode && !!status && (
    status.comparison !== 'in-sync'
    || !!status.pendingLocal
    || status.driveDesktop?.state !== 'ready'
  );
  const canRetryManualPush = !!status && (
    status.comparison === 'mirror-missing'
    || status.comparison === 'local-newer'
    || !!status.pendingLocal
  );
  const copyRecommendation = compareCopyEntityCounts(status);
  const pendingNeedsProtectedLocalRecovery = status?.pendingLocal?.reason === 'mirror-changed-on-another-pc';
  const canProtectDriveAndKeepLocal = pendingNeedsProtectedLocalRecovery
    && copyRecommendation.direction === 'local'
    && !!status?.mirrorManifest;
  const remoteLookupMessage = String(status?.config.remoteLookupMessage || '').trim();
  const localDate = status?.localManifest?.generatedAt
    ? new Date(status.localManifest.generatedAt).toLocaleString()
    : 'Sin datos locales';
  const mirrorDate = status?.mirrorManifest?.generatedAt
    ? new Date(status.mirrorManifest.generatedAt).toLocaleString()
    : 'Sin copia en Drive';
  const incrementalState = status?.incrementalSync?.state || status?.continuousSync?.state || 'inactive';
  const synchronizationTone = !isDriveMode
    ? 'local'
    : !browserOnline
      || status?.driveDesktop?.state !== 'ready'
      || ['error', 'unavailable', 'pending', 'waiting-for-drive', 'waiting-for-folder', 'protected-conflict'].includes(incrementalState)
      ? 'error'
      : loadingStatus || activeAction !== null || ['starting', 'syncing', 'waiting-for-quiet', 'needs-review'].includes(incrementalState)
        ? 'syncing'
        : 'ready';
  const synchronizationTitle = synchronizationTone === 'ready'
    ? 'Sincronizado: los cambios visibles estan en la carpeta espejo y Google Drive esta activo.'
    : synchronizationTone === 'syncing'
      ? incrementalState === 'needs-review'
        ? 'Sincronizado con un cambio concurrente registrado para revision.'
        : 'Sincronizando cambios en segundo plano.'
      : synchronizationTone === 'error'
        ? (!browserOnline ? 'No sincronizado: esta PC no tiene internet.' : status?.driveDesktop?.message || status?.incrementalSync?.message || 'No sincronizado; los datos locales siguen seguros.')
        : 'Modo local: Google Drive no esta activo.';
  const toggleButtonClass = `
    relative group ${compact ? '-mr-[12rem] origin-left scale-[0.34]' : ''} flex h-[4.4rem] w-[18.5rem] items-center overflow-hidden rounded-full border
    bg-white/25 px-2 backdrop-blur-xl transition-all duration-500
    shadow-[inset_0_1px_1px_rgba(255,255,255,0.95),inset_0_-8px_18px_rgba(15,23,42,0.10),0_14px_28px_rgba(15,23,42,0.18)]
    disabled:opacity-60
    ${isDriveMode ? 'border-sky-200/80' : 'border-amber-200/80'}
  `;
  const toggleGlowClass = `
    pointer-events-none absolute top-[0.45rem] h-[3.5rem] w-[3.5rem] rounded-full transition-all duration-500
    ${isDriveMode
      ? 'left-[14.45rem] bg-sky-400/80 shadow-[0_0_18px_rgba(56,189,248,0.95),0_0_38px_rgba(37,99,235,0.55)]'
      : 'left-[0.45rem] bg-amber-300/90 shadow-[0_0_18px_rgba(251,191,36,0.95),0_0_38px_rgba(245,158,11,0.55)]'}
  `;
  const infoButtonClass = compact
    ? 'flex h-7 w-7 items-center justify-center rounded-full border border-slate-300/80 bg-white/95 text-[10px] font-black text-slate-600 shadow-sm transition hover:border-slate-400 hover:bg-slate-50'
    : 'flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-black text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50';
  const toastPositionClass = compact
    ? 'absolute bottom-full left-0 z-[240] mb-3 w-[18rem]'
    : 'absolute right-0 top-[4.65rem] z-50 w-[20rem]';
  const detailsPositionClass = compact
    ? 'absolute bottom-full left-0 z-[230] mb-3 w-[21rem] max-h-[75vh] overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white/98 p-4 shadow-[0_24px_50px_rgba(15,23,42,0.18)] backdrop-blur'
    : 'absolute right-0 top-[4.1rem] z-40 w-[21rem] rounded-[1.75rem] border border-slate-200 bg-white/98 p-4 shadow-[0_24px_50px_rgba(15,23,42,0.18)] backdrop-blur';

  return (
    <>
      <div ref={rootRef} className={`relative flex items-center print:hidden ${compact ? 'gap-1.5 overflow-visible' : 'gap-2'}`}>
        <button
          type="button"
          aria-label={isDriveMode ? 'Cambiar a modo local' : 'Cambiar a modo Drive'}
          onClick={async () => {
            const previousMode = configMode;
            const nextMode = isDriveMode ? 'local' : 'drive_mirror';
            setConfigMode(nextMode);
            const success = await saveConfig(
              nextMode,
              autoSyncOnClose,
              {
                successMessage: nextMode === 'drive_mirror'
                  ? 'Espejo gratuito de Google Drive activado.'
                  : 'Modo local activado.',
              }
            );
            if (!success) {
              setConfigMode(previousMode);
            }
          }}
          disabled={savingConfig || loadingStatus || activeAction !== null}
          className={
            compact
              ? `group relative h-7 w-[4.6rem] overflow-hidden rounded-full border bg-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.16)] backdrop-blur transition disabled:opacity-60 ${isDriveMode ? 'border-sky-200/80' : 'border-amber-200/80'}`
              : toggleButtonClass
          }
        >
          {compact ? (
            <>
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.78),rgba(255,255,255,0.16)_48%,rgba(255,255,255,0.34))]" />
              <div className={`pointer-events-none absolute left-[0.12rem] top-[0.12rem] h-[1.48rem] w-[1.48rem] rounded-full opacity-80 blur-[2px] transition-transform duration-500 ${isDriveMode ? 'translate-x-[2.7rem] bg-sky-300/70 shadow-[0_0_10px_rgba(56,189,248,0.65)]' : 'translate-x-0 bg-amber-200/75 shadow-[0_0_10px_rgba(251,191,36,0.65)]'}`} />
              <div className="pointer-events-none absolute left-[0.28rem] top-[0.28rem] z-20 flex h-[1.15rem] w-[1.15rem] items-center justify-center rounded-full border border-white/85 bg-white text-slate-700 shadow-[0_4px_10px_rgba(15,23,42,0.18)] transition-transform duration-500" style={{ transform: isDriveMode ? 'translateX(2.7rem)' : 'translateX(0)' }}>
                {isDriveMode ? <img src={driveIcon} alt="" className="h-3 w-3 object-contain" /> : <LocalPcIcon className="h-3 w-3" />}
              </div>
              <div className="pointer-events-none absolute left-[0.58rem] top-1/2 -translate-y-1/2 text-slate-400/80">
                <LocalPcIcon className="h-3.5 w-3.5" />
              </div>
              <div className="pointer-events-none absolute right-[0.58rem] top-1/2 -translate-y-1/2">
                <img src={driveIcon} alt="" className={`h-3.5 w-3.5 object-contain transition-opacity ${isDriveMode ? 'opacity-100' : 'opacity-40 grayscale'}`} />
              </div>
            </>
          ) : null}
          {!compact ? (
            <>
          <div className="pointer-events-none absolute inset-0 rounded-full bg-[linear-gradient(135deg,rgba(255,255,255,0.75),rgba(255,255,255,0.18)_48%,rgba(255,255,255,0.42))]" />

          <div className={toggleGlowClass} />

          <div
            className={`
              absolute top-[0.65rem] z-20 flex h-[3.1rem] w-[3.1rem] items-center justify-center rounded-full border
              bg-white/25 text-[1.45rem] backdrop-blur-md transition-all duration-500
              shadow-[inset_0_1px_1px_rgba(255,255,255,0.95),0_8px_18px_rgba(15,23,42,0.18)]
              ${isDriveMode
                ? 'left-[14.65rem] border-sky-100/80 text-white'
                : 'left-[0.65rem] border-amber-100/80 text-white'}
            `}
          >
            {isDriveMode ? '☁' : '🖥'}
          </div>

          <div className="relative z-10 grid w-full grid-cols-2 items-center px-5">
            <div
              className={`
                pl-12 text-left transition-all duration-500
                ${isDriveMode ? 'text-slate-400/70' : 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.30)]'}
              `}
            >
              <span className="flex items-center justify-center">
                <LocalPcIcon className={`h-5 w-5 ${isDriveMode ? 'opacity-45' : 'opacity-100'}`} />
              </span>
            </div>

            <div
              className={`
                pr-12 text-right transition-all duration-500
                ${isDriveMode ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.30)]' : 'text-slate-400/70'}
              `}
            >
              <span className="flex items-center justify-center">
                <img src={driveIcon} alt="" className={`h-5 w-5 object-contain ${isDriveMode ? 'brightness-0 invert opacity-100' : 'grayscale opacity-45'}`} />
              </span>
            </div>
          </div>

          <div
            className={`
              pointer-events-none absolute inset-0 rounded-full transition-all duration-500
              ${isDriveMode
                ? 'bg-[radial-gradient(circle_at_82%_50%,rgba(14,165,233,0.45),transparent_34%)]'
                : 'bg-[radial-gradient(circle_at_18%_50%,rgba(245,158,11,0.45),transparent_34%)]'}
            `}
          />
            </>
          ) : null}
        </button>

        {compact ? (
          <span
            role="status"
            aria-label={synchronizationTitle}
            title={synchronizationTitle}
            className={`absolute -right-0.5 -top-1 z-30 h-2.5 w-2.5 rounded-full border-2 border-white shadow-sm ${
              synchronizationTone === 'ready'
                ? 'bg-emerald-500'
                : synchronizationTone === 'syncing'
                  ? 'animate-pulse bg-amber-400'
                  : synchronizationTone === 'error'
                    ? 'bg-rose-500'
                    : 'bg-slate-400'
            }`}
          />
        ) : null}

        <button
          type="button"
          onClick={() => setDetailsOpen((current) => !current)}
          className={infoButtonClass}
          title="Informacion de sincronizacion"
        >
          i
        </button>

        {toast ? (
          <div className={toastPositionClass}>
            <div
              className={`rounded-2xl border px-4 py-3 text-sm font-semibold shadow-[0_18px_34px_rgba(15,23,42,0.16)] backdrop-blur ${
                toast.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50/95 text-emerald-800'
                  : toast.type === 'warning'
                    ? 'border-amber-200 bg-amber-50/95 text-amber-800'
                    : 'border-rose-200 bg-rose-50/95 text-rose-800'
              }`}
            >
              {toast.text}
            </div>
          </div>
        ) : null}

        {detailsOpen ? (
          <div className={detailsPositionClass}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Sincronizacion</p>
                <h3 className="text-base font-black text-slate-900">{badge.label}</h3>
              </div>
              <button
                type="button"
                onClick={refreshStatus}
                disabled={loadingStatus || activeAction !== null}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              >
                Actualizar
              </button>
            </div>

            <div ref={detailsBodyRef} className="mt-3 max-h-[calc(75vh-4.5rem)] space-y-2 overflow-y-auto pr-1 custom-scrollbar">
              <div className="rounded-2xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
                <p className="font-black uppercase tracking-[0.14em] text-slate-400">Usuario</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{syncUserLabel}</p>
                <p className="truncate">{syncUserKey}</p>
              </div>

              {!isDriveMode ? (
                <div className="rounded-2xl border border-sky-100 bg-sky-50 px-3 py-3 text-xs text-sky-800">
                  <p className="font-black uppercase tracking-[0.14em] text-sky-500">Google Drive gratuito</p>
                  <p className="mt-1 leading-relaxed">
                    {status?.driveDesktop?.detected
                      ? 'Google Drive para escritorio fue detectado. Puedes vincular la carpeta que corresponda a esta cuenta.'
                      : 'Google Drive para escritorio no fue detectado en esta PC.'}
                  </p>
                  {status?.driveDesktop?.detected ? (
                    <button
                      type="button"
                      onClick={chooseMirrorFolder}
                      className="mt-2 rounded-xl border border-sky-200 bg-white px-3 py-2 font-bold text-sky-700"
                    >
                      Elegir carpeta y activar
                    </button>
                  ) : (
                    <a
                      href="https://support.google.com/drive/answer/10838124"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block rounded-xl border border-sky-200 bg-white px-3 py-2 font-bold text-sky-700"
                    >
                      Descargar Google Drive
                    </a>
                  )}
                </div>
              ) : null}

              {isDriveMode ? (
                <div className="rounded-2xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
                  <p className="font-black uppercase tracking-[0.14em] text-slate-400">Carpeta</p>
                  <p className="mt-1 break-all text-sm font-semibold text-slate-800">
                    {isMirrorMode ? mirrorPath || 'Selecciona una carpeta de Google Drive' : remoteFolderName || 'Preparando carpeta...'}
                  </p>
                  {isMirrorMode ? (
                    <>
                      <div className={`mt-2 rounded-xl border px-3 py-2 font-semibold ${
                        status?.driveDesktop?.state === 'ready'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                      }`}>
                        {status?.driveDesktop?.message || 'Comprobando Google Drive para escritorio...'}
                      </div>
                      <button
                        type="button"
                        onClick={chooseMirrorFolder}
                        disabled={savingConfig || activeAction !== null}
                        className="mt-2 rounded-xl border border-sky-200 bg-white px-3 py-2 font-bold text-sky-700 transition hover:bg-sky-50 disabled:opacity-50"
                      >
                        Cambiar carpeta
                      </button>
                      {!status?.driveDesktop?.detected ? (
                        <a
                          href="https://support.google.com/drive/answer/10838124"
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 inline-block font-semibold text-sky-700 hover:text-sky-800"
                        >
                          Instalar Google Drive
                        </a>
                      ) : null}
                      <p className="mt-2 leading-relaxed text-slate-500">
                        ARMI comprueba la instalacion, abre Google Drive automaticamente cuando es posible y revisa la conexion a internet. Si Drive se pausa, los cambios permanecen seguros y se reintentan al reanudarlo.
                      </p>
                      {status?.incrementalSync || status?.continuousSync ? (
                        <div className={`mt-2 rounded-xl border px-3 py-2 ${
                          synchronizationTone === 'ready'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : synchronizationTone === 'syncing'
                              ? 'border-amber-200 bg-amber-50 text-amber-800'
                              : 'border-rose-200 bg-rose-50 text-rose-800'
                        }`}>
                          <p className="font-black uppercase tracking-[0.12em]">Sincronizacion incremental</p>
                          <p className="mt-1 leading-relaxed">{status.incrementalSync?.message || status.continuousSync?.message}</p>
                          <p className="mt-1 font-semibold">
                            Internet: {status.driveDesktop?.internetOnline === false ? 'sin conexion; trabajando localmente' : 'disponible'}
                          </p>
                        </div>
                      ) : null}
                      {status?.resourceDelivery ? (
                        <div className={`mt-2 rounded-xl border px-3 py-2 ${
                          status.resourceDelivery.pendingFilesCount > 0
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        }`}>
                          <p className="font-black uppercase tracking-[0.12em]">Recursos bajo demanda</p>
                          <p className="mt-1 leading-relaxed">
                            {status.resourceDelivery.pendingFilesCount > 0
                              ? `${status.resourceDelivery.pendingFilesCount} archivo${status.resourceDelivery.pendingFilesCount === 1 ? '' : 's'} se descargara${status.resourceDelivery.pendingFilesCount === 1 ? '' : 'n'} cuando lo necesites. Los datos principales ya pueden utilizarse.`
                              : `${status.resourceDelivery.availableFiles} archivo${status.resourceDelivery.availableFiles === 1 ? '' : 's'} disponible${status.resourceDelivery.availableFiles === 1 ? '' : 's'} en esta PC.`}
                          </p>
                        </div>
                      ) : null}
                      {status?.mirrorOperation?.state === 'origin-copy-pending' || status?.mirrorOperation?.state === 'catalog-ahead-of-manifest' ? (
                        <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                          <p className="font-black uppercase tracking-[0.12em]">Copia de otra PC pendiente</p>
                          <p className="mt-1 leading-relaxed">
                            {status.mirrorOperation.state === 'origin-copy-pending'
                              ? 'El catalogo llego, pero la otra PC no registro que terminara de copiar sus archivos.'
                              : 'El catalogo nuevo ya llego; Google Drive todavia esta entregando el manifiesto o los recursos asociados.'}
                          </p>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={chooseMirrorFolder}
                      disabled={savingConfig || activeAction !== null}
                      className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                    >
                      Cambiar al modo gratuito de escritorio
                    </button>
                  )}
                  <div className="mt-1 flex flex-wrap gap-3">
                    {!isMirrorMode && remoteFolderUrl ? (
                      <a
                        href={remoteFolderUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block font-semibold text-sky-700 hover:text-sky-800"
                      >
                        Carpeta principal
                      </a>
                    ) : null}
                    {!isMirrorMode && status?.config.remoteUser?.conflictsFolderUrl ? (
                      <a
                        href={status.config.remoteUser.conflictsFolderUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block font-semibold text-rose-700 hover:text-rose-800"
                      >
                        Conflictos
                      </a>
                    ) : null}
                    {!isMirrorMode && status?.config.remoteUser?.versionsFolderUrl ? (
                      <a
                        href={status.config.remoteUser.versionsFolderUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block font-semibold text-emerald-700 hover:text-emerald-800"
                      >
                        Historial
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-2xl bg-slate-50 px-3 py-3 text-slate-500">
                  <p className="font-black uppercase tracking-[0.14em] text-slate-400">Local</p>
                  <p className="mt-1 leading-relaxed">{localDate}</p>
                  <p className="mt-2 leading-relaxed text-slate-600">{localEntitySummary}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-3 py-3 text-slate-500">
                  <p className="font-black uppercase tracking-[0.14em] text-slate-400">Drive</p>
                  <p className="mt-1 leading-relaxed">{mirrorDate}</p>
                  <p className="mt-2 leading-relaxed text-slate-600">
                    {status?.mirrorManifest?.summary
                      ? driveEntitySummary
                      : remoteLookupMessage || 'Esta copia aun no trae resumen detallado.'}
                  </p>
                </div>
              </div>

              {isDriveMode ? (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-2xl bg-slate-50 px-3 py-3 text-slate-500">
                    <p className="font-black uppercase tracking-[0.14em] text-slate-400">Conflictos</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{conflictsSummary?.count || 0}</p>
                    <p className="mt-1 leading-relaxed">
                      {conflictsSummary?.latestAt ? new Date(conflictsSummary.latestAt).toLocaleString() : 'Sin conflictos pendientes'}
                    </p>
                    {conflictsSummary?.latestUrl ? (
                      <a
                        href={conflictsSummary.latestUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block font-semibold text-rose-700 hover:text-rose-800"
                      >
                        Ver ultimo
                      </a>
                    ) : null}
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-3 py-3 text-slate-500">
                    <p className="font-black uppercase tracking-[0.14em] text-slate-400">Historial</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{versionsSummary?.count || 0}</p>
                    <p className="mt-1 leading-relaxed">
                      {!showVersionHistory && versionsSummary?.count
                        ? 'Oculto'
                        : versionsSummary?.latestAt
                          ? new Date(versionsSummary.latestAt).toLocaleString()
                          : 'Aun no hay versiones subidas'}
                    </p>
                    {versionsSummary?.latestUrl && showVersionHistory ? (
                      <a
                        href={versionsSummary.latestUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block font-semibold text-emerald-700 hover:text-emerald-800"
                      >
                        Ver ultima
                      </a>
                    ) : null}
                    {versionsSummary?.count ? (
                      <button
                        type="button"
                        onClick={toggleVersionHistoryVisibility}
                        className="mt-1 inline-block font-semibold text-emerald-700 hover:text-emerald-800"
                      >
                        {showVersionHistory ? 'Ocultar' : 'Mostrar'}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {isDriveMode && latestConflict ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-800">
                  <p className="font-black uppercase tracking-[0.14em] text-rose-500">Ultimo conflicto detectado</p>
                  <p className="mt-1 leading-relaxed">
                    Esta copia quedo protegida en Drive y no reemplazo la version actual automaticamente.
                  </p>
                  <p className="mt-2 leading-relaxed">
                    Fecha: {latestConflict.generatedAt ? new Date(latestConflict.generatedAt).toLocaleString() : 'Sin fecha'}
                  </p>
                  <p className="mt-1 leading-relaxed">
                    Equipo: {latestConflict.deviceId || 'No identificado'}
                  </p>
                  <p className="mt-1 leading-relaxed">
                    {latestConflictEntitySummary || 'Sin resumen legible en esta version del conflicto.'}
                  </p>
                  <p className="mt-2 leading-relaxed">
                    Si usted registro asistencias en otra PC y no las ve aqui, es muy probable que hayan quedado dentro de este conflicto protegido.
                  </p>
                  {localMatchesLatestConflict ? (
                    <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 font-semibold text-emerald-800">
                      La copia local ya coincide con este conflicto. Si ya recuperaste esa informacion, puedes archivarlo sin afectar tu copia actual.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {isDriveMode && conflictsSummary?.items?.length ? (
                <div className="rounded-2xl bg-slate-50 px-3 py-3 text-xs text-slate-600">
                  <p className="font-black uppercase tracking-[0.14em] text-slate-400">Copias en conflicto</p>
                  {localMatchesAnyConflict ? (
                    <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 leading-relaxed text-emerald-800">
                      La copia local ya coincide con al menos uno de estos conflictos. Esos registros ya pueden tratarse como historial de respaldo y archivarse uno por uno.
                    </p>
                  ) : null}
                  <div className="mt-2 space-y-2">
                    {conflictsSummary.items.map((item) => {
                      const inspectKey = `inspect:conflict:${item.id}`;
                      const applyKey = `apply:conflict:${item.id}`;
                      const mergeKey = `merge-attendance:conflict:${item.id}`;
                      const mergeStudentsKey = `merge-students:conflict:${item.id}`;
                      const resolveKey = `resolve:conflict:${item.id}`;
                      return (
                        <div key={item.id} className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                          <p className="font-semibold text-slate-800">{formatArtifactMoment(item.generatedAt || item.createdAt)}</p>
                          <p className="mt-1 leading-relaxed text-slate-500">{item.deviceId || 'Equipo no identificado'}</p>
                          <p className="mt-1 leading-relaxed text-slate-500">{formatEntitySummary(item.summary) || 'Sin resumen disponible.'}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <ConflictActionButton
                              loadingLabel="Revisando..."
                              title="Abrir un resumen de esta copia en conflicto para revisar fecha, equipo y contenido."
                              loading={artifactActionKey === inspectKey}
                              disabled={artifactActionKey !== ''}
                              tone="border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                              onClick={() => runArtifactAction('conflict', item.id, 'inspect')}
                            >
                              <EyeIcon />
                            </ConflictActionButton>
                            <ConflictActionButton
                              loadingLabel="Fusionando..."
                              title="Traer solo las asistencias de esta copia en conflicto sin reemplazar toda la PC."
                              loading={artifactActionKey === mergeKey}
                              disabled={artifactActionKey !== ''}
                              tone="border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400 hover:bg-amber-100"
                              onClick={() => runArtifactAction('conflict', item.id, 'merge-attendance')}
                            >
                              <AttendanceMergeIcon />
                            </ConflictActionButton>
                            <ConflictActionButton
                              loadingLabel="Fusionando..."
                              title="Traer solo estudiantes y egresados de esta copia en conflicto sin reemplazar todo lo demás."
                              loading={artifactActionKey === mergeStudentsKey}
                              disabled={artifactActionKey !== ''}
                              tone="border-sky-300 bg-sky-50 text-sky-800 hover:border-sky-400 hover:bg-sky-100"
                              onClick={() => runArtifactAction('conflict', item.id, 'merge-students')}
                            >
                              <StudentsMergeIcon />
                            </ConflictActionButton>
                            <ConflictActionButton
                              loadingLabel="Cargando..."
                              title="Reemplazar la copia actual de esta PC con toda la informacion de este conflicto."
                              loading={artifactActionKey === applyKey}
                              disabled={artifactActionKey !== ''}
                              tone="border-slate-900 bg-slate-900 text-white hover:border-slate-800 hover:bg-slate-800"
                              onClick={() => runArtifactAction('conflict', item.id, 'apply')}
                            >
                              <RestoreIcon />
                            </ConflictActionButton>
                            <ConflictActionButton
                              loadingLabel="Archivando..."
                              title="Marcar este conflicto como revisado y moverlo al archivo para despejar la lista."
                              loading={artifactActionKey === resolveKey}
                              disabled={artifactActionKey !== ''}
                              tone="border-rose-300 bg-rose-50 text-rose-800 hover:border-rose-400 hover:bg-rose-100"
                              onClick={() => markConflictResolved(item.id)}
                            >
                              <ArchiveIcon />
                            </ConflictActionButton>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {isDriveMode && showVersionHistory && versionsSummary?.items?.length ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-900">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-black uppercase tracking-[0.14em] text-emerald-700">Historial de versiones</p>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={toggleVersionHistoryVisibility}
                        className="rounded-xl border border-emerald-300 bg-white px-3 py-2 font-bold text-emerald-800 transition hover:border-emerald-400"
                      >
                        Ocultar
                      </button>
                      <button
                        type="button"
                        onClick={clearVersionHistory}
                        disabled={clearingHistory || activeAction !== null || artifactActionKey !== ''}
                        className="rounded-xl border border-emerald-300 bg-white px-3 py-2 font-bold text-emerald-800 transition hover:border-emerald-400 disabled:opacity-50"
                      >
                        {clearingHistory ? 'Archivando...' : 'Archivar historial'}
                      </button>
                    </div>
                  </div>
                  {localMatchesAnyVersion ? (
                    <p className="mt-3 rounded-xl border border-emerald-200 bg-white px-3 py-2 leading-relaxed text-emerald-800">
                      La copia local ya coincide con una version del historial. Ese historial puede conservarse como respaldo o archivarse para despejar la vista; no cambia tu copia actual.
                    </p>
                  ) : null}
                  <div className="mt-3 space-y-2">
                    {versionsSummary.items.map((item) => {
                      const inspectKey = `inspect:version:${item.id}`;
                      const applyKey = `apply:version:${item.id}`;
                      const mergeKey = `merge-attendance:version:${item.id}`;
                      const mergeStudentsKey = `merge-students:version:${item.id}`;
                      return (
                        <div key={item.id} className="rounded-2xl border border-emerald-200 bg-white px-3 py-3 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-emerald-950">{formatArtifactMoment(item.generatedAt || item.createdAt)}</p>
                              <p className="mt-1 truncate leading-relaxed text-emerald-700">{item.deviceId || 'Equipo no identificado'}</p>
                            </div>
                            <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                              <VersionActionButton
                                label="Revisando"
                                title="Ver resumen"
                                loading={artifactActionKey === inspectKey}
                                disabled={artifactActionKey !== ''}
                                tone="border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                                onClick={() => runArtifactAction('version', item.id, 'inspect')}
                              >
                                <EyeIcon />
                              </VersionActionButton>
                              <VersionActionButton
                                label="Fusionando asistencia"
                                title="Fusionar asistencia"
                                loading={artifactActionKey === mergeKey}
                                disabled={artifactActionKey !== ''}
                                tone="border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400 hover:bg-amber-100"
                                onClick={() => runArtifactAction('version', item.id, 'merge-attendance')}
                              >
                                <AttendanceMergeIcon />
                              </VersionActionButton>
                              <VersionActionButton
                                label="Fusionando estudiantes"
                                title="Fusionar estudiantes"
                                loading={artifactActionKey === mergeStudentsKey}
                                disabled={artifactActionKey !== ''}
                                tone="border-sky-300 bg-sky-50 text-sky-800 hover:border-sky-400 hover:bg-sky-100"
                                onClick={() => runArtifactAction('version', item.id, 'merge-students')}
                              >
                                <StudentsMergeIcon />
                              </VersionActionButton>
                              <VersionActionButton
                                label="Restaurando copia"
                                title="Usar copia completa"
                                loading={artifactActionKey === applyKey}
                                disabled={artifactActionKey !== ''}
                                tone="border-emerald-700 bg-emerald-700 text-white hover:border-emerald-800 hover:bg-emerald-800"
                                onClick={() => runArtifactAction('version', item.id, 'apply')}
                              >
                                <RestoreIcon />
                              </VersionActionButton>
                            </div>
                          </div>
                          <p className="mt-2 leading-relaxed text-emerald-800">{formatEntitySummary(item.summary) || 'Sin resumen disponible.'}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {isDriveMode ? (
                <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs font-black text-emerald-700">✓</span>
                  Sincronizacion continua y verificacion al abrir y cerrar
                </div>
              ) : null}

              {errorMessage ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {errorMessage}
                </div>
              ) : null}

              {isDriveMode && !manualRecoveryNeeded ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-800">
                  <p className="font-black uppercase tracking-[0.14em] text-emerald-700">Sincronizacion automatica activa</p>
                  <p className="mt-1 leading-relaxed">ARMI detecta cambios durante el uso, espera unos segundos para agruparlos y actualiza la carpeta espejo continuamente. La apertura y el cierre solo verifican que no quede nada pendiente.</p>
                </div>
              ) : null}

              {manualRecoveryNeeded ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
                  <p className="font-black uppercase tracking-[0.14em] text-amber-700">Recuperacion manual</p>
                  <p className="mt-1 leading-relaxed">
                    {status?.comparison === 'diverged'
                      ? 'Esta PC y Drive contienen cambios distintos. Usa el asistente protegido para elegir cual conservar; ninguna copia se reemplazara sin confirmacion.'
                      : status?.comparison === 'mirror-newer'
                        ? 'Drive contiene cambios de otra PC que no llegaron automaticamente. Puedes recuperarlos ahora.'
                        : status?.comparison === 'mirror-missing'
                          ? 'La carpeta espejo todavia no contiene una copia completa. Puedes reintentar su creacion.'
                          : canProtectDriveAndKeepLocal
                            ? `Drive cambió desde otra PC, pero esta PC conserva más información (${copyRecommendation.advantages.slice(0, 3).join(', ')}). Puedes subir esta PC a Drive; ARMI guardará antes la copia anterior de Drive en el historial protegido.`
                          : status?.pendingLocal
                            ? 'Hay cambios locales pendientes de entregar a Google Drive.'
                            : status?.driveDesktop?.message || 'La sincronizacion necesita atencion.'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {status?.comparison === 'diverged' ? (
                      <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="rounded-xl bg-slate-900 px-3 py-2 font-bold text-white"
                      >
                        Abrir asistente de solucion
                      </button>
                    ) : null}
                    {canProtectDriveAndKeepLocal ? (
                      <button
                        type="button"
                        onClick={async () => {
                          const confirmed = window.confirm(
                            `Esta PC tiene ${copyRecommendation.advantages.slice(0, 3).join(', ')}. ARMI respaldará primero la copia actual de Drive y luego conservará esta PC como principal. ¿Deseas continuar?`
                          );
                          if (!confirmed) return;
                          await executeSyncAction('push', status, { force: true });
                        }}
                        disabled={loadingStatus || activeAction !== null}
                        className="rounded-xl bg-emerald-700 px-3 py-2 font-bold text-white disabled:opacity-50"
                      >
                        Subir esta PC a Drive
                      </button>
                    ) : null}
                    {canRetryManualPush && status?.comparison !== 'diverged' && !pendingNeedsProtectedLocalRecovery ? (
                      <button
                        type="button"
                        onClick={() => executeSyncAction('push')}
                        disabled={loadingStatus || activeAction !== null}
                        className="rounded-xl border border-emerald-300 bg-white px-3 py-2 font-bold text-emerald-800 disabled:opacity-50"
                      >
                        {status?.comparison === 'mirror-missing' ? 'Crear copia ahora' : 'Reintentar cambios pendientes'}
                      </button>
                    ) : null}
                    {canPullFromDrive && status?.comparison === 'mirror-newer' ? (
                      <button
                        type="button"
                        onClick={() => executeSyncAction('pull')}
                        disabled={loadingStatus || activeAction !== null}
                        className="rounded-xl border border-sky-300 bg-white px-3 py-2 font-bold text-sky-800 disabled:opacity-50"
                      >
                        Recuperar cambios de otra PC
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-6 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[2rem] bg-white p-7 shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-sky-500">Estado de sincronizacion</p>
            <h2 className="mt-2 text-2xl font-black text-slate-900">
              {activeAction === 'push' ? 'Actualizando Drive' : activeAction === 'pull' ? 'Cargando desde Drive' : errorMessage && canProtectDriveAndKeepLocal ? 'Drive protegió tus datos' : errorMessage ? 'Operacion no disponible' : 'Sincronizacion protegida'}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">{modalMessage}</p>

            <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full transition-all ${
                activeAction
                  ? 'w-3/4 animate-pulse bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400'
                  : errorMessage
                    ? 'w-full bg-rose-500'
                    : 'w-full bg-emerald-500'
              }`} />
            </div>

            {errorMessage ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {errorMessage}
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-2">
              {errorMessage && canProtectDriveAndKeepLocal && activeAction === null ? (
                <button
                  type="button"
                  onClick={async () => {
                    const confirmed = window.confirm(
                      `Esta PC tiene ${copyRecommendation.advantages.slice(0, 3).join(', ')}. ARMI respaldará primero la copia actual de Drive y luego conservará esta PC como principal. ¿Deseas continuar?`
                    );
                    if (!confirmed) return;
                    await executeSyncAction('push', status, { force: true });
                  }}
                  className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800"
                >
                  Subir esta PC a Drive
                </button>
              ) : null}
              {status?.comparison === 'mirror-newer' && activeAction === null ? (
                <button
                  type="button"
                  onClick={() => executeSyncAction('pull')}
                  className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
                >
                  Descargar ahora
                </button>
              ) : null}
              <button
                type="button"
                onClick={async () => {
                  setModalOpen(false);
                  setActiveAction(null);
                  await refreshStatus();
                }}
                disabled={activeAction !== null}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
