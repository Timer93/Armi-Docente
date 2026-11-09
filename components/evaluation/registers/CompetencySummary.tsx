import React from 'react';
import type { RegisterLevelCode } from './register-types';

export const summarizeCompetencyLevels = (results: Array<{ code?: RegisterLevelCode | ''; pending?: boolean }>) => {
  const counts = { c: 0, b: 0, a: 0, ad: 0, pending: 0, ne: 0 };
  results.forEach(result => {
    if (result.pending) counts.pending += 1;
    else if (result.code === 'c' || result.code === 'b' || result.code === 'a' || result.code === 'ad') counts[result.code] += 1;
    else counts.ne += 1;
  });
  return {
    ...counts,
    approved: counts.b + counts.a + counts.ad,
    failed: counts.c,
    missing: counts.pending + counts.ne,
    evaluated: counts.c + counts.b + counts.a + counts.ad,
  };
};

type SummaryEntry = {
  key: string;
  name: string;
  colorClass?: string;
  counts: ReturnType<typeof summarizeCompetencyLevels>;
};

export const CompetencySummary: React.FC<{ rows: SummaryEntry[] }> = ({ rows }) => (
  <div className="mt-3 max-w-[740px] overflow-x-auto rounded-xl border border-slate-200 bg-white print:hidden">
    <table className="w-full min-w-[520px] table-fixed border-collapse text-[11px] leading-tight">
      <caption className="px-3 py-1.5 text-left text-[10px] font-bold text-slate-600">Resumen por competencia</caption>
      <thead className="border-y border-slate-200 bg-slate-50 text-[10px] text-slate-600">
        <tr>
          <th scope="col" className="w-[46%] px-3 py-1.5 text-left font-bold">Competencia</th>
          <th scope="col" className="px-3 py-1.5 text-center font-bold">
            Aprobados <span className="block text-[9px] font-medium">B · A · AD</span>
          </th>
          <th scope="col" className="px-3 py-1.5 text-center font-bold">
            Desaprobados <span className="block text-[9px] font-medium">C</span>
          </th>
          <th scope="col" className="px-3 py-1.5 text-center font-bold">
            Sin nota <span className="block text-[9px] font-medium">Pend. / NE</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, name, counts, colorClass }) => {
          const approvedDetail = `B: ${counts.b} · A: ${counts.a} · AD: ${counts.ad}`;
          const missingDetail = `Pendientes: ${counts.pending} · NE o sin registro: ${counts.ne}`;
          return (
            <tr key={key} className="border-b border-slate-100 last:border-b-0">
              <th scope="row" title={name} className={`px-3 py-1.5 text-left font-semibold ${colorClass || 'bg-slate-700 text-white'}`}><span className="block truncate">{name}</span></th>
              <td className="bg-emerald-50/50 px-3 py-1.5 text-center font-black tabular-nums text-emerald-700">
                <span tabIndex={0} title={approvedDetail} aria-label={`Aprobados: ${counts.approved}. ${approvedDetail}`} className="cursor-help rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">{counts.approved}</span>
              </td>
              <td className="bg-rose-50/50 px-3 py-1.5 text-center font-black tabular-nums text-rose-700" title={`C: ${counts.c}`}>{counts.failed}</td>
              <td className="px-3 py-1.5 text-center font-bold tabular-nums text-slate-500">
                <span tabIndex={0} title={missingDetail} aria-label={`Sin nota: ${counts.missing}. ${missingDetail}`} className="cursor-help rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500">{counts.missing}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
