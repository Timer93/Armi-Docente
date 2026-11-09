// Textareas, unlike rich-text criteria and activities, must not expose HTML.
const fields = ['title', 'purpose', 'situation', 'extension'];
const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',aacute:'á',eacute:'é',iacute:'í',oacute:'ó',uacute:'ú',ntilde:'ñ',uuml:'ü',Aacute:'Á',Eacute:'É',Iacute:'Í',Oacute:'Ó',Uacute:'Ú',Ntilde:'Ñ',Uuml:'Ü'};
const tags = 'p|div|br|ul|ol|li|strong|b|em|i|u|s|span|font|h[1-6]|blockquote|pre|code|a|table|thead|tbody|tr|td|th|html|body|section|article|hr|script|style';
const tagPattern = new RegExp(`<\\/?(?:${tags})(?=[\\s/>])[^>]*>`, 'gi');

export function sessionPlainText(value) {
  let text = String(value ?? '');
  for(let pass=0;pass<4;pass++) {
    const decoded = text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(match,key)=>{
      if(key[0]!=='#')return entities[key] ?? match;
      const code=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
      return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):match;
    });
    if(decoded===text)break;
    text=decoded;
  }
  // Do not trim ordinary text during editing, or eat comparisons like costo < 20.
  tagPattern.lastIndex=0;
  if(!tagPattern.test(text))return text.replace(/\u00a0/g,' ');
  return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
    .replace(/<!--[\s\S]*?-->/g,'')
    .replace(/<br\b[^>]*>/gi,'\n')
    .replace(/<li\b[^>]*>/gi,'• ')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|tr)\s*>/gi,'\n')
    .replace(tagPattern,'')
    .replace(/[\t \u00a0]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

export function normalizeSessionPlainFields(data) {
  if(!data || typeof data!=='object')return data;
  const result={...data};
  for(const field of fields)if(typeof result[field]==='string')result[field]=sessionPlainText(result[field]);
  return result;
}
