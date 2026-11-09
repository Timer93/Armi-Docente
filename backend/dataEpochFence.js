// Fence queued writes from a teacher window which loaded records before a
// one-time identity migration. Ordinary incremental synchronization is unaffected.
export const createDataEpochFence = db => {
  let statement=null;
  return (req,res,next) => {
    if(!statement && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='armi_sync_migration_log'").get()) {
      statement=db.prepare('SELECT migration_id FROM armi_sync_migration_log ORDER BY applied_at DESC LIMIT 1');
    }
    const epoch=statement?.get()?.migration_id || 'legacy';
    res.setHeader('X-ARMI-Data-Epoch',epoch);
    const mutating=!['GET','HEAD','OPTIONS'].includes(req.method);
    const guarded=/^\/(?:evaluacion(?:\/|$)|sesiones(?:\/|$)|estudiantes(?:\/|$)|sync\/frontend-state(?:\/|$))/.test(req.path);
    const client=String(req.headers['x-armi-data-epoch'] || 'legacy');
    if(mutating && guarded && epoch!=='legacy' && client!==epoch) return res.status(409).json({
      success:false,code:'ARMI_DATA_REFRESH_REQUIRED',message:'ARMI actualizo las identidades. Recarga la vista antes de guardar; los datos verificados se conservaron.'
    });
    next();
  };
};
