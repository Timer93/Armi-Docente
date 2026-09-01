import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth/AuthContext';
import {
  CloudSyncStatusData,
  ResourceDeliveryStatus,
  discardPendingCloudSync,
  getCloudSyncStatus,
  getLocalCloudSyncStatus,
  getResourceDeliveryStatus,
  markPendingCloudSync,
  pullCloudSync,
  pushCloudSync,
  saveCloudFrontendState,
  saveCloudSyncConfig,
} from '../services/apiService';
import { applyArmiLocalState, CLOUD_SYNC_EVENT, collectArmiLocalState, emitCloudSyncUpdated } from '../utils/cloudSyncState';

type CloseFlowState = 'idle' | 'checking' | 'syncing' | 'needs-attention' | 'ready-to-close';
type RestorePromptReason = 'mirror-newer' | 'local-newer' | 'diverged' | 'conflicts' | 'conflicts-missing-current' | 'pending-local';
type StartupSyncFlow = 'idle' | 'checking' | 'syncing' | 'offline' | 'error';

type NoticeTone = 'info' | 'success' | 'warning' | 'error';

type SyncNotice = {
  title: string;
  message: string;
  tone: NoticeTone;
};

type SyncManifestLike = CloudSyncStatusData['localManifest'];

const toneStyles: Record<NoticeTone, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-rose-200 bg-rose-50 text-rose-800',
};

const canAutoRestoreFromCloud = (status: CloudSyncStatusData) => {
  if (status.config.mode === 'local') return false;
  if (status.comparison !== 'mirror-newer') return false;
  return !status.localManifest;
};

const formatTransferBytes = (value: number) => {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const SKIP_NEXT_LOCAL_PUSH_FLAG = 'armi-sync-skip-next-local-push';
const RECENT_MANUAL_PUSH_MARK_KEY = 'armi-sync-recent-manual-push';
const RECENT_MANUAL_PUSH_TTL_MS = 10 * 60 * 1000;

const markRecentManualPush = () => {
  window.localStorage.setItem(RECENT_MANUAL_PUSH_MARK_KEY, String(Date.now()));
};

const shouldSuppressLocalNewerPromptAfterRecentPush = (status: CloudSyncStatusData) => {
  const raw = window.localStorage.getItem(RECENT_MANUAL_PUSH_MARK_KEY);
  if (!raw) return false;

  const pushedAt = Number(raw);
  if (!Number.isFinite(pushedAt) || Date.now() - pushedAt > RECENT_MANUAL_PUSH_TTL_MS) {
    window.localStorage.removeItem(RECENT_MANUAL_PUSH_MARK_KEY);
    return false;
  }

  const savedDigest = String(status.savedManifest?.digest || '').trim();
  const mirrorDigest = String(status.mirrorManifest?.digest || '').trim();
  if (!savedDigest || savedDigest !== mirrorDigest) {
    return false;
  }

  window.localStorage.removeItem(RECENT_MANUAL_PUSH_MARK_KEY);
  return true;
};

const reloadApplicationView = () => {
  window.setTimeout(() => {
    window.location.reload();
  }, 1200);
};

const buildDriveDiagnosticMessage = (status: CloudSyncStatusData | null | undefined, fallback?: string) => {
  const base = String(fallback || '').trim();
  if (!status || status.config.mode === 'local') {
    return base || 'No pude recuperar la copia del usuario desde Drive.';
  }

  const versionsCount = Number(status.config.remoteActivity?.versions?.count || 0);
  const conflictsCount = Number(status.config.remoteActivity?.conflicts?.count || 0);
  const remoteLookupMessage = String(status.config.remoteLookupMessage || '').trim();
  if (remoteLookupMessage) {
    return remoteLookupMessage;
  }

  if (!status.mirrorManifest && (versionsCount > 0 || conflictsCount > 0)) {
    const parts = [];
    if (versionsCount > 0) parts.push(`${versionsCount} version${versionsCount === 1 ? '' : 'es'} en el historial`);
    if (conflictsCount > 0) parts.push(`${conflictsCount} conflicto${conflictsCount === 1 ? '' : 's'} protegido${conflictsCount === 1 ? '' : 's'}`);
    return `Drive si tiene ${parts.join(' y ')}, pero no se pudo leer la copia actual en la carpeta "current". Normalmente eso significa que falta "manifest.json" o "snapshot.zip" en la copia actual, o que Apps Script esta resolviendo mal esa subcarpeta.`;
  }

  return base || 'No pude recuperar la copia del usuario desde Drive.';
};

const formatSyncDigest = (digest?: string | null) => {
  const value = String(digest || '').trim();
  if (!value) return 'Sin huella';
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
};

const formatSyncDate = (value?: string | null) => {
  const text = String(value || '').trim();
  if (!text) return 'Sin fecha';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleString();
};

const formatSyncEntitySummary = (manifest?: SyncManifestLike) => {
  const entities = manifest?.summary?.entities;
  if (!entities) return 'Sin resumen';
  const summary = [
    `${entities.programaciones || 0} prog.`,
    `${entities.unidades || 0} unid.`,
    `${entities.sesiones || 0} ses.`,
    `${entities.estudiantes || 0} est.`,
    `${entities.asistencias || 0} asist.`,
    `${entities.rostros || 0} rostros`,
  ];
  if (entities.evidencias !== undefined) summary.push(`${entities.evidencias || 0} evid.`);
  return summary.join(' · ');
};

const getDivergedCopyRecommendation = (localManifest?: SyncManifestLike, mirrorManifest?: SyncManifestLike) => {
  const local = localManifest?.summary?.entities;
  const mirror = mirrorManifest?.summary?.entities;
  if (!local || !mirror) return { direction: 'unknown' as const, advantages: [] as string[] };

  const fields = [
    ['programaciones', 'programaciones'],
    ['unidades', 'unidades'],
    ['sesiones', 'sesiones'],
    ['estudiantes', 'estudiantes'],
    ['asistencias', 'asistencias'],
    ['evaluaciones', 'evaluaciones'],
    ['evidencias', 'evidencias'],
    ['rostros', 'rostros'],
  ] as const;
  const localAdvantages: string[] = [];
  const mirrorAdvantages: string[] = [];
  fields.forEach(([key, label]) => {
    const localValue = Number(local[key] || 0);
    const mirrorValue = Number(mirror[key] || 0);
    if (localValue > mirrorValue) localAdvantages.push(`${localValue - mirrorValue} ${label} más`);
    if (mirrorValue > localValue) mirrorAdvantages.push(`${mirrorValue - localValue} ${label} más`);
  });

  if (localAdvantages.length && !mirrorAdvantages.length) {
    return { direction: 'local' as const, advantages: localAdvantages };
  }
  if (mirrorAdvantages.length && !localAdvantages.length) {
    return { direction: 'mirror' as const, advantages: mirrorAdvantages };
  }
  return { direction: 'mixed' as const, advantages: [...localAdvantages, ...mirrorAdvantages] };
};

const formatPendingCountSummary = (counts?: Record<string, number> | null) => {
  if (!counts) return 'Sin resumen';
  return [
    `${counts.programaciones || 0} prog.`,
    `${counts.unidades || 0} unid.`,
    `${counts.sesiones || 0} ses.`,
    `${counts.estudiantes || 0} est.`,
    `${counts.asistencias || 0} asist.`,
    `${counts.rostros || 0} rostros`,
  ].join(' · ');
};

const getManifestDiffSummary = (localManifest?: SyncManifestLike, mirrorManifest?: SyncManifestLike) => {
  const localFiles = new Map((localManifest?.files || []).map((item) => [item.relativePath, item]));
  const mirrorFiles = new Map((mirrorManifest?.files || []).map((item) => [item.relativePath, item]));
  const allPaths = Array.from(new Set([...localFiles.keys(), ...mirrorFiles.keys()])).sort();
  const changedPaths = allPaths.filter((relativePath) => {
    const localFile = localFiles.get(relativePath);
    const mirrorFile = mirrorFiles.get(relativePath);
    if (!localFile || !mirrorFile) return true;
    return localFile.checksum !== mirrorFile.checksum || Number(localFile.size || 0) !== Number(mirrorFile.size || 0);
  });

  return {
    total: changedPaths.length,
    items: changedPaths.slice(0, 4),
  };
};

const hasOnlyFrontendStateDifference = (localManifest?: SyncManifestLike, mirrorManifest?: SyncManifestLike) => {
  const summary = getManifestDiffSummary(localManifest, mirrorManifest);
  return summary.total > 0 && summary.items.every((item) => item === 'state/frontend-local-storage.json') && summary.total === 1;
};

const FRONTEND_STATE_RECOVERY_KEYS = [
  'armi_areas',
  'armi_assignments',
  'armi_calendar_state',
  'armi_schedule_config',
  'armi_schedule_entries',
  'armi_holidays_v7',
  'armi_pa_pinned_matrix_global',
  'armi_pa_pinned_didactic_units_global',
  'armi_sessions_theme',
  'armi_units_theme',
];

const shouldHydrateStoredFrontendState = (storedKeys?: Record<string, string> | null) => {
  const nextKeys = storedKeys || {};
  const nextCount = Object.keys(nextKeys).length;
  if (nextCount === 0) return false;

  const currentKeys = collectArmiLocalState();
  const currentCount = Object.keys(currentKeys).length;
  if (nextCount <= currentCount) return false;

  return FRONTEND_STATE_RECOVERY_KEYS.some((key) => {
    const hasStored = typeof nextKeys[key] === 'string' && nextKeys[key].trim() !== '';
    const hasCurrent = typeof currentKeys[key] === 'string' && currentKeys[key].trim() !== '';
    return hasStored && !hasCurrent;
  });
};

const ActionIcon: React.FC<{ kind: 'local' | 'push' | 'pull' }> = ({ kind }) => {
  const commonProps = {
    className: 'h-4 w-4',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (kind === 'push') {
    return (
      <svg {...commonProps}>
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M5 20h14" />
      </svg>
    );
  }

  if (kind === 'pull') {
    return (
      <svg {...commonProps}>
        <path d="M12 4v12" />
        <path d="m17 11-5 5-5-5" />
        <path d="M5 20h14" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M4 12h16" />
      <path d="M4 12 8 8" />
      <path d="M4 12 8 16" />
    </svg>
  );
};

export const SyncLifecycleManager: React.FC = () => {
  const { session } = useAuth();
  const [status, setStatus] = useState<CloudSyncStatusData | null>(null);
  const [notice, setNotice] = useState<SyncNotice | null>(null);
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);
  const [restorePromptReason, setRestorePromptReason] = useState<RestorePromptReason>('mirror-newer');
  const [startupFlow, setStartupFlow] = useState<StartupSyncFlow>('idle');
  const [startupGateOpen, setStartupGateOpen] = useState(false);
  const [startupMessage, setStartupMessage] = useState('Verificando la copia mas reciente en Drive...');
  const [closeFlow, setCloseFlow] = useState<CloseFlowState>('idle');
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closeMessage, setCloseMessage] = useState('Guardando datos locales...');
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeContext, setCloseContext] = useState<'sync' | 'offline' | 'manual'>('manual');
  const [resourceDelivery, setResourceDelivery] = useState<ResourceDeliveryStatus | null>(null);
  const handledSessionRef = useRef('');
  const closeInFlightRef = useRef(false);
  const restorePromptDiffs = useMemo(
    () => getManifestDiffSummary(status?.localManifest, status?.mirrorManifest),
    [status]
  );
  const onlyFrontendStateDiff = useMemo(
    () => hasOnlyFrontendStateDifference(status?.localManifest, status?.mirrorManifest),
    [status]
  );
  const divergedRecommendation = useMemo(
    () => getDivergedCopyRecommendation(status?.localManifest, status?.mirrorManifest),
    [status]
  );
  const pendingNeedsProtectedLocalRecovery = restorePromptReason === 'pending-local'
    && status?.pendingLocal?.reason === 'mirror-changed-on-another-pc'
    && divergedRecommendation.direction === 'local';

  useEffect(() => {
    if (status?.config.mode !== 'drive_mirror') {
      setResourceDelivery(null);
      return undefined;
    }
    setResourceDelivery(status.resourceDelivery || null);
    if (!status.resourceDelivery?.pendingFilesCount && !status.resourceDelivery?.activeTransfers?.length) {
      return undefined;
    }
    let active = true;
    let timer: number | undefined;
    const refreshResourceDelivery = async () => {
      if (!active) return;
      if (document.visibilityState !== 'visible') {
        timer = window.setTimeout(refreshResourceDelivery, 2000);
        return;
      }
      const response = await getResourceDeliveryStatus();
      if (!active) return;
      if (response.success && response.data) {
        setResourceDelivery(response.data);
        if (!response.data.pendingFilesCount && !response.data.activeTransfers?.length) return;
      }
      timer = window.setTimeout(refreshResourceDelivery, 1200);
    };
    void refreshResourceDelivery();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [status?.config.mode, status?.resourceDelivery?.manifestDigest, status?.resourceDelivery?.pendingFilesCount]);

  useEffect(() => {
    if (status?.config.mode !== 'drive_mirror') return undefined;
    const retryCounts = new WeakMap<Element, number>();
    const timers = new Set<number>();
    const clearRetryQuery = (value: string) => {
      try {
        const url = new URL(value, window.location.href);
        url.searchParams.delete('armiSyncRetry');
        return url.toString();
      } catch {
        return value;
      }
    };
    const handleMediaError = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement || target instanceof HTMLVideoElement || target instanceof HTMLAudioElement)) return;
      const source = target.currentSrc || target.src;
      if (!source) return;
      let url: URL;
      try { url = new URL(source, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin || !url.pathname.startsWith('/uploads/')) return;
      const attempts = retryCounts.get(target) || 0;
      if (attempts >= 24) return;
      retryCounts.set(target, attempts + 1);
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (!target.isConnected) return;
        const retryUrl = new URL(clearRetryQuery(source));
        retryUrl.searchParams.set('armiSyncRetry', String(Date.now()));
        target.src = retryUrl.toString();
        if (target instanceof HTMLVideoElement || target instanceof HTMLAudioElement) target.load();
      }, Math.min(15000, 3000 + attempts * 500));
      timers.add(timer);
    };
    const handleMediaLoaded = (event: Event) => {
      if (event.target instanceof Element) retryCounts.delete(event.target);
    };
    window.addEventListener('error', handleMediaError, true);
    window.addEventListener('load', handleMediaLoaded, true);
    window.addEventListener('loadeddata', handleMediaLoaded, true);
    return () => {
      window.removeEventListener('error', handleMediaError, true);
      window.removeEventListener('load', handleMediaLoaded, true);
      window.removeEventListener('loadeddata', handleMediaLoaded, true);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [status?.config.mode]);

  useEffect(() => {
    if (!notice || notice.tone === 'warning' || notice.tone === 'error') return undefined;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const sessionFingerprint = useMemo(() => {
    if (!session?.user) return '';
    return [
      session.authenticatedAt,
      session.user.id,
      session.user.sync?.userKey,
      session.user.sync?.driveFolderName,
    ].join('|');
  }, [session]);

  const refreshStatus = async () => {
    const frontendState = await saveCloudFrontendState(collectArmiLocalState());
    if (!frontendState.success) {
      setNotice({
        title: 'Guardado local con observaciones',
        message: frontendState.message || 'No pude actualizar el estado local de sincronizacion.',
        tone: 'warning',
      });
    }

    const response = await getCloudSyncStatus();
    if (!response.success || !response.data) {
      setStatus(null);
      setNotice({
        title: 'Sin sincronizacion disponible',
        message: response.message || 'No pude consultar el estado de Drive en este momento.',
        tone: 'warning',
      });
      return null;
    }

    setStatus(response.data);
    return response.data;
  };

  const continueDesktopClose = async () => {
    if (window.armiApp?.continueQuit) {
      await window.armiApp.continueQuit();
      return;
    }
    window.close();
  };

  const cancelDesktopClose = async () => {
    if (window.armiApp?.cancelQuit) {
      await window.armiApp.cancelQuit();
    }
  };

  const restoreFromCloud = async (statusSnapshot?: CloudSyncStatusData, options?: { startup?: boolean; force?: boolean }) => {
    const isStartupRestore = options?.startup === true;
    if (isStartupRestore) {
      setStartupGateOpen(true);
      setStartupFlow('syncing');
      setStartupMessage('Preparando restauracion segura desde Drive...');
      setCloseError(null);
    } else {
      setCloseModalOpen(true);
      setCloseFlow('syncing');
      setCloseMessage('Preparando restauracion segura desde Drive...');
      setCloseError(null);
      setCloseContext('manual');
    }

    await saveCloudFrontendState(collectArmiLocalState());
    const response = await pullCloudSync({ force: options?.force === true });
    if (!response.success) {
      const diagnosticMessage = buildDriveDiagnosticMessage(
        statusSnapshot || status,
        response.message || 'No pude recuperar la copia del usuario desde Drive.'
      );
      if (isStartupRestore) {
        setStartupFlow('error');
      } else {
        setCloseFlow('needs-attention');
      }
      setCloseError(diagnosticMessage);
      return false;
    }

    applyArmiLocalState(response.data?.frontendState?.keys || {});
    const nextStatus = statusSnapshot || (await refreshStatus());
    emitCloudSyncUpdated();
    if (isStartupRestore) {
      setStartupFlow('syncing');
      setStartupMessage(
        nextStatus?.localManifest
          ? 'La copia de Drive se recupero correctamente. Recargaremos la aplicacion para mostrar esos datos.'
          : 'La copia de Drive se recupero correctamente. Recargaremos la aplicacion.'
      );
      setCloseError(null);
    } else {
      setCloseFlow('ready-to-close');
      setCloseError(null);
      setCloseMessage(
        nextStatus?.localManifest
          ? 'La copia de Drive se recupero correctamente. Recargaremos la aplicacion para mostrar esos datos.'
          : 'La copia de Drive se recupero correctamente. Recargaremos la aplicacion.'
      );
    }
    setNotice({
      title: 'Copia de Drive cargada',
      message: 'La informacion mas reciente del usuario ya esta lista en esta PC.',
      tone: 'success',
    });
    if (isStartupRestore) {
      window.sessionStorage.setItem(SKIP_NEXT_LOCAL_PUSH_FLAG, '1');
    }
    reloadApplicationView();
    return true;
  };

  const pushLocalSnapshotToDrive = async (options?: { force?: boolean }) => {
    setStartupGateOpen(true);
    setStartupFlow('syncing');
    setStartupMessage('Esta PC tiene datos mas recientes. Los subiremos a Drive antes de continuar.');
    setCloseError(null);

    await saveCloudFrontendState(collectArmiLocalState());
    const response = await pushCloudSync({
      force: options?.force === true,
      reason: options?.force ? 'user-confirmed-conflict-resolution' : 'automatic-or-retry',
    });
    if (!response.success) {
      const refreshed = await refreshStatus();
      const failureMessage = response.message || 'No pude actualizar Drive con la copia de esta PC.';
      setCloseError(response.message || 'No pude actualizar Drive con la copia de esta PC.');
      setNotice({
        title: (response as any).conflict === true ? 'Drive protegió la copia actual' : 'No se pudo subir esta copia',
        message: (response as any).conflict === true
          ? `${failureMessage} Tus cambios permanecen guardados localmente en esta PC.`
          : failureMessage,
        tone: 'error',
      });
      if ((response as any).conflict === true || refreshed?.comparison === 'diverged') {
        setStartupGateOpen(false);
        setStartupFlow('idle');
        setRestorePromptReason('diverged');
        setShowRestorePrompt(true);
      } else {
        setStartupFlow('error');
      }
      return false;
    }

    setStartupGateOpen(false);
    setStartupFlow('idle');
    setCloseError(null);
    markRecentManualPush();
    const protectedPreviousDriveCopy = String(response.data?.protectedMirrorBackup || '').trim();
    setNotice({
      title: protectedPreviousDriveCopy
        ? 'Conflicto resuelto con respaldo'
        : response.data?.cloudDeliveryPending
          ? 'Carpeta espejo preparada'
          : 'Espejo actualizado al abrir',
      message: protectedPreviousDriveCopy
        ? 'Esta PC quedo como copia principal. La version anterior de Drive se guardo completa en el historial protegido del espejo.'
        : response.data?.cloudDeliveryPending
        ? 'ARMI preparo la copia local; Google Drive la enviara cuando vuelva a estar activo.'
        : 'La copia mas reciente de esta PC ya quedo en la carpeta espejo antes de comenzar a trabajar.',
      tone: response.data?.cloudDeliveryPending ? 'warning' : 'success',
    });
    emitCloudSyncUpdated();
    await refreshStatus();
    return true;
  };

  const promptForLocalNewer = (statusSnapshot?: CloudSyncStatusData | null) => {
    if (statusSnapshot) {
      setStatus(statusSnapshot);
    }
    setRestorePromptReason('local-newer');
    setShowRestorePrompt(true);
    setStartupFlow('idle');
    setStartupGateOpen(false);
    setCloseError(null);
    setNotice({
      title: 'Esta PC tiene cambios mas recientes que Drive',
      message: 'Puedes subir los cambios de esta PC a Drive o cargar primero la copia actual de Drive. ARMI no reemplazara ninguna copia sin pedirte confirmacion.',
      tone: 'warning',
    });
  };

  const promptForPendingLocal = (statusSnapshot?: CloudSyncStatusData | null) => {
    if (statusSnapshot) {
      setStatus(statusSnapshot);
    }
    setRestorePromptReason('pending-local');
    setShowRestorePrompt(true);
    setStartupFlow('idle');
    setStartupGateOpen(false);
    setCloseError(null);
    setNotice({
      title: 'Hay una copia local pendiente',
      message: 'Encontramos una copia local que no se confirmo en Drive. Puedes seguir con ella, subirla ahora o descartarla para cargar la copia oficial.',
      tone: 'warning',
    });
  };

  useEffect(() => {
    const handleExternalRefresh = () => {
      void refreshStatus();
    };
    window.addEventListener(CLOUD_SYNC_EVENT, handleExternalRefresh);
    return () => window.removeEventListener(CLOUD_SYNC_EVENT, handleExternalRefresh);
  }, []);

  useEffect(() => {
    if (!sessionFingerprint || handledSessionRef.current === sessionFingerprint) return;
    handledSessionRef.current = sessionFingerprint;

    void (async () => {
      setStartupGateOpen(true);
      setStartupFlow('checking');
      setStartupMessage('Verificando la sincronizacion antes de habilitar el trabajo en esta PC...');
      setCloseError(null);
      setShowRestorePrompt(false);
      setCloseFlow('checking');
      const bootstrapStatus = await getCloudSyncStatus();
      if (bootstrapStatus.success && bootstrapStatus.data?.frontendState?.keys && shouldHydrateStoredFrontendState(bootstrapStatus.data.frontendState.keys)) {
        applyArmiLocalState(bootstrapStatus.data.frontendState.keys);
        emitCloudSyncUpdated();
        setNotice({
          title: 'Recuperamos el estado local de esta PC',
          message: 'Detectamos que el navegador tenia una copia incompleta. Restauramos la configuracion local guardada para volver a mostrar areas, calendario, sesiones y programaciones.',
          tone: 'info',
        });
      }
      let freshStatus = await refreshStatus();
      setCloseFlow('idle');
      if (!freshStatus) {
        setStartupGateOpen(false);
        setStartupFlow('idle');
        return;
      }
      if (freshStatus.config.mode === 'local'
        && freshStatus.config.legacyMode === 'apps_script_drive'
        && freshStatus.driveDesktop?.existingMirrors?.length === 1) {
        const migrated = await saveCloudSyncConfig({
          mode: 'drive_mirror',
          mirrorPath: freshStatus.driveDesktop.existingMirrors[0],
          autoSyncOnClose: freshStatus.config.autoSyncOnClose,
          syncUserKey: freshStatus.config.syncUserKey,
          syncUserLabel: freshStatus.config.syncUserLabel,
        });
        if (migrated.success) {
          freshStatus = await refreshStatus();
        }
      }

      if (!freshStatus || freshStatus.config.mode === 'local') {
        setStartupGateOpen(false);
        setStartupFlow('idle');
        return;
      }

      if (freshStatus.config.mode === 'drive_mirror' && !freshStatus.driveDesktop?.folderAccessible) {
        setStartupGateOpen(false);
        setStartupFlow('idle');
        setNotice({
          title: 'No encontramos la carpeta espejo',
          message: 'Tus datos locales siguen disponibles. Abre el panel de sincronizacion y selecciona nuevamente la carpeta de ARMI dentro de Mi unidad; no intentaremos descargar ni sobrescribir nada mientras no exista.',
          tone: 'warning',
        });
        return;
      }

      if (freshStatus.config.mode === 'drive_mirror' && freshStatus.comparison === 'mirror-missing') {
        setStartupFlow('syncing');
        setStartupMessage('La carpeta espejo esta vacia. Creando automaticamente la primera copia de esta PC...');
        await markPendingCloudSync({
          reason: 'initial-mirror-upload',
          note: 'Primera subida automatica despues de vincular la carpeta espejo.',
        });
        const initialPush = await pushCloudSync();
        if (!initialPush.success) {
          setStartupGateOpen(false);
          setStartupFlow('idle');
          setCloseError(null);
          setNotice({
            title: 'La primera copia quedo pendiente',
            message: initialPush.message || 'No se pudo preparar la primera copia en la carpeta espejo. Tus datos locales siguen intactos.',
            tone: 'warning',
          });
          return;
        }
        const deliveryPending = initialPush.data?.cloudDeliveryPending === true;
        setNotice({
          title: deliveryPending ? 'Copia preparada; Drive sigue pendiente' : 'Primera copia preparada automaticamente',
          message: deliveryPending
            ? initialPush.data?.message || 'ARMI preparo los archivos, pero Google Drive debe reanudar la sincronizacion para subirlos.'
            : 'ARMI copio automaticamente tus datos en la carpeta espejo. No fue necesario pulsar Subir.',
          tone: deliveryPending ? 'warning' : 'success',
        });
        setStartupGateOpen(false);
        setStartupFlow('idle');
        emitCloudSyncUpdated();
        await refreshStatus();
        return;
      }

      if (freshStatus.config.mode === 'apps_script_drive' && !navigator.onLine) {
        setStartupFlow('offline');
        setStartupMessage('Drive esta activado, pero esta PC esta sin internet. Puedes seguir solo con lo local o esperar para sincronizar primero.');
        return;
      }

      if (canAutoRestoreFromCloud(freshStatus)) {
        setStartupFlow('syncing');
        setStartupMessage('Encontramos una copia del usuario en Drive. La cargaremos antes de continuar.');
        setNotice({
          title: 'Recuperando copia del usuario',
          message: 'Encontramos una copia en Drive y esta PC aun no tiene trabajo local. La cargaremos automaticamente.',
          tone: 'info',
        });
        await restoreFromCloud(freshStatus, { startup: true });
        return;
      }

      if (freshStatus.comparison === 'mirror-newer') {
        setStartupFlow('syncing');
        setStartupMessage('Drive tiene una copia mas reciente. La cargaremos antes de permitir nuevos cambios.');
        await restoreFromCloud(freshStatus, { startup: true });
        return;
      }

      if (freshStatus.pendingLocal) {
        promptForPendingLocal(freshStatus);
        return;
      }

      if (freshStatus.comparison === 'local-newer') {
        if (freshStatus.config.mode === 'drive_mirror') {
          setStartupFlow('syncing');
          setStartupMessage('Esta PC tiene la copia mas completa. La guardaremos automaticamente en la carpeta espejo.');
          await pushLocalSnapshotToDrive();
          return;
        }
        if (hasOnlyFrontendStateDifference(freshStatus.localManifest, freshStatus.mirrorManifest)) {
          setStartupGateOpen(false);
          setStartupFlow('idle');
          setCloseError(null);
          setNotice({
            title: 'Solo cambiaron preferencias locales',
            message: 'La diferencia detectada pertenece al estado visual del navegador o a la sesion local. No bloquearemos el inicio por ese motivo.',
            tone: 'info',
          });
          return;
        }
        if (shouldSuppressLocalNewerPromptAfterRecentPush(freshStatus)) {
          setStartupGateOpen(false);
          setStartupFlow('idle');
          setCloseError(null);
          setNotice({
            title: 'Drive acaba de actualizarse',
            message: 'Detectamos que acabas de subir esta misma copia. Omitiremos el aviso de inicio para no interrumpirte otra vez.',
            tone: 'info',
          });
          return;
        }
        if (window.sessionStorage.getItem(SKIP_NEXT_LOCAL_PUSH_FLAG) === '1') {
          window.sessionStorage.removeItem(SKIP_NEXT_LOCAL_PUSH_FLAG);
          setStartupGateOpen(false);
          setStartupFlow('idle');
          setCloseError(null);
          setNotice({
            title: 'Copia de Drive lista',
            message: 'Acabamos de cargar Drive en esta misma apertura, asi que no volveremos a subir una copia local inmediatamente.',
            tone: 'info',
          });
          return;
        }
        promptForLocalNewer(freshStatus);
        return;
      }

      if ((freshStatus.config.remoteActivity?.conflicts?.count || 0) > 0 && freshStatus.comparison !== 'in-sync') {
        setRestorePromptReason(freshStatus.mirrorManifest ? 'conflicts' : 'conflicts-missing-current');
        setShowRestorePrompt(true);
        setStartupFlow('idle');
        setStartupGateOpen(false);
        const conflictNoticeMessage = freshStatus.mirrorManifest
          ? 'Antes de seguir, conviene decidir si trabajaras con la copia actual o si revisaras el conflicto protegido.'
          : buildDriveDiagnosticMessage(freshStatus);
        setNotice({
          title: freshStatus.mirrorManifest ? 'Hay conflictos pendientes en Drive' : 'Drive tiene historial, pero no una copia actual legible',
          message: conflictNoticeMessage,
          tone: 'warning',
        });
        return;
      }

      if (freshStatus.comparison === 'diverged') {
        setRestorePromptReason('diverged');
        setShowRestorePrompt(true);
        setStartupFlow('idle');
        setStartupGateOpen(false);
        setNotice({
          title: 'Detectamos diferencias entre esta PC y Drive',
          message: 'Tus datos locales y la nube ya no coinciden. Antes de seguir, conviene decidir con cual copia trabajaras.',
          tone: 'warning',
        });
        return;
      }

      setStartupGateOpen(false);
      setStartupFlow('idle');
    })();
  }, [sessionFingerprint]);

  useEffect(() => {
    if (!status || status.config.mode === 'local') return;
    if (status.mirrorOperation?.state === 'origin-copy-pending') {
      setNotice({
        title: 'Otra PC no termino de preparar sus archivos',
        message: `Drive recibio el catalogo de una operacion, pero no su confirmacion final. ${status.mirrorOperation.resourceFiles || 0} recurso${status.mirrorOperation.resourceFiles === 1 ? '' : 's'} puede${status.mirrorOperation.resourceFiles === 1 ? '' : 'n'} seguir pendiente${status.mirrorOperation.resourceFiles === 1 ? '' : 's'}. Puedes trabajar con los datos disponibles y reintentar cuando la otra PC vuelva a conectarse.`,
        tone: 'warning',
      });
      return;
    }
    if (status.mirrorOperation?.state === 'catalog-ahead-of-manifest') {
      setNotice({
        title: 'Google Drive todavia esta entregando cambios',
        message: 'Ya llego el catalogo de una copia mas nueva, pero aun no llegaron su manifiesto y todos sus archivos. ARMI conservara la version valida actual y volvera a comprobarla.',
        tone: 'warning',
      });
      return;
    }
    if ((status.config.remoteActivity?.conflicts?.count || 0) > 0) {
      const conflictCount = status.config.remoteActivity?.conflicts?.count || 0;
      setNotice({
        title: conflictCount === 1 ? 'Hay 1 conflicto pendiente en Drive' : `Hay ${conflictCount} conflictos pendientes en Drive`,
        message: 'La app protegio esas copias para no sobrescribir la nube. Si faltan asistencias o cambios de otra PC, revisa el panel de sincronizacion: pueden haber quedado guardados como conflicto protegido.',
        tone: 'warning',
      });
      return;
    }
    if (status.comparison === 'mirror-incomplete') {
      setNotice({
        title: 'La copia de Drive esta incompleta',
        message: 'Faltan archivos en la copia remota. Conservaremos lo local hasta que revisemos esa nube.',
        tone: 'error',
      });
    }
  }, [status]);

  useEffect(() => {
    if (!window.armiApp?.onBeforeQuitAttempt) return undefined;

    return window.armiApp.onBeforeQuitAttempt(async () => {
      if (closeInFlightRef.current) return;
      closeInFlightRef.current = true;
      setCloseModalOpen(true);
      setCloseError(null);
      setCloseFlow('syncing');
      setCloseContext('sync');
      setCloseMessage('Guardando datos locales antes de cerrar...');

      try {
        const localSave = await saveCloudFrontendState(collectArmiLocalState());
        if (!localSave.success) {
          setCloseFlow('needs-attention');
          setCloseError(localSave.message || 'No pude dejar lista la copia local antes de cerrar.');
          closeInFlightRef.current = false;
          return;
        }

        const localStatusResponse = await getLocalCloudSyncStatus();
        const localStatus = localStatusResponse.success ? localStatusResponse.data || null : null;

        if (!localStatus || localStatus.config.mode === 'local' || !localStatus.config.autoSyncOnClose) {
          setCloseFlow('ready-to-close');
          setCloseMessage('La copia local quedo guardada. Cerrando aplicativo...');
          await continueDesktopClose();
          return;
        }

        if (!localStatus.hasUnsyncedChanges && !localStatus.pendingLocal) {
          setCloseFlow('ready-to-close');
          setCloseMessage('No habia cambios nuevos por subir. Cerrando aplicativo...');
          await continueDesktopClose();
          return;
        }

        await markPendingCloudSync({
          reason: 'close-attempt',
          note: 'Se preparo una copia local de emergencia antes de intentar subir a Drive.',
        });

        if (localStatus.config.mode === 'apps_script_drive' && !navigator.onLine) {
          setCloseContext('offline');
          setCloseFlow('needs-attention');
          setCloseError('No hay internet. Tus cambios quedaron guardados localmente, pero aun no se subieron a Drive.');
          closeInFlightRef.current = false;
          return;
        }

        setCloseMessage('Subiendo la copia reciente del usuario a Drive...');
        const pushResult = await pushCloudSync();
        if (!pushResult.success) {
          if ((pushResult as any).conflict === true) {
            setCloseFlow('needs-attention');
            setCloseError(
              pushResult.message
              || (localStatus.config.mode === 'drive_mirror'
                ? 'Drive cambio desde otra PC. No se sobrescribio la copia compartida y tus cambios siguen guardados localmente.'
                : 'Drive cambio desde la ultima vez que esta PC lo conocia. Guardamos este paquete como conflicto para no sobrescribir la nube.')
            );
            setCloseMessage('Se detecto un conflicto entre esta PC y Drive. Tus cambios locales siguen intactos.');
            setNotice({
              title: 'Conflicto detectado y protegido',
              message: localStatus.config.mode === 'drive_mirror'
                ? 'La app no sobrescribio Drive. Tus cambios siguen en esta PC; primero recupera la copia compartida para poder revisar y combinar las diferencias.'
                : 'La app no sobrescribio la nube. Tu paquete se guardo como conflicto en Drive y la copia local sigue a salvo. Ese conflicto puede incluir asistencias nuevas.',
              tone: 'warning',
            });
            closeInFlightRef.current = false;
            return;
          }
          setCloseFlow('needs-attention');
          setCloseError(pushResult.message || 'No pude subir los cambios recientes a Drive.');
          closeInFlightRef.current = false;
          return;
        }

        const deliveryPending = pushResult.data?.cloudDeliveryPending === true;
        if (!deliveryPending) {
          await discardPendingCloudSync();
        }
        setCloseFlow('ready-to-close');
        setCloseMessage(deliveryPending
          ? 'La copia local y la carpeta espejo quedaron actualizadas. Google Drive continuara cuando se reanude. Cerrando aplicativo...'
          : 'La copia local y la carpeta espejo quedaron actualizadas. Cerrando aplicativo...');
        emitCloudSyncUpdated();
        await continueDesktopClose();
      } catch (error: any) {
        setCloseFlow('needs-attention');
        setCloseError(error?.message || 'La sincronizacion protegida no pudo completarse.');
        closeInFlightRef.current = false;
      }
    });
  }, []);

  const closeModalTitle = closeContext === 'offline'
    ? 'Sin internet para sincronizar'
    : closeFlow === 'syncing'
      ? 'Guardando antes de cerrar'
      : closeFlow === 'ready-to-close'
        ? 'Cierre seguro'
        : 'Sincronizacion pendiente';

  const startupTitle = startupFlow === 'checking'
    ? 'Verificando sincronizacion'
    : startupFlow === 'syncing'
      ? 'Actualizando datos antes de iniciar'
      : startupFlow === 'offline'
        ? 'Sin internet para sincronizar'
        : 'No pudimos alinear las copias';

  const currentResourceTransfer = resourceDelivery?.activeTransfers?.[0] || null;
  const currentMirrorTransfer = resourceDelivery?.mirrorTransfer || null;
  const resourceProgress = currentResourceTransfer?.totalBytes
    ? Math.min(100, Math.round((currentResourceTransfer.copiedBytes / currentResourceTransfer.totalBytes) * 100))
    : 0;
  const mirrorProgress = currentMirrorTransfer?.totalBytes
    ? Math.min(100, Math.round((currentMirrorTransfer.copiedBytes / currentMirrorTransfer.totalBytes) * 100))
    : 0;

  return (
    <>
      {currentResourceTransfer || currentMirrorTransfer ? (
        <div className="fixed bottom-5 left-1/2 z-[95] w-[min(92vw,28rem)] -translate-x-1/2 print:hidden">
          <div className={`rounded-2xl border px-4 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.22)] backdrop-blur ${
            currentResourceTransfer?.state === 'error' || currentMirrorTransfer?.state === 'error'
              ? 'border-rose-200 bg-rose-50/95 text-rose-900'
              : currentResourceTransfer?.state === 'waiting-for-drive-upload'
                ? 'border-amber-200 bg-amber-50/95 text-amber-900'
                : 'border-sky-200 bg-white/95 text-slate-800'
          }`}>
            <div className="flex items-center gap-3">
              <span className={`h-3 w-3 shrink-0 rounded-full ${
                currentResourceTransfer?.state === 'waiting-for-drive-upload'
                  ? 'bg-amber-500'
                  : currentResourceTransfer?.state === 'error' || currentMirrorTransfer?.state === 'error'
                    ? 'bg-rose-500'
                    : 'animate-pulse bg-sky-500'
              }`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black">
                  {currentResourceTransfer
                    ? currentResourceTransfer.state === 'waiting-for-drive-upload'
                      ? 'Archivo pendiente en la otra PC'
                      : currentResourceTransfer.state === 'error'
                        ? 'No se pudo descargar el archivo'
                        : currentResourceTransfer.state === 'available'
                          ? 'Archivo disponible'
                          : 'Descargando recurso desde Drive'
                    : currentMirrorTransfer?.state === 'error'
                      ? 'No se pudo preparar la copia'
                      : 'Copiando cambios a la carpeta de Drive'}
                </p>
                <p className="mt-0.5 truncate text-xs font-semibold opacity-75">
                  {currentResourceTransfer
                    ? currentResourceTransfer.message || currentResourceTransfer.fileName
                    : currentMirrorTransfer?.currentFile || 'Preparando catalogo de sincronizacion'}
                </p>
              </div>
              <span className="shrink-0 text-xs font-black">
                {currentResourceTransfer
                  ? currentResourceTransfer.state === 'downloading'
                    ? `${formatTransferBytes(currentResourceTransfer.copiedBytes)} / ${formatTransferBytes(currentResourceTransfer.totalBytes)}`
                    : ''
                  : `${mirrorProgress}%`}
              </span>
            </div>
            {(currentResourceTransfer?.state === 'downloading' || currentMirrorTransfer?.state === 'copying-to-drive-folder') ? (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200/80">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-[width] duration-300"
                  style={{ width: `${currentResourceTransfer ? resourceProgress : mirrorProgress}%` }}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {notice && !showRestorePrompt ? (
        <div className="fixed left-4 right-4 top-4 z-[90] mx-auto w-full max-w-xl print:hidden">
          <div className={`flex items-start justify-between gap-3 rounded-3xl border px-4 py-3 text-sm shadow-sm ${toneStyles[notice.tone]}`}>
            <div>
              <div className="font-black">{notice.title}</div>
              <div className="mt-1 leading-relaxed">{notice.message}</div>
            </div>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="shrink-0 rounded-full px-2 py-1 text-xs font-black opacity-70 transition hover:opacity-100"
              aria-label="Cerrar aviso"
            >
              x
            </button>
          </div>
        </div>
      ) : null}

      {showRestorePrompt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-6 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[2rem] bg-white p-7 shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-sky-500">Copia detectada</p>
            <h2 className="mt-2 text-2xl font-black text-slate-900">
              {restorePromptReason === 'local-newer'
                ? 'Esta PC tiene cambios mas recientes'
                : restorePromptReason === 'pending-local'
                ? 'Hay una copia local pendiente'
                : restorePromptReason === 'diverged'
                ? divergedRecommendation.direction === 'local'
                  ? 'Esta PC contiene más información'
                  : 'Hay dos copias distintas'
                : restorePromptReason === 'conflicts'
                  ? 'Hay conflictos pendientes en Drive'
                  : restorePromptReason === 'conflicts-missing-current'
                    ? 'Drive tiene historial, pero no una copia actual legible'
                  : 'Drive tiene datos mas recientes'}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              {restorePromptReason === 'local-newer'
                ? 'Esta PC detecto cambios mas nuevos que los de Drive. Abajo puedes revisar fecha, huella corta y archivos que no coinciden para entender por que salio este aviso. Puedes subir esta PC a Drive o cargar Drive antes de editar.'
                : restorePromptReason === 'pending-local'
                ? 'La ultima vez que esta PC intento sincronizar, quedo una copia local pendiente de confirmarse en Drive. Para simplificar: puedes seguir con esa copia local, subirla ahora o descartarla para usar la copia oficial de Drive.'
                : restorePromptReason === 'diverged'
                ? divergedRecommendation.direction === 'local'
                  ? 'No se borró nada. Esta PC conserva más registros que Drive. La opción recomendada respaldará primero la copia actual de Drive y después conservará esta PC como principal.'
                  : 'No se borró nada. Esta PC y Drive contienen cambios distintos; puedes decidir después mientras revisamos cuál debe conservarse.'
                : restorePromptReason === 'conflicts'
                  ? 'Drive tiene una copia actual utilizable, pero ademas hay conflictos protegidos de otra PC. Si esperabas ver datos faltantes, conviene cargar primero la copia actual de Drive y luego revisar esos conflictos.'
                  : restorePromptReason === 'conflicts-missing-current'
                    ? buildDriveDiagnosticMessage(status)
                  : 'Encontramos una copia del usuario mas nueva en Drive. Si la cargas ahora, esta PC trabajara con esa version. Si prefieres continuar con lo local, no borraremos nada y podras traer la copia despues.'}
            </p>

            {restorePromptReason === 'diverged' && divergedRecommendation.direction === 'local' ? (
              <div className="mt-4 rounded-2xl border-2 border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
                <p className="font-black">Recomendación: subir esta PC a Drive</p>
                <p className="mt-1 leading-relaxed">
                  Tiene {divergedRecommendation.advantages.slice(0, 3).join(', ')}. ARMI guardará la versión actual de Drive en el historial protegido antes de actualizarla.
                </p>
              </div>
            ) : null}

            {restorePromptReason === 'diverged' && divergedRecommendation.direction === 'mixed' ? (
              <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <p className="font-black">Recomendación: decidir después</p>
                <p className="mt-1 leading-relaxed">Ambas copias tienen información exclusiva. Continúa sin sincronizar mientras ARMI conserva las dos.</p>
              </div>
            ) : null}

            {status ? (
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700">Esta PC</p>
                  <p className="mt-2 font-bold">{formatSyncDate(status.localManifest?.generatedAt)}</p>
                  <p className="mt-1 text-xs font-semibold text-emerald-800">Huella: {formatSyncDigest(status.localManifest?.digest)}</p>
                  <p className="mt-2 leading-relaxed">{formatSyncEntitySummary(status.localManifest)}</p>
                </div>
                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-700">Drive</p>
                  <p className="mt-2 font-bold">{formatSyncDate(status.mirrorManifest?.generatedAt)}</p>
                  <p className="mt-1 text-xs font-semibold text-sky-800">Huella: {formatSyncDigest(status.mirrorManifest?.digest)}</p>
                  <p className="mt-2 leading-relaxed">{formatSyncEntitySummary(status.mirrorManifest)}</p>
                </div>
              </div>
            ) : null}

            {restorePromptReason === 'pending-local' && status?.pendingLocal ? (
              <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
                <p className="font-black uppercase tracking-[0.14em] text-violet-700">Copia pendiente</p>
                <p className="mt-2 leading-relaxed">
                  Se guardo una copia local de emergencia el {formatSyncDate(status.pendingLocal.createdAt)}.
                </p>
                <p className="mt-2 leading-relaxed">{formatPendingCountSummary(status.pendingLocal.counts || null)}</p>
              </div>
            ) : null}

            {restorePromptReason === 'local-newer' || restorePromptReason === 'diverged' ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-black uppercase tracking-[0.14em] text-amber-700">Diagnostico rapido</p>
                <p className="mt-2 leading-relaxed">
                  {onlyFrontendStateDiff
                    ? 'La unica diferencia detectada pertenece al estado visual guardado en este navegador. No afecta asistencias, estudiantes ni la base principal.'
                    : restorePromptDiffs.total > 0
                    ? `Se detectaron ${restorePromptDiffs.total} archivo${restorePromptDiffs.total === 1 ? '' : 's'} distinto${restorePromptDiffs.total === 1 ? '' : 's'} entre esta PC y Drive.`
                    : 'Las huellas no coinciden, pero no se pudo resumir un archivo puntual desde este manifiesto.'}
                </p>
                {restorePromptDiffs.items.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {restorePromptDiffs.items.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-800"
                        title={item}
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowRestorePrompt(false);
                  setStartupGateOpen(false);
                  setStartupFlow('idle');
                  setCloseError(null);
                }}
                title="Mantener esta copia local por ahora sin subir ni descargar nada. La sincronizacion seguira pendiente."
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-400"
              >
                <ActionIcon kind="local" />
                {restorePromptReason === 'diverged'
                  ? 'Decidir después (no sincronizar)'
                  : restorePromptReason === 'pending-local'
                    ? 'Usar copia local pendiente'
                    : 'Seguir con esta PC'}
              </button>
              {restorePromptReason === 'diverged' || restorePromptReason === 'local-newer' || restorePromptReason === 'pending-local' ? (
                <button
                  type="button"
                  onClick={async () => {
                    const requiresProtectedOverride = restorePromptReason === 'diverged' || pendingNeedsProtectedLocalRecovery;
                    if (requiresProtectedOverride) {
                      const localAdvantage = divergedRecommendation.direction === 'local'
                        ? ` Esta PC tiene ${divergedRecommendation.advantages.slice(0, 3).join(', ')}.`
                        : '';
                      const confirmed = window.confirm(
                        `Esta acción convertirá los datos de esta PC en la copia principal.${localAdvantage} Antes de reemplazar Drive, ARMI guardará una copia completa de su versión actual. ¿Deseas continuar?`
                      );
                      if (!confirmed) return;
                    }
                    setShowRestorePrompt(false);
                    await pushLocalSnapshotToDrive({ force: requiresProtectedOverride });
                  }}
                  title={restorePromptReason === 'diverged' || pendingNeedsProtectedLocalRecovery
                    ? 'Guardar primero una copia completa de Drive y despues convertir esta PC en la version principal.'
                    : 'Subir esta copia local a Drive y tomarla como la version principal antes de trabajar.'}
                  className="inline-flex items-center gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-800 transition hover:border-emerald-400"
                >
                  <ActionIcon kind="push" />
                  {restorePromptReason === 'diverged'
                    ? divergedRecommendation.direction === 'local'
                      ? 'Subir esta PC a Drive (recomendado)'
                      : 'Subir esta PC a Drive'
                    : restorePromptReason === 'pending-local'
                      ? pendingNeedsProtectedLocalRecovery
                        ? 'Subir esta PC a Drive'
                        : 'Reintentar copia pendiente'
                      : 'Subir esta PC a Drive'}
                </button>
              ) : null}
              {restorePromptReason === 'pending-local' ? (
                <button
                  type="button"
                  onClick={async () => {
                    if (pendingNeedsProtectedLocalRecovery) {
                      const confirmed = window.confirm(
                        `Drive tiene menos información y esta PC tiene ${divergedRecommendation.advantages.slice(0, 3).join(', ')}. Esta acción reemplazará la vista local con Drive. ARMI creará un punto de recuperación, pero no es la opción recomendada. ¿Deseas continuar?`
                      );
                      if (!confirmed) return;
                    }
                    await discardPendingCloudSync();
                    setShowRestorePrompt(false);
                    await restoreFromCloud(status || undefined, { startup: true, force: true });
                  }}
                  title="Descartar la copia local pendiente y cargar la copia oficial de Drive."
                  className="inline-flex items-center gap-2 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-800 transition hover:border-rose-400"
                >
                  Descartar pendiente y cargar Drive
                </button>
              ) : null}
              <button
                type="button"
                onClick={async () => {
                  if (restorePromptReason === 'diverged' || restorePromptReason === 'local-newer') {
                    const localAdvantage = divergedRecommendation.direction === 'local'
                      ? ` Esta PC tiene ${divergedRecommendation.advantages.slice(0, 3).join(', ')}.`
                      : '';
                    const confirmed = window.confirm(
                      `Cargar Drive reemplazará los datos visibles de esta PC con la copia de Drive.${localAdvantage} ARMI creará un punto de recuperación local, pero esta opción no es la recomendada en este momento. ¿Deseas continuar?`
                    );
                    if (!confirmed) return;
                  }
                  setShowRestorePrompt(false);
                  await restoreFromCloud(status || undefined, { startup: true, force: true });
                }}
                title="Descargar la copia actual de Drive y reemplazar esta copia local con esa version."
                className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold transition ${
                  restorePromptReason === 'diverged' && divergedRecommendation.direction === 'local'
                    ? 'border border-rose-300 bg-white text-rose-700 hover:bg-rose-50'
                    : 'bg-slate-900 text-white hover:bg-slate-800'
                }`}
              >
                <ActionIcon kind="pull" />
                {restorePromptReason === 'diverged' && divergedRecommendation.direction === 'local'
                  ? 'Reemplazar esta PC con Drive'
                  : 'Cargar copia de Drive'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {startupGateOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-6 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[2rem] bg-white p-7 shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-sky-500">Inicio protegido</p>
            <h2 className="mt-2 text-2xl font-black text-slate-900">{startupTitle}</h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">{startupMessage}</p>

            <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 ${(startupFlow === 'checking' || startupFlow === 'syncing') ? 'w-3/4 animate-pulse' : 'w-full'}`} />
            </div>

            {closeError ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {closeError}
              </div>
            ) : null}

            {(startupFlow === 'offline' || startupFlow === 'error') ? (
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setStartupFlow('checking');
                    setStartupMessage('Reintentando verificacion de Drive...');
                    setCloseError(null);
                    const freshStatus = await refreshStatus();
                    if (!freshStatus || freshStatus.config.mode === 'local') {
                      setStartupGateOpen(false);
                      setStartupFlow('idle');
                      return;
                    }
                    if (freshStatus.config.mode === 'apps_script_drive' && !navigator.onLine) {
                      setStartupFlow('offline');
                      setStartupMessage('Drive esta activado, pero esta PC sigue sin internet. Puedes seguir solo con lo local o esperar para sincronizar primero.');
                      return;
                    }
                    if (freshStatus.comparison === 'mirror-newer' || canAutoRestoreFromCloud(freshStatus)) {
                      setStartupFlow('syncing');
                      setStartupMessage('Drive tiene una copia mas reciente. La cargaremos antes de permitir nuevos cambios.');
                      await restoreFromCloud(freshStatus, { startup: true });
                      return;
                    }
                    if (freshStatus.comparison === 'local-newer') {
                      promptForLocalNewer(freshStatus);
                      return;
                    }
                    if (freshStatus.comparison === 'diverged' || ((freshStatus.config.remoteActivity?.conflicts?.count || 0) > 0 && freshStatus.comparison !== 'in-sync')) {
                      setStartupGateOpen(false);
                      setStartupFlow('idle');
                      setRestorePromptReason(
                        freshStatus.comparison === 'diverged'
                          ? 'diverged'
                          : freshStatus.mirrorManifest
                            ? 'conflicts'
                            : 'conflicts-missing-current'
                      );
                      setShowRestorePrompt(true);
                      return;
                    }
                    setStartupGateOpen(false);
                    setStartupFlow('idle');
                  }}
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-400"
                >
                  Reintentar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStartupGateOpen(false);
                    setStartupFlow('idle');
                    setCloseError(null);
                    setNotice({
                      title: 'Continuando solo con esta PC',
                      message: 'No se pudo validar Drive antes de iniciar. Trabajaras con la copia local hasta la siguiente sincronizacion.',
                      tone: 'warning',
                    });
                  }}
                  className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
                >
                  Seguir solo local
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {closeModalOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-6 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[2rem] bg-white p-7 shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-sky-500">Sincronizacion protegida</p>
            <h2 className="mt-2 text-2xl font-black text-slate-900">{closeModalTitle}</h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">{closeMessage}</p>

            <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 ${closeFlow === 'syncing' ? 'w-3/4 animate-pulse' : 'w-full'}`} />
            </div>

            {closeError ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {closeError}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              {closeFlow === 'needs-attention' ? (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      setCloseError(null);
                      closeInFlightRef.current = false;
                      setCloseModalOpen(false);
                      await cancelDesktopClose();
                    }}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-400"
                  >
                    Seguir trabajando
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      closeInFlightRef.current = false;
                      setCloseModalOpen(false);
                      setCloseFlow('idle');
                      setCloseError(null);
                      if (window.armiApp?.requestQuit) {
                        await window.armiApp.requestQuit();
                      }
                    }}
                    className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-800 transition hover:border-amber-400"
                  >
                    Reintentar cierre
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      setCloseMessage('Tus cambios recientes quedaron guardados solo en esta PC. Cerrando aplicativo...');
                      setCloseFlow('ready-to-close');
                      await continueDesktopClose();
                    }}
                    className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
                  >
                    Salir solo local
                  </button>
                </>
              ) : closeFlow !== 'syncing' ? (
                <button
                  type="button"
                  onClick={async () => {
                    setCloseModalOpen(false);
                    setCloseFlow('idle');
                    setCloseError(null);
                    closeInFlightRef.current = false;
                    await cancelDesktopClose();
                  }}
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-400"
                >
                  Cerrar mensaje
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

