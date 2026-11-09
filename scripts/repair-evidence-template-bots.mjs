import fs from 'node:fs';
import path from 'node:path';
import {resolveDevDataRoot} from './dev-data-root.mjs';
import {readPracticeImages} from '../backend/interactiveImageLibrary.js';
import {recommendEvidenceBots} from '../backend/evidenceTemplateBots.js';
import {bindEvidenceTemplateImages} from '../backend/evidenceTemplateImages.js';
import {validateEvidenceTemplate} from '../backend/evidenceTemplateContract.js';
import {parseHTML} from 'linkedom';
const [inputArg,outputArg]=process.argv.slice(2);if(!inputArg || !outputArg)throw new Error('Indica carpeta de origen y una carpeta nueva de destino.');
const input=path.resolve(inputArg),output=path.resolve(outputArg);if(fs.existsSync(output))throw new Error('La carpeta de destino ya existe. Elige otra para conservar las copias.');
const root=resolveDevDataRoot(process.cwd()),library=await readPracticeImages(path.join(root,'uploads/user-assets/practice')),files=[];
for(let i=1;i<=3;i++){
 const name=`evidencia-${i}.html`;let html=fs.readFileSync(path.join(input,name),'utf8');
 const title=[html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1],html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]].filter(Boolean).join(' ') || name;
 const bot=recommendEvidenceBots({text:title.replace(/<[^>]*>/g,'')},library.images.map(image=>image.name));if(!bot.name)throw new Error('No hay estados válidos del bot disponibles.');
 const {document}=parseHTML(html),heading=document.querySelector('header .heading,header .identity');
 if(!heading)throw new Error(`${name}: no se encontró el bloque del título. Añade el marcador del bot manualmente para conservar la composición.`);
 document.querySelectorAll('img[data-armi-image]').forEach(image=>{if(/^bot[_-]/i.test(image.getAttribute('data-armi-image') || ''))image.remove();});
 const wrapper=document.createElement('div'),content=document.createElement('div'),image=document.createElement('img');
 wrapper.setAttribute('style','display:flex;gap:12px;align-items:flex-start;width:100%;min-width:0');content.setAttribute('style','min-width:0;flex:1');
 image.setAttribute('data-armi-image',bot.name);image.setAttribute('alt',`Bot de ARMI: ${bot.reason}`);image.setAttribute('style','width:64px;height:72px;object-fit:contain;flex:0 0 64px');
 while(heading.firstChild)content.append(heading.firstChild);wrapper.append(image,content);heading.append(wrapper);html=document.toString();
 const bound=bindEvidenceTemplateImages(html,library.images),validation=validateEvidenceTemplate(bound);if(!validation.valid)throw new Error(`${name}: ${validation.errors.join(' ')}`);
 files.push({name,html:bound,bot:bot.name});
}
fs.mkdirSync(output,{recursive:true});files.forEach(file=>fs.writeFileSync(path.join(output,file.name),file.html,'utf8'));
fs.writeFileSync(path.join(output,'LEEME.txt'),`Copias de los últimos HTML, con imágenes reales incrustadas desde la biblioteca de ARMI. Los originales se conservaron.\n${files.map(f=>`${f.name}: ${f.bot}`).join('\n')}\nImporta estas copias en la evidencia correspondiente. No se publicaron automáticamente.\n`,'utf8');
console.log(JSON.stringify({folder:output,files:files.map(({name,bot})=>({name,bot}))},null,2));
