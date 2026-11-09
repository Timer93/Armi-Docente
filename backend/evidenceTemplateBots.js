export const templateImageKey=value=>String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\.(png|jpe?g|gif|webp|svg)$/,'').replace(/_/g,'-');
export function recommendEvidenceBots(evidence,imageNames=[]) {
  const names=imageNames.filter(name=>/^bot[-_]/i.test(name));
  const text=templateImageKey(evidence.text),competency=templateImageKey(evidence.competency);
  const rules=[
    [/entrevist/,'entrevistar y registrar respuestas',['con-portapapeles','con-lista-de-verificacion','atento']],
    [/observ|campo|investig|indag/,'observar o investigar',['observando-con-lupa','investigando-con-lupa','revisando-con-lupa']],
    [/necesidad|problema|diagnost|empatia/,'identificar necesidades y problemas',['investigando-con-lupa','observando-con-lupa','pensando']],
    [/archiv|aplicacion|entorno.*virtual|carpeta|digital/,'organizar y utilizar recursos digitales',['trabajando-en-computadora','con-carpeta','usando-laptop','con-tablet']],
    [/boceto|dibuj|disen|redact|escri/,'dibujar, diseñar o redactar',['con-lapiz','sosteniendo-lapiz','con-lapiz-gigante']],
    [/lectur|leer|resumen|libro/,'leer y comprender',['leyendo-libro','leyendo-sentado','cargando-libros']],
    [/graf|estad|calculo|costo|presupuesto|matematic/,'analizar datos y cálculos',['exponiendo-graficos','pensando','pensativo']],
    [/plan|lista|verific|evalu|cronograma|metas|objetivos|autorregul|aprendizaje/,'planificar y verificar el trabajo',['con-lista-de-verificacion','mostrando-lista-digital','con-portapapeles']],
    [/idea|propuest|solucion|creativ/,'proponer ideas y soluciones',['con-idea','teniendo-una-idea','pensando']],
  ];
  const rule=rules.find(([pattern])=>pattern.test(text)) || rules.find(([pattern])=>pattern.test(competency));
  const preferences=rule?.[2] || ['presentando','pensando','atento','de-pie-neutral'];
  const ranked=[...new Set([...preferences.flatMap(word=>names.filter(name=>templateImageKey(name)===`bot-${word}`)),...names.filter(name=>/bot-(presentando|pensando|atento|neutral)(\.|$)/.test(templateImageKey(name))),...names])];
  return {name:ranked[0] || '',alternatives:ranked.slice(1,3),reason:rule?.[1] || 'acompañar las instrucciones de esta evidencia'};
}
export function evidenceBotErrors(html,imageNames=[]) {
  const bots=imageNames.filter(name=>/^bot[-_]/i.test(name));
  const known=new Set(imageNames.map(templateImageKey));
  const markup=String(html).replace(/<!--[\s\S]*?-->|<(?:style|template|noscript)\b[^>]*>[\s\S]*?<\/(?:style|template|noscript)>/gi,'');
  const tags=[...markup.matchAll(/<img\b[^>]*>/gi)].map(m=>m[0]);
  const markers=tags.map(tag=>({tag,name:tag.match(/\bdata-armi-image\s*=\s*["']([^"']+)["']/i)?.[1]}));
  const errors=[];
  for(const marker of markers)if(marker.name && !known.has(templateImageKey(marker.name)))errors.push(`La imagen «${marker.name}» no existe en la biblioteca actual de ARMI.`);
  if(bots.length && !markers.some(m=>bots.some(name=>templateImageKey(name)===templateImageKey(m.name)) && !/\s+hidden(?:\s|=|\/?\s*>)|display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:!important\s*)?(?:[;"']|$)/i.test(m.tag)))errors.push('Falta un bot visible de la biblioteca de ARMI. No basta un recuadro bot-slot: incluye una etiqueta img con data-armi-image. Copia el prompt actualizado de esta evidencia.');
  return errors;
}
