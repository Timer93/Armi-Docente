import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };
import {desktopStudentLogin} from './student-login-template.mjs';

const web = fileURLToPath(new URL('../', import.meta.url));
const repo = path.resolve(web, '..');
const out = path.join(web, 'dist');
if (path.dirname(out) !== path.resolve(web) || path.basename(out) !== 'dist') throw new Error('Invalid generated output path');
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'assets'), { recursive: true });
const absolute = file => path.join(repo, file);
const webFile = file => path.join(web, 'frontend', file);
const studentLogin=desktopStudentLogin(await readFile(absolute('backend/public/student-portal.html'),'utf8'));
const isolated = new Set(['SyncLifecycleManager', 'BackgroundSyncIndicator', 'RemoteAccessIndicator', 'AppUpdaterOverlay', 'CloudSyncPanel', 'GeneralNotesOverlay']);
const desktopPkg = JSON.parse(await readFile(absolute('package.json'), 'utf8'));
const alias = Object.fromEntries(Object.keys(pkg.dependencies).map(name => [name, path.join(web, 'node_modules', name)]));
alias.xlsx = webFile('excel-disabled.js');
const originalSource = {
  name: 'armi-web-runtime-adapters',
  setup(bundler) {
    bundler.onResolve({filter:/^armi-web-student-login$/},()=>({path:'student-login',namespace:'armi-student-login'}));
    bundler.onLoad({filter:/.*/,namespace:'armi-student-login'},()=>({contents:`export const desktopLoginHtml=${JSON.stringify(studentLogin.html)};`,loader:'js'}));
    bundler.onResolve({filter:/^armi-web-student-desktop\.css$/},()=>({path:'desktop-login.css',namespace:'armi-student-css'}));
    bundler.onLoad({filter:/.*/,namespace:'armi-student-css'},()=>({contents:studentLogin.css,loader:'css'}));
    bundler.onResolve({ filter: /^armi-web-runtime$/ }, () => ({path:webFile('runtime.js')}));
    bundler.onResolve({filter:/^armi-web-ai$/},()=>({path:webFile('ai-client.ts')}));
    bundler.onResolve({filter:/^armi-web-ai-settings$/},()=>({path:webFile('AISettings.tsx')}));
    bundler.onResolve({filter:/^armi-web-evaluation$/},()=>({path:webFile('evaluation-client.tsx')}));
    bundler.onResolve({filter:/^armi-web-portal$/},()=>({path:webFile('PortalPanel.tsx')}));
    bundler.onResolve({filter:/[\\/]utils[\\/](gemini|aiModels)(?:\.ts)?$/},args=>({path:webFile(args.path.includes('aiModels')?'ai-models.ts':'ai-client.ts')}));
    bundler.onResolve({ filter: /^armi-desktop-api-original$/ }, () => ({ path: absolute('services/apiService.ts') }));
    bundler.onResolve({ filter: /(?:AuthContext|apiService|observePortableStorage|SyncLifecycleManager|BackgroundSyncIndicator|RemoteAccessIndicator|AppUpdaterOverlay|CloudSyncPanel|GeneralNotesOverlay)(?:\.tsx?)?$/ }, args => {
      const target = path.resolve(args.resolveDir, args.path).replace(/\\/g, '/').replace(/\.tsx?$/, '');
      const normalizedRepo = repo.replace(/\\/g, '/');
      if (target === `${normalizedRepo}/components/auth/AuthContext`) return { path: webFile('auth.tsx') };
      if (target === `${normalizedRepo}/services/apiService`) return { path: webFile('desktop-api.ts') };
      if (target === `${normalizedRepo}/utils/observePortableStorage`) return { path: webFile('observe-storage.js') };
      if (target.startsWith(`${normalizedRepo}/components/`) && isolated.has(path.basename(target))) return { path: webFile('desktop-only.tsx') };
    });
    bundler.onLoad({ filter: /[\\/]components[\\/]auth[\\/]LoginScreen\.tsx$/ }, async args => {
      let contents = await readFile(args.path, 'utf8');
      const marker = 'onClick={loginAsDeveloper}';
      const location = contents.indexOf(marker);
      if (location < 0 || contents.indexOf(marker, location + marker.length) >= 0) throw new Error('Review the desktop login before publishing web');
      const start = contents.lastIndexOf('<button', location);
      const end = contents.indexOf('</button>', location);
      if (start < 0 || end < 0) throw new Error('Cannot isolate the desktop developer button');
      contents = contents.slice(0, start) + contents.slice(end + '</button>'.length);
      const remember = contents.indexOf('checked={remember}');
      if (remember >= 0) {
        const labelStart = contents.lastIndexOf('<label', remember);
        const labelEnd = contents.indexOf('</label>', remember);
        if (labelStart < 0 || labelEnd < 0) throw new Error('Review the desktop remember-login control');
        contents = contents.slice(0, labelStart) + contents.slice(labelEnd + '</label>'.length);
      }
      return { contents, loader: 'tsx', resolveDir: path.dirname(args.path) };
    });
    bundler.onLoad({ filter: /[\\/]components[\\/]DatosGeneralesView\.tsx$/ }, async args => {
      // Marcas exclusivas de la compilación web; el archivo de escritorio no cambia.
      const contents = (await readFile(args.path, 'utf8'))
        .replace('<div className="animate-fade-in pb-10">', '<div data-armi-web-editor="general" className="animate-fade-in pb-10">')
        .replace('<div className="flex flex-col items-center gap-3">','<div data-web-unavailable="" className="flex flex-col items-center gap-3">')
        .replaceAll('Guardado automatico', 'Sin cambios pendientes')
        .replaceAll('Guardado automático', 'Sin cambios pendientes')
        .replaceAll('SQL Server Activo','Datos en la web');
      if (!contents.includes('data-armi-web-editor="general"')) throw new Error('Review general editor marker');
      return { contents, loader: 'tsx', resolveDir: path.dirname(args.path) };
    });
    bundler.onLoad({ filter: /[\\/]components[\\/]StudentsView\.tsx$/ }, async args => {
      let contents = (await readFile(args.path, 'utf8')).replace('<div className="animate-fade-in pb-12">','<div data-armi-web-editor="students" className="animate-fade-in pb-12">');
      if (!contents.includes('data-armi-web-editor="students"')) throw new Error('Review student editor marker');
      for (const title of ['Importar Excel','Egresar Promoción Anterior','Migración Masiva']) contents = contents.replace(`title="${title}"`,`data-web-unavailable="" title="${title}"`);
      for (const handler of ['handleRevealPortalPassword(student)','handleOpenStudentPortalTest(student)','handleResetPortalPassword(student)']) contents = contents.replace(`onClick={() => { void ${handler}; }}`,`data-web-unavailable="" onClick={() => { void ${handler}; }}`);
      contents = contents.replace('title={`Ver foto de ${student.name}`}','data-web-unavailable="" title={`Ver foto de ${student.name}`}');
      const clearButton = '<button onClick={handleClearForm}';
      if (!contents.includes(clearButton)) throw new Error('Review web student delete action');
      contents = contents.replace(clearButton, '<button type="button" title="Eliminar estudiante seleccionado" disabled={!selectedStudentId || savingStudentIds.includes(selectedStudentId)} onClick={() => handleDeleteRequest(selectedStudentId)} className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-40">Eliminar seleccionado</button>' + clearButton);
      contents = contents.replaceAll('eliminado permanentemente','eliminado de la web');
      contents = contents.replaceAll('SQL Sincronizado - Gestión de Datos Estudiantiles','Registro de estudiantes · Web');
      return { contents, loader: 'tsx', resolveDir: path.dirname(args.path) };
    });
    bundler.onLoad({filter:/[\\/]evaluation[\\/]EvidenceBank\.tsx$/},async args=>{
      let contents=(await readFile(args.path,'utf8')).replace(/\r\n/g,'\n');
      const start=contents.indexOf('      <TeacherMessages />');
      const bank='<div className="rounded-[2rem] border border-slate-100 bg-white p-8 shadow-lg">';
      const end=contents.indexOf(bank,start);
      if(start<0||end<start)throw new Error('Review web evidence access section');
      contents=contents.slice(0,start)+'      <PortalPanel inline />\n      '+contents.slice(end);
      contents=contents.replace(bank,bank.replace('<div ','<div data-web-unavailable="" '));
      const remoteStart=contents.indexOf('  useEffect(() => {\n    let active = true;\n    let refreshing = false;');
      const remoteEnd='  }, [remoteAccess.enabledByTeacher, remoteOperation]);';
      const remoteStop=contents.indexOf(remoteEnd,remoteStart);
      if(remoteStart<0||remoteStop<0)throw new Error('Review desktop tunnel polling isolation');
      contents=contents.slice(0,remoteStart)+contents.slice(remoteStop+remoteEnd.length);
      const poll=/  useEffect\(\(\) => \{\n    let reading = false;[\s\S]*?\n  \}, \[\]\);/;
      if(!poll.test(contents)||!contents.includes('    void loadSecondaryData();'))throw new Error('Review unmigrated file service isolation');
      contents=contents.replace(poll,'').replace('    void loadSecondaryData();','');
      return {contents:"import {PortalPanel} from 'armi-web-portal';\n"+contents,loader:'tsx',resolveDir:path.dirname(args.path)};
    });
    bundler.onLoad({filter:/[\\/]instruments[\\/]EvaluationInstrumentsView\.tsx$/},async args=>{
      let contents="import {getWebIdentity as getArmiInstrumentIdentity} from 'armi-web-runtime';\n"+await readFile(args.path,'utf8');
      const marker='<div className="space-y-6">';
      const mapping='id: r.id,';
      const payload='id: editor.id,';
      for(const text of [marker,mapping,payload,'const saveEditor = async () => {','<button onClick={saveEditor}'])if(!contents.includes(text))throw new Error('Review instruments web adapter: '+text);
      contents=contents.replace(marker,'<div data-armi-web-editor="instruments" className="space-y-6">');
      contents=contents.replace(mapping,mapping+'\n          webRevision: r.webRevision,');
      contents=contents.replace(payload,payload+'\n      webRevision: (editor as any).webRevision,');
      contents=contents.replace('const currentYear =',"const [savingWeb,setSavingWeb]=useState(false);const savingWebRef=React.useRef(false);\n  const currentYear =");
      contents=contents.replace('const saveEditor = async () => {','const saveEditor = async () => {\n    if(savingWebRef.current)return;');
      contents=contents.replace('const res = await saveInstrumento(payload);','savingWebRef.current=true;setSavingWeb(true);\n      const res = await saveInstrumento(payload);');
      const ending="showToast('Error de conexión al guardar');";
      if(!contents.includes(ending))throw new Error('Review instrument save acknowledgement');
      const location=contents.indexOf(ending),end=contents.indexOf('    }',location);
      contents=contents.slice(0,end)+contents.slice(end).replace('    }','    } finally {savingWebRef.current=false;setSavingWeb(false);}');
      contents=contents.replace('<button onClick={saveEditor}','<button disabled={savingWeb} aria-busy={savingWeb} onClick={saveEditor}');
      contents=contents.replace('await deleteInstrumento(id)','await deleteInstrumento(id,(instruments.find(row=>row.id===id) as any)?.webRevision)');
      contents=contents.replace('{toast && (','<p className="rounded-xl border border-slate-200 p-3 text-sm">{getArmiInstrumentIdentity()?.academic?.instrumentsEditable ? "Esta biblioteca contiene los instrumentos creados en la web." : "El administrador debe activar el guardado de Instrumentos en la base de datos web."}</p>{toast && (');
      return {contents,loader:'tsx',resolveDir:path.dirname(args.path)};
    });
    bundler.onLoad({filter:/[\\/]components[\\/](AnnualProgramView|UnitsView|SessionsView)\.tsx$/}, async args => {
      let contents = await readFile(args.path,'utf8');
      const name = path.basename(args.path,'.tsx');
      contents="import {WebAISettings} from 'armi-web-ai-settings';\nimport {webOpenAIResponse} from 'armi-web-ai';\n"+contents.replaceAll('<AuthOverlay','<WebAISettings').replaceAll("fetch('https://api.openai.com/v1/responses',", "webOpenAIResponse('https://api.openai.com/v1/responses',");
      if(name==='SessionsView') {
        contents="import {EvaluationGate,evaluationBlocked,clearEvaluationPending} from 'armi-web-evaluation';\n"+contents.replace(/\r\n/g,'\n');
        const pollStart=contents.indexOf('        const refresh = () => { void loadGradingRecords(); };');
        const pollEnd=contents.indexOf('\n    }, [sessionMode, currentSessionId, serializeGradingRecords]);',pollStart);
        if(pollStart<0||pollEnd<0)throw new Error('Review grading polling isolation');
        contents=contents.slice(0,pollStart)+'        return () => { cancelled = true; };'+contents.slice(pollEnd);
        const autosave="if (sessionMode !== 'calificacion' || !currentSessionId || gradingLoading) return;";
        if(!contents.includes(autosave))throw new Error('Review grading autosave guard');
        contents=contents.replace(autosave,"if (evaluationBlocked() || sessionMode !== 'calificacion' || !currentSessionId || gradingLoading) return;");
        contents=contents.replace('if (snapshot === gradingAutosaveRef.current.lastSaved || gradingAutosaveRef.current.saving) return;','if(gradingAutosaveRef.current.saving)return;if(snapshot===gradingAutosaveRef.current.lastSaved){clearEvaluationPending("grades:"+currentSessionId);return;}');
        const panelStart=contents.indexOf('            <SessionRegisterPanel'),panelEnd=contents.indexOf('\n            />',panelStart);
        if(panelStart<0||panelEnd<0)throw new Error('Review grading panel wrapper');
        contents=contents.slice(0,panelStart)+'            <EvaluationGate required={["grades:"+currentSessionId]}>'+contents.slice(panelStart,panelEnd+15)+'</EvaluationGate>'+contents.slice(panelEnd+15);
        contents=contents.replace('handleSave={handleSave}','handleSave={sessionMode === "calificacion" ? async()=>{if(!await handleSaveGrading())throw new Error("No se pudo guardar la calificación.");} : handleSave}');
        contents=contents.replace('} = useSessionGradingPersistence({','} = useSessionGradingPersistence({\n        webSessionMode:sessionMode,');
        contents=contents.replace("const apiKey = (generalData?.gemini_api_key || process.env.API_KEY || '').trim();","const apiKey = (generalData?.ai_provider === 'openai' ? generalData?.openai_api_key || '' : generalData?.gemini_api_key || '').trim();");
        contents=contents.replace("const preferredGeminiModel = String(generalData?.gemini_model || '').trim();","const preferredGeminiModel = String(generalData?.ai_provider === 'openai' ? generalData?.openai_model || '' : generalData?.gemini_model || '').trim();");
        contents=contents.replace('const updated = { ...generalData, gemini_api_key: key, gemini_model: model };',"const updated = {...generalData,...(key.includes('openai') ? {ai_provider:'openai',openai_api_key:key,openai_model:model} : {ai_provider:'gemini',gemini_api_key:key,gemini_model:model})};");
        contents=contents.replace("registerAiUsage('gemini', 'learning_session'","registerAiUsage(generalData?.ai_provider || 'gemini', 'learning_session'");
      }
      const dataset = {AnnualProgramView:'annual',UnitsView:'units',SessionsView:'sessions'}[name];
      if (name === 'AnnualProgramView') {
        const marker = /return \(\s*<>\s*\{toast &&/;
        if (!marker.test(contents)) throw new Error('Review annual planning web editor');
        contents = contents.replace(marker,`return (<div data-armi-web-editor="${dataset}">{toast &&`);
        const lastFragment = contents.lastIndexOf('</>');
        if (lastFragment < 0) throw new Error('Missing annual editor closing fragment');
        contents = contents.slice(0,lastFragment) + '</div>' + contents.slice(lastFragment+3);
        contents = contents.replaceAll('Sincronización Año','Guardado web Año');
      } else {
        const marker = '<div className="animate-fade-in pb-20 space-y-6 relative">';
        if (!contents.includes(marker)) throw new Error(`Review ${dataset} planning web editor`);
        contents = contents.replace(marker,`<div data-armi-web-editor="${dataset}" className="animate-fade-in pb-20 space-y-6 relative">`);
      }
      contents = contents.replaceAll('Unidad Sincronizada.','Unidad guardada en la web.');
      return {contents,loader:'tsx',resolveDir:path.dirname(args.path)};
    });
    bundler.onLoad({filter:/[\\/]registers[\\/]RegisterConsolidationView\.tsx$/},async args=>{
      let contents="import {EvaluationGate,useWebConclusionAutosave} from 'armi-web-evaluation';\n"+(await readFile(args.path,'utf8')).replace(/\r\n/g,'\n');
      const marker='    <div className="space-y-6">',start=contents.lastIndexOf(marker),end=contents.lastIndexOf('</div>');
      if(start<0||end<start)throw new Error('Review consolidated register wrapper');
      contents=contents.slice(0,end+6)+'</EvaluationGate>'+contents.slice(end+6);
      contents=contents.slice(0,start)+'    <EvaluationGate required={["all-grades","conclusions:"+conclusionQueryKey]}>'+contents.slice(start);
      const saveStart=contents.indexOf('  useEffect(() => {\n    if (!conclusionsHydrated || hydratedConclusionsScope !== conclusionQueryKey || !year');
      const recordsStart=contents.indexOf('      const records = ',saveStart),recordsEnd=contents.indexOf('\n\n      try {',recordsStart);
      const saveEnd=contents.indexOf('\n  const getAggregatedCompetencyCode',recordsEnd);
      if(saveStart<0||recordsStart<0||recordsEnd<0||saveEnd<0)throw new Error('Review conclusion autosave isolation');
      const expression=contents.slice(recordsStart+'      const records = '.length,recordsEnd).trim().replace(/;$/,'');
      contents=contents.slice(0,saveStart)+`  useWebConclusionAutosave(conclusionQueryKey,${expression},conclusionsHydrated && hydratedConclusionsScope===conclusionQueryKey && Boolean(year && areaId && grade && section && conclusionScopeValue));\n`+contents.slice(saveEnd);
      contents=contents.replace('if (key && text) acc[key] = text;','if (key) acc[key] = text;');
      contents=contents.replace("const apiKey = String(generalData?.gemini_api_key || process.env.API_KEY || '').trim();","const apiKey = String(generalData?.ai_provider === 'openai' ? generalData?.openai_api_key || '' : generalData?.gemini_api_key || '').trim();");
      contents=contents.replace("String(generalData?.gemini_model || '').trim()","String(generalData?.ai_provider === 'openai' ? generalData?.openai_model || '' : generalData?.gemini_model || '').trim()");
      contents=contents.replaceAll('Modo de prueba','Detalle de sesiones').replaceAll('Tabla de jalado desde sesiones','Notas de las sesiones');
      return {contents,loader:'tsx',resolveDir:path.dirname(args.path)};
    });
    bundler.onLoad({filter:/[\\/]evaluation[\\/](UnitRegisterView|BimesterRegisterView)\.tsx$/},async args=>{
      const description=args.path.includes('UnitRegisterView')?'Consulta las notas de las sesiones de esta unidad y redacta conclusiones por competencia.':'Consulta las notas de este bimestre y redacta conclusiones por competencia.';
      const contents=(await readFile(args.path,'utf8')).replace(/description="[^"]*"/,`description="${description}"`);
      return {contents,loader:'tsx',resolveDir:path.dirname(args.path)};
    });
    bundler.onLoad({filter:/[\\/]sessions-view[\\/]useSessionGradingPersistence\.ts$/},async args=>{
      let contents=(await readFile(args.path,'utf8')).replace(/\r\n/g,'\n');
      contents="import {useEffect,useRef} from 'react';\nimport {evaluationBlocked,evaluationPending,markEvaluationPending} from 'armi-web-evaluation';\n"+contents;
      contents=contents.replace('    currentSessionId,','    webSessionMode,\n    currentSessionId,');
      contents=contents.replace('interface UseSessionGradingPersistenceParams {','interface UseSessionGradingPersistenceParams {\n    webSessionMode?:string;');
      const keyLine='        const key = getGradingKey(studentId, criteriaId);';
      if(!contents.includes(keyLine))throw new Error('Review grade change marker');
      contents=contents.replace(keyLine,keyLine+'\n        if((patch.level!==undefined && patch.level!==(gradingRecords[key]?.level||"")) || (patch.observation!==undefined && patch.observation!==(gradingRecords[key]?.observation||"")))markEvaluationPending("grades:"+currentSessionId);');
      const marker='    return {\n        getGradingKey,';
      if(!contents.includes(marker))throw new Error('Review grade navigation flush');
      contents=contents.replace(marker,'    const saves=useRef(new Map());saves.current.set(currentSessionId,handleSaveGrading);\n    useEffect(()=>()=>{if(webSessionMode==="calificacion" && evaluationPending("grades:"+currentSessionId) && !evaluationBlocked())void saves.current.get(currentSessionId)?.({silent:true});},[currentSessionId,webSessionMode]);\n'+marker);
      return {contents,loader:'ts',resolveDir:path.dirname(args.path)};
    });
    bundler.onLoad({filter:/[\\/]components[\\/](AreasGradosView|CalendarView|ScheduleView)\.tsx$/},async args=>{
      let contents=await readFile(args.path,'utf8');
      const name=path.basename(args.path,'.tsx');
      const markers=name==='AreasGradosView'?['animate-fade-in flex flex-col h-full space-y-8','animate-fade-in relative flex flex-col h-full space-y-6']:name==='CalendarView'?['relative select-none pb-20','calendar-ie-print-sheet relative animate-fade-in bg-white p-6']:['animate-fade-in pb-12 select-none relative schedule-print-page'];
      for(const marker of markers) {
        const source=`<div className="${marker}`;
        if(!contents.includes(source))throw new Error(`Review configuration web editor: ${name}`);
        contents=contents.replace(source,`<div data-armi-web-editor="settings" className="${marker}`);
      }
      if(name==='AreasGradosView') {
        const call="await updateModuleStatus('areas_grados', newAssigns.length > 0);";
        if(!contents.includes(call))throw new Error('Review assignment save acknowledgement');
        contents=contents.replace(call,`const result=${call.slice(0,-1)};if(!result.success){showToast(result.message || 'No se pudo guardar en la web.','error');return false;}`);
        contents=contents.replace('            onSuccess();\r\n        } catch (e) {','            onSuccess();return true;\r\n        } catch (e) {').replace('            onSuccess();\n        } catch (e) {','            onSuccess();return true;\n        } catch (e) {');
        for(const call of ['await saveAssignmentsToLocal(updated);','await saveAssignmentsToLocal([...assignments, newItem]);'])contents=contents.replace(call,`if(!${call.slice(6,-1)}){setLoading(false);setSaving(false);return;}`.replace('!saveAssignmentsToLocal','!await saveAssignmentsToLocal'));
        contents=contents.replace('const confirmDeleteArea = () => {','const confirmDeleteArea = async () => {').replace('saveAssignmentsToLocal(assignments.filter(a => a.areaId !== confirmDeleteAreaId));','if(!await saveAssignmentsToLocal(assignments.filter(a => a.areaId !== confirmDeleteAreaId)))return;');
        contents=contents.replace('const confirmDeleteAssignment = () => {','const confirmDeleteAssignment = async () => {').replace('saveAssignmentsToLocal(assignments.filter(a => a.id !== confirmDeleteAssignmentId));','if(!await saveAssignmentsToLocal(assignments.filter(a => a.id !== confirmDeleteAssignmentId)))return;');
        contents=contents.replaceAll('Área agregada correctamente','Área añadida. Guardado web pendiente.');
      }
      if(name==='CalendarView')contents=contents.replaceAll('✅ ¡Planificación sincronizada y módulo desbloqueado!','Calendario guardado en la web.');
      if(name==='ScheduleView') {
        const call="await updateModuleStatus('horario', entries.length > 0);";
        if(!contents.includes(call))throw new Error('Review timetable save acknowledgement');
        contents=contents.replace(call,`const result=${call.slice(0,-1)};if(!result.success)throw new Error(result.message || 'No se pudo guardar el horario.');`);
      }
      return {contents,loader:'tsx',resolveDir:path.dirname(args.path)};
    });
    bundler.onLoad({filter:/[\\/]sessions-view[\\/]SessionActions\.tsx$/}, async args => {
      let contents = await readFile(args.path,'utf8');
      const marker = ".filter(action => action.id !== 'clear' || !!props.onClear)";
      if (!contents.includes(marker)) throw new Error('Review planning actions for web');
      contents = "import {getWebIdentity as getArmiWebIdentity} from 'armi-web-runtime';\n" + contents.replace(marker, marker + ".map(action => ({...action,disabled:action.disabled || !getArmiWebIdentity()?.academic?.planningEditable || action.id==='template'}))");
      return {contents,loader:'tsx',resolveDir:path.dirname(args.path)};
    });
    bundler.onLoad({filter:/[\\/]sessions-view[\\/]SessionManager\.tsx$/}, async args => {
      const contents = (await readFile(args.path,'utf8')).replace(/return createPortal\(\s*<div /,'return createPortal(<div data-armi-web-editor="sessions" ');
      if (!contents.includes('data-armi-web-editor="sessions"')) throw new Error('Review saved session manager for web');
      return {contents,loader:'tsx',resolveDir:path.dirname(args.path)};
    });
    bundler.onLoad({filter:/[\\/]sessions-view[\\/]SessionLearningResources\.tsx$/}, async args => {
      let contents = await readFile(args.path,'utf8');
      // These resources depend on desktop-generated files and Drive. Keep them
      // in consultation while enabling the authored lesson text around them.
      const index = contents.indexOf('    return (');
      const tail = contents.slice(index).replace(/(return \(\s*<>\s*)<div /,'$1<div data-web-unavailable="" ');
      contents = contents.slice(0,index)+tail;
      if (index < 0 || !contents.includes('data-web-unavailable')) throw new Error('Review web learning resources');
      return {contents,loader:'tsx',resolveDir:path.dirname(args.path)};
    });
    bundler.onLoad({ filter: /[\\/]index\.css$/ }, async args => {
      if (path.resolve(args.path) !== absolute('index.css')) return;
      const cssPath = value => value.replace(/\\/g, '/');
      let css = await readFile(args.path, 'utf8');
      css = css.replace('@import "tailwindcss";', `@import "${cssPath(path.join(web, 'node_modules/tailwindcss/index.css'))}" source(none);\n@source "${cssPath(absolute('App.tsx'))}";\n@source "${cssPath(absolute('components'))}";\n@source "${cssPath(path.join(web, 'frontend'))}";`);
      for (const file of ['react-quill-new/dist/quill.snow.css', 'quill/dist/quill.bubble.css']) css = css.replace(`"${file}"`, `"${cssPath(path.join(web, 'node_modules', file))}"`);
      const result = await postcss([tailwind({ base: repo, optimize: true })]).process(css, { from: args.path, map: false });
      return { contents: result.css, loader: 'css', resolveDir: path.dirname(args.path) };
    });
  },
};
await build({
  absWorkingDir: web, entryPoints: [{ in: 'frontend/entry.tsx', out: 'web' },{in:'frontend/student-entry.tsx',out:'student'}],
  outdir: path.join(out, 'assets'), assetNames: '[name]-[hash]', chunkNames: 'chunks/[name]-[hash]',
  publicPath: '/assets',
  bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022',
  jsx: 'automatic', minify: true, alias, plugins: [originalSource],
  loader: Object.fromEntries(['.png', '.jpg', '.jpeg', '.svg', '.ico', '.gif', '.woff', '.woff2', '.ttf'].map(extension => [extension, 'file'])),
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.API_KEY': '""', 'process.env.GEMINI_API_KEY': '""', __APP_VERSION__: JSON.stringify(desktopPkg.version) },
  metafile: true,
}).then(async result => {
  // Evidencia de qué componentes originales entraron en la compilación; no se publica.
  await writeFile(path.join(web, '.web-build-inputs.json'), JSON.stringify(Object.keys(result.metafile.inputs), null, 2));
});
await copyFile(path.join(web, 'public/index.html'), path.join(out, 'index.html'));
await copyFile(path.join(web, 'public/student.html'), path.join(out, 'student.html'));
await copyFile(path.join(web, 'public/_headers'), path.join(out, '_headers'));
await copyFile(path.join(web, 'public/curriculum.json'), path.join(out, 'curriculum.json'));
await copyFile(absolute('src/Logo_bar.ico'), path.join(out, 'favicon.ico'));
console.log('Built original App.tsx and desktop screens with isolated web adapters. Desktop sources were not modified.');
