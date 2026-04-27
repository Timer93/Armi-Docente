import React, { useEffect, useMemo, useState } from 'react';
import { getAllSesiones, getCompetencias, getDatosGenerales, getEstudiantes, getEvaluacionRegistros, getSesion } from '../../../services/apiService';
import { Select } from '../../Select';
import type { GeneralData, Student, TeachingAssignment } from '../../../types';
import { buildBimesterRegisterAggregation, buildUnitRegisterAggregation, inferBimesterLabelFromUnitNumber } from './register-core';
import type { AggregatedRegisterResult, AggregatedStudentRegister, EvaluationRecordRow, RegisterLevelCode, SessionDetailEntry, SessionSummaryEntry } from './register-types';
import { normalizeLoose } from '../../sessions-view/shared';

interface Props {
  mode: 'unit' | 'bimester';
  title: string;
  badge: string;
  accentClassName: string;
  description: string;
}

type CapacityGroup = {
  competencyKey: string;
  competencyName: string;
  source: 'primary' | 'transversal';
  capacities: Array<{ key: string; capacityName: string }>;
};

const LEVEL_LABEL_MAP: Record<string, string> = { c: 'C', b: 'B', a: 'A', ad: 'AD', ne: 'NE', '': '' };
const LEVEL_CELL_TONE_MAP: Record<string, string> = {
  c: 'bg-rose-100 text-rose-700',
  b: 'bg-orange-100 text-orange-700',
  a: 'bg-emerald-100 text-emerald-700',
  ad: 'bg-sky-100 text-sky-700',
  ne: 'bg-slate-900 text-white'
};
const BIMESTER_ORDER = ['I', 'II', 'III', 'IV'] as const;
const UNIT_THEME = { tableTone: 'bg-sky-50', headerDark: 'bg-sky-900 text-white', headerMid: 'bg-sky-600 text-white', headerSoft: 'bg-sky-100 text-sky-900', transHeader: 'bg-emerald-700 text-white', transSoft: 'bg-emerald-100 text-emerald-900', summaryHeader: 'bg-cyan-700 text-white' };
const BIMESTER_THEME = { tableTone: 'bg-amber-50', headerDark: 'bg-amber-900 text-white', headerMid: 'bg-amber-700 text-white', headerSoft: 'bg-amber-100 text-amber-900', transHeader: 'bg-lime-800 text-white', transSoft: 'bg-lime-100 text-lime-900', summaryHeader: 'bg-yellow-700 text-white' };

const resolveStudentRowTone = (estadoValue?: string) => {
  const estado = normalizeLoose(String(estadoValue || ''));
  if (estado === 'r' || estado.includes('retir')) return 'bg-black text-white';
  if (estado === 't' || estado.includes('traslad')) return 'bg-violet-700 text-white';
  if (estado === 'na' || estado.includes('no asiste')) return 'bg-red-700 text-white';
  return '';
};

export const RegisterConsolidationView: React.FC<Props> = ({ mode, title, badge, accentClassName, description }) => {
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [generalData, setGeneralData] = useState<GeneralData | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<EvaluationRecordRow[]>([]);
  const [areaCompetencyRows, setAreaCompetencyRows] = useState<any[]>([]);
  const [sessionIndex, setSessionIndex] = useState<SessionSummaryEntry[]>([]);
  const [year, setYear] = useState('');
  const [areaId, setAreaId] = useState('');
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [bimesterLabel, setBimesterLabel] = useState('');
  const [detailedSessions, setDetailedSessions] = useState<SessionDetailEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [allSessionsMap, studentRows, recordResponse, generalDataResponse] = await Promise.all([getAllSesiones(), getEstudiantes(), getEvaluacionRegistros(), getDatosGenerales()]);
        if (cancelled) return;
        const sessions = (Object.values(allSessionsMap || {}) as SessionSummaryEntry[]).sort((l, r) => [l.year, l.areaId, l.grade, l.section, l.unitNumber, l.sessionNumber].join('::').localeCompare([r.year, r.areaId, r.grade, r.section, r.unitNumber, r.sessionNumber].join('::'), 'es', { numeric: true }));
        try { setAssignments(JSON.parse(localStorage.getItem('armi_assignments') || '[]') as TeachingAssignment[]); } catch { setAssignments([]); }
        setGeneralData(generalDataResponse || null);
        setSessionIndex(sessions);
        setStudents(studentRows || []);
        setRecords((recordResponse?.success ? recordResponse.data : []) || []);
        const first = sessions[0];
        if (first) {
          setYear(String(first.year || ''));
          setAreaId(String(first.areaId || ''));
          setGrade(String(first.grade || ''));
          setSection(String(first.section || ''));
          setUnitNumber(String(first.unitNumber || ''));
          setBimesterLabel(inferBimesterLabelFromUnitNumber(first.unitNumber));
        }
      } finally { if (!cancelled) setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const years = useMemo(() => Array.from(new Set(sessionIndex.map((i) => String(i.year || '')))).filter(Boolean), [sessionIndex]);
  const areaIds = useMemo(() => Array.from(new Set(sessionIndex.filter((i) => !year || String(i.year) === year).map((i) => String(i.areaId || '')))).filter(Boolean), [sessionIndex, year]);
  const areaLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    assignments.forEach((a) => { const id = String(a.areaId || '').trim(); const label = String(a.areaName || a.areaId || '').trim(); if (id && label && !map.has(id)) map.set(id, label); });
    sessionIndex.forEach((s) => { const id = String(s.areaId || '').trim(); if (id && !map.has(id)) map.set(id, id); });
    return map;
  }, [assignments, sessionIndex]);
  const grades = useMemo(() => Array.from(new Set(sessionIndex.filter((i) => (!year || String(i.year) === year) && (!areaId || String(i.areaId) === areaId)).map((i) => String(i.grade || '')))).filter(Boolean), [sessionIndex, year, areaId]);
  const sections = useMemo(() => Array.from(new Set(students.filter((s) => !grade || String(s.grade) === grade).map((s) => String(s.section || '')))).filter(Boolean).sort(), [students, grade]);
  const units = useMemo(() => Array.from(new Set(sessionIndex.filter((i) => (!year || String(i.year) === year) && (!areaId || String(i.areaId) === areaId) && (!grade || String(i.grade) === grade) && (!section || matchesSection(String(i.section || ''), section))).map((i) => String(i.unitNumber || '')))).filter(Boolean).sort((l, r) => Number(l) - Number(r)), [sessionIndex, year, areaId, grade, section]);
  const bimesterOptions = useMemo<string[]>(
    () => Array.from(new Set(units.map((v) => inferBimesterLabelFromUnitNumber(v)))).sort((l, r) => BIMESTER_ORDER.indexOf(l as typeof BIMESTER_ORDER[number]) - BIMESTER_ORDER.indexOf(r as typeof BIMESTER_ORDER[number])),
    [units]
  );

  useEffect(() => { if (years.length && !years.includes(year)) setYear(years[0]); }, [years, year]);
  useEffect(() => { if (areaIds.length && !areaIds.includes(areaId)) setAreaId(areaIds[0]); }, [areaIds, areaId]);
  useEffect(() => { if (grades.length && !grades.includes(grade)) setGrade(grades[0]); }, [grades, grade]);
  useEffect(() => { if (sections.length && !sections.includes(section)) setSection(sections[0]); }, [sections, section]);
  useEffect(() => { if (units.length && !units.includes(unitNumber)) setUnitNumber(units[0]); }, [units, unitNumber]);
  useEffect(() => { if (bimesterOptions.length && !bimesterOptions.includes(bimesterLabel)) setBimesterLabel(bimesterOptions[0]); }, [bimesterOptions, bimesterLabel]);

  function matchesSection(sessionSection: string, selectedSectionValue: string) {
    const source = String(sessionSection || '').trim().toUpperCase();
    const selected = String(selectedSectionValue || '').trim().toUpperCase();
    if (!selected) return true;
    if (source === selected) return true;
    return source.split(/,| Y |\/|-/).map((part) => part.trim()).filter(Boolean).includes(selected);
  }

  const scopedSessionHeaders = useMemo(() => sessionIndex.filter((i) => {
    const base = (!year || String(i.year) === year) && (!areaId || String(i.areaId) === areaId) && (!grade || String(i.grade) === grade);
    if (!base) return false;
    return mode === 'unit' ? (!unitNumber || String(i.unitNumber) === unitNumber) : inferBimesterLabelFromUnitNumber(i.unitNumber) === bimesterLabel;
  }).filter((i) => !section || matchesSection(String(i.section || ''), section)), [sessionIndex, year, areaId, grade, section, unitNumber, bimesterLabel, mode]);

  useEffect(() => {
    let cancelled = false;
    const loadDetails = async () => {
      if (!scopedSessionHeaders.length) { setDetailedSessions([]); return; }
      setDetailLoading(true);
      try {
        const detailRows = await Promise.all(scopedSessionHeaders.map(async (h) => ({ ...h, bimesterLabel: inferBimesterLabelFromUnitNumber(h.unitNumber), sessionData: await getSesion(h.year, h.areaId, h.grade, h.section, h.unitNumber, h.sessionNumber) || {} } as SessionDetailEntry)));
        if (!cancelled) setDetailedSessions(detailRows.sort((l, r) => l.unitNumber !== r.unitNumber ? Number(l.unitNumber) - Number(r.unitNumber) : Number(l.sessionNumber) - Number(r.sessionNumber)));
      } finally { if (!cancelled) setDetailLoading(false); }
    };
    loadDetails();
    return () => { cancelled = true; };
  }, [scopedSessionHeaders]);

  const matchesStudentSection = (studentSection: string, selected: string) => {
    const s = String(studentSection || '').trim().toUpperCase();
    const sel = String(selected || '').trim().toUpperCase();
    if (!sel || s === sel) return true;
    return sel.split(/,| Y |\/|-/).map((part) => part.trim()).filter(Boolean).includes(s);
  };

  const scopedStudents = useMemo(() => students.filter((s) => (!grade || String(s.grade) === grade) && matchesStudentSection(String(s.section || ''), section)), [students, grade, section]);
  const aggregation = useMemo<AggregatedRegisterResult | null>(() => {
    if (!detailedSessions.length || !scopedStudents.length) return null;
    const bundle = { students: scopedStudents, records, sessions: detailedSessions };
    return mode === 'unit' ? buildUnitRegisterAggregation(bundle) : buildBimesterRegisterAggregation(bundle);
  }, [detailedSessions, scopedStudents, records, mode]);

  const theme = mode === 'unit' ? UNIT_THEME : BIMESTER_THEME;
  const areaName = areaLabelMap.get(areaId) || areaId || 'Area';
  useEffect(() => {
    let cancelled = false;
    const loadCompetencies = async () => {
      if (!grade || !areaName) {
        setAreaCompetencyRows([]);
        return;
      }
      const areaRows = await getCompetencias(grade, areaName);
      if (cancelled) return;
      setAreaCompetencyRows(Array.isArray(areaRows) ? areaRows : []);
    };
    loadCompetencies();
    return () => { cancelled = true; };
  }, [grade, areaName]);

  const capacityGroups = useMemo<CapacityGroup[]>(() => {
    const buildFromRows = (rows: any[], source: 'primary' | 'transversal') => {
      const map = new Map<string, CapacityGroup>();
      rows.forEach((row) => {
        const competencyName = String(row?.competencias || '').trim();
        const capacityName = String(row?.capacidades || '').trim();
        if (!competencyName || !capacityName) return;
        const competencyKey = `${source}::${normalizeLoose(competencyName)}`;
        if (!map.has(competencyKey)) {
          map.set(competencyKey, { competencyKey, competencyName, source, capacities: [] });
        }
        const group = map.get(competencyKey)!;
        if (!group.capacities.some((item) => item.capacityName === capacityName)) {
          group.capacities.push({ key: `${competencyKey}::${normalizeLoose(capacityName)}`, capacityName });
        }
      });
      return Array.from(map.values());
    };

    const buildFromEvaluatedSnapshots = (source: 'primary' | 'transversal') => {
      const map = new Map<string, CapacityGroup>();
      (aggregation?.sessions || []).forEach((session) => {
        session.students.forEach((student) => {
          student.capacities
            .filter((capacity) => capacity.source === source)
            .forEach((capacity) => {
              const competencyKey = capacity.key.split('::').slice(0, 2).join('::');
              if (!map.has(competencyKey)) {
                map.set(competencyKey, {
                  competencyKey,
                  competencyName: capacity.competencyName,
                  source,
                  capacities: []
                });
              }
              const group = map.get(competencyKey)!;
              if (!group.capacities.some((item) => item.key === capacity.key)) {
                group.capacities.push({ key: capacity.key, capacityName: capacity.capacityName });
              }
            });
        });
      });
      return Array.from(map.values());
    };

    return [
      ...buildFromRows(areaCompetencyRows, 'primary'),
      ...buildFromEvaluatedSnapshots('transversal')
    ];
  }, [areaCompetencyRows, aggregation]);
  const primaryCapacityGroups = capacityGroups.filter((g) => g.source === 'primary');
  const transversalCapacityGroups = capacityGroups.filter((g) => g.source === 'transversal');

  const getAggregatedCompetencyCode = (student: AggregatedStudentRegister, competencyKey: string) => student.competencies.find((i) => i.key === competencyKey)?.code || 'ne';
  const getAggregatedCapacityCode = (student: AggregatedStudentRegister, capacityKey: string) => student.capacities.find((i) => i.key === capacityKey)?.code || '';
  const getAggregatedCapacityCodeByMeta = (student: AggregatedStudentRegister, competencyName: string, capacityName: string) => {
    const normalizedCompetency = normalizeLoose(competencyName);
    const normalizedCapacity = normalizeLoose(capacityName);
    return student.capacities.find((item) =>
      normalizeLoose(item.competencyName) === normalizedCompetency &&
      normalizeLoose(item.capacityName) === normalizedCapacity
    )?.code || '';
  };
  const getUnitCompetencyDisplayCode = (student: AggregatedStudentRegister, competencyKey: string, capacityItems: Array<{ key: string; capacityName: string }>, competencyName?: string) => {
    if (mode !== 'unit') return getAggregatedCompetencyCode(student, competencyKey);
    const filledCapacityCodes = capacityItems
      .map((capacity) => getAggregatedCapacityCode(student, capacity.key) || getAggregatedCapacityCodeByMeta(student, competencyName || '', capacity.capacityName))
      .filter(Boolean);
    if (filledCapacityCodes.length <= 1) return '';
    return getAggregatedCompetencyCode(student, competencyKey);
  };
  const totals = useMemo(() => {
    const rows = aggregation?.students || [];
    return { enrolled: rows.length, evaluated: rows.filter((r) => r.overallCode !== 'ne').length, notEvaluated: rows.filter((r) => r.overallCode === 'ne').length, approved: rows.filter((r) => r.overallCode === 'a' || r.overallCode === 'ad').length, inProgress: rows.filter((r) => r.overallCode === 'b').length, atStart: rows.filter((r) => r.overallCode === 'c').length };
  }, [aggregation]);
  const teacherName = useMemo(() => {
    const fromBackend = String(generalData?.teacher || '').trim();
    if (fromBackend) return fromBackend;
    try {
      return JSON.parse(localStorage.getItem('armi_general_data') || '{}')?.teacher || '-';
    } catch {
      return '-';
    }
  }, [generalData]);
  const sessionCapacityDebugRows = useMemo(() => {
    if (mode !== 'unit' || !aggregation) return [];
    return aggregation.sessions.flatMap((session) => {
      const capacityMap = new Map<string, { competencyName: string; capacityName: string }>();
      session.students.forEach((student) => {
        student.capacities.forEach((capacity) => {
          if (!capacityMap.has(capacity.key)) {
            capacityMap.set(capacity.key, {
              competencyName: capacity.competencyName,
              capacityName: capacity.capacityName
            });
          }
        });
      });

      return Array.from(capacityMap.entries()).map(([capacityKey, meta]) => ({
        sessionId: session.sessionId,
        sessionNumber: session.sessionNumber,
        sessionTitle: session.title,
        capacityKey,
        competencyName: meta.competencyName,
        capacityName: meta.capacityName,
        studentLevels: aggregation.students.map((student) => {
          const sessionStudent = session.students.find((entry) => entry.studentId === student.studentId);
          const sessionCapacity = sessionStudent?.capacities.find((item) => item.key === capacityKey);
          return {
            studentId: student.studentId,
            studentName: student.studentName,
            code: sessionCapacity?.code || ''
          };
        })
      }));
    });
  }, [aggregation, mode]);

  const renderLevelCell = (code: RegisterLevelCode | '', extra = '', useSpecialTone = false) => (
    <td className={`border px-1 py-0.5 text-center text-[10px] font-black ${useSpecialTone ? 'border-white/10 bg-inherit text-inherit' : `${LEVEL_CELL_TONE_MAP[code] || 'bg-slate-50 text-slate-700'} border-slate-300`} ${extra}`}>{LEVEL_LABEL_MAP[code] || 'NE'}</td>
  );

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden">
        <div className={`h-2 ${accentClassName}`}></div>
        <div className="p-8 space-y-6">
          <div className="flex items-start gap-4">
            <div className={`rounded-3xl px-4 py-3 text-sm font-black text-white shadow-lg ${accentClassName}`}>{badge}</div>
            <div>
              <h2 className="text-2xl font-black italic uppercase tracking-tight text-slate-800">{title}</h2>
              <p className="mt-2 max-w-3xl text-sm font-medium leading-relaxed text-slate-500">{description}</p>
            </div>
          </div>

          {mode === 'unit' ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-[84px]"><Select label="Anio" name="year" value={year} onChange={(e) => setYear(String(e.target.value || ''))} options={years.map((v) => ({ value: v, label: v }))} variant="compact" /></div>
              <div className="w-[220px]"><Select label="Area" name="areaId" value={areaId} onChange={(e) => setAreaId(String(e.target.value || ''))} options={areaIds.map((v) => ({ value: v, label: areaLabelMap.get(v) || v }))} variant="compact" searchable /></div>
              <div className="w-[88px]"><Select label="Grado" name="grade" value={grade} onChange={(e) => setGrade(String(e.target.value || ''))} options={grades.map((v) => ({ value: v, label: v }))} variant="compact" /></div>
              <div className="w-[96px]"><Select label="Seccion" name="section" value={section} onChange={(e) => setSection(String(e.target.value || ''))} options={sections.map((v) => ({ value: v, label: v }))} variant="compact" /></div>
              <div className="w-[86px]"><Select label="Unidad" name="unitNumber" value={unitNumber} onChange={(e) => setUnitNumber(String(e.target.value || ''))} options={units.map((v) => ({ value: v, label: `U${v}` }))} variant="compact" /></div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-[84px]"><Select label="Anio" name="year" value={year} onChange={(e) => setYear(String(e.target.value || ''))} options={years.map((v) => ({ value: v, label: v }))} variant="compact" /></div>
              <div className="w-[220px]"><Select label="Area" name="areaId" value={areaId} onChange={(e) => setAreaId(String(e.target.value || ''))} options={areaIds.map((v) => ({ value: v, label: areaLabelMap.get(v) || v }))} variant="compact" searchable /></div>
              <div className="w-[88px]"><Select label="Grado" name="grade" value={grade} onChange={(e) => setGrade(String(e.target.value || ''))} options={grades.map((v) => ({ value: v, label: v }))} variant="compact" /></div>
              <div className="w-[96px]"><Select label="Seccion" name="section" value={section} onChange={(e) => setSection(String(e.target.value || ''))} options={sections.map((v) => ({ value: v, label: v }))} variant="compact" /></div>
              <div className="w-[96px]"><Select label="Bimestre" name="bimesterLabel" value={bimesterLabel} onChange={(e) => setBimesterLabel(String(e.target.value || ''))} options={bimesterOptions.map((v) => ({ value: v, label: v }))} variant="compact" /></div>
            </div>
          )}

          {(loading || detailLoading) ? (
            <div className="rounded-[2rem] border border-dashed border-slate-300 bg-slate-50/80 px-6 py-10 text-center"><p className="text-sm font-bold text-slate-500">Cargando base de consolidacion...</p></div>
          ) : !aggregation ? (
            <div className="rounded-[2rem] border border-dashed border-slate-300 bg-slate-50/80 px-6 py-10 text-center"><p className="text-sm font-bold text-slate-500">No se encontraron sesiones con datos suficientes para esta combinacion.</p></div>
          ) : (
            <div className={`rounded-[2rem] border border-slate-200 ${theme.tableTone} p-4 shadow-sm`}>
              <div className="overflow-hidden rounded-[1.5rem] border border-slate-300 bg-white">
                <table className="w-full table-fixed border-collapse text-[9px]">
                  <thead>
                    <tr>
                      <th className={`w-[15%] border border-slate-300 px-2 py-1 text-center text-[8px] font-black uppercase ${theme.headerDark}`}>Nivel</th>
                      <td className="w-[28%] border border-slate-300 px-2 py-1 font-bold">Secundaria</td>
                      <th className={`w-[12%] border border-slate-300 px-2 py-1 text-center text-[8px] font-black uppercase ${theme.headerDark}`}>Grado</th>
                      <td className="w-[7%] border border-slate-300 px-2 py-1 font-bold">{grade || '-'}</td>
                      <th className={`w-[11%] border border-slate-300 px-2 py-1 text-center text-[8px] font-black uppercase ${theme.headerDark}`}>Seccion</th>
                      <td className="w-[5%] border border-slate-300 px-2 py-1 font-bold">{section || '-'}</td>
                      <th className={`w-[11%] border border-slate-300 px-2 py-1 text-center text-[8px] font-black uppercase ${theme.headerDark}`}>{mode === 'unit' ? 'Unidad' : 'Bimestre'}</th>
                      <td className="w-[5%] border border-slate-300 px-2 py-1 font-bold">{mode === 'unit' ? `U${unitNumber || '-'}` : bimesterLabel || '-'}</td>
                      <th className={`w-[11%] border border-slate-300 px-2 py-1 text-center text-[8px] font-black uppercase ${theme.headerDark}`}>Matriculados</th>
                      <td className="w-[6%] border border-slate-300 px-2 py-1 text-center font-black">{totals.enrolled}</td>
                    </tr>
                    <tr>
                      <th className={`border border-slate-300 px-2 py-1 text-center text-[8px] font-black uppercase ${theme.headerDark}`}>Area Curricular</th>
                      <td className="border border-slate-300 px-2 py-1 font-bold">{areaName}</td>
                      <th className={`border border-slate-300 px-2 py-1 text-center text-[8px] font-black uppercase ${theme.headerDark}`}>Docente</th>
                      <td className="border border-slate-300 px-2 py-1 font-bold" colSpan={3}>{teacherName}</td>
                      <th className={`border border-slate-300 px-2 py-1 text-center text-[8px] font-black uppercase ${theme.headerDark}`}>Evaluados</th>
                      <td className="border border-slate-300 px-2 py-1 text-center font-black">{totals.evaluated}</td>
                      <th className={`border border-slate-300 px-2 py-1 text-center text-[8px] font-black uppercase ${theme.headerDark}`}>No Evaluados</th>
                      <td className="border border-slate-300 px-2 py-1 text-center font-black">{totals.notEvaluated}</td>
                    </tr>
                  </thead>
                </table>
              </div>

              <div className="mt-4 overflow-hidden rounded-[1.5rem] border border-slate-300 bg-white">
                <table className="w-full table-fixed border-collapse text-[8px]">
                  <thead>
                    <tr>
                      <th rowSpan={2} className={`w-[24px] border border-slate-300 px-0.5 py-1 text-center font-black uppercase ${theme.headerMid}`}>N°</th>
                      <th rowSpan={2} className={`w-[230px] border border-slate-300 px-1 py-1 text-center font-black uppercase ${theme.headerMid}`}>Apellidos y nombres</th>
                      {primaryCapacityGroups.map((group: any) => <th key={group.competencyKey} colSpan={group.capacities.length + 1} className={`border border-slate-300 px-2 py-1 text-center font-black uppercase ${theme.headerDark}`}>{group.competencyName}</th>)}
                      <th className={`border border-slate-300 px-2 py-1 text-center font-black uppercase ${theme.summaryHeader}`}>Resumen</th>
                      {transversalCapacityGroups.map((group: any) => <th key={group.competencyKey} colSpan={group.capacities.length + 1} className={`border border-slate-300 px-2 py-1 text-center font-black uppercase ${theme.transHeader}`}>{group.competencyName}</th>)}
                    </tr>
                    <tr>
                      {primaryCapacityGroups.map((group: any) => (
                        <React.Fragment key={`label-${group.competencyKey}`}>
                          {group.capacities.map((capacity: any) => <th key={`${capacity.key}-label`} className="border border-slate-300 px-0.5 py-0.5 text-center text-[7px] font-semibold leading-tight text-slate-500 break-words">{capacity.capacityName}</th>)}
                          <th className={`w-[44px] border border-slate-300 px-0.5 py-0.5 text-center text-[7px] font-semibold uppercase ${theme.headerMid}`}>Logro</th>
                        </React.Fragment>
                      ))}
                      <th className={`border border-slate-300 px-1 py-1 text-center text-[8px] font-semibold uppercase ${theme.summaryHeader}`}>Final</th>
                      {transversalCapacityGroups.map((group: any) => (
                        <React.Fragment key={`tlabel-${group.competencyKey}`}>
                          {group.capacities.map((capacity: any) => <th key={`${capacity.key}-tlabel`} className="border border-slate-300 px-0.5 py-0.5 text-center text-[7px] font-semibold leading-tight text-slate-500 break-words">{capacity.capacityName}</th>)}
                          <th className={`w-[44px] border border-slate-300 px-0.5 py-0.5 text-center text-[7px] font-semibold uppercase ${theme.transHeader}`}>Logro</th>
                        </React.Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {aggregation.students.map((student, index) => {
                      const specialRowTone = resolveStudentRowTone(student.estado);
                      const hasSpecialRow = !!specialRowTone;
                      return (
                      <tr key={student.studentId} className={hasSpecialRow ? specialRowTone : index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                        <td className={`border px-0.5 py-0.5 text-center font-black ${hasSpecialRow ? 'border-white/10 bg-inherit text-inherit' : 'border-slate-300 text-slate-700'}`}>{index + 1}</td>
                        <td className={`border px-1 py-0.5 font-medium uppercase text-[8px] leading-tight ${hasSpecialRow ? 'border-white/10 bg-inherit text-inherit' : 'border-slate-300 text-slate-800'}`}>{student.studentName}</td>
                        {primaryCapacityGroups.map((group: any) => (
                          <React.Fragment key={`row-${student.studentId}-${group.competencyKey}`}>
                            {group.capacities.map((capacity: any) => renderLevelCell(getAggregatedCapacityCode(student, capacity.key) || getAggregatedCapacityCodeByMeta(student, group.competencyName, capacity.capacityName), '', hasSpecialRow))}
                            {renderLevelCell(getUnitCompetencyDisplayCode(student, group.competencyKey, group.capacities, group.competencyName), 'border-l-2 border-l-slate-500', hasSpecialRow)}
                          </React.Fragment>
                        ))}
                        {renderLevelCell(student.overallCode, 'border-l-2 border-l-slate-700', hasSpecialRow)}
                        {transversalCapacityGroups.map((group: any) => (
                          <React.Fragment key={`trow-${student.studentId}-${group.competencyKey}`}>
                            {group.capacities.map((capacity: any) => renderLevelCell(getAggregatedCapacityCode(student, capacity.key) || getAggregatedCapacityCodeByMeta(student, group.competencyName, capacity.capacityName), '', hasSpecialRow))}
                            {renderLevelCell(getUnitCompetencyDisplayCode(student, group.competencyKey, group.capacities, group.competencyName), 'border-l-2 border-l-emerald-700', hasSpecialRow)}
                          </React.Fragment>
                        ))}
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <div className="rounded-xl bg-slate-900 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">Matriculados: {totals.enrolled}</div>
                <div className="rounded-xl bg-sky-700 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">Evaluados: {totals.evaluated}</div>
                <div className="rounded-xl bg-violet-700 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">No evaluados: {totals.notEvaluated}</div>
                <div className="rounded-xl bg-emerald-700 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">Aprobados: {totals.approved}</div>
                <div className="rounded-xl bg-orange-600 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">En proceso: {totals.inProgress}</div>
                <div className="rounded-xl bg-rose-600 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">En inicio: {totals.atStart}</div>
              </div>
            </div>
          )}

          {mode === 'unit' && !!sessionCapacityDebugRows.length && (
            <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Modo de prueba</p>
                  <h3 className="mt-1 text-lg font-black uppercase text-slate-800">Tabla de jalado desde sesiones</h3>
                </div>
                <div className="rounded-2xl bg-slate-100 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {sessionCapacityDebugRows.length} bloques
                </div>
              </div>

              <div className="mt-4 space-y-4">
                {sessionCapacityDebugRows.map((row) => (
                  <div key={`${row.sessionId}-${row.capacityKey}`} className="rounded-[1.5rem] border border-slate-200 overflow-hidden">
                    <div className="bg-slate-900 px-4 py-3 text-white">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em]">Sesion {row.sessionNumber}</p>
                      <p className="mt-1 text-sm font-black uppercase">{row.sessionTitle || `Sesion ${row.sessionNumber}`}</p>
                      <p className="mt-2 text-[11px] font-semibold text-slate-200">
                        Competencia: {row.competencyName}
                      </p>
                      <p className="text-[11px] font-semibold text-slate-200">
                        Capacidad: {row.capacityName}
                      </p>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-slate-100">
                            <th className="border border-slate-200 px-3 py-2 text-left font-black uppercase text-slate-500">Estudiante</th>
                            <th className="border border-slate-200 px-3 py-2 text-center font-black uppercase text-slate-500">Nota jalada</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.studentLevels.map((student) => (
                            <tr key={`${row.sessionId}-${row.capacityKey}-${student.studentId}`} className="odd:bg-white even:bg-slate-50/60">
                              <td className="border border-slate-200 px-3 py-2 font-semibold text-slate-700">{student.studentName}</td>
                              <td className={`border border-slate-200 px-3 py-2 text-center font-black ${LEVEL_CELL_TONE_MAP[student.code] || 'text-slate-400'}`}>
                                {LEVEL_LABEL_MAP[student.code] || '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
