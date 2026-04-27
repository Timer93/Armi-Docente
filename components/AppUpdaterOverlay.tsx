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
  currentVersion: '',
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
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot>(
    typeof window !== 'undefined' && window.armiUpdater?.getSnapshot
      ? window.armiUpdater.getSnapshot()
      : fallbackSnapshot
  );
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!window.armiUpdater?.onStateChange) return undefined;
    return window.armiUpdater.onStateChange((payload: UpdaterSnapshot) => {
      setSnapshot(payload);
    });
  }, []);

  useEffect(() => {
    if (snapshot.status === 'error' || snapshot.available || ['downloading', 'installing', 'downloaded'].includes(snapshot.status)) {
      setExpanded(true);
    }
  }, [snapshot.available, snapshot.status]);

  const isBlocking = ['downloading', 'installing'].includes(snapshot.status);
  const isVisible = isBlocking || snapshot.status === 'error' || snapshot.status === 'downloaded';
  const progress = Math.max(0, Math.min(100, Number(snapshot.progress?.percent || 0)));

  return (
    <>
      <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
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
              {snapshot.message || (snapshot.configured ? 'Revisa si hay una nueva version disponible.' : 'Configura GitHub Releases para activar las actualizaciones automaticas.')}
            </p>

            {snapshot.releaseName ? (
              <p className="mt-2 text-xs font-semibold text-slate-500">Version detectada: {snapshot.releaseName}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => window.armiUpdater?.checkForUpdates?.()}
                disabled={!snapshot.configured || isBlocking}
                className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Buscar actualizacion
              </button>
              {snapshot.status === 'downloaded' && snapshot.downloadReady ? (
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
            className="flex items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-4 py-3 text-sm font-bold text-slate-800 shadow-[0_16px_40px_rgba(15,23,42,0.16)] backdrop-blur transition hover:-translate-y-0.5"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white">UP</span>
            <span className="text-left leading-tight">
              <span className="block text-[11px] uppercase tracking-[0.18em] text-slate-400">Version</span>
              <span>{snapshot.currentVersion || 'web'}</span>
            </span>
          </button>
        )}
      </div>

      {isVisible ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-6 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[2rem] bg-white p-8 shadow-[0_28px_80px_rgba(15,23,42,0.28)]">
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
                  onClick={() => setExpanded(false)}
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
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
};
