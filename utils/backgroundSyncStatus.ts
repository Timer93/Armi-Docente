import type { LocalCloudSyncStatusData } from '../services/apiService';

export const mergeRecoveredLocalState = (before: Record<string, string>, current: Record<string, string>, recovered: Record<string, string>) => {
  const keys = { ...recovered };
  const changedKeys = [...new Set([...Object.keys(before), ...Object.keys(current)])].filter(key => before[key] !== current[key]);
  for (const key of changedKeys) {
    if (current[key] === undefined) delete keys[key];
    else keys[key] = current[key];
  }
  return { keys, changedKeys };
};

// Advance only recovered values, so a later Drive response still preserves real edits.
export const mergeRecoveryProgress = (before: Record<string, string>, current: Record<string, string>, recovered: Record<string, string>) => {
  const merged = mergeRecoveredLocalState(before, current, recovered);
  const baseline = { ...merged.keys };
  for (const key of merged.changedKeys) {
    if (before[key] === undefined) delete baseline[key];
    else baseline[key] = before[key];
  }
  return { ...merged, baseline };
};

const percentage = (done: number, total: number) => total > 0 ? Math.min(99, Math.max(0, Math.floor(done / total * 100))) : null;
type SyncIndicatorStatus = {
  config: { mode: string };
  incrementalSync?: { state: string; pendingOperations?: number };
  continuousSync?: { state: string };
  hasUnsyncedChanges?: boolean;
  driveDesktop?: { state?: string; processRunning?: boolean | null; folderAccessible?: boolean; paused?: boolean | null; internetOnline?: boolean | null };
  internetConnectivity?: { online: boolean | null };
  downloadProgress?: { state: string };
  activeTransfers?: Array<{ state: string }>;
  mirrorTransfer?: { state: string } | null;
};
export const getSyncIndicatorTone = (status: SyncIndicatorStatus | null, online = true) => {
  if (!status) return 'syncing';
  if (status.config.mode === 'local') return 'local';
  const states = [status.incrementalSync?.state, status.continuousSync?.state, status.downloadProgress?.state, status.mirrorTransfer?.state];
  const network = status.internetConnectivity?.online ?? status.driveDesktop?.internetOnline ?? null;
  if (network === false
    || states.some(state => state === 'error' || state === 'protected-conflict')
    || status.activeTransfers?.some(file => file.state === 'error')) return 'error';
  // navigator.onLine describes an adapter, not verified Internet access.
  // A fresh probe takes precedence over both that hint and a cached Drive state.
  if (!online && network !== true) return 'waiting';
  const driveAvailable = status.driveDesktop?.state === 'ready' || (network === true
    && ['unknown', 'offline'].includes(status.driveDesktop?.state || '')
    && status.driveDesktop?.processRunning === true && status.driveDesktop?.folderAccessible === true
    && status.driveDesktop?.paused !== true);
  if ((status.driveDesktop && !driveAvailable)
    || states.some(state => ['unavailable', 'pending', 'waiting', 'waiting-for-drive', 'waiting-for-folder'].includes(state || ''))
    || status.activeTransfers?.some(file => file.state === 'waiting-for-drive-upload')
    || status.incrementalSync?.pendingOperations) return 'waiting';
  if (status.hasUnsyncedChanges || states.some(state =>
    state && !['in-sync', 'synchronized', 'needs-review', 'complete', 'idle', 'prepared-in-local-drive-folder'].includes(state))) return 'syncing';
  if (status.activeTransfers?.some(file => file.state === 'downloading')) return 'syncing';
  // Conflict counts are an audit history of automatically resolved changes.
  // They do not represent unsent changes or an unfinished transfer.
  return states.some(Boolean) ? 'ready' : 'syncing';
};
export const describeBackgroundSync = (status: LocalCloudSyncStatusData | null, ready: boolean, error: string) => {
  if (error) return { label: 'Sincronización pendiente', detail: error, percent: null, tone: 'error' };
  if (!status) return { label: 'Comprobando sincronización', detail: 'Puedes continuar trabajando con los datos locales.', percent: null, tone: 'busy' };
  if (status.config.mode === 'local') return { label: 'Guardado local', detail: 'La sincronización está desactivada.', percent: null, tone: 'local' };
  const task = status.incrementalSync?.pendingTask;
  if (task) return {label: task.label, detail: task.detail, percent: null, tone: task.requiresAction ? 'error' : 'warning'};
  if (status.internetConnectivity?.online === false) return { label: 'Sin conexión a Internet',
    detail: 'Los cambios se conservan en esta PC. Comprobando la conexión para reanudar el envío.', percent: null, tone: 'error' };
  if (status.downloadProgress?.state === 'error') return { label: 'Descarga pendiente de reintento',
    detail: status.downloadProgress.message || 'Un archivo no pudo recibirse o verificarse.', percent: null, tone: 'error' };
  if (status.downloadProgress?.state === 'waiting') return { label: 'Esperando archivos de Drive',
    detail: status.downloadProgress.message || `${status.downloadProgress.totalFiles - status.downloadProgress.completedFiles} archivo(s) pendiente(s) de recibir.`, percent: null, tone: 'warning' };
  const incoming = status.activeTransfers?.filter(transfer => transfer.state === 'downloading') || [];
  const outgoing = status.mirrorTransfer;
  const files = status.continuousSync?.progress;
  if (incoming.length) return { label: 'Descargando archivos', detail: `${incoming.length} archivo(s) en proceso.`,
    percent: percentage(incoming.reduce((sum, transfer) => sum + transfer.copiedBytes, 0), incoming.reduce((sum, transfer) => sum + transfer.totalBytes, 0)), tone: 'busy' };
  if (outgoing?.state === 'copying-to-drive-folder') return { label: 'Enviando archivos', detail: 'Copiando a la carpeta espejo.',
    percent: percentage(outgoing.copiedBytes, outgoing.totalBytes), tone: 'busy' };
  if (status.continuousSync?.state === 'syncing' && files) return { label: 'Procesando archivos',
    detail: `${files.completedFiles} de ${files.totalFiles} archivos revisados o copiados.`,
    percent: percentage(files.completedBytes, files.totalBytes) ?? percentage(files.completedFiles, files.totalFiles), tone: 'busy' };
  if (status.activeTransfers?.some(transfer => transfer.state === 'error' || transfer.state === 'waiting-for-drive-upload')) {
    return { label: 'Archivos pendientes de Drive', detail: 'Tus datos locales se conservan; la transferencia continúa en segundo plano.', percent: null, tone: 'warning' };
  }
  if (status.continuousSync?.state === 'waiting-for-drive' || status.continuousSync?.state === 'waiting-for-folder' || status.incrementalSync?.state === 'unavailable') {
    return { label: 'Esperando a Drive', detail: status.continuousSync?.message || status.incrementalSync?.message || '', percent: null, tone: 'warning' };
  }
  const health = getSyncIndicatorTone(status);
  if (health === 'error') return { label: 'Sincronización pendiente', detail: status.incrementalSync?.state === 'error'
    ? status.incrementalSync.message : status.continuousSync?.message || '', percent: null, tone: 'error' };
  if (health === 'waiting') return { label: 'Esperando cambios de Drive', detail: status.incrementalSync?.state === 'pending'
    ? `${status.incrementalSync.pendingOperations || 0} cambio(s) pendiente(s). ${status.incrementalSync.message}`
    : status.continuousSync?.message || '', percent: null, tone: 'warning' };
  if (ready && !status.hasUnsyncedChanges && !status.incrementalSync?.pendingOperations
    && status.continuousSync?.state === 'in-sync' && health === 'ready') {
    return { label: 'Al día en esta PC', detail: 'Cambios visibles incorporados. Google Drive puede continuar transfiriendo a otras PCs.', percent: 100, tone: 'success' };
  }
  return { label: 'Sincronizando datos', detail: 'Puedes seguir trabajando. El avance de archivos aparecerá cuando esté disponible.', percent: null, tone: 'busy' };
};

export const formatSyncBytes = (value: number) => value >= 1024 * 1024 * 1024 ? `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
  : value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MB`
    : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${Math.max(0, value)} B`;
const transferDetail = (completedFiles: number, totalFiles: number, completedBytes: number, totalBytes: number) => {
  return `${completedFiles} de ${totalFiles} archivos · ${formatSyncBytes(completedBytes)} de ${formatSyncBytes(totalBytes)}`;
};

export type SyncDeliveryStatus = {
  config: { mode: string }; hasUnsyncedChanges?: boolean; comparison?: string;
  incrementalSync?: LocalCloudSyncStatusData['incrementalSync'];
};
export const describeSyncDelivery = (status: SyncDeliveryStatus) => {
  const delivery = status.incrementalSync?.delivery;
  const unpublished = Boolean(status.hasUnsyncedChanges || (status.comparison && status.comparison !== 'in-sync'));
  const peers = delivery?.peers || [];
  const confirmed = unpublished ? [] : peers.filter(peer => peer.confirmed);
  const known = peers.length;
  return [
    { label: 'Esta PC', value: 'Datos guardados localmente', confirmed: true, detail: '' },
    { label: 'Carpeta de Drive', value: unpublished ? 'Sincronización de datos pendiente'
      : delivery?.lastPublication ? 'Último envío preparado en la carpeta de Drive' : 'Sin comprobante de un envío reciente',
      confirmed: !unpublished && Boolean(delivery?.lastPublication), detail: '' },
    { label: 'Servidores de Google Drive', value: 'Sin comprobación directa desde ARMI', confirmed: false,
      detail: 'Drive abierto o una copia local terminada no confirman la subida a los servidores.' },
    { label: 'Recepción en otras PC', value: confirmed.length
      ? `${confirmed.length} de ${known} equipo(s) con comprobante recibieron el último envío de datos`
      : known ? 'Esperando confirmación del último envío de datos' : 'Todavía no hay comprobantes de otra PC',
      confirmed: known > 0 && confirmed.length === known,
      detail: (peers.map(peer => `${peer.label || peer.deviceId}: última recepción confirmada ${new Date(peer.confirmedAt).toLocaleString('es-CO')}`).join(' · ')
        || 'Una PC desconectada no impide guardar ni preparar cambios.') + ' Los archivos adjuntos se comprueban por separado.' },
  ];
};

export interface DirectionalSyncView {
  label: string;
  percent: number | null;
  tone: string;
  detail: string;
  completed: number | null;
  total: number | null;
  unit: 'archivos' | 'revisados' | 'cambios' | 'pendientes';
  completedBytes: number | null;
  totalBytes: number | null;
  phase: string;
  files: Array<{ name: string; state: string; percent: number | null }>;
  unchangedFiles: number;
  internalTask?: boolean;
  requiresAction?: boolean;
}
const directionView = (label: string, detail: string): DirectionalSyncView => ({
  label, detail, percent: null, tone: 'idle', completed: null, total: null, unit: 'archivos',
  completedBytes: null, totalBytes: null, phase: '', files: [], unchangedFiles: 0,
});
const shortFileName = (value: string) => value.split(/[\\/]/).pop() || value;
const fileCounts = (view: DirectionalSyncView, completed: number, total: number, doneBytes: number, totalBytes: number) => {
  view.total = Math.max(0, total);
  view.completed = Math.min(view.total, Math.max(0, completed));
  view.completedBytes = Math.max(0, doneBytes);
  view.totalBytes = Math.max(0, totalBytes);
};
export const syncCountLabel = (view: DirectionalSyncView) => view.total === null ? null
  : view.unit === 'pendientes' ? `${view.total} pendientes`
    : view.unit === 'cambios' ? `${view.completed} cambio${view.completed === 1 ? '' : 's'}`
      : `${view.completed}/${view.total} ${view.unit === 'revisados' ? 'revisados' : 'arch.'}`;

export const compactSyncState = (view: DirectionalSyncView, direction: 'upload' | 'download') => {
  const remaining = view.total === null ? null : Math.max(0, view.total - (view.completed || 0));
  const count = view.total !== null && view.total > 0 ? syncCountLabel(view) : null;
  if (view.internalTask) return { icon: view.requiresAction ? 'alert' : 'sync', text: view.requiresAction ? 'Revisar datos' : 'Comprobando', count: null };
  if (view.tone === 'error') return { icon: 'alert', text: 'Reintento pendiente', count };
  if (view.tone === 'warning') return { icon: 'wait', text: view.phase === 'Sin Internet' ? 'Sin conexión'
    : view.unit === 'pendientes' ? 'Cambios pendientes' : remaining ? 'Archivos pendientes' : 'Esperando a Drive', count };
  if (view.tone === 'success') return { icon: 'check', text: direction === 'upload' ? 'Todo copiado a carpeta espejo'
    : view.unit === 'cambios' ? 'Cambios incorporados' : 'Todo recibido en esta PC', count };
  if (view.tone === 'idle') return { icon: 'check', text: 'Sin archivos pendientes', count: null };
  return { icon: 'sync', text: view.unit === 'revisados' ? 'Revisando archivos'
    : view.phase === 'Publicando catálogo' ? 'Terminando'
    : count ? view.unit === 'cambios' ? 'Incorporando cambios' : direction === 'upload' ? 'Copiando archivos' : 'Recibiendo archivos'
    : 'Comprobando', count };
};

export const describeDirectionalSync = (status: LocalCloudSyncStatusData | null, ready: boolean, error: string) => {
  const upload = directionView('Subida a la carpeta de Drive', 'Sin subidas en curso.');
  const download = directionView('Bajada a esta PC', 'Sin descargas solicitadas.');
  if (!status || error) {
    const pending = { percent: null, tone: error ? 'error' : 'busy', detail: error || 'Comprobando transferencias.' };
    return { upload: { ...upload, ...pending }, download: { ...download, ...pending } };
  }
  if (status.config.mode === 'local') return { upload, download };
  const task = status.incrementalSync?.pendingTask;
  if (task) {
    Object.assign(download,{label:task.label,phase:task.requiresAction ? 'Necesita revisión' : 'Reintento automático',
      detail:task.detail,tone:task.requiresAction ? 'error' : 'warning',internalTask:true,requiresAction:task.requiresAction});
    return {upload,download};
  }
  const manual = status.mirrorTransfer;
  const files = status.continuousSync?.progress;
  if (manual?.state === 'copying-to-drive-folder') Object.assign(upload, {
    tone: 'busy', percent: percentage(manual.copiedBytes, manual.totalBytes) ?? percentage(manual.copiedFiles, manual.totalFiles),
    detail: transferDetail(manual.copiedFiles, manual.totalFiles, manual.copiedBytes, manual.totalBytes),
  });
  else if (manual?.state === 'error') Object.assign(upload, { tone: 'error', detail: manual.message || 'La subida requiere un reintento.' });
  else if (status.continuousSync?.state === 'syncing' && files) Object.assign(upload, {
    tone: 'busy', percent: percentage(files.completedBytes, files.totalBytes) ?? percentage(files.completedFiles, files.totalFiles),
    detail: `${transferDetail(files.completedFiles, files.totalFiles, files.completedBytes, files.totalBytes)}${['files', 'checking'].includes(files.phase) ? ' revisados; todavía se identifican los archivos que necesitan envío.' : ' copiados a la carpeta espejo.'}`,
  });
  else if (manual?.state === 'prepared-in-local-drive-folder') Object.assign(upload, {
    tone: 'success', percent: 100, detail: `${manual.copiedFiles} archivo(s) entregado(s) a la carpeta de Drive. Subida a los servidores: no verificada por ARMI.`,
  });
  else if (ready && !status.hasUnsyncedChanges && !status.incrementalSync?.pendingOperations
    && ['in-sync', 'waiting-for-drive'].includes(status.continuousSync?.state || '')) Object.assign(upload, {
    tone: 'success', percent: 100, detail: 'Cambios entregados a la carpeta de Drive. Subida a los servidores: no verificada por ARMI.',
  });
  else {
    const overall = describeBackgroundSync(status, ready, '');
    Object.assign(upload, { tone: overall.tone, detail: overall.detail });
  }

  const receipt = status.downloadProgress;
  if (status.incrementalSync?.pendingOperations && (!receipt || ['idle', 'complete'].includes(receipt.state))) Object.assign(download, {
    tone: 'warning', percent: null, detail: `${status.incrementalSync.pendingOperations} elemento(s) de sincronización pendiente(s). ${status.incrementalSync.message || 'Esperando que se complete su incorporación.'}`,
  });
  else if (receipt && receipt.state !== 'idle') Object.assign(download, {
    tone: receipt.state === 'complete' ? 'success' : receipt.state === 'error' ? 'error' : receipt.state === 'waiting' ? 'warning' : 'busy',
    percent: receipt.state === 'complete' ? 100 : receipt.state === 'transferring'
      ? percentage(receipt.completedBytes, receipt.totalBytes) ?? percentage(receipt.completedFiles, receipt.totalFiles) : null,
    detail: receipt.message || `${transferDetail(receipt.completedFiles, receipt.totalFiles, receipt.completedBytes, receipt.totalBytes)}${receipt.state === 'complete' ? ' recibidos y verificados.' : receipt.state === 'waiting' ? ' · Esperando que Drive entregue los archivos.' : ''}`,
  });
  else {
    const incoming = status.activeTransfers || [];
    if (incoming.length) {
      const completed = incoming.filter(file => file.state === 'available').length;
      const allComplete = completed === incoming.length;
      const active = incoming.some(file => file.state === 'downloading');
      const failed = incoming.some(file => file.state === 'error');
      const done = incoming.reduce((sum, file) => sum + file.copiedBytes, 0);
      const total = incoming.reduce((sum, file) => sum + file.totalBytes, 0);
      Object.assign(download, { tone: allComplete ? 'success' : active ? 'busy' : failed ? 'error' : 'warning',
        percent: allComplete ? 100 : active ? percentage(done, total) : null,
        detail: transferDetail(completed, incoming.length, done, total),
      });
    }
    else if (status.receivedChanges?.operations) Object.assign(download, {
      tone: 'success', percent: 100, detail: `${status.receivedChanges.operations} cambio(s) recibido(s) e incorporado(s) en esta PC.`,
    });
  }
  // Counts describe their real unit; a database operation is never a file.
  if (manual && ['copying-to-drive-folder', 'prepared-in-local-drive-folder'].includes(manual.state)
    && !(status.continuousSync?.state === 'syncing' && files && manual.state !== 'copying-to-drive-folder')) {
    fileCounts(upload, manual.copiedFiles, manual.totalFiles, manual.copiedBytes, manual.totalBytes);
    upload.phase = manual.state === 'copying-to-drive-folder' ? 'Copiando archivos' : 'Entregado a la carpeta';
    if (manual.currentFile) upload.files = [{name: shortFileName(manual.currentFile), state: 'Copiando', percent: null}];
  } else if (files && manual?.state !== 'error') {
    fileCounts(upload, files.completedFiles, files.totalFiles, files.completedBytes, files.totalBytes);
    const checking = ['files', 'checking'].includes(files.phase);
    upload.unit = checking ? 'revisados' : 'archivos';
    upload.phase = checking ? 'Revisando archivos' : upload.tone === 'success' ? 'Entregado a la carpeta'
      : files.phase === 'catalog' ? 'Publicando catálogo' : 'Copiando archivos';
    upload.unchangedFiles = files.unchangedFiles || 0;
    if (files.currentFile && upload.tone === 'busy') upload.files = [{name: shortFileName(files.currentFile), state: checking ? 'Revisando' : 'Copiando', percent: null}];
  }
  if (status.incrementalSync?.pendingOperations && (!receipt || ['idle', 'complete'].includes(receipt.state))) {
    download.total = status.incrementalSync.pendingOperations;
    download.unit = 'pendientes';
    download.phase = 'Cambios por incorporar';
  } else if (receipt && receipt.state !== 'idle') {
    fileCounts(download, receipt.completedFiles, receipt.totalFiles, receipt.completedBytes, receipt.totalBytes);
    download.phase = receipt.state === 'complete' ? 'Recibidos y verificados' : receipt.state === 'waiting' ? 'Esperando archivos'
      : receipt.state === 'error' ? 'Reintento pendiente' : receipt.totalBytes > 0 && receipt.completedBytes >= receipt.totalBytes ? 'Verificando archivos' : 'Recibiendo archivos';
  } else if (status.activeTransfers?.length) {
    const incoming = status.activeTransfers;
    fileCounts(download, incoming.filter(file => file.state === 'available').length, incoming.length,
      incoming.reduce((sum, file) => sum + file.copiedBytes, 0), incoming.reduce((sum, file) => sum + file.totalBytes, 0));
    download.phase = download.tone === 'success' ? 'Recibidos y verificados' : download.tone === 'busy' ? 'Recibiendo archivos'
      : download.tone === 'error' ? 'Reintento pendiente' : 'Esperando archivos';
  } else if (status.receivedChanges?.operations) {
    download.completed = download.total = status.receivedChanges.operations;
    download.unit = 'cambios';
    download.phase = 'Datos incorporados';
  }
  if (download.unit === 'archivos') download.files = (status.activeTransfers || [])
    .filter(file => file.state !== 'available').slice(0, 3).map(file => ({ name: file.fileName || shortFileName(file.relativePath || ''),
      state: file.state === 'downloading' ? 'Recibiendo' : file.state === 'error' ? 'Reintentar' : 'Esperando Drive',
      percent: file.state === 'downloading' ? percentage(file.copiedBytes, file.totalBytes) : null }));
  if (status.internetConnectivity?.online === false) {
    for (const view of [upload, download]) if (view.tone !== 'idle') Object.assign(view, {
      tone: 'warning', percent: null, phase: 'Sin Internet', detail: 'Los datos siguen en esta PC. Drive necesita conexión para transferir entre equipos.',
    });
  }
  return { upload, download };
};
