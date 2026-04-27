import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer, LabelList } from 'recharts';
import { Student, SummaryStat, EvaluationLevel } from '../types';
import { LEVEL_COLORS } from '../constants';

interface SummarySectionProps {
  students: Student[];
  competencies: string[];
  grade?: string;
  section?: string;
  labelColor?: string;
}

const CompetencyBlock: React.FC<{
  compName: string;
  students: Student[];
  labelColor: string;
}> = ({ compName, students, labelColor }) => {
  const stats = useMemo(() => {
    const total = students.length || 1;
    const counts: Record<EvaluationLevel, number> = {
      [EvaluationLevel.AD]: 0,
      [EvaluationLevel.A]: 0,
      [EvaluationLevel.B]: 0,
      [EvaluationLevel.C]: 0,
      [EvaluationLevel.NE]: 0
    };

    students.forEach((s) => {
      const evalObj = s.evaluations?.[compName];
      const val = evalObj?.level || EvaluationLevel.NE;
      counts[val]++;
    });

    return Object.entries(counts).map(([level, count]) => ({
      level: level as EvaluationLevel,
      count,
      percentage: Math.round((count / total) * 100),
      color: LEVEL_COLORS[level as EvaluationLevel]
    })) as SummaryStat[];
  }, [students, compName]);

  const totalCount = stats.reduce((acc, curr) => acc + curr.count, 0);

  return (
    <div className="bg-slate-50/50 border border-slate-200 rounded-[2.5rem] p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col break-inside-avoid print:break-inside-avoid-page print:shadow-none print:border-slate-300 print:rounded-2xl print:mb-6">
      <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-start gap-2 h-10 overflow-hidden">
        <span className="w-1.5 h-4 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: labelColor }}></span>
        <span className="text-slate-800 line-clamp-2 leading-tight">{compName}</span>
      </h3>

      <div className="flex flex-col lg:flex-row gap-6 print:flex-row">
        <div className="w-full lg:w-1/2 print:w-[60%]">
          <div
            className="text-white text-center font-black py-1.5 mb-0 uppercase text-[8px] rounded-t-xl shadow-sm tracking-widest"
            style={{ backgroundColor: labelColor }}
          >
            Logro Alcanzado
          </div>
          <table className="w-full text-[10px] border-collapse bg-white shadow-sm rounded-b-xl overflow-hidden border-hidden">
            <thead>
              <tr className="bg-gray-50 font-black text-gray-400 uppercase text-[7px]">
                <th className="p-1.5 border border-gray-100">NL</th>
                <th className="p-1.5 border border-gray-100">Cant.</th>
                <th className="p-1.5 border border-gray-100">%</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((stat) => (
                <tr key={stat.level} className="text-center h-7 hover:bg-gray-50 transition-colors">
                  <td className="font-black border border-gray-100 text-white text-[9px]" style={{ backgroundColor: stat.color }}>
                    {stat.level}
                  </td>
                  <td className="border border-gray-100 font-black" style={{ color: stat.color }}>{stat.count}</td>
                  <td className="border border-gray-100 font-bold text-gray-400">{stat.percentage}%</td>
                </tr>
              ))}
              <tr className="font-black bg-slate-100 h-8">
                <td className="p-1 border border-gray-100 text-slate-600 uppercase text-[8px]">TOTAL</td>
                <td className="p-1 border border-gray-100 text-slate-700">{totalCount}</td>
                <td className="p-1 border border-gray-100 text-slate-700">100%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="w-full lg:w-1/2 bg-white border border-slate-100 rounded-2xl p-4 shadow-inner min-h-[200px] flex flex-col print:w-[40%] print:min-h-[220px] print:break-inside-avoid-page">
          <div className="text-[8px] font-black text-center text-slate-300 mb-4 uppercase tracking-[0.2em]">
            Visualizacion de Datos
          </div>
          <div className="flex-1 min-h-[180px] print:min-h-[180px]">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={stats} margin={{ top: 20, right: 5, left: -30, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="level"
                  stroke="#94a3b8"
                  fontSize={9}
                  tickLine={false}
                  axisLine={{ stroke: '#f1f5f9' }}
                  dy={5}
                />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={9}
                  tickLine={false}
                  axisLine={{ stroke: '#f1f5f9' }}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontSize: '9px', borderRadius: '10px' }}
                  cursor={{ fill: '#f8fafc' }}
                />
                <Bar dataKey="count" radius={[3, 3, 0, 0]} barSize={28} animationDuration={1000}>
                  {stats.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                  <LabelList
                    dataKey="count"
                    position="top"
                    style={{ fill: '#64748b', fontSize: '10px', fontWeight: 'bold' }}
                    offset={5}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

const SummarySection: React.FC<SummarySectionProps> = ({ students, competencies, grade = '', section = '', labelColor = '#8b6d00' }) => {
  if (competencies.length === 0) return null;

  const [copied, setCopied] = useState(false);
  const [firstCompetency, ...restCompetencies] = competencies;

  const summaryRows = useMemo(() => {
    return competencies.map((compName) => {
      const total = students.length || 1;
      const counts: Record<EvaluationLevel, number> = {
        [EvaluationLevel.AD]: 0,
        [EvaluationLevel.A]: 0,
        [EvaluationLevel.B]: 0,
        [EvaluationLevel.C]: 0,
        [EvaluationLevel.NE]: 0
      };

      students.forEach((student) => {
        const evalObj = student.evaluations?.[compName];
        const val = evalObj?.level || EvaluationLevel.NE;
        counts[val]++;
      });

      const ordered = [EvaluationLevel.NE, EvaluationLevel.C, EvaluationLevel.B, EvaluationLevel.A, EvaluationLevel.AD].map((level) => ({
        level,
        count: counts[level],
        percentage: Math.round((counts[level] / total) * 100)
      }));

      return {
        competencia: compName,
        total: students.length,
        ordered
      };
    });
  }, [competencies, students]);

  const buildPlainTextTable = () => {
    const rows = summaryRows.map((row) => {
      const values = new Map(row.ordered.map((item) => [item.level, item]));
      return [
        grade || '',
        section || '',
        String(row.total),
        row.competencia,
        String(values.get(EvaluationLevel.NE)?.count ?? 0),
        `${values.get(EvaluationLevel.NE)?.percentage ?? 0}%`,
        String(values.get(EvaluationLevel.C)?.count ?? 0),
        `${values.get(EvaluationLevel.C)?.percentage ?? 0}%`,
        String(values.get(EvaluationLevel.B)?.count ?? 0),
        `${values.get(EvaluationLevel.B)?.percentage ?? 0}%`,
        String(values.get(EvaluationLevel.A)?.count ?? 0),
        `${values.get(EvaluationLevel.A)?.percentage ?? 0}%`,
        String(values.get(EvaluationLevel.AD)?.count ?? 0),
        `${values.get(EvaluationLevel.AD)?.percentage ?? 0}%`
      ];
    });
    return rows.map((row) => row.join('\t')).join('\n');
  };

  const buildHtmlTable = () => {
    const escapeHtml = (value: string) =>
      String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const rowsHtml = summaryRows.map((row) => {
      const values = new Map(row.ordered.map((item) => [item.level, item]));
      return `
        <tr>
          <td>${escapeHtml(grade || '')}</td>
          <td>${escapeHtml(section || '')}</td>
          <td>${escapeHtml(String(row.total))}</td>
          <td>${escapeHtml(row.competencia)}</td>
          <td>${escapeHtml(String(values.get(EvaluationLevel.NE)?.count ?? 0))}</td>
          <td>${escapeHtml(`${values.get(EvaluationLevel.NE)?.percentage ?? 0}%`)}</td>
          <td>${escapeHtml(String(values.get(EvaluationLevel.C)?.count ?? 0))}</td>
          <td>${escapeHtml(`${values.get(EvaluationLevel.C)?.percentage ?? 0}%`)}</td>
          <td>${escapeHtml(String(values.get(EvaluationLevel.B)?.count ?? 0))}</td>
          <td>${escapeHtml(`${values.get(EvaluationLevel.B)?.percentage ?? 0}%`)}</td>
          <td>${escapeHtml(String(values.get(EvaluationLevel.A)?.count ?? 0))}</td>
          <td>${escapeHtml(`${values.get(EvaluationLevel.A)?.percentage ?? 0}%`)}</td>
          <td>${escapeHtml(String(values.get(EvaluationLevel.AD)?.count ?? 0))}</td>
          <td>${escapeHtml(`${values.get(EvaluationLevel.AD)?.percentage ?? 0}%`)}</td>
        </tr>
      `;
    }).join('');

    return `<table><tbody>${rowsHtml}</tbody></table>`;
  };

  const handleCopySummary = async () => {
    const plainText = buildPlainTextTable();
    const html = buildHtmlTable();
    try {
      if (navigator.clipboard && 'write' in navigator.clipboard && typeof window !== 'undefined' && 'ClipboardItem' in window) {
        const item = new (window as any).ClipboardItem({
          'text/plain': new Blob([plainText], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' })
        });
        await (navigator.clipboard as any).write([item]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="w-full">
      <div className="print:break-inside-avoid-page">
        <div className="flex items-center justify-between gap-4 mb-8 border-b border-slate-100 pb-4 print:mb-4 print:pb-2">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center text-2xl print:w-9 print:h-9 print:text-lg">📊</div>
            <div className="flex flex-col">
              <h2 className="text-sm font-black text-slate-700 uppercase tracking-[0.3em]">Resumen Estadistico</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCopySummary}
            className="print:hidden shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 shadow-sm hover:border-sky-300 hover:text-sky-700"
            title="Copiar tabla resumen al portapapeles"
          >
            {copied ? 'Copiado' : 'Copiar Tabla'}
          </button>
        </div>

        {firstCompetency && (
          <CompetencyBlock
            key={`summary-first-${firstCompetency}`}
            compName={firstCompetency}
            students={students}
            labelColor={labelColor}
          />
        )}
      </div>

      {restCompetencies.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 print:grid-cols-1 mt-8">
          {restCompetencies.map((comp, idx) => (
            <CompetencyBlock
              key={idx}
              compName={comp}
              students={students}
              labelColor={labelColor}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default SummarySection;
