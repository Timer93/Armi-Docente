import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CloudSyncStatusData,
  getCloudSyncStatus,
  pullCloudSync,
  pushCloudSync,
  saveCloudFrontendState,
  saveCloudSyncConfig,
} from '../services/apiService';
import { useAuth } from './auth/AuthContext';
import { applyArmiLocalState, CLOUD_SYNC_EVENT, collectArmiLocalState, emitCloudSyncUpdated } from '../utils/cloudSyncState';

type SyncAction = 'push' | 'pull' | null;
type ToastState = { type: 'success' | 'error'; text: string } | null;

const reloadApplicationView = () => {
  window.setTimeout(() => {
    window.location.reload();
  }, 1200);
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

export const CloudSyncPanel: React.FC = () => {
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
  const [configMode, setConfigMode] = useState<'local' | 'drive_mirror' | 'apps_script_drive'>('local');
  const [autoSyncOnClose, setAutoSyncOnClose] = useState(true);
  const [syncUserKey, setSyncUserKey] = useState('default-user');
  const [syncUserLabel, setSyncUserLabel] = useState('Usuario local');
  const autoBoundIdentityRef = useRef('');
  const rootRef = useRef<HTMLDivElement | null>(null);

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
      setConfigMode(response.data.config.mode);
      setAutoSyncOnClose(response.data.config.autoSyncOnClose);
      setSyncUserKey(response.data.config.syncUserKey || 'default-user');
      setSyncUserLabel(response.data.config.syncUserLabel || 'Usuario local');
    } else {
      setErrorMessage(response.message || 'No pude consultar el estado de sincronizacion.');
    }
    setLoadingStatus(false);
  };

  useEffect(() => {
    void refreshStatus();
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
        mirrorPath: '',
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
    nextMode: 'local' | 'apps_script_drive',
    nextAutoSyncOnClose = autoSyncOnClose,
    options?: { successMessage?: string; silent?: boolean }
  ) => {
    setSavingConfig(true);
    setErrorMessage(null);
    const response = await saveCloudSyncConfig({
      mode: nextMode,
      mirrorPath: '',
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

  const executeSyncAction = async (action: SyncAction) => {
    if (!action) return;
    setActiveAction(action);
    setModalOpen(true);
    setErrorMessage(null);
    setModalMessage(
      action === 'push'
        ? 'Creando una copia segura local y actualizando Drive...'
        : 'Creando un punto de restauracion local y cargando la ultima copia desde Drive...'
    );

    await saveCloudFrontendState(collectArmiLocalState());
    const response = action === 'push' ? await pushCloudSync() : await pullCloudSync();

    if (!response.success) {
      setErrorMessage(response.message || 'La sincronizacion no termino correctamente.');
      setToast({ type: 'error', text: response.message || 'La sincronizacion no termino correctamente.' });
      setModalMessage('La operacion no pudo completarse.');
      setActiveAction(null);
      await refreshStatus();
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
      setToast({ type: 'success', text: response.data?.message || 'No hubo cambios nuevos para subir a Drive.' });
      setModalMessage(response.data?.message || 'No hubo cambios nuevos para subir a Drive.');
      setActiveAction(null);
      await refreshStatus();
      emitCloudSyncUpdated();
      return;
    }

    setToast({ type: 'success', text: 'Copia subida correctamente a Drive.' });
    setModalMessage('La copia de Drive quedo actualizada correctamente.');
    setActiveAction(null);
    await refreshStatus();
    emitCloudSyncUpdated();
  };

  const badge = comparisonMeta[status?.comparison || 'local-mode'];
  const isDriveMode = configMode === 'apps_script_drive';
  const remoteFolderName = status?.config.remoteUser?.folderName || sessionSyncProfile.driveFolderName;
  const remoteFolderUrl = status?.config.remoteUser?.folderUrl || sessionSyncProfile.driveFolderUrl;
  const conflictsSummary = status?.config.remoteActivity?.conflicts;
  const versionsSummary = status?.config.remoteActivity?.versions;
  const localDate = status?.localManifest?.generatedAt
    ? new Date(status.localManifest.generatedAt).toLocaleString()
    : 'Sin datos locales';
  const mirrorDate = status?.mirrorManifest?.generatedAt
    ? new Date(status.mirrorManifest.generatedAt).toLocaleString()
    : 'Sin copia en Drive';

  return (
    <>
      <div ref={rootRef} className="relative flex items-center gap-2 print:hidden">
        <button
          type="button"
          aria-label={isDriveMode ? 'Cambiar a modo local' : 'Cambiar a modo Drive'}
          onClick={async () => {
            const previousMode = configMode;
            const nextMode = isDriveMode ? 'local' : 'apps_script_drive';
            setConfigMode(nextMode);
            const success = await saveConfig(
              nextMode,
              autoSyncOnClose,
              {
                successMessage: nextMode === 'apps_script_drive'
                  ? 'Sincronizacion en Drive activada.'
                  : 'Modo local activado.',
              }
            );
            if (!success) {
              setConfigMode(previousMode);
            }
          }}
          disabled={savingConfig || loadingStatus || activeAction !== null}
          className={`
            group relative flex h-[4.4rem] w-[18.5rem] items-center overflow-hidden rounded-full border
            bg-white/25 px-2 backdrop-blur-xl transition-all duration-500
            shadow-[inset_0_1px_1px_rgba(255,255,255,0.95),inset_0_-8px_18px_rgba(15,23,42,0.10),0_14px_28px_rgba(15,23,42,0.18)]
            disabled:opacity-60
            ${isDriveMode ? 'border-sky-200/80' : 'border-amber-200/80'}
          `}
        >
          <div className="pointer-events-none absolute inset-0 rounded-full bg-[linear-gradient(135deg,rgba(255,255,255,0.75),rgba(255,255,255,0.18)_48%,rgba(255,255,255,0.42))]" />

          <div
            className={`
              pointer-events-none absolute top-[0.45rem] h-[3.5rem] w-[3.5rem] rounded-full transition-all duration-500
              ${isDriveMode
                ? 'left-[14.45rem] bg-sky-400/80 shadow-[0_0_18px_rgba(56,189,248,0.95),0_0_38px_rgba(37,99,235,0.55)]'
                : 'left-[0.45rem] bg-amber-300/90 shadow-[0_0_18px_rgba(251,191,36,0.95),0_0_38px_rgba(245,158,11,0.55)]'}
            `}
          />

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
              <span className="block text-[1.05rem] font-black leading-none">Local</span>
            </div>

            <div
              className={`
                pr-12 text-right transition-all duration-500
                ${isDriveMode ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.30)]' : 'text-slate-400/70'}
              `}
            >
              <span className="block text-[1.05rem] font-black leading-none">Drive</span>
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
        </button>

        <button
          type="button"
          onClick={() => setDetailsOpen((current) => !current)}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-black text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          title="Informacion de sincronizacion"
        >
          i
        </button>

        {toast ? (
          <div className="absolute right-0 top-[4.65rem] z-50 w-[20rem]">
            <div
              className={`rounded-2xl border px-4 py-3 text-sm font-semibold shadow-[0_18px_34px_rgba(15,23,42,0.16)] backdrop-blur ${
                toast.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50/95 text-emerald-800'
                  : 'border-rose-200 bg-rose-50/95 text-rose-800'
              }`}
            >
              {toast.text}
            </div>
          </div>
        ) : null}

        {detailsOpen ? (
          <div className="absolute right-0 top-[4.1rem] z-40 w-[21rem] rounded-[1.75rem] border border-slate-200 bg-white/98 p-4 shadow-[0_24px_50px_rgba(15,23,42,0.18)] backdrop-blur">
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

            <div className="mt-3 space-y-2">
              <div className="rounded-2xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
                <p className="font-black uppercase tracking-[0.14em] text-slate-400">Usuario</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{syncUserLabel}</p>
                <p className="truncate">{syncUserKey}</p>
              </div>

              {isDriveMode ? (
                <div className="rounded-2xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
                  <p className="font-black uppercase tracking-[0.14em] text-slate-400">Carpeta</p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-800">{remoteFolderName || 'Preparando carpeta...'}</p>
                  <div className="mt-1 flex flex-wrap gap-3">
                    {remoteFolderUrl ? (
                      <a
                        href={remoteFolderUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block font-semibold text-sky-700 hover:text-sky-800"
                      >
                        Carpeta principal
                      </a>
                    ) : null}
                    {status?.config.remoteUser?.conflictsFolderUrl ? (
                      <a
                        href={status.config.remoteUser.conflictsFolderUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block font-semibold text-rose-700 hover:text-rose-800"
                      >
                        Conflictos
                      </a>
                    ) : null}
                    {status?.config.remoteUser?.versionsFolderUrl ? (
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
                </div>
                <div className="rounded-2xl bg-slate-50 px-3 py-3 text-slate-500">
                  <p className="font-black uppercase tracking-[0.14em] text-slate-400">Drive</p>
                  <p className="mt-1 leading-relaxed">{mirrorDate}</p>
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
                      {versionsSummary?.latestAt ? new Date(versionsSummary.latestAt).toLocaleString() : 'Aun no hay versiones subidas'}
                    </p>
                    {versionsSummary?.latestUrl ? (
                      <a
                        href={versionsSummary.latestUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block font-semibold text-emerald-700 hover:text-emerald-800"
                      >
                        Ver ultima
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <label className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={autoSyncOnClose}
                  onChange={async (event) => {
                    setAutoSyncOnClose(event.target.checked);
                    const success = await saveConfig(
                      isDriveMode ? 'apps_script_drive' : 'local',
                      event.target.checked,
                      {
                        successMessage: event.target.checked
                          ? 'Sincronizacion automatica al cerrar activada.'
                          : 'Sincronizacion automatica al cerrar desactivada.',
                      }
                    );
                    if (!success) {
                      setAutoSyncOnClose(!event.target.checked);
                    }
                  }}
                />
                Sincronizar al cerrar
              </label>

              {errorMessage ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {errorMessage}
                </div>
              ) : null}

              {isDriveMode ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => executeSyncAction('push')}
                    disabled={loadingStatus || activeAction !== null}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
                  >
                    Subir
                  </button>
                  <button
                    type="button"
                    onClick={() => executeSyncAction('pull')}
                    disabled={loadingStatus || activeAction !== null}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
                  >
                    Traer
                  </button>
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
              {activeAction === 'push' ? 'Actualizando Drive' : activeAction === 'pull' ? 'Cargando desde Drive' : 'Sincronizacion protegida'}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">{modalMessage}</p>

            <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 ${activeAction ? 'w-3/4 animate-pulse' : 'w-full'}`} />
            </div>

            {errorMessage ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {errorMessage}
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-2">
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
