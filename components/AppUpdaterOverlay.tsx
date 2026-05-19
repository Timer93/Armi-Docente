import React, { useEffect, useState } from 'react';

type UpdaterSnapshot = {
  available: boolean;
  configured: boolean;
  currentVersion: string;
  status: string;
  progress: null | {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
  message: string;
  releaseName: string;
  releaseNotes: string;
  error: string;
  downloadReady?: boolean;
  downloadedVersion?: string;
};

const fallbackSnapshot: UpdaterSnapshot = {
  available: false,
  configured: false,
  currentVersion: __APP_VERSION__,
  status: 'idle',
  progress: null,
  message: '',
  releaseName: '',
  releaseNotes: '',
  error: '',
  downloadReady: false,
  downloadedVersion: '',
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

export const AppUpdaterOverlay: React.FC = () => {
  const hasUpdaterBridge = typeof window !== 'undefined' && !!window.armiUpdater;
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot>(
    typeof window !== 'undefined' && window.armiUpdater?.getSnapshot
      ? window.armiUpdater.getSnapshot()
      : fallbackSnapshot
  );
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!window.armiUpdater?.onStateChange) return undefined;
    return window.armiUpdater.onStateChange((payload: UpdaterSnapshot) => {
      setSnapshot(payload);
    });
  }, []);

  useEffect(() => {
    if (['checking', 'downloading', 'installing'].includes(snapshot.status)) {
      setDismissed(false);
    }
  }, [snapshot.status]);

  const isBlocking = ['downloading', 'installing'].includes(snapshot.status);
  const isError = snapshot.status === 'error';
  const isDownloadedModal = snapshot.status === 'downloaded';
  const canDismissModal = isError || isDownloadedModal;
  const isVisible = !dismissed && (isBlocking || isError || isDownloadedModal);
  const progress = Math.max(0, Math.min(100, Number(snapshot.progress?.percent || 0)));
  const hasAttention = snapshot.available || isError || Boolean(snapshot.downloadReady);
  const panelMessage = !hasUpdaterBridge
    ? 'Sistema actualizado en esta vista web. La verificacion e instalacion de nuevas versiones se realiza desde la app de escritorio.'
    : snapshot.message || (snapshot.configured ? 'Sistema actualizado.' : 'El actualizador de escritorio aun no tiene GitHub Releases configurado.');

  const closeModal = () => {
    if (!canDismissModal) return;
    setDismissed(true);
    setExpanded(false);
  };

  return (
    <>
      <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3 print:hidden">
        {expanded ? (
          <div className="w-[19rem] rounded-[1.75rem] border border-slate-200 bg-white/95 p-4 text-xs shadow-[0_18px_50px_rgba(15,23,42,0.16)] backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black uppercase tracking-[0.18em] text-slate-400">Actualizaciones</p>
                <p className="mt-1 text-sm font-bold text-slate-800">{snapshot.currentVersion || 'web'}</p>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="h-8 w-8 rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
              >
                ×
              </button>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              {panelMessage}
            </p>

            {snapshot.releaseName ? (
              <p className="mt-2 text-xs font-semibold text-slate-500">Version detectada: {snapshot.releaseName}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => window.armiUpdater?.checkForUpdates?.()}
                disabled={!hasUpdaterBridge || !snapshot.configured || isBlocking}
                className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                title={!hasUpdaterBridge ? 'Disponible en la app de escritorio' : undefined}
              >
                Buscar actualizacion
              </button>
              {snapshot.downloadReady ? (
                <button
                  type="button"
                  onClick={() => window.armiUpdater?.installDownloadedUpdate?.()}
                  className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-500"
                >
                  Instalar ahora
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-400"
              >
                Ocultar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            title={`Actualizaciones${snapshot.currentVersion ? ` - ${snapshot.currentVersion}` : ''}`}
            className={`relative flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-slate-800 shadow-[0_16px_40px_rgba(15,23,42,0.16)] backdrop-blur transition hover:-translate-y-0.5 hover:border-slate-300 ${hasAttention ? 'border-sky-300' : 'border-slate-200'}`}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
            </span>
            {hasAttention ? (
              <span className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full border border-white bg-sky-500" />
            ) : null}
          </button>
        )}
      </div>

      {isVisible ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-6 backdrop-blur-sm">
          <div className="relative w-full max-w-xl rounded-[2rem] bg-white p-8 shadow-[0_28px_80px_rgba(15,23,42,0.28)]">
            {canDismissModal ? (
              <button
                type="button"
                onClick={closeModal}
                className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-lg font-black text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                title="Cerrar"
              >
                ×
              </button>
            ) : null}

            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-sky-500">Actualizacion del sistema</p>
            <h2 className="mt-2 text-3xl font-black text-slate-900">
              {snapshot.status === 'installing'
                ? 'Instalando nueva version'
                : snapshot.status === 'error'
                  ? 'Actualizacion detenida'
                  : snapshot.status === 'downloaded'
                    ? 'Actualizacion lista para instalar'
                    : 'Descargando nueva version'}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              {snapshot.message || 'Preparando actualizacion...'}
            </p>

            {snapshot.releaseName ? (
              <p className="mt-2 text-xs font-semibold text-slate-500">Version detectada: {snapshot.releaseName}</p>
            ) : null}

            <div className="mt-6 h-4 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 transition-all duration-500"
                style={{ width: `${snapshot.status === 'installing' ? 100 : progress}%` }}
              />
            </div>

            {snapshot.progress ? (
              <p className="mt-3 text-xs text-slate-500">
                {progress.toFixed(1)}% · {formatBytes(snapshot.progress.transferred)} / {formatBytes(snapshot.progress.total)} · {formatBytes(snapshot.progress.bytesPerSecond)}/s
              </p>
            ) : null}

            {snapshot.error ? (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {snapshot.error}
              </div>
            ) : snapshot.status === 'downloaded' ? (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                La descarga ya termino. Puedes instalar ahora o dejarlo para despues; la app recordara esta version descargada.
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700">
                Mientras se actualiza, el acceso al aplicativo queda bloqueado para evitar inconsistencias.
              </div>
            )}

            {snapshot.status === 'downloaded' ? (
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-400"
                >
                  Mas tarde
                </button>
                <button
                  type="button"
                  onClick={() => window.armiUpdater?.installDownloadedUpdate?.()}
                  className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-500"
                >
                  Abrir instalador
                </button>
              </div>
            ) : snapshot.status === 'error' ? (
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-400"
                >
                  Cerrar
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
};
