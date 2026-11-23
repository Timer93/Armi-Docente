/**
 * Complemento para el proyecto de autenticación existente de ARMI.
 * 1. Pegar estas funciones al final de ese proyecto, sin borrar su código.
 * 2. En Login_, dentro del objeto data, añadir junto a username:
 *    portalIdentity: armiPortalTeacherIdentity_(sheet, rowIndex + 1, data, rowUsername),
 * 3. Actualizar la implementación existente (/exec), no crear otra URL.
 * Solo escribe la columna de metadatos ARMI_DOCENTE_ID; no altera credenciales,
 * permisos, carpetas ni validaciones del inicio de sesión original.
 */
function armiPortalTeacherIdentity_(sheet, physicalRow, snapshot, username) {
  try {
    var number = armiPortalTeacherNumber_(sheet, physicalRow, snapshot, username);
    var label = String(username || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90).replace(/-+$/, '') || 'usuario';
    return { ready: true, teacherRegistryNumber: number,
      studentPortalUrl: 'https://web.armiapp.com/estudiantes/d' + number + '-profe-' + label };
  } catch (error) {
    // A metadata problem must not disable the existing desktop/web login.
    return { ready: false, message: 'Revisa la columna ARMI_DOCENTE_ID del registro de docentes.' };
  }
}

function armiPortalNumberValue_(value) {
  var raw = String(value == null ? '' : value).trim();
  return /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null;
}

function armiPortalColumn_(rows) {
  var headers = rows[0] || [], found = -1;
  for (var i = 0; i < headers.length; i += 1) {
    if (String(headers[i] || '').trim().toUpperCase() === 'ARMI_DOCENTE_ID') {
      if (found >= 0 || i < 28) throw new Error('Invalid metadata column');
      found = i;
    }
  }
  return found;
}

function armiPortalTeacherNumber_(sheet, physicalRow, snapshot, username) {
  var user = String(username || '').trim();
  if (!user || !Array.isArray(snapshot) || physicalRow < 2) throw new Error('Invalid identity');
  var column = armiPortalColumn_(snapshot), seen = {}, own = null, ownCount = 0;
  // Normal logins reuse Login_'s already-read snapshot: no extra Sheets calls.
  if (column >= 0) {
    for (var i = 1; i < snapshot.length; i += 1) {
      var value = snapshot[i][column], number = armiPortalNumberValue_(value);
      if (value !== '' && value != null && !number) throw new Error('Invalid registered number');
      if (number) { if (seen[number]) throw new Error('Duplicate registered number'); seen[number] = true; }
      if (String(snapshot[i][0] || '').trim() === user) { own = number; ownCount += 1; }
    }
    if (ownCount !== 1) throw new Error('Ambiguous username');
    if (own) return own;
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var rows = sheet.getDataRange().getValues();
    column = armiPortalColumn_(rows);
    var createColumn = column < 0;
    // The existing DB_COL contract reserves columns 1..28.
    if (createColumn) column = Math.max(28, sheet.getLastColumn());
    seen = {}; var largest = 0, ownIndex = -1;
    for (var j = 1; j < rows.length; j += 1) {
      var existing = rows[j][column], saved = armiPortalNumberValue_(existing);
      if (existing !== '' && existing != null && !saved) throw new Error('Invalid registered number');
      if (saved) {
        if (seen[saved]) throw new Error('Duplicate registered number');
        seen[saved] = true; largest = Math.max(largest, saved);
      }
      if (String(rows[j][0] || '').trim() === user) {
        if (ownIndex >= 0) throw new Error('Ambiguous username');
        ownIndex = j;
      }
    }
    if (ownIndex < 1) throw new Error('Teacher no longer exists');
    var values = [], changed = createColumn;
    for (var k = 1; k < rows.length; k += 1) {
      var stored = rows[k][column], assigned = armiPortalNumberValue_(stored);
      if (!assigned && String(rows[k][0] || '').trim()) {
        // First data row is d1. Existing numbers survive sorting and insertion.
        assigned = seen[k] ? largest + 1 : k;
        if (!armiPortalNumberValue_(assigned)) throw new Error('Registry exhausted');
        seen[assigned] = true; largest = Math.max(largest, assigned); changed = true;
      }
      values.push([assigned || '']);
    }
    if (changed) {
      var required = column + 1, current = sheet.getMaxColumns();
      if (required > current) sheet.insertColumnsAfter(current, required - current);
      if (createColumn) sheet.getRange(1, column + 1).setValue('ARMI_DOCENTE_ID');
      sheet.getRange(2, column + 1, values.length, 1).setValues(values);
      SpreadsheetApp.flush();
    }
    return values[ownIndex - 1][0];
  } finally { lock.releaseLock(); }
}
