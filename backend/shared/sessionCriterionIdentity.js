import { reconcileSessionCapacities } from './sessionCapacityReconciliation.js';

const normalize = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.\s]+/g, ' ').trim();
const fields = row => [row?.competencyName || row?.competencia || row?.comp,
  row?.capacityName || row?.capacidad || row?.cap, row?.criterionText || row?.criterio].map(normalize);
const source = row => String(row?.source || '').trim();
const sameIdentity = (left, right) => {
  const a=fields(left), b=fields(right);
  return a.every(Boolean) && b.every(Boolean) && a.every((value,index)=>value===b[index])
    && (!source(left)||!source(right)||source(left)===source(right));
};
const compatible = (left, right) => {
  const a=fields(left), b=fields(right);
  return a.every((value,index)=>!value||!b[index]||value===b[index])
    && (!source(left)||!source(right)||source(left)===source(right));
};
export const sessionCriterionScopeMatches = (left, right) => {
  const a=fields(left),b=fields(right);
  return a.slice(0,2).every((value,index)=>!value||!b[index]||value===b[index])
    && (!source(left)||!source(right)||source(left)===source(right));
};

export const findSessionInstrumentRow = (row, rows, index, canonical) => {
  const matches=rows.filter(item=>sameIdentity(row,item));
  const exact=matches.filter(item=>String(item.id)===String(row.id));
  if(exact.length===1)return exact[0];
  if(matches.length===1)return matches[0];
  if(matches.length>1)return undefined;
  const identity=fields(row);
  const sameCriterion=rows.filter(item=>{
    const other=fields(item);
    return identity[0]&&identity[2]&&identity[0]===other[0]&&identity[2]===other[2]
      && (!source(row)||!source(item)||source(row)===source(item));
  });
  // Planning may have corrected a capacity label while retaining the exact
  // competency and criterion. Preserve that uniquely identified instrument ID.
  if(sameCriterion.length===1)return sameCriterion[0];
  const explicit=rows.filter(item=>String(item.id)===String(row.id));
  if(explicit.length===1&&sessionCriterionScopeMatches(row,explicit[0]))return explicit[0];
  // Legacy numeric/unlabelled rows may use order only when the complete tables
  // align and no competency or capacity contradicts that alignment.
  if(rows.length===canonical.length&&canonical.every((item,i)=>sessionCriterionScopeMatches(item,rows[i])))return rows[index];
  return undefined;
};

// Resolve references for reading only. Never move, replace or manufacture grades.
// The instrument is also used by the session grading screen; IDs can outlive
// an older assessment snapshot or change order independently of that snapshot.
export const resolveSessionCriterionRows = (data, rows) => {
  const repaired=reconcileSessionCapacities({...data,sessionAssessmentModel:{...data?.sessionAssessmentModel,rows}});
  const canonical=repaired.sessionAssessmentModel.rows;
  const instrument=Array.isArray(repaired.instrumento)?repaired.instrumento:[];
  const legacyAligned=instrument.length===canonical.length&&canonical.every((row,index)=>sessionCriterionScopeMatches(row,instrument[index]));
  const resolved=canonical.map((row,index)=>{
    const originalId=String(row.id || '').trim();
    const matches=instrument.filter(item=>String(item.id || '').trim() && sameIdentity(row,item));
    const exact=matches.filter(item=>String(item.id)===originalId);
    const selected=exact.length===1?exact[0]:matches.length===1?matches[0]:null;
    const id=selected?String(selected.id):originalId;
    const safeAlias=alias=>{
      if(!alias)return false;
      // A stable explicit ID remains valid when only the wording of an old
      // instrument differs. Change it only when a full identity proves the link.
      if(!selected&&alias===originalId)return !canonical.some((other,otherIndex)=>otherIndex!==index&&String(other.id)===alias);
      const holders=instrument.filter(item=>String(item.id)===alias);
      if(holders.some(item=>!compatible(row,item)))return false;
      if(holders.length===1&&sameIdentity(row,holders[0]))return true;
      return !canonical.some((other,otherIndex)=>otherIndex!==index&&String(other.id)===alias&&!sameIdentity(row,other));
    };
    // Multiple indistinguishable instruments without an exact ID are ambiguous.
    const ambiguous=matches.length>1&&!selected;
    const legacyId=legacyAligned?String(instrument[index]?.id || ''):'';
    const recordIds=ambiguous?[]:[...new Set([id,originalId,String(index+1)].filter(safeAlias))];
    if(!ambiguous&&legacyId&&legacyAligned&&!recordIds.includes(legacyId)&&sessionCriterionScopeMatches(row,instrument[index])&&!canonical.some((other,i)=>i!==index&&String(other.id)===legacyId))recordIds.push(legacyId);
    return {...row,id,recordIds};
  });
  const owners=new Map();
  resolved.forEach((row,index)=>row.recordIds.forEach(id=>{if(!owners.has(id))owners.set(id,new Set());owners.get(id).add(index);}));
  return resolved.map(row=>({...row,recordIds:row.recordIds.filter(id=>owners.get(id).size===1)}));
};
