import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';

test('Apps Script login never creates Drive folders; web login skips legacy Drive queries',()=>{
 const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../../scripts/ArmiAuthWebApp.gs',import.meta.url),'utf8'),context);
 const row=Array(30).fill('');for(const [column,value] of [['USERNAME','fixture'],['PASSWORD','fixture-pass'],['ESTADO','Habilitad@'],['SYNC_USER_KEY','fixture'],['DISPLAY_NAME','Fixture']])row[context.DB_COL[column]-1]=value;
 context.getConfig_=()=>({loginSheet:'db',syncRootFolderId:'fixture-root'});
 context.getSpreadsheet_=()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>[[],row]})})});
 context.ensureDeviceAllowedForDbUser_=()=>({success:true});context.jsonResponse_=value=>value;
 let reads=0,creates=0;context.getExistingSyncUserFolder_=()=>{reads++;return null;};context.ensureSyncUserFolder_=()=>{creates++;throw new Error('Login must not create folders');};
 for(const skipDrivePreparation of [true,'true'])assert.equal(context.Login_({username:'fixture',password:'fixture-pass',skipDrivePreparation}).success,true);
 assert.equal(reads,0);
 assert.equal(context.Login_({username:'fixture',password:'fixture-pass'}).success,true);assert.equal(reads,1);
 context.getExistingSyncUserFolder_=()=>({folderName:'Existing legacy folder',folderUrl:'https://drive.google.com/drive/folders/fixture-folder'});
 context.publicSyncFolderInfo_=value=>value;
 const result=context.Login_({username:'fixture',password:'fixture-pass'});assert.equal(result.success,true);assert.equal(result.data.driveFolderName,'Existing legacy folder');
 assert.equal(creates,0);
});
