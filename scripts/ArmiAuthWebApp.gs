/**
 * ARMI DOCENTE - Google Apps Script
 * VERSION 2
 *
 * - Login desde hoja configurable por Admin (LOGIN_SHEET o DB_SHEET)
 * - Compras en hoja "usuarios"
 * - Trabajo por INDICES DE COLUMNA
 * - Soporta campos opcionales futuros en "db"
 * - NO depende de encabezados
 */

var ARMI_DEFAULTS = {
  spreadsheetId: '1U21RiyXYDP8P3TXUzsO5OBnMP4sW1huk2c5pamlRwEM',
  adminSheet: 'Admin',
  usersSheet: 'usuarios',
  loginSheet: 'db',
  purchasesFolderId: '1uGulQjVzCBfoMitcuIEJil9ti-8loH5v',
  pcSeparator: '\uD83D\uDCBB',
  maxDevicesDefault: 5,
  allowAutoRegisterPc: true,
  supportWebsite: 'https://sites.google.com/view/terminos-armi-docente/armar',
  yapeQrUrl: '',
  paymentAmount: '100',
  paymentReceiver: 'Kevin Arnold Horna Quispe',
  syncRootFolderId: '',
  syncKeepVersions: 5,
  syncKeepConflicts: 10
};

var USERS_COL = {
  TIPO: 1,
  DISPLAY_NAME: 2,
  DNI: 3,
  LOCATION: 4,
  INSTITUTION_NAME: 5,
  SPECIALITY: 6,
  USERNAME: 7,
  PASSWORD: 8,
  GMAIL: 9,
  OUTLOOK: 10,
  TELEGRAM: 11,
  WHATSAPP: 12,
  BOUCHER: 13,
  TERMS: 14,
  PLACAS: 15,
  ESTADO: 16,
  MOTIVO: 17,
  PC1: 18,
  PC2: 19,
  PC3: 20,
  PC4: 21,
  PC5: 22
};

var DB_COL = {
  USERNAME: 1,
  PASSWORD: 2,
  PLACAS: 3,
  ESTADO: 4,
  MOTIVO: 5,
  WHATSAPP: 6,
  TELEGRAM: 7,
  GMAIL: 8,
  OUTLOOK: 9,
  PC1: 10,
  PC2: 11,
  PC3: 12,
  PC4: 13,
  PC5: 14,
  DNI: 15,
  DISPLAY_NAME: 16,
  ROLE: 17,
  SYNC_USER_KEY: 18,
  SYNC_USER_LABEL: 19,
  DRIVE_FOLDER_NAME: 20,
  DRIVE_FOLDER_URL: 21,
  MODULE_PERMISSIONS: 22,
  FEATURES: 23,
  MAX_DEVICES: 24,
  ALLOW_AUTO_REGISTER_PC: 25,
  INSTITUTION_NAME: 26,
  AVATAR_URL: 27,
  EMAIL: 28
};

function doGet(e) {
  return handleRequest_(e, 'GET');
}

function doPost(e) {
  return handleRequest_(e, 'POST');
}

function handleRequest_(e, method) {
  try {
    var params = readRequestParams_(e, method);
    var action = normalizeText_(
      params.action || params.Action || params.fn || params.mode || params.type,
      'ResolveAuthUrl'
    ).toLowerCase();

    switch (action) {
      case 'compras':
        return Compras_(params);
      case 'purchase_status':
      case 'estado_compra':
      case 'consultar_compra':
        return PurchaseStatus_(params);
      case 'purchase_config':
      case 'compra_config':
      case 'payment_config':
      case 'qr_yape':
        return PurchaseConfig_();
      case 'login':
        return Login_(params);
      case 'sync_prepare_user':
      case 'sync_prepare':
        return SyncPrepareUser_(params);
      case 'sync_status':
        return SyncStatus_(params);
      case 'sync_push':
        return SyncPush_(params);
      case 'sync_push_start':
        return SyncPushStart_(params);
      case 'sync_push_chunk':
        return SyncPushChunk_(params);
      case 'sync_push_commit':
        return SyncPushCommit_(params);
      case 'sync_pull':
        return SyncPull_(params);
      case 'sync_pull_chunk':
        return SyncPullChunk_(params);
      case 'sync_pull_artifact':
        return SyncPullArtifact_(params);
      case 'sync_resolve_conflict':
      case 'sync_mark_conflict_resolved':
        return SyncResolveConflict_(params);
      case 'sync_clear_versions':
      case 'sync_archive_versions':
        return SyncClearVersions_(params);
      case 'resolveauthurl':
      case 'resolve_auth_url':
      case 'resolver':
      case 'getauthurl':
        return ResolveAuthUrl_();
      case 'health':
        return jsonResponse_({
          success: true,
          data: {
            ok: true,
            authLoginUrl: getResolvedAuthUrl_(),
            loginSheet: getConfig_().loginSheet,
            yapeQrConfigured: !!normalizeText_(getConfig_().yapeQrUrl),
            syncRootConfigured: !!normalizeText_(getConfig_().syncRootFolderId),
            timestamp: new Date().toISOString()
          }
        });
      default:
        return jsonResponse_({
          success: false,
          message: 'Accion no reconocida: ' + action
        });
    }
  } catch (error) {
    return jsonResponse_({
      success: false,
      message: 'Error inesperado en Apps Script: ' + error.message
    });
  }
}

function ResolveAuthUrl_() {
  return jsonResponse_({
    success: true,
    authLoginUrl: getResolvedAuthUrl_(),
    data: {
      authLoginUrl: getResolvedAuthUrl_(),
      loginSheet: getConfig_().loginSheet,
      timestamp: new Date().toISOString()
    }
  });
}

function PurchaseConfig_() {
  var config = getConfig_();
  var yapeQrUrl = normalizeText_(getConfigValue_(config, 'YAPE_QR_URL', config.yapeQrUrl));
  if (!yapeQrUrl) {
    yapeQrUrl = normalizeText_(getConfigValue_(config, 'PURCHASE_QR_URL', config.yapeQrUrl));
  }

  return jsonResponse_({
    success: true,
    data: {
      yapeQrUrl: yapeQrUrl,
      purchaseQrUrl: yapeQrUrl,
      paymentAmount: normalizeText_(getConfigValue_(config, 'PAYMENT_AMOUNT', config.paymentAmount), ARMI_DEFAULTS.paymentAmount),
      paymentReceiver: normalizeText_(getConfigValue_(config, 'PAYMENT_RECEIVER', config.paymentReceiver), ARMI_DEFAULTS.paymentReceiver)
    }
  });
}

function Compras_(params) {
  var config = getConfig_();
  var spreadsheet = getSpreadsheet_(config);
  var sheet = spreadsheet.getSheetByName(config.usersSheet);

  if (!sheet) {
    return jsonResponse_({
      success: false,
      message: 'No se encontro la hoja de usuarios/compras.'
    });
  }

  var imageUrl = '';
  if (normalizeText_(params.imageBase64)) {
    imageUrl = uploadPurchaseImage_(params.imageBase64, config);
  }

  var existing = findPurchaseByIdentity_(sheet, params);
  if (existing.found) {
    return jsonResponse_({
      success: true,
      message: existing.active
        ? 'Tu compra ya fue verificada. Ya puedes iniciar sesion con tu usuario y contrasena.'
        : 'Ya tenemos una solicitud registrada con estos datos. Evitamos duplicarla; puedes consultar su estado desde el formulario.',
      data: existing
    });
  }

  var nextRow = Math.max(sheet.getLastRow() + 1, 2);
  var plate = normalizePlate_(params.Placa || params.placa || params.devicePlate || params.varPlaca);

  sheet.getRange(nextRow, USERS_COL.TIPO).setValue('Compras');
  sheet.getRange(nextRow, USERS_COL.DISPLAY_NAME).setValue(params.varNombres || params.displayName || '');
  sheet.getRange(nextRow, USERS_COL.DNI).setValue(params.varDNI || params.dni || '');
  sheet.getRange(nextRow, USERS_COL.LOCATION).setValue(params.varLugar || params.location || '');
  sheet.getRange(nextRow, USERS_COL.INSTITUTION_NAME).setValue(params.varIE || params.institutionName || '');
  sheet.getRange(nextRow, USERS_COL.SPECIALITY).setValue(params.varEspecialidad || params.speciality || '');
  sheet.getRange(nextRow, USERS_COL.USERNAME).setValue(params.varUsuario || params.username || '');
  sheet.getRange(nextRow, USERS_COL.PASSWORD).setValue(params.varContrasena || params['varContrase\u00f1a'] || params.password || '');
  sheet.getRange(nextRow, USERS_COL.GMAIL).setValue(params.varGmail || params.gmail || '');
  sheet.getRange(nextRow, USERS_COL.OUTLOOK).setValue(params.varOutlook || params.outlook || '');
  sheet.getRange(nextRow, USERS_COL.TELEGRAM).setValue(params.varTelegram || params.telegram || '');
  sheet.getRange(nextRow, USERS_COL.WHATSAPP).setValue(params.varWhatsApp || params.whatsapp || '');
  sheet.getRange(nextRow, USERS_COL.BOUCHER).setValue(imageUrl);
  sheet.getRange(nextRow, USERS_COL.TERMS).setValue(toBooleanText_(params.varTerminos || params['varT\u00e9rminos']));
  sheet.getRange(nextRow, USERS_COL.PLACAS).setValue(plate);
  sheet.getRange(nextRow, USERS_COL.ESTADO).setValue('Pendiente');
  sheet.getRange(nextRow, USERS_COL.MOTIVO).setValue('');

  return jsonResponse_({
    success: true,
    message: 'Datos de compra almacenados con exito. Se procedera a verificar la informacion proporcionada y se te notificara al culminar el proceso.'
  });
}

function PurchaseStatus_(params) {
  var config = getConfig_();
  var spreadsheet = getSpreadsheet_(config);
  var sheet = spreadsheet.getSheetByName(config.usersSheet);

  if (!sheet) {
    return jsonResponse_({
      success: false,
      message: 'No se encontro la hoja de usuarios/compras.'
    });
  }

  var existing = findPurchaseByIdentity_(sheet, params);
  if (!existing.found) {
    return jsonResponse_({
      success: false,
      message: 'No encontramos una compra registrada con ese DNI o usuario.'
    });
  }

  return jsonResponse_({
    success: true,
    message: existing.active
      ? 'Tu compra ya fue verificada. Ya puedes iniciar sesion.'
      : 'Tu compra sigue pendiente de verificacion.',
    data: existing
  });
}

function SyncPrepareUser_(params) {
  try {
    var userKey = sanitizeSyncUserKey_(params.syncUserKey || params.userKey || params.username || params.varUsuario || params.dni);
    var userLabel = normalizeText_(params.syncUserLabel || params.userLabel || params.displayName || userKey, userKey);
    var folderInfo = ensureSyncUserFolder_(userKey, userLabel);
    return jsonResponse_({
      success: true,
      data: publicSyncFolderInfo_(folderInfo)
    });
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message });
  }
}

function SyncStatus_(params) {
  try {
    var userKey = sanitizeSyncUserKey_(params.syncUserKey || params.userKey || params.username);
    var userLabel = normalizeText_(params.syncUserLabel || params.userLabel || userKey, userKey);
    var folderInfo = resolveSyncUserFolderFromParams_(params, false);
    if (!folderInfo) {
      return jsonResponse_({
        success: false,
        message: 'No encontre la carpeta historica de este usuario en Drive. Verifica la raiz de sincronizacion o la cuenta conectada.'
      });
    }
    var currentCopy = resolveCurrentCloudCopy_(folderInfo);
    var manifest = currentCopy && currentCopy.manifest ? currentCopy.manifest : null;
    var config = getConfig_();
    var conflicts = summarizeSyncManifestFolder_(folderInfo.conflictsFolder, 'conflict', parsePositiveInteger_(getConfigValue_(config, 'SYNC_KEEP_CONFLICTS', config.syncKeepConflicts), ARMI_DEFAULTS.syncKeepConflicts));
    var versions = summarizeSyncManifestFolder_(folderInfo.versionsFolder, 'version', parsePositiveInteger_(getConfigValue_(config, 'SYNC_KEEP_VERSIONS', config.syncKeepVersions), ARMI_DEFAULTS.syncKeepVersions));
    return jsonResponse_({
      success: true,
      data: {
        user: publicSyncFolderInfo_(folderInfo),
        manifest: manifest,
        hasCloudCopy: !!manifest,
        currentSource: currentCopy ? currentCopy.source : '',
        capabilities: {
          chunkedSync: true,
          protocol: 'zip-parts-v1'
        },
        activity: {
          conflicts: conflicts,
          versions: versions
        }
      }
    });
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message });
  }
}

function SyncPushStart_(params) {
  try {
    var userKey = sanitizeSyncUserKey_(params.syncUserKey || params.userKey || params.username);
    var userLabel = normalizeText_(params.syncUserLabel || params.userLabel || userKey, userKey);
    var deviceId = sanitizeSyncUserKey_(params.deviceId || 'unknown-device');
    var baseCloudVersion = normalizeText_(params.baseCloudVersion || params.baseVersion || '');
    var manifest = typeof params.manifest === 'object' ? params.manifest : parseJsonSafe_(params.manifest);
    var totalParts = parsePositiveInteger_(params.totalParts, 0);
    var totalBytes = Math.max(Number(params.totalBytes || 0), 0);
    if (!manifest || !manifest.digest) throw new Error('No se recibio un manifiesto valido.');
    if (!totalParts || totalParts > 500) throw new Error('El numero de fragmentos no es valido.');

    var folderInfo = resolveSyncUserFolderFromParams_(params, true) || ensureSyncUserFolder_(userKey, userLabel);
    var currentManifest = readJsonFileFromFolder_(folderInfo.currentFolder, 'manifest.json');
    var currentVersion = normalizeText_(currentManifest && currentManifest.cloudVersion);
    var localDigest = normalizeText_(manifest.digest);
    if (currentManifest && localDigest === normalizeText_(currentManifest.digest)) {
      return jsonResponse_({
        success: true,
        message: 'No hubo cambios nuevos para subir a Drive.',
        data: {
          user: publicSyncFolderInfo_(folderInfo),
          manifest: currentManifest,
          skippedUpload: true,
          reason: 'same-digest'
        }
      });
    }

    var artifactKind = currentManifest && currentVersion && baseCloudVersion !== currentVersion ? 'conflict' : 'version';
    var uploadId = buildSyncVersionId_(deviceId, localDigest, artifactKind === 'conflict' ? 'conflict' : 'v');
    var cloudManifest = copyObject_(manifest);
    cloudManifest.cloudVersion = uploadId;
    cloudManifest.baseCloudVersion = baseCloudVersion;
    cloudManifest.syncUserKey = userKey;
    cloudManifest.syncUserLabel = userLabel;
    cloudManifest.deviceId = deviceId;
    cloudManifest.provider = 'google-apps-script-drive';
    cloudManifest.storageMode = 'apps_script_drive';
    cloudManifest.generatedAt = new Date().toISOString();
    cloudManifest.packageParts = {
      count: totalParts,
      totalBytes: totalBytes,
      format: 'zip-parts-v1'
    };

    var targetFolder = artifactKind === 'conflict' ? folderInfo.conflictsFolder : folderInfo.versionsFolder;
    pruneAbandonedUploads_(targetFolder);
    removeFilesByPrefix_(targetFolder, uploadId + '.zip.part-');
    trashFilesByName_(targetFolder, uploadId + '-upload.json');
    createOrReplaceJsonFile_(targetFolder, uploadId + '-upload.json', {
      uploadId: uploadId,
      artifactKind: artifactKind,
      totalParts: totalParts,
      totalBytes: totalBytes,
      createdAt: new Date().toISOString(),
      baseCloudVersion: baseCloudVersion,
      currentCloudVersion: currentVersion,
      deviceId: deviceId,
      manifest: manifest,
      cloudManifest: cloudManifest
    });

    return jsonResponse_({
      success: true,
      data: {
        user: publicSyncFolderInfo_(folderInfo),
        uploadId: uploadId,
        artifactKind: artifactKind,
        totalParts: totalParts
      }
    });
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message });
  }
}

function SyncPushChunk_(params) {
  try {
    var uploadId = sanitizeSyncUserKey_(params.uploadId);
    var artifactKind = normalizeText_(params.artifactKind, 'version') === 'conflict' ? 'conflict' : 'version';
    var index = Number(params.index);
    var totalParts = parsePositiveInteger_(params.totalParts, 0);
    var chunkBase64 = normalizeText_(params.chunkBase64);
    if (!uploadId || !Number.isInteger(index) || index < 0 || index >= totalParts) throw new Error('Fragmento de subida invalido.');
    if (!chunkBase64) throw new Error('El fragmento llego vacio.');

    var folderInfo = resolveSyncUserFolderFromParams_(params, false);
    if (!folderInfo) throw new Error('No encontre la carpeta de sincronizacion del usuario.');
    var targetFolder = artifactKind === 'conflict' ? folderInfo.conflictsFolder : folderInfo.versionsFolder;
    var marker = readJsonFileFromFolder_(targetFolder, uploadId + '-upload.json');
    if (!marker || Number(marker.totalParts) !== totalParts || normalizeText_(marker.artifactKind) !== artifactKind) {
      throw new Error('La sesion de subida ya no existe o no coincide con este fragmento.');
    }

    var bytes = Utilities.base64Decode(chunkBase64);
    var expectedSha256 = normalizeText_(params.chunkSha256).toLowerCase();
    var actualSha256 = sha256Hex_(bytes);
    if (expectedSha256 && actualSha256 !== expectedSha256) {
      throw new Error('El fragmento ' + (index + 1) + ' llego alterado y no se guardo.');
    }
    var partName = buildPackagePartName_(uploadId + '.zip', index, totalParts);
    createOrReplaceBytesFile_(targetFolder, partName, bytes, 'application/octet-stream');
    return jsonResponse_({ success: true, data: { uploadId: uploadId, index: index, sha256: actualSha256 } });
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message });
  }
}

function SyncPushCommit_(params) {
  try {
    var uploadId = sanitizeSyncUserKey_(params.uploadId);
    var artifactKind = normalizeText_(params.artifactKind, 'version') === 'conflict' ? 'conflict' : 'version';
    var folderInfo = resolveSyncUserFolderFromParams_(params, false);
    if (!folderInfo) throw new Error('No encontre la carpeta de sincronizacion del usuario.');
    var targetFolder = artifactKind === 'conflict' ? folderInfo.conflictsFolder : folderInfo.versionsFolder;
    var markerName = uploadId + '-upload.json';
    var marker = readJsonFileFromFolder_(targetFolder, markerName);
    if (!marker) throw new Error('La sesion de subida ya no existe.');
    var totalParts = parsePositiveInteger_(marker.totalParts, 0);
    var parts = getPackagePartFiles_(targetFolder, uploadId + '.zip', totalParts);
    if (parts.length !== totalParts) {
      throw new Error('La subida esta incompleta: llegaron ' + parts.length + ' de ' + totalParts + ' fragmentos.');
    }

    var config = getConfig_();
    var markerFile = getFirstFileByName_(targetFolder, markerName);
    if (markerFile) markerFile.setTrashed(true);
    if (artifactKind === 'conflict') {
      var conflictPayload = {
        conflict: true,
        conflictId: uploadId,
        uploadedAt: new Date().toISOString(),
        baseCloudVersion: marker.baseCloudVersion,
        currentCloudVersion: marker.currentCloudVersion,
        deviceId: marker.deviceId,
        packageParts: marker.cloudManifest.packageParts,
        manifest: marker.manifest
      };
      createOrReplaceJsonFile_(targetFolder, uploadId + '-manifest.json', conflictPayload);
      pruneVersionArtifacts_(targetFolder, parsePositiveInteger_(getConfigValue_(config, 'SYNC_KEEP_CONFLICTS', config.syncKeepConflicts), ARMI_DEFAULTS.syncKeepConflicts), 'conflict');
      return jsonResponse_({
        success: false,
        conflict: true,
        message: 'La nube tiene una version distinta. El paquete local completo quedo guardado como conflicto protegido.',
        data: {
          user: publicSyncFolderInfo_(folderInfo),
          currentManifest: readJsonFileFromFolder_(folderInfo.currentFolder, 'manifest.json'),
          conflictId: uploadId
        }
      });
    }

    var cloudManifest = marker.cloudManifest;
    createOrReplaceJsonFile_(targetFolder, uploadId + '-manifest.json', cloudManifest);
    clearFolder_(folderInfo.currentFolder);
    for (var i = 0; i < parts.length; i += 1) {
      parts[i].file.makeCopy(buildPackagePartName_('snapshot.zip', i, totalParts), folderInfo.currentFolder);
    }
    createOrReplaceJsonFile_(folderInfo.currentFolder, 'manifest.json', cloudManifest);
    pruneVersionArtifacts_(targetFolder, parsePositiveInteger_(getConfigValue_(config, 'SYNC_KEEP_VERSIONS', config.syncKeepVersions), ARMI_DEFAULTS.syncKeepVersions), 'version');

    return jsonResponse_({
      success: true,
      message: 'Copia fragmentada guardada en Drive correctamente.',
      data: { user: publicSyncFolderInfo_(folderInfo), manifest: cloudManifest }
    });
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message });
  }
}

function SyncPush_(params) {
  try {
    var userKey = sanitizeSyncUserKey_(params.syncUserKey || params.userKey || params.username);
    var userLabel = normalizeText_(params.syncUserLabel || params.userLabel || userKey, userKey);
    var deviceId = sanitizeSyncUserKey_(params.deviceId || 'unknown-device');
    var baseCloudVersion = normalizeText_(params.baseCloudVersion || params.baseVersion || '');
    var packageBase64 = normalizeText_(params.packageBase64 || params.zipBase64 || '');
    var manifest = typeof params.manifest === 'object' ? params.manifest : parseJsonSafe_(params.manifest);

    if (!packageBase64) throw new Error('No se recibio el paquete de sincronizacion.');
    if (!manifest || !manifest.digest) throw new Error('No se recibio un manifiesto valido.');

    var folderInfo = resolveSyncUserFolderFromParams_(params, true) || ensureSyncUserFolder_(userKey, userLabel);
    var currentManifest = readJsonFileFromFolder_(folderInfo.currentFolder, 'manifest.json');
    var currentVersion = normalizeText_(currentManifest && currentManifest.cloudVersion);
    var localDigest = normalizeText_(manifest.digest);
    var conflict = false;
    var config = getConfig_();
    var keepVersions = parsePositiveInteger_(getConfigValue_(config, 'SYNC_KEEP_VERSIONS', config.syncKeepVersions), ARMI_DEFAULTS.syncKeepVersions);
    var keepConflicts = parsePositiveInteger_(getConfigValue_(config, 'SYNC_KEEP_CONFLICTS', config.syncKeepConflicts), ARMI_DEFAULTS.syncKeepConflicts);

    if (currentManifest && localDigest && localDigest === normalizeText_(currentManifest.digest)) {
      return jsonResponse_({
        success: true,
        message: 'No hubo cambios nuevos para subir a Drive.',
        data: {
          user: publicSyncFolderInfo_(folderInfo),
          manifest: currentManifest,
          skippedUpload: true,
          reason: 'same-digest'
        }
      });
    }

    if (currentManifest && currentVersion && baseCloudVersion !== currentVersion && localDigest !== normalizeText_(currentManifest.digest)) {
      conflict = true;
      var conflictId = buildSyncVersionId_(deviceId, localDigest, 'conflict');
      createOrReplaceBase64File_(folderInfo.conflictsFolder, conflictId + '.zip', packageBase64, 'application/zip');
      createOrReplaceJsonFile_(folderInfo.conflictsFolder, conflictId + '-manifest.json', {
        conflict: true,
        conflictId: conflictId,
        uploadedAt: new Date().toISOString(),
        baseCloudVersion: baseCloudVersion,
        currentCloudVersion: currentVersion,
        deviceId: deviceId,
        manifest: manifest
      });
      pruneVersionArtifacts_(folderInfo.conflictsFolder, keepConflicts, 'conflict');
      return jsonResponse_({
        success: false,
        conflict: true,
        message: 'La nube tiene una version distinta a la que esta PC conocia. Guarde tu paquete como conflicto para evitar perdida de datos.',
        data: {
          user: publicSyncFolderInfo_(folderInfo),
          currentManifest: currentManifest,
          conflictId: conflictId
        }
      });
    }

    var versionId = buildSyncVersionId_(deviceId, localDigest, 'v');
    var cloudManifest = copyObject_(manifest);
    cloudManifest.cloudVersion = versionId;
    cloudManifest.baseCloudVersion = baseCloudVersion;
    cloudManifest.syncUserKey = userKey;
    cloudManifest.syncUserLabel = userLabel;
    cloudManifest.deviceId = deviceId;
    cloudManifest.provider = 'google-apps-script-drive';
    cloudManifest.storageMode = 'apps_script_drive';
    cloudManifest.generatedAt = new Date().toISOString();

    createOrReplaceBase64File_(folderInfo.versionsFolder, versionId + '.zip', packageBase64, 'application/zip');
    createOrReplaceJsonFile_(folderInfo.versionsFolder, versionId + '-manifest.json', cloudManifest);
    pruneVersionArtifacts_(folderInfo.versionsFolder, keepVersions, 'version');
    clearFolder_(folderInfo.currentFolder);
    createOrReplaceBase64File_(folderInfo.currentFolder, 'snapshot.zip', packageBase64, 'application/zip');
    createOrReplaceJsonFile_(folderInfo.currentFolder, 'manifest.json', cloudManifest);

    return jsonResponse_({
      success: true,
      message: 'Copia guardada en Drive correctamente.',
      data: {
        user: publicSyncFolderInfo_(folderInfo),
        manifest: cloudManifest
      }
    });
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message });
  }
}

function SyncPull_(params) {
  try {
    var folderInfo = resolveSyncUserFolderFromParams_(params, false);
    if (!folderInfo) {
      return jsonResponse_({ success: false, message: 'No encontre la carpeta historica de este usuario en Drive. Verifica la raiz de sincronizacion o la cuenta conectada.' });
    }
    var currentCopy = resolveCurrentCloudCopy_(folderInfo);
    if (!currentCopy || !currentCopy.manifest) {
      return jsonResponse_({ success: false, message: 'Este usuario todavia no tiene copia en Drive.' });
    }
    if (!currentCopy.file && !(currentCopy.parts && currentCopy.parts.length)) {
      return jsonResponse_({ success: false, message: 'La copia actual no tiene paquete de datos.' });
    }
    if (currentCopy.parts && currentCopy.parts.length) {
      return jsonResponse_({
        success: true,
        data: {
          user: publicSyncFolderInfo_(folderInfo),
          manifest: currentCopy.manifest,
          currentSource: currentCopy.source,
          chunked: true,
          totalParts: currentCopy.parts.length,
          artifactId: currentCopy.artifactId || '',
          artifactKind: currentCopy.artifactKind || 'current'
        }
      });
    }
    return jsonResponse_({
      success: true,
      data: {
        user: publicSyncFolderInfo_(folderInfo),
        manifest: currentCopy.manifest,
        currentSource: currentCopy.source,
        packageBase64: Utilities.base64Encode(currentCopy.file.getBlob().getBytes())
      }
    });
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message });
  }
}

function SyncPullArtifact_(params) {
  try {
    var artifactId = normalizeText_(params.artifactId || params.id);
    var artifactKind = normalizeText_(params.artifactKind || params.kind, 'version');
    var folderInfo = resolveSyncUserFolderFromParams_(params, false);
    if (!folderInfo) {
      return jsonResponse_({ success: false, message: 'No encontre la carpeta historica de este usuario en Drive. Verifica la raiz de sincronizacion o la cuenta conectada.' });
    }
    var folder = artifactKind === 'conflict'
      ? folderInfo.conflictsFolder
      : artifactKind === 'current'
        ? folderInfo.currentFolder
        : folderInfo.versionsFolder;
    var zipName = artifactKind === 'current' ? 'snapshot.zip' : artifactId + '.zip';
    var manifestName = artifactKind === 'current' ? 'manifest.json' : artifactId + '-manifest.json';
    var file = getFirstFileByName_(folder, zipName);
    var manifest = readJsonFileFromFolder_(folder, manifestName);
    var totalParts = Number(manifest && (manifest.packageParts && manifest.packageParts.count || manifest.manifest && manifest.manifest.packageParts && manifest.manifest.packageParts.count) || 0);
    var parts = totalParts ? getPackagePartFiles_(folder, zipName, totalParts) : [];
    if (!file && !parts.length) {
      return jsonResponse_({ success: false, message: 'No encontre el paquete solicitado en Drive.' });
    }
    if (parts.length) {
      return jsonResponse_({
        success: true,
        data: {
          user: publicSyncFolderInfo_(folderInfo),
          artifactId: artifactId,
          artifactKind: artifactKind,
          manifest: manifest,
          chunked: true,
          totalParts: parts.length
        }
      });
    }
    return jsonResponse_({
      success: true,
      data: {
        user: publicSyncFolderInfo_(folderInfo),
        artifactId: artifactId,
        artifactKind: artifactKind,
        manifest: manifest,
        packageBase64: Utilities.base64Encode(file.getBlob().getBytes())
      }
    });
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message });
  }
}

function SyncPullChunk_(params) {
  try {
    var artifactId = normalizeText_(params.artifactId || params.id);
    var artifactKind = normalizeText_(params.artifactKind || params.kind, 'current');
    var index = Number(params.index);
    var totalParts = parsePositiveInteger_(params.totalParts, 0);
    if (!Number.isInteger(index) || index < 0 || index >= totalParts) throw new Error('Indice de fragmento invalido.');
    var folderInfo = resolveSyncUserFolderFromParams_(params, false);
    if (!folderInfo) throw new Error('No encontre la carpeta historica de este usuario en Drive.');
    var folder = artifactKind === 'conflict'
      ? folderInfo.conflictsFolder
      : artifactKind === 'version'
        ? folderInfo.versionsFolder
        : folderInfo.currentFolder;
    var zipName = artifactKind === 'current' ? 'snapshot.zip' : artifactId + '.zip';
    var partName = buildPackagePartName_(zipName, index, totalParts);
    var file = getFirstFileByName_(folder, partName);
    if (!file) throw new Error('No encontre el fragmento ' + (index + 1) + ' de ' + totalParts + ' en Drive.');
    return jsonResponse_({
      success: true,
      data: {
        index: index,
        totalParts: totalParts,
        chunkBase64: Utilities.base64Encode(file.getBlob().getBytes())
      }
    });
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message });
  }
}

function SyncResolveConflict_(params) {
  try {
    var userKey = sanitizeSyncUserKey_(params.syncUserKey || params.userKey || params.username);
    var conflictId = normalizeText_(params.conflictId || params.artifactId || params.id);
    if (!conflictId) {
      return jsonResponse_({ success: false, message: 'Falta indicar el conflicto que deseas marcar como solucionado.' });
    }

    var folderInfo = resolveSyncUserFolderFromParams_(params, false);
    if (!folderInfo) {
      return jsonResponse_({ success: false, message: 'No encontre la carpeta historica de este usuario en Drive. Verifica la raiz de sincronizacion o la cuenta conectada.' });
    }
    var resolvedFolder = folderInfo.resolvedConflictsFolder;
    var zipName = conflictId + '.zip';
    var manifestName = conflictId + '-manifest.json';
    var zipFile = getFirstFileByName_(folderInfo.conflictsFolder, zipName);
    var manifestFile = getFirstFileByName_(folderInfo.conflictsFolder, manifestName);

    if (!zipFile && !manifestFile) {
      return jsonResponse_({ success: false, message: 'No encontre ese conflicto pendiente en Drive.' });
    }

    if (zipFile) zipFile.moveTo(resolvedFolder);
    if (manifestFile) {
      var manifest = readJsonFileFromFile_(manifestFile) || {};
      var conflictPartCount = Number(manifest.packageParts && manifest.packageParts.count || manifest.manifest && manifest.manifest.packageParts && manifest.manifest.packageParts.count || 0);
      var conflictParts = conflictPartCount ? getPackagePartFiles_(folderInfo.conflictsFolder, zipName, conflictPartCount) : [];
      for (var partIndex = 0; partIndex < conflictParts.length; partIndex += 1) {
        conflictParts[partIndex].file.moveTo(resolvedFolder);
      }
      manifest.resolved = true;
      manifest.resolvedAt = new Date().toISOString();
      manifest.resolvedBy = userKey;
      manifestFile.setTrashed(true);
      createOrReplaceJsonFile_(resolvedFolder, manifestName, manifest);
    }

    return jsonResponse_({
      success: true,
      message: 'Conflicto marcado como solucionado.',
      data: {
        conflictId: conflictId,
        user: publicSyncFolderInfo_(folderInfo)
      }
    });
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message });
  }
}

function SyncClearVersions_(params) {
  try {
    var folderInfo = resolveSyncUserFolderFromParams_(params, false);
    if (!folderInfo) {
      return jsonResponse_({ success: false, message: 'No encontre la carpeta historica de este usuario en Drive. Verifica la raiz de sincronizacion o la cuenta conectada.' });
    }
    var moved = moveFolderContents_(folderInfo.versionsFolder, folderInfo.archivedVersionsFolder);

    return jsonResponse_({
      success: true,
      message: moved > 0
        ? 'Historial de versiones archivado correctamente.'
        : 'No habia versiones en el historial para archivar.',
      data: {
        archivedCount: moved,
        user: publicSyncFolderInfo_(folderInfo)
      }
    });
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message });
  }
}

function findPurchaseByIdentity_(sheet, params) {
  var dni = normalizeText_(params.varDNI || params.dni);
  var username = normalizeText_(params.varUsuario || params.username || params.user);
  if (!dni && !username) return { found: false };

  var data = sheet.getDataRange().getValues();
  for (var rowIndex = data.length - 1; rowIndex >= 1; rowIndex -= 1) {
    var row = data[rowIndex];
    var rowDni = normalizeText_(getCellByIndex_(row, USERS_COL.DNI));
    var rowUsername = normalizeText_(getCellByIndex_(row, USERS_COL.USERNAME));
    if ((dni && dni === rowDni) || (username && username === rowUsername)) {
      var status = normalizeText_(getCellByIndex_(row, USERS_COL.ESTADO), 'Pendiente');
      var reason = normalizeText_(getCellByIndex_(row, USERS_COL.MOTIVO));
      return {
        found: true,
        row: rowIndex + 1,
        dni: rowDni,
        username: rowUsername,
        displayName: normalizeText_(getCellByIndex_(row, USERS_COL.DISPLAY_NAME)),
        estado: status,
        motivo: reason,
        placa: normalizeText_(getCellByIndex_(row, USERS_COL.PLACAS)),
        pending: isPendingStatusValue_(status),
        active: isActiveStatusValue_(status)
      };
    }
  }

  return { found: false };
}

function Login_(params) {
  var config = getConfig_();
  var spreadsheet = getSpreadsheet_(config);
  var sheet = spreadsheet.getSheetByName(config.loginSheet);

  if (!sheet) {
    return jsonResponse_({
      success: false,
      message: 'No se encontro la hoja de login: ' + config.loginSheet
    });
  }

  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    return jsonResponse_({
      success: false,
      message: 'La base de usuarios esta vacia.'
    });
  }

  var username = normalizeText_(params.Usuario || params.username || params.user);
  var password = normalizeText_(params.Contrasena || params['Contrase\u00f1a'] || params.password);
  var plate = normalizePlate_(params.Placa || params.placa || params.devicePlate);
  var infoUser = normalizeText_(params.InfoUsuario || params.infoUsuario || '');

  var defaultMaxDevices = parsePositiveInteger_(config.maxDevicesDefault, ARMI_DEFAULTS.maxDevicesDefault);
  var defaultAutoRegister = parseBooleanLike_(config.allowAutoRegisterPc, ARMI_DEFAULTS.allowAutoRegisterPc);

  for (var rowIndex = 1; rowIndex < data.length; rowIndex += 1) {
    var row = data[rowIndex];

    var rowUsername = normalizeText_(getCellByIndex_(row, DB_COL.USERNAME));
    var rowPassword = normalizeText_(getCellByIndex_(row, DB_COL.PASSWORD));

    if (username !== rowUsername || password !== rowPassword) {
      continue;
    }

    var status = normalizeText_(getCellByIndex_(row, DB_COL.ESTADO), 'Habilitad@');
    var reason = normalizeText_(getCellByIndex_(row, DB_COL.MOTIVO));
    var supportWhatsApp = normalizeText_(getCellByIndex_(row, DB_COL.WHATSAPP));
    var supportTelegram = normalizeText_(getCellByIndex_(row, DB_COL.TELEGRAM));
    var gmail = normalizeText_(getCellByIndex_(row, DB_COL.GMAIL));
    var outlook = normalizeText_(getCellByIndex_(row, DB_COL.OUTLOOK));
    var placaCell = normalizeText_(getCellByIndex_(row, DB_COL.PLACAS));

    var dni = normalizeText_(getCellByIndex_(row, DB_COL.DNI));
    var displayName = normalizeText_(getCellByIndex_(row, DB_COL.DISPLAY_NAME), rowUsername);
    var role = normalizeText_(getCellByIndex_(row, DB_COL.ROLE), 'docente');
    var syncUserKey = normalizeText_(getCellByIndex_(row, DB_COL.SYNC_USER_KEY), rowUsername);
    var syncUserLabel = normalizeText_(getCellByIndex_(row, DB_COL.SYNC_USER_LABEL), displayName);
    var driveFolderName = normalizeText_(getCellByIndex_(row, DB_COL.DRIVE_FOLDER_NAME));
    var driveFolderUrl = normalizeText_(getCellByIndex_(row, DB_COL.DRIVE_FOLDER_URL));
    var institutionName = normalizeText_(getCellByIndex_(row, DB_COL.INSTITUTION_NAME));
    var avatarUrl = normalizeText_(getCellByIndex_(row, DB_COL.AVATAR_URL));
    var emailExtra = normalizeText_(getCellByIndex_(row, DB_COL.EMAIL));

    var modulePermissions = parseJsonSafe_(getCellByIndex_(row, DB_COL.MODULE_PERMISSIONS));
    var features = parseJsonSafe_(getCellByIndex_(row, DB_COL.FEATURES));

    var maxDevices = parsePositiveInteger_(getCellByIndex_(row, DB_COL.MAX_DEVICES), defaultMaxDevices);
    var allowAutoRegisterPc = parseBooleanLike_(getCellByIndex_(row, DB_COL.ALLOW_AUTO_REGISTER_PC), defaultAutoRegister);
    var syncFolderInfo = null;

    if (isPendingStatusValue_(status)) {
      return jsonResponse_({
        success: false,
        message: reason || 'Tu acceso esta pendiente de verificacion.'
      });
    }

    if (!isActiveStatusValue_(status)) {
      return jsonResponse_({
        success: false,
        message: reason || ('Usuari@ bloquead@: ' + status)
      });
    }

    var deviceCheck = ensureDeviceAllowedForDbUser_({
      sheet: sheet,
      rowIndex: rowIndex + 1,
      row: row,
      placaCell: placaCell,
      plate: plate,
      infoUser: infoUser,
      maxDevices: maxDevices,
      allowAutoRegisterPc: allowAutoRegisterPc,
      pcSeparator: config.pcSeparator
    });

    if (!deviceCheck.success) {
      return jsonResponse_({
        success: false,
        message: deviceCheck.message || reason || 'Este usuario ya alcanzo el maximo de computadoras autorizadas.'
      });
    }

    var refreshedPlates = deviceCheck.placaCell || placaCell;
    var emailFinal = gmail || emailExtra;
    if (normalizeText_(config.syncRootFolderId)) {
      try {
        syncFolderInfo = ensureSyncUserFolder_(syncUserKey || rowUsername, syncUserLabel || displayName);
        driveFolderName = driveFolderName || syncFolderInfo.folderName;
        driveFolderUrl = driveFolderUrl || syncFolderInfo.folderUrl;
      } catch (syncError) {}
    }

    return jsonResponse_({
      success: true,
      message: deviceCheck.registeredNewDevice
        ? 'Nueva dispositivo registrado. Inicio de sesion exitoso.'
        : 'Inicio de sesion exitoso.',
      data: {
        id: syncUserKey || rowUsername,
        username: rowUsername,
        displayName: displayName,
        nameuser: displayName,
        dni: dni,
        email: emailFinal,
        gmail: gmail,
        outlook: outlook,
        telegram: supportTelegram,
        whatsapp: supportWhatsApp,
        placa: refreshedPlates,
        placas: refreshedPlates,
        estado: status,
        motivo: reason,
        active: true,
        subscriptionActive: true,
        subscriptionStatus: status,
        subscriptionReason: reason,
        role: role,
        syncUserKey: syncUserKey,
        syncUserLabel: syncUserLabel,
        driveFolderName: driveFolderName,
        driveFolderUrl: driveFolderUrl,
        syncFolderInfo: syncFolderInfo ? publicSyncFolderInfo_(syncFolderInfo) : null,
        modulePermissions: modulePermissions || {},
        features: Array.isArray(features) ? features : [],
        supportWhatsApp: supportWhatsApp,
        supportTelegram: supportTelegram,
        supportEmail: emailFinal,
        institutionName: institutionName,
        avatarUrl: avatarUrl,
        website: normalizeText_(getConfigValue_(config, 'SUPPORT_WEBSITE', ARMI_DEFAULTS.supportWebsite))
      }
    });
  }

  return jsonResponse_({
    success: false,
    message: 'Usuario o contrasena incorrectos.'
  });
}

function ensureDeviceAllowedForDbUser_(options) {
  var plate = normalizePlate_(options.plate);
  var infoUser = normalizeText_(options.infoUser);
  var pcSeparator = normalizeText_(options.pcSeparator, ARMI_DEFAULTS.pcSeparator);
  var row = options.row;
  var sheet = options.sheet;
  var rowIndex = options.rowIndex;
  var maxDevices = Math.min(Math.max(Number(options.maxDevices || 1), 1), 5);
  var allowAutoRegisterPc = options.allowAutoRegisterPc !== false;

  var slots = [
    normalizeText_(getCellByIndex_(row, DB_COL.PC1)),
    normalizeText_(getCellByIndex_(row, DB_COL.PC2)),
    normalizeText_(getCellByIndex_(row, DB_COL.PC3)),
    normalizeText_(getCellByIndex_(row, DB_COL.PC4)),
    normalizeText_(getCellByIndex_(row, DB_COL.PC5))
  ];

  var plates = splitLegacyPlateCell_(options.placaCell, pcSeparator);
  var allKnownPlates = uniqueStrings_(plates.concat(extractPlatesFromSlots_(slots)));

  if (!plate) {
    return {
      success: true,
      registeredNewDevice: false,
      placaCell: allKnownPlates.join(pcSeparator)
    };
  }

  if (allKnownPlates.indexOf(plate) >= 0) {
    return {
      success: true,
      registeredNewDevice: false,
      placaCell: allKnownPlates.join(pcSeparator)
    };
  }

  if (!allowAutoRegisterPc) {
    return {
      success: false,
      message: 'Este usuario no tiene permitido registrar nuevas computadoras.'
    };
  }

  for (var slotIndex = 0; slotIndex < maxDevices; slotIndex += 1) {
    if (!normalizeText_(slots[slotIndex])) {
      var targetColumn = DB_COL.PC1 + slotIndex;
      sheet.getRange(rowIndex, targetColumn).setValue(formatPcInfoCell_(infoUser));

      allKnownPlates.push(plate);
      sheet.getRange(rowIndex, DB_COL.PLACAS).setValue(allKnownPlates.join(pcSeparator));

      return {
        success: true,
        registeredNewDevice: true,
        placaCell: allKnownPlates.join(pcSeparator)
      };
    }
  }

  return {
    success: false,
    message: 'Este usuario ya alcanzo el maximo de computadoras autorizadas.'
  };
}

function getConfig_() {
  var config = copyObject_(ARMI_DEFAULTS);
  var spreadsheet = getSpreadsheet_({ spreadsheetId: ARMI_DEFAULTS.spreadsheetId });
  var adminSheet = spreadsheet.getSheetByName(config.adminSheet);
  if (!adminSheet) return config;

  var values = adminSheet.getDataRange().getValues();

  for (var i = 0; i < values.length; i += 1) {
    var key = normalizeText_(values[i][0]).toUpperCase();
    var value = values[i][1];
    if (!key) continue;

    switch (key) {
      case 'SPREADSHEET_ID':
        config.spreadsheetId = normalizeText_(value, config.spreadsheetId);
        break;
      case 'ADMIN_SHEET':
        config.adminSheet = normalizeText_(value, config.adminSheet);
        break;
      case 'USERS_SHEET':
        config.usersSheet = normalizeText_(value, config.usersSheet);
        break;
      case 'LOGIN_SHEET':
      case 'DB_SHEET':
        config.loginSheet = normalizeText_(value, config.loginSheet);
        break;
      case 'PURCHASES_FOLDER_ID':
        config.purchasesFolderId = normalizeText_(value, config.purchasesFolderId);
        break;
      case 'AUTH_LOGIN_URL':
        config.authLoginUrl = normalizeText_(value, '');
        break;
      case 'MAX_DEVICES_DEFAULT':
        config.maxDevicesDefault = parsePositiveInteger_(value, config.maxDevicesDefault);
        break;
      case 'ALLOW_AUTO_REGISTER_PC':
        config.allowAutoRegisterPc = parseBooleanLike_(value, config.allowAutoRegisterPc);
        break;
      case 'PC_SEPARATOR':
        config.pcSeparator = normalizeText_(value, config.pcSeparator);
        break;
      case 'SUPPORT_WEBSITE':
        config.supportWebsite = normalizeText_(value, config.supportWebsite);
        break;
      case 'YAPE_QR_URL':
      case 'PURCHASE_QR_URL':
        config.yapeQrUrl = normalizeText_(value, config.yapeQrUrl);
        config[key] = config.yapeQrUrl;
        break;
      case 'PAYMENT_AMOUNT':
        config.paymentAmount = normalizeText_(value, config.paymentAmount);
        break;
      case 'PAYMENT_RECEIVER':
        config.paymentReceiver = normalizeText_(value, config.paymentReceiver);
        break;
      case 'SYNC_KEEP_VERSIONS':
        config.syncKeepVersions = parsePositiveInteger_(value, config.syncKeepVersions);
        break;
      case 'SYNC_KEEP_CONFLICTS':
        config.syncKeepConflicts = parsePositiveInteger_(value, config.syncKeepConflicts);
        break;
      case 'SYNC_ROOT_FOLDER_ID':
      case 'DRIVE_SYNC_ROOT_FOLDER_ID':
        config.syncRootFolderId = extractDriveId_(value);
        config[key] = config.syncRootFolderId;
        break;
      default:
        config[key] = value;
        break;
    }
  }

  return config;
}

function getResolvedAuthUrl_() {
  var config = getConfig_();
  var explicitUrl = normalizeText_(config.authLoginUrl);
  if (explicitUrl) return explicitUrl;
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (error) {
    return '';
  }
}

function getSpreadsheet_(config) {
  try {
    return SpreadsheetApp.openById(config.spreadsheetId || ARMI_DEFAULTS.spreadsheetId);
  } catch (error) {
    return SpreadsheetApp.getActiveSpreadsheet();
  }
}

function getConfigValue_(config, key, fallback) {
  if (!config) return fallback;
  var direct = config[key];
  if (typeof direct !== 'undefined' && direct !== null && String(direct) !== '') {
    return direct;
  }
  return fallback;
}

function readRequestParams_(e, method) {
  if (method === 'POST' && e && e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (error) {
      return {};
    }
  }
  return (e && e.parameter) ? e.parameter : {};
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function uploadPurchaseImage_(imageBase64, config) {
  if (!normalizeText_(imageBase64) || !normalizeText_(config.purchasesFolderId)) {
    return '';
  }

  var match = String(imageBase64).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return '';

  var mimeType = match[1];
  var bytes = Utilities.base64Decode(match[2]);
  var extension = mimeType.indexOf('png') >= 0 ? 'png' : 'jpg';
  var blob = Utilities.newBlob(bytes, mimeType, 'compra_' + new Date().getTime() + '.' + extension);
  var folder = DriveApp.getFolderById(config.purchasesFolderId);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function ensureSyncUserFolder_(userKey, userLabel) {
  var config = getConfig_();
  var rootId = normalizeText_(config.syncRootFolderId);
  if (!rootId) {
    throw new Error('Falta configurar SYNC_ROOT_FOLDER_ID en la hoja Admin.');
  }

  var root = DriveApp.getFolderById(rootId);
  var folderName = sanitizeSyncUserKey_(userKey) + ' - ' + sanitizeDriveName_(userLabel);
  var userFolder = getOrCreateFolder_(root, folderName);
  var currentFolder = getOrCreateFolder_(userFolder, 'current');
  var versionsFolder = getOrCreateFolder_(userFolder, 'versions');
  var conflictsFolder = getOrCreateFolder_(userFolder, 'conflicts');
  var resolvedConflictsFolder = getOrCreateFolder_(userFolder, 'resolved-conflicts');
  var archivedVersionsFolder = getOrCreateFolder_(userFolder, 'archived-versions');

  return {
    syncUserKey: sanitizeSyncUserKey_(userKey),
    syncUserLabel: normalizeText_(userLabel, userKey),
    folderId: userFolder.getId(),
    folderName: userFolder.getName(),
    folderUrl: userFolder.getUrl(),
    currentFolder: currentFolder,
    versionsFolder: versionsFolder,
    conflictsFolder: conflictsFolder,
    resolvedConflictsFolder: resolvedConflictsFolder,
    archivedVersionsFolder: archivedVersionsFolder,
    currentFolderId: currentFolder.getId(),
    versionsFolderId: versionsFolder.getId(),
    conflictsFolderId: conflictsFolder.getId(),
    resolvedConflictsFolderId: resolvedConflictsFolder.getId(),
    archivedVersionsFolderId: archivedVersionsFolder.getId()
  };
}

function resolveSyncUserFolderFromParams_(params, allowCreate) {
  var userKey = sanitizeSyncUserKey_(params.syncUserKey || params.userKey || params.username);
  var userLabel = normalizeText_(params.syncUserLabel || params.userLabel || userKey, userKey);
  var folderId = extractDriveId_(params.folderId || params.userFolderId || params.driveFolderId);

  if (folderId) {
    var resolvedById = getSyncUserFolderByIds_(folderId, userKey, userLabel, params, allowCreate);
    if (resolvedById) return resolvedById;
  }

  return allowCreate
    ? ensureSyncUserFolder_(userKey, userLabel)
    : getExistingSyncUserFolder_(userKey, userLabel);
}

function getExistingSyncUserFolder_(userKey, userLabel) {
  var config = getConfig_();
  var rootId = normalizeText_(config.syncRootFolderId);
  if (!rootId) {
    throw new Error('Falta configurar SYNC_ROOT_FOLDER_ID en la hoja Admin.');
  }

  var normalizedKey = sanitizeSyncUserKey_(userKey);
  var normalizedLabel = sanitizeDriveName_(userLabel);
  var root = DriveApp.getFolderById(rootId);
  var targetName = normalizedKey + ' - ' + normalizedLabel;
  var userFolder = getFolderByName_(root, targetName);

  if (!userFolder) {
    userFolder = findSyncUserFolderByKey_(root, normalizedKey);
  }
  if (!userFolder) return null;

  var currentFolder = getFolderByName_(userFolder, 'current');
  var versionsFolder = getFolderByName_(userFolder, 'versions');
  var conflictsFolder = getFolderByName_(userFolder, 'conflicts');
  var resolvedConflictsFolder = getFolderByName_(userFolder, 'resolved-conflicts');
  var archivedVersionsFolder = getFolderByName_(userFolder, 'archived-versions');

  return {
    syncUserKey: normalizedKey,
    syncUserLabel: normalizeText_(userLabel, userKey),
    folderId: userFolder.getId(),
    folderName: userFolder.getName(),
    folderUrl: userFolder.getUrl(),
    currentFolder: currentFolder,
    versionsFolder: versionsFolder,
    conflictsFolder: conflictsFolder,
    resolvedConflictsFolder: resolvedConflictsFolder,
    archivedVersionsFolder: archivedVersionsFolder,
    currentFolderId: currentFolder ? currentFolder.getId() : '',
    versionsFolderId: versionsFolder ? versionsFolder.getId() : '',
    conflictsFolderId: conflictsFolder ? conflictsFolder.getId() : '',
    resolvedConflictsFolderId: resolvedConflictsFolder ? resolvedConflictsFolder.getId() : '',
    archivedVersionsFolderId: archivedVersionsFolder ? archivedVersionsFolder.getId() : ''
  };
}

function getSyncUserFolderByIds_(folderId, userKey, userLabel, params, allowCreate) {
  try {
    var userFolder = DriveApp.getFolderById(folderId);
    return buildSyncFolderInfoFromFolder_(
      userFolder,
      userKey,
      userLabel,
      {
        currentFolderId: params.currentFolderId,
        versionsFolderId: params.versionsFolderId,
        conflictsFolderId: params.conflictsFolderId,
        resolvedConflictsFolderId: params.resolvedConflictsFolderId,
        archivedVersionsFolderId: params.archivedVersionsFolderId
      },
      allowCreate
    );
  } catch (error) {
    return null;
  }
}

function buildSyncFolderInfoFromFolder_(userFolder, userKey, userLabel, folderIds, allowCreate) {
  if (!userFolder) return null;

  var currentFolder = resolveNamedChildFolder_(userFolder, 'current', folderIds && folderIds.currentFolderId, allowCreate);
  var versionsFolder = resolveNamedChildFolder_(userFolder, 'versions', folderIds && folderIds.versionsFolderId, allowCreate);
  var conflictsFolder = resolveNamedChildFolder_(userFolder, 'conflicts', folderIds && folderIds.conflictsFolderId, allowCreate);
  var resolvedConflictsFolder = resolveNamedChildFolder_(userFolder, 'resolved-conflicts', folderIds && folderIds.resolvedConflictsFolderId, allowCreate);
  var archivedVersionsFolder = resolveNamedChildFolder_(userFolder, 'archived-versions', folderIds && folderIds.archivedVersionsFolderId, allowCreate);

  return {
    syncUserKey: sanitizeSyncUserKey_(userKey),
    syncUserLabel: normalizeText_(userLabel, userKey),
    folderId: userFolder.getId(),
    folderName: userFolder.getName(),
    folderUrl: userFolder.getUrl(),
    currentFolder: currentFolder,
    versionsFolder: versionsFolder,
    conflictsFolder: conflictsFolder,
    resolvedConflictsFolder: resolvedConflictsFolder,
    archivedVersionsFolder: archivedVersionsFolder,
    currentFolderId: currentFolder ? currentFolder.getId() : '',
    versionsFolderId: versionsFolder ? versionsFolder.getId() : '',
    conflictsFolderId: conflictsFolder ? conflictsFolder.getId() : '',
    resolvedConflictsFolderId: resolvedConflictsFolder ? resolvedConflictsFolder.getId() : '',
    archivedVersionsFolderId: archivedVersionsFolder ? archivedVersionsFolder.getId() : ''
  };
}

function resolveNamedChildFolder_(parentFolder, name, folderId, allowCreate) {
  var byName = getFolderByName_(parentFolder, name);
  if (byName) return byName;

  var explicitId = extractDriveId_(folderId);
  if (explicitId) {
    try {
      var explicitFolder = DriveApp.getFolderById(explicitId);
      if (normalizeText_(explicitFolder.getName()) === normalizeText_(name)) {
        return explicitFolder;
      }
    } catch (error) {}
  }
  if (allowCreate) {
    return getOrCreateFolder_(parentFolder, name);
  }
  return null;
}

function publicSyncFolderInfo_(folderInfo) {
  if (!folderInfo) return null;
  return {
    syncUserKey: folderInfo.syncUserKey,
    syncUserLabel: folderInfo.syncUserLabel,
    folderId: folderInfo.folderId,
    folderName: folderInfo.folderName,
    folderUrl: folderInfo.folderUrl,
    currentFolderId: folderInfo.currentFolderId,
    currentFolderUrl: buildDriveFolderUrl_(folderInfo.currentFolderId),
    versionsFolderId: folderInfo.versionsFolderId,
    versionsFolderUrl: buildDriveFolderUrl_(folderInfo.versionsFolderId),
    conflictsFolderId: folderInfo.conflictsFolderId,
    conflictsFolderUrl: buildDriveFolderUrl_(folderInfo.conflictsFolderId),
    resolvedConflictsFolderId: folderInfo.resolvedConflictsFolderId,
    resolvedConflictsFolderUrl: buildDriveFolderUrl_(folderInfo.resolvedConflictsFolderId),
    archivedVersionsFolderId: folderInfo.archivedVersionsFolderId,
    archivedVersionsFolderUrl: buildDriveFolderUrl_(folderInfo.archivedVersionsFolderId)
  };
}

function getOrCreateFolder_(parentFolder, name) {
  var folders = parentFolder.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return parentFolder.createFolder(name);
}

function getFolderByName_(parentFolder, name) {
  var folders = parentFolder.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : null;
}

function findSyncUserFolderByKey_(rootFolder, normalizedKey) {
  var folders = rootFolder.getFolders();
  var prefix = normalizedKey + ' - ';
  while (folders.hasNext()) {
    var folder = folders.next();
    var folderName = normalizeText_(folder.getName());
    if (folderName.indexOf(prefix) === 0) {
      return folder;
    }
  }
  return null;
}

function getFirstFileByName_(folder, name) {
  if (!folder) return null;
  var files = folder.getFilesByName(name);
  return files.hasNext() ? files.next() : null;
}

function clearFolder_(folder) {
  if (!folder) return;
  var files = folder.getFiles();
  while (files.hasNext()) {
    files.next().setTrashed(true);
  }
}

function createOrReplaceJsonFile_(folder, name, payload) {
  if (!folder) throw new Error('No se encontro la carpeta de Drive donde debia guardarse el archivo JSON.');
  var existing = folder.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);
  var blob = Utilities.newBlob(JSON.stringify(payload || {}, null, 2), 'application/json', name);
  return folder.createFile(blob);
}

function createOrReplaceBase64File_(folder, name, base64, mimeType) {
  if (!folder) throw new Error('No se encontro la carpeta de Drive donde debia guardarse el archivo ZIP.');
  var existing = folder.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);
  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', name);
  return folder.createFile(blob);
}

function createOrReplaceBytesFile_(folder, name, bytes, mimeType) {
  if (!folder) throw new Error('No se encontro la carpeta de Drive donde debia guardarse el fragmento.');
  trashFilesByName_(folder, name);
  return folder.createFile(Utilities.newBlob(bytes, mimeType || 'application/octet-stream', name));
}

function trashFilesByName_(folder, name) {
  if (!folder) return;
  var files = folder.getFilesByName(name);
  while (files.hasNext()) files.next().setTrashed(true);
}

function removeFilesByPrefix_(folder, prefix) {
  if (!folder) return;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (normalizeText_(file.getName()).indexOf(prefix) === 0) file.setTrashed(true);
  }
}

function pruneAbandonedUploads_(folder) {
  if (!folder) return;
  var markers = listFolderFilesBySuffix_(folder, '-upload.json');
  var cutoff = Date.now() - 24 * 60 * 60 * 1000;
  markers.forEach(function(item) {
    var marker = readJsonFileFromFile_(item.file) || {};
    var createdAt = Date.parse(marker.createdAt || item.createdAt || '') || 0;
    if (createdAt >= cutoff) return;
    var uploadId = normalizeText_(marker.uploadId || item.name.replace(/-upload\.json$/i, ''));
    item.file.setTrashed(true);
    if (uploadId) removeFilesByPrefix_(folder, uploadId + '.zip.part-');
  });
}

function padPackagePart_(value) {
  return ('00000' + String(value)).slice(-5);
}

function buildPackagePartName_(zipName, index, totalParts) {
  return zipName + '.part-' + padPackagePart_(Number(index) + 1) + '-of-' + padPackagePart_(totalParts);
}

function getPackagePartFiles_(folder, zipName, totalParts) {
  var parts = [];
  if (!folder || !totalParts) return parts;
  for (var index = 0; index < totalParts; index += 1) {
    var name = buildPackagePartName_(zipName, index, totalParts);
    var file = getFirstFileByName_(folder, name);
    if (!file) return parts;
    parts.push({ name: name, file: file, index: index });
  }
  return parts;
}

function sha256Hex_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function(value) {
    var normalized = value < 0 ? value + 256 : value;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function readJsonFileFromFolder_(folder, name) {
  if (!folder) return null;
  var file = getFirstFileByName_(folder, name);
  if (!file) return null;
  return readJsonFileFromFile_(file);
}

function resolveCurrentCloudCopy_(folderInfo) {
  if (!folderInfo) return null;

  var currentManifest = readJsonFileFromFolder_(folderInfo.currentFolder, 'manifest.json');
  var currentZip = getFirstFileByName_(folderInfo.currentFolder, 'snapshot.zip');
  var currentPartCount = Number(currentManifest && currentManifest.packageParts && currentManifest.packageParts.count || 0);
  var currentParts = currentPartCount ? getPackagePartFiles_(folderInfo.currentFolder, 'snapshot.zip', currentPartCount) : [];
  if (currentManifest && currentParts.length === currentPartCount && currentPartCount > 0) {
    return {
      manifest: currentManifest,
      file: null,
      parts: currentParts,
      artifactId: '',
      artifactKind: 'current',
      source: 'current-chunked'
    };
  }
  if (currentManifest && currentZip) {
    return {
      manifest: currentManifest,
      file: currentZip,
      source: 'current'
    };
  }

  var latestVersion = getLatestVersionCloudCopy_(folderInfo.versionsFolder);
  if (latestVersion) {
    return {
      manifest: latestVersion.manifest,
      file: latestVersion.file,
      parts: latestVersion.parts || [],
      artifactId: latestVersion.artifactId || '',
      artifactKind: 'version',
      source: 'versions-fallback'
    };
  }

  return {
    manifest: currentManifest,
    file: currentZip,
    source: currentManifest || currentZip ? 'current-incomplete' : ''
  };
}

function getLatestVersionCloudCopy_(versionsFolder) {
  if (!versionsFolder) return null;
  var items = listFolderFilesBySuffix_(versionsFolder, '-manifest.json');
  for (var i = 0; i < items.length; i += 1) {
    var item = items[i];
    var manifest = readJsonFileFromFile_(item.file);
    if (!manifest) continue;
    var zipName = item.name.replace(/-manifest\.json$/i, '.zip');
    var zipFile = getFirstFileByName_(versionsFolder, zipName);
    var partCount = Number(manifest.packageParts && manifest.packageParts.count || 0);
    var parts = partCount ? getPackagePartFiles_(versionsFolder, zipName, partCount) : [];
    if (!zipFile && (!partCount || parts.length !== partCount)) continue;
    return {
      manifest: manifest,
      file: zipFile,
      parts: parts,
      artifactId: item.name.replace(/-manifest\.json$/i, ''),
      manifestName: item.name,
      zipName: zipName
    };
  }
  return null;
}

function moveFolderContents_(sourceFolder, targetFolder) {
  if (!sourceFolder || !targetFolder) return 0;
  var moved = 0;
  var files = sourceFolder.getFiles();
  while (files.hasNext()) {
    files.next().moveTo(targetFolder);
    moved += 1;
  }
  return moved;
}

function readJsonFileFromFile_(file) {
  try {
    return JSON.parse(file.getBlob().getDataAsString());
  } catch (error) {
    return null;
  }
}

function buildDriveFolderUrl_(folderId) {
  var id = normalizeText_(folderId);
  if (!id) return '';
  return 'https://drive.google.com/drive/folders/' + id;
}

function summarizeSyncManifestFolder_(folder, kind, limit) {
  if (!folder) {
    return {
      count: 0,
      latestAt: '',
      latestId: '',
      latestUrl: '',
      items: []
    };
  }
  var files = folder.getFiles();
  var items = [];

  while (files.hasNext()) {
    var file = files.next();
    var name = normalizeText_(file.getName());
    if (!name || name.indexOf('-manifest.json') < 0) continue;

    var payload = null;
    try {
      payload = JSON.parse(file.getBlob().getDataAsString());
    } catch (error) {
      payload = null;
    }

    var createdAt = '';
    try {
      createdAt = file.getDateCreated().toISOString();
    } catch (error2) {
      createdAt = '';
    }

    items.push({
      id: normalizeText_(payload && (payload.conflictId || payload.cloudVersion || name.replace(/-manifest\.json$/i, '')), name),
      name: name,
      kind: normalizeText_(kind, 'version'),
      createdAt: createdAt,
      generatedAt: normalizeText_(payload && (payload.generatedAt || payload.uploadedAt || payload.createdAt), createdAt),
      deviceId: normalizeText_(payload && payload.deviceId),
      digest: normalizeText_(payload && (payload.digest || (payload.manifest && payload.manifest.digest))),
      currentCloudVersion: normalizeText_(payload && payload.currentCloudVersion),
      baseCloudVersion: normalizeText_(payload && payload.baseCloudVersion),
      summary: payload && (payload.summary || (payload.manifest && payload.manifest.summary)) || null,
      url: file.getUrl()
    });
  }

  items.sort(function(left, right) {
    return normalizeText_(right.generatedAt).localeCompare(normalizeText_(left.generatedAt));
  });

  return {
    count: items.length,
    latestAt: items.length ? items[0].generatedAt : '',
    latestId: items.length ? items[0].id : '',
    latestUrl: items.length ? items[0].url : '',
    items: items.slice(0, Math.max(parsePositiveInteger_(limit, 5), 1))
  };
}

function pruneVersionArtifacts_(folder, keepCount, mode) {
  if (!folder) return;
  var count = Math.max(parsePositiveInteger_(keepCount, 1), 1);
  var manifestFiles = listFolderFilesBySuffix_(folder, '-manifest.json');
  if (manifestFiles.length <= count) return;

  manifestFiles.slice(count).forEach(function(item) {
    item.file.setTrashed(true);
    var zipName = item.name.replace(/-manifest\.json$/i, '.zip');
    var zipFile = getFirstFileByName_(folder, zipName);
    if (zipFile) zipFile.setTrashed(true);
    removeFilesByPrefix_(folder, zipName + '.part-');
  });
}

function listFolderFilesBySuffix_(folder, suffix) {
  if (!folder) return [];
  var files = folder.getFiles();
  var items = [];
  while (files.hasNext()) {
    var file = files.next();
    var name = normalizeText_(file.getName());
    if (!name || (suffix && name.slice(-suffix.length) !== suffix)) continue;
    var createdAt = '';
    try {
      createdAt = file.getDateCreated().toISOString();
    } catch (error) {
      createdAt = '';
    }
    items.push({
      name: name,
      file: file,
      createdAt: createdAt
    });
  }

  return items.sort(function(left, right) {
    return normalizeText_(right.createdAt).localeCompare(normalizeText_(left.createdAt));
  });
}

function buildSyncVersionId_(deviceId, digest, prefix) {
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  return [
    normalizeText_(prefix, 'v'),
    stamp,
    sanitizeSyncUserKey_(deviceId),
    sanitizeSyncUserKey_(String(digest || '').slice(0, 12))
  ].join('_');
}

function sanitizeSyncUserKey_(value) {
  var text = normalizeText_(value, 'default-user')
    .toLowerCase()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || 'default-user';
}

function sanitizeDriveName_(value) {
  return normalizeText_(value, 'Usuario')
    .replace(/[\\/:*?"<>|#%{}~&]/g, '-')
    .slice(0, 80);
}

function extractDriveId_(value) {
  var text = normalizeText_(value);
  var match = text.match(/\/folders\/([^/?#]+)/i) || text.match(/[?&]id=([^&]+)/i);
  return match && match[1] ? match[1] : text;
}

function getCellByIndex_(row, colIndex) {
  if (!row || !colIndex || colIndex < 1) return '';
  return typeof row[colIndex - 1] === 'undefined' ? '' : row[colIndex - 1];
}

function normalizeText_(value, fallback) {
  var text = String(value === null || typeof value === 'undefined' ? '' : value).trim();
  if (text) return text;
  return typeof fallback === 'undefined' ? '' : fallback;
}

function parseJsonSafe_(value) {
  var text = normalizeText_(value);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function parsePositiveInteger_(value, fallback) {
  var parsed = Number(value);
  if (!isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseBooleanLike_(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  var text = normalizeText_(value).toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'si', 's\u00ed', 'yes', 'ok', 'activo'].indexOf(text) >= 0;
}

function normalizePlate_(value) {
  return normalizeText_(value).toUpperCase();
}

function splitLegacyPlateCell_(value, separator) {
  var text = normalizeText_(value);
  if (!text) return [];
  return text
    .split(separator)
    .map(function(item) { return normalizePlate_(item); })
    .filter(Boolean);
}

function extractPlatesFromSlots_(slots) {
  return slots
    .map(function(info) {
      var match = normalizeText_(info).match(/Serie:\s*([^\n-]+)/i);
      if (match && match[1]) {
        return normalizePlate_('1M39A' + match[1]);
      }
      return '';
    })
    .filter(Boolean);
}

function uniqueStrings_(items) {
  var seen = {};
  var result = [];
  items.forEach(function(item) {
    var key = normalizeText_(item);
    if (!key || seen[key]) return;
    seen[key] = true;
    result.push(key);
  });
  return result;
}

function formatPcInfoCell_(infoUser) {
  return normalizeText_(infoUser).replace(/-/g, '\n');
}

function isActiveStatusValue_(status) {
  var normalized = normalizeText_(status, 'Habilitad@').toLowerCase();
  return ['habilitad@', 'habilitado', 'habilitada', 'active', 'activo', 'ok'].indexOf(normalized) >= 0;
}

function isPendingStatusValue_(status) {
  var normalized = normalizeText_(status).toLowerCase();
  return ['pendiente', 'pending', 'por verificar', 'verificacion', 'verification'].indexOf(normalized) >= 0;
}

function toBooleanText_(value) {
  return parseBooleanLike_(value, false) ? 'Aceptado' : 'No aceptado';
}

function copyObject_(source) {
  var target = {};
  Object.keys(source || {}).forEach(function(key) {
    target[key] = source[key];
  });
  return target;
}
