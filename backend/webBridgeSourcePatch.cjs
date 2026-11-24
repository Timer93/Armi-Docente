const once=(source,before,after)=>{
 if(source.split(before).length!==2)throw Error('La versión instalada cambió. No se activó el receptor web.');
 return source.replace(before,after);
};
exports.patchSync=(source,bundleUrl)=>{
 source=String(source).replaceAll('\r\n','\n');
 if(source.includes('armiWebDesktopBridge'))return source;
 source=`import armiWebDesktopBridge from ${JSON.stringify(bundleUrl)};\n`+source;
 source=once(source,'const runIncrementalMirrorSync = async (mirrorPath) => {',`const runIncrementalMirrorSync = async (mirrorPath) => {
  const webConfig=readConfig();
  const webReceived=await armiWebDesktopBridge.runWebBridge({db,mirrorPath,syncUserKey:webConfig.syncUserKey,backupPath:path.join(snapshotsFolder,'before-web-receiver.db')});`);
 source=once(source,'result.data?.appliedOperations > 0 || result.data?.identityMigrationApplied','result.data?.appliedOperations > 0 || result.data?.identityMigrationApplied || webReceived.applied');
 source=once(source,'Math.max(1,result.data.appliedOperations)','Math.max(1,(result.data.appliedOperations||0)+webReceived.applied)');
 return source;
};
exports.patchDb=source=>{
 source=String(source);
 if(source.includes("'web_work_ids'"))return source;
 return once(source,'const SYNC_EXCLUDED_TABLES = new Set([',"const SYNC_EXCLUDED_TABLES = new Set([\n    'web_work_ids','web_work_receipts','web_work_versions',");
};
