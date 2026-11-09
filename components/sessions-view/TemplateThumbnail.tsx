import React from 'react';
export function TemplateThumbnail({ html, title, onClick }: {html?:string;title:string;onClick?:()=>void}) {
    return <button type="button" onClick={onClick} aria-label={`Vista previa: ${title}`} className="relative h-[90px] w-[128px] shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-slate-400">
        {html ? <iframe title={`Miniatura: ${title}`} sandbox="" loading="lazy" tabIndex={-1} srcDoc={html} style={{position:'absolute',top:0,left:0,display:'block',width:960,height:675,transform:'scale(0.1333)',transformOrigin:'top left',pointerEvents:'none',border:0,background:'white'}}/> : <span className="text-[10px] font-bold">Sin plantilla HTML</span>}
        <span className="absolute inset-0" aria-hidden="true"/>
    </button>;
}
