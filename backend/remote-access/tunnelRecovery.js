// Recupera un tunel realmente inutilizable, no un fallo HTTP/DNS aislado.
// El proveedor ya exige varios fallos de salud consecutivos antes de marcar
// DISCONNECTED. Aqui agregamos una segunda ventana de seguridad para evitar
// rotar enlaces temporales trycloudflare.com innecesariamente.

const RECOVERY_DISCONNECTED_MS = 45_000;
const RECOVERY_COOLDOWN_MS = 2 * 60_000;
const MAX_AUTOMATIC_RECOVERY_ATTEMPTS = 3;

export const shouldRecoverTunnel = ({
  state,
  disconnectedSince,
  lastRestartAt,
  attempts,
  now = Date.now(),
}) => (
  state.enabledByTeacher
  && state.automaticRecoveryAllowed !== false
  && ['DISCONNECTED', 'ERROR'].includes(state.tunnelStatus)
  && !['connectedStudents', 'activeUploads', 'queuedUploads', 'activeTransfers']
    .some((key) => Number(state[key] || 0) > 0)
  && disconnectedSince > 0
  && now - disconnectedSince >= RECOVERY_DISCONNECTED_MS
  && (lastRestartAt <= 0 || now - lastRestartAt >= RECOVERY_COOLDOWN_MS)
  && attempts < MAX_AUTOMATIC_RECOVERY_ATTEMPTS
);
