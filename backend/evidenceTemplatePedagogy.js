const plain=value=>String(value || '').replace(/<br\s*\/?>|<\/(?:p|li|div)>/gi,'\n').replace(/<[^>]*>/g,'')
  .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'")
  .replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
const key=value=>plain(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function templatePedagogyContext(data={}) {
  const sequence=data.secuencia || {};
  const stored=data.sessionAssessmentModel?.rows?.length?data.sessionAssessmentModel.rows:data.assessmentModel?.rows || [];
  const rows=stored.length?stored:[{...(data.competenciaPrio || {}),source:'primary'},...(data.competenciasTrans || []).map(row=>({...row,source:'transversal'}))];
  return {title:plain(data.title),purpose:plain(data.purpose),situation:plain(data.situation),
    plannedActivities:[['Construcción y trabajo de equipos',sequence.proceso?.construccion],['Aplicación del producto',sequence.proceso?.aplicacion]]
      .filter(([,value])=>plain(value)).map(([label,value])=>({label,text:plain(value)})),
    processTime:plain(sequence.proceso?.tiempo),
    criteria:rows.map(row=>({source:row.source || 'primary',competency:plain(row.competencyName || row.comp),capacity:plain(row.capacityName || row.cap),criterion:plain(row.criterionText || row.des),field:plain(row.fieldText || row.field)})).filter(row=>row.criterion)};
}
export function templateEvidenceBrief(evidence,context={}) {
  const matches=(context.criteria || []).filter(row=>row.source===(evidence.source || 'primary') && key(row.competency)===key(evidence.competency));
  const text=key(evidence.text);
  let layout='Lienzo principal cuya estructura represente exactamente el producto solicitado. Si se nombra una técnica, conserva esa técnica; no la sustituyas por otra.';
  let essentials='Incluye solo campos que permitan comprobar el criterio. Propón el mínimo necesario para trabajar en clase; no agregues tareas previas o posteriores.';
  if(/entrevista/.test(text)){
    layout='Matriz de entrevista: filas para las preguntas y columnas Pregunta / Respuesta registrada / Necesidad detectada. Encima, un único campo breve para el perfil general del usuario, sin datos personales. Comienza con tres filas, salvo que la planificación exija otra cantidad.';
    essentials='La guía debe permitir redactar y aplicar las preguntas. No agregues apartados independientes de planificación, oportunidades, investigación pendiente ni conclusiones extensas. Si la secuencia solo prevé ensayo o guía preliminar, incluye Tipo de registro: Aplicación real / Ensayo de aula, y aclara que el ensayo no acredita una entrevista real. No inventes respuestas ni exijas salir del aula.';
  }else if(/registro.*observ|observ.*campo/.test(text)){
    layout='Lienzo de observación con tres registros y columnas Hecho observado / Necesidad o problema / Sustento observable. Un único campo breve identifica el contexto. Usa casillas alineadas o notas compactas, no tres cuestionarios consecutivos.';
    essentials='Distingue hechos de interpretaciones. No agregues priorización, propuestas de solución ni otra entrevista si no forman parte del producto de esta sesión. Si la planificación dice simular, identifica Observación real / Simulación de aula y nunca presentes una simulación como observación real.';
  }else if(/organiz.*(?:archiv|aplicacion|material|entorno)|capturas.*pantalla/.test(text)){
    layout='Reporte visual de la organización realizada: tres filas de Archivo o material concreto / Ubicación real / Aplicación utilizada / Utilidad y comprobación. Debe documentar acciones ya efectuadas, con nombres y ubicaciones reales del trabajo escolar, sin credenciales ni datos privados.';
    essentials='No lo conviertas en un plan de carpetas que se crearán en el futuro. Si la evidencia admite capturas O reporte, el reporte es válido: conserva la alternativa y no exijas ambas. No afirmes que escribir una intención demuestra haber organizado realmente los archivos.';
  }
  return {criteria:matches,layout,essentials};
}
