import React from 'react';
import { describeSyncDelivery, type SyncDeliveryStatus } from '../utils/backgroundSyncStatus';

export const SyncDeliveryDetails: React.FC<{ status: SyncDeliveryStatus | null }> = ({ status }) => {
  if (!status || status.config.mode !== 'drive_mirror') return null;
  const maintenance = status.incrementalSync?.maintenance;
  return <div className="mt-3 border-t border-slate-200 pt-2 text-[11px] leading-4" aria-label="Confirmaciones de sincronización">
    <dl className="space-y-2">{describeSyncDelivery(status).map(row => <div key={row.label}>
      <dt className="font-semibold text-slate-700">{row.label}</dt>
      <dd className={row.confirmed ? 'text-emerald-700' : 'text-slate-500'}>{row.value}</dd>
      {row.detail && <dd className="text-slate-500">{row.detail}</dd>}
    </div>)}</dl>
    {maintenance && <p className="mt-3 border-t border-slate-100 pt-2 text-slate-500">
      <span className="font-semibold">Mantenimiento automático: </span>{maintenance.message}
      {maintenance.retiredFiles > 0 && ` ${maintenance.retiredFiles} repetición(es) retiradas en esta PC, con copia de seguridad verificada.`}
    </p>}
  </div>;
};
