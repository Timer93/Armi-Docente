import type {AccessConfig,AccessSnapshot} from './accessControl';

// Merge independent roster changes (such as a newly paired PC) without replacing edits.
export function mergeAccessConfig(base:AccessConfig,draft:AccessConfig,remote:AccessConfig):AccessConfig {
  const result={...remote};
  for(const key of ['groups','devices','rules'] as const){
    const rows=new Map<string,any>(remote[key].map(row=>[row.id,row] as const));
    for(const id of new Set([...base[key],...draft[key]].map(row=>row.id))){
      const before=base[key].find(row=>row.id===id),after=draft[key].find(row=>row.id===id),other=rows.get(id);
      if(JSON.stringify(before)===JSON.stringify(after))continue;
      if(JSON.stringify(other)!==JSON.stringify(before)&&JSON.stringify(other)!==JSON.stringify(after))throw new Error('Este registro cambió en otra ventana. Tus cambios se conservan; recarga para revisarlos.');
      if(after)rows.set(id,after);else rows.delete(id);
    }
    (result[key] as any)=Array.from(rows.values());
  }
  return result;
}
