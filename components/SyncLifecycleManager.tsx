import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth/AuthContext';
import {
  CloudSyncStatusData,
  getCloudSyncStatus,
  pullCloudSync,
  pushCloudSync,
  saveCloudFrontendState,
} from '../services/apiService';
import { applyArmiLocalState, CLOUD_SYNC_EVENT, collectArmiLocalState, emitCloudSyncUpdated } from '../utils/cloudSyncState';

type CloseFlowState = 'idle' | 'checking' | 'syncing' | 'needs-attention' | 'ready-to-close';
type RestorePromptReason = 'mirror-newer' | 'diverged';

type NoticeTone = 'info' | 'success' | 'warning' | 'error';

type SyncNotice = {
  title: string;
  message: string;
  tone: NoticeTone;
};

const toneStyles: Record<NoticeTone, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-rose-200 bg-rose-50 text-rose-800',
};

const canAutoRestoreFromCloud = (status: CloudSyncStatusData) => {
  if (status.config.mode !== 'apps_script_drive') return false;
  if (status.comparison !== 'mirror-newer') return false;
  return !status.localManifest;
};

const reloadApplicationView = () => {
  window.setTimeout(() => {
    window.location.reload();
  }, 1200);
};

export const SyncLifecycleManager: React.FC = () => {
  const { session } = useAuth();
  const [status, setStatus] = useState<CloudSyncStatusData | null>(null);
  const [notice, setNotice] = useState<SyncNotice | null>(null);
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);
  const [restorePromptReason, setRestorePromptReason] = useState<RestorePromptReason>('mirror-newer');
  const [closeFlow, setCloseFlow] = useState<CloseFlowState>('idle');
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closeMessage, setCloseMessage] = useState('Guardando datos locales...');
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeContext, setCloseContext] = useState<'sync' | 'offline' | 'manual'>('manual');
  const handledSessionRef = useRef('');
  const closeInFlightRef = useRef(false);

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

  const restoreFromCloud = async (statusSnapshot?: CloudSyncStatusData) => {
    setCloseModalOpen(true);
    setCloseFlow('syncing');
    setCloseMessage('Preparando restauracion segura desde Drive...');
    setCloseError(null);
    setCloseContext('manual');

    await saveCloudFrontendState(collectArmiLocalState());
    const response = await pullCloudSync();
    if (!response.success) {
      setCloseFlow('needs-attention');
      setCloseError(response.message || 'No pude recuperar la copia del usuario desde Drive.');
      return false;
    }

    applyArmiLocalState(response.data?.frontendState?.keys || {});
    const nextStatus = statusSnapshot || (await refreshStatus());
    emitCloudSyncUpdated();
    setCloseFlow('ready-to-close');
    setCloseError(null);
    setCloseMessage(
      nextStatus?.localManifest
        ? 'La copia de Drive se recupero correctamente. Recargaremos la aplicacion para mostrar esos datos.'
        : 'La copia de Drive se recupero correctamente. Recargaremos la aplicacion.'
    );
    setNotice({
      title: 'Copia de Drive cargada',
      message: 'La informacion mas reciente del usuario ya esta lista en esta PC.',
      tone: 'success',
    });
    reloadApplicationView();
    return true;
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
      setCloseFlow('checking');
      const freshStatus = await refreshStatus();
      setCloseFlow('idle');
      if (!freshStatus || freshStatus.config.mode !== 'apps_script_drive') return;

      if (canAutoRestoreFromCloud(freshStatus)) {
        setNotice({
          title: 'Recuperando copia del usuario',
          message: 'Encontramos una copia en Drive y esta PC aun no tiene trabajo local. La cargaremos automaticamente.',
          tone: 'info',
        });
        await restoreFromCloud(freshStatus);
        return;
      }

      if (freshStatus.comparison === 'mirror-newer') {
        setRestorePromptReason('mirror-newer');
        setShowRestorePrompt(true);
        setNotice({
          title: 'Drive tiene una copia mas reciente',
          message: 'Puedes traerla ahora o seguir con la copia local de esta PC.',
          tone: 'warning',
        });
        return;
      }

      if (freshStatus.comparison === 'diverged') {
        setRestorePromptReason('diverged');
        setShowRestorePrompt(true);
        setNotice({
          title: 'Detectamos diferencias entre esta PC y Drive',
          message: 'Tus datos locales y la nube ya no coinciden. Antes de seguir, conviene decidir con cual copia trabajaras.',
          tone: 'warning',
        });
      }
    })();
  }, [sessionFingerprint]);

  useEffect(() => {
    if (!status || status.config.mode !== 'apps_script_drive') return;
    if ((status.config.remoteActivity?.conflicts?.count || 0) > 0) {
      const conflictCount = status.config.remoteActivity?.conflicts?.count || 0;
      setNotice({
        title: conflictCount === 1 ? 'Hay 1 conflicto pendiente en Drive' : `Hay ${conflictCount} conflictos pendientes en Drive`,
        message: 'La app protegió esas copias para no sobrescribir la nube. Puedes revisar el detalle desde el panel de sincronización.',
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

        const freshStatus = await getCloudSyncStatus();
        const effectiveStatus = freshStatus.success ? freshStatus.data || null : null;
        setStatus(effectiveStatus);

        if (!effectiveStatus || effectiveStatus.config.mode !== 'apps_script_drive' || !effectiveStatus.config.autoSyncOnClose) {
          setCloseFlow('ready-to-close');
          setCloseMessage('La copia local quedo guardada. Cerrando aplicativo...');
          await continueDesktopClose();
          return;
        }

        if (!navigator.onLine) {
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
              || 'Drive cambio desde la ultima vez que esta PC lo conocia. Guardamos este paquete como conflicto para no sobrescribir la nube.'
            );
            setCloseMessage('Se detecto un conflicto entre esta PC y Drive. Tus cambios locales siguen intactos.');
            setNotice({
              title: 'Conflicto detectado y protegido',
              message: 'La app no sobrescribio la nube. Tu paquete se guardo como conflicto en Drive y la copia local sigue a salvo.',
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

        setCloseFlow('ready-to-close');
        setCloseMessage('La copia local y la de Drive quedaron actualizadas. Cerrando aplicativo...');
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

  return (
    <>
      {notice ? (
        <div className="mb-4 print:hidden">
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
              {restorePromptReason === 'diverged' ? 'Hay dos copias distintas' : 'Drive tiene datos mas recientes'}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              {restorePromptReason === 'diverged'
                ? 'Esta PC y Drive tienen cambios distintos. Si cargas Drive ahora, trabajaras con la copia remota. Si prefieres seguir con lo local, no borraremos nada y podras sincronizar despues con mas cuidado.'
                : 'Encontramos una copia del usuario mas nueva en Drive. Si la cargas ahora, esta PC trabajara con esa version. Si prefieres continuar con lo local, no borraremos nada y podras traer la copia despues.'}
            </p>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRestorePrompt(false)}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-400"
              >
                Seguir con esta PC
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowRestorePrompt(false);
                  await restoreFromCloud(status || undefined);
                }}
                  className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
              >
                Cargar copia de Drive
              </button>
            </div>
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
