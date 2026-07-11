import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Type } from '@google/genai';
import { getAllSesiones, getCompetencias, getDatosGenerales, getEstudiantes, getEvaluacionConclusiones, getEvaluacionRegistros, getEstandares, getSesion, saveEvaluacionConclusiones } from '../../../services/apiService';
import { Select } from '../../Select';
import type { GeneralData, Student, TeachingAssignment } from '../../../types';
import { buildBimesterRegisterAggregation, buildUnitRegisterAggregation, inferBimesterLabelFromUnitNumber } from './register-core';
import type { AggregatedRegisterResult, AggregatedStudentRegister, EvaluationRecordRow, RegisterLevelCode, SessionDetailEntry, SessionSummaryEntry } from './register-types';
import { autoResizeTextarea, buildSessionAssessmentModel, extractCapacidades, normalizeLoose, TRANSVERSAL_CAPACITY_MAP } from '../../sessions-view/shared';
import { createGeminiClient, generateGeminiContent } from '../../../utils/gemini';
import logoBar from '../../../src/Logo_bar.ico';

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

type GeneratedConclusionItem = {
  key: string;
  logros?: string;
  dificultades?: string;
  sugerencias?: string;
};

const FloatingToast: React.FC<{ message: string; subtext?: string; type: 'success' | 'error'; onClose: () => void }> = ({ message, subtext, type, onClose }) => {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 7000);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed top-10 left-1/2 z-[7000] w-full max-w-md -translate-x-1/2 px-4 print:hidden">
      <div className={`rounded-[2.25rem] border px-6 py-5 shadow-2xl backdrop-blur-xl ${type === 'success' ? 'border-emerald-400/30 bg-slate-950 text-white' : 'border-rose-400/30 bg-slate-950 text-white'}`}>
        <div className="flex items-start gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl ${type === 'success' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
            {type === 'success' ? 'OK' : '!'}
          </div>
          <div className="min-w-0 flex-1">
            <div className={`text-[10px] font-black uppercase tracking-[0.22em] ${type === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>Registro ARMI</div>
            <div className="mt-1 text-[11px] font-bold leading-tight">{message}</div>
            {subtext ? <div className="mt-2 text-[10px] leading-relaxed text-slate-300">{subtext}</div> : null}
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 transition hover:text-white">✕</button>
        </div>
      </div>
    </div>
  );
};

const PrintMiniIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 9V4h10v5" />
    <rect x="4" y="9" width="16" height="8" rx="2" />
    <path d="M7 14h10v6H7z" />
    <path d="M17 12h.01" />
  </svg>
);

const SparklesMiniIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.4L12 15l-1.9-4.6L5.5 9l4.6-1.4L12 3z" />
    <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z" />
    <path d="M5 14l.9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9L5 14z" />
  </svg>
);

const CopyMiniIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const TooltipVisibleIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <path d="M8 9h8" />
    <path d="M8 13h5" />
  </svg>
);

const TooltipHiddenIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const ToggleConclusionIcon = ({ expanded }: { expanded: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    {expanded && (
      <>
        <path d="M8 9h8" />
        <path d="M8 13h5" />
      </>
    )}
  </svg>
);

const LEVEL_LABEL_MAP: Record<string, string> = { c: 'C', b: 'B', a: 'A', ad: 'AD', ne: 'NE', '': '' };
const LEVEL_CELL_TONE_MAP: Record<string, string> = {
  c: 'bg-rose-100 text-rose-700',
  b: 'bg-orange-100 text-orange-700',
  a: 'bg-emerald-100 text-emerald-700',
  ad: 'bg-sky-100 text-sky-700',
  ne: 'bg-slate-900 text-white'
};
const LEVEL_SOLID_TONE_MAP: Record<string, string> = {
  c: 'bg-rose-600 text-white',
  b: 'bg-orange-500 text-white',
  a: 'bg-emerald-500 text-white',
  ad: 'bg-sky-500 text-white',
  ne: 'bg-slate-950 text-white'
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
  const [showSessionSources, setShowSessionSources] = useState(false);
  const [expandedConclusions, setExpandedConclusions] = useState<Record<string, boolean>>({});
  const [editableConclusions, setEditableConclusions] = useState<Record<string, string>>({});
  const [isGeneratingAiConclusions, setIsGeneratingAiConclusions] = useState(false);
  const [aiConclusionMessage, setAiConclusionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copySiagieMessage, setCopySiagieMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [conclusionsHydrated, setConclusionsHydrated] = useState(false);
  const [toastData, setToastData] = useState<{ type: 'success' | 'error'; msg: string; sub?: string } | null>(null);
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
  const lastLoadedConclusionsScopeRef = useRef('');

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
  const conclusionStorageKey = useMemo(
    () => `armi_register_conclusions_${mode}_${year}_${areaId}_${grade}_${section}_${mode === 'unit' ? unitNumber : bimesterLabel}`,
    [mode, year, areaId, grade, section, unitNumber, bimesterLabel]
  );
  const conclusionScopeType = mode;
  const conclusionScopeValue = mode === 'unit' ? unitNumber : bimesterLabel;
  const conclusionQueryKey = useMemo(
    () => [year, areaId, grade, section, conclusionScopeType, conclusionScopeValue].join('::'),
    [year, areaId, grade, section, conclusionScopeType, conclusionScopeValue]
  );

  useEffect(() => {
    let cancelled = false;
    const loadPersistedConclusions = async () => {
      if (!year || !areaId || !grade || !section || !conclusionScopeType || !conclusionScopeValue) {
        setEditableConclusions({});
        setConclusionsHydrated(false);
        lastLoadedConclusionsScopeRef.current = '';
        return;
      }
      if (lastLoadedConclusionsScopeRef.current === conclusionQueryKey) return;

      setConclusionsHydrated(false);
      lastLoadedConclusionsScopeRef.current = conclusionQueryKey;
      try {
        const response = await getEvaluacionConclusiones({
          year,
          areaId,
          grade,
          section,
          scopeType: conclusionScopeType,
          scopeValue: conclusionScopeValue
        });
        if (cancelled) return;

        const dbRows = response?.success && Array.isArray(response.data) ? response.data : [];
        const fromDb = dbRows.reduce((acc: Record<string, string>, row: any) => {
          const key = getConclusionKey(String(row.studentId || ''), String(row.competencyKey || ''));
          const text = String(row.conclusionText || '').trim();
          if (key && text) acc[key] = text;
          return acc;
        }, {});

        if (Object.keys(fromDb).length > 0) {
          setEditableConclusions(fromDb);
          setConclusionsHydrated(true);
          return;
        }

        try {
          const stored = localStorage.getItem(conclusionStorageKey);
          const localRows = stored ? JSON.parse(stored) : {};
          setEditableConclusions(localRows && typeof localRows === 'object' ? localRows : {});
        } catch {
          setEditableConclusions({});
        }
      } catch {
        if (cancelled) return;
        lastLoadedConclusionsScopeRef.current = '';
        try {
          const stored = localStorage.getItem(conclusionStorageKey);
          const localRows = stored ? JSON.parse(stored) : {};
          setEditableConclusions(localRows && typeof localRows === 'object' ? localRows : {});
        } catch {
          setEditableConclusions({});
        }
      } finally {
        if (!cancelled) setConclusionsHydrated(true);
      }
    };

    loadPersistedConclusions();
    return () => { cancelled = true; };
  }, [conclusionStorageKey, conclusionQueryKey, year, areaId, grade, section, conclusionScopeType, conclusionScopeValue]);

  useEffect(() => {
    try {
      localStorage.setItem(conclusionStorageKey, JSON.stringify(editableConclusions));
    } catch {
      // Ignore localStorage write errors.
    }
  }, [conclusionStorageKey, editableConclusions]);

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

    const buildFromSessionDefinitions = (source: 'primary' | 'transversal') => {
      const map = new Map<string, CapacityGroup>();
      detailedSessions.forEach((session) => {
        if (source === 'transversal') {
          const transversalRows = Array.isArray(session?.sessionData?.competenciasTrans)
            ? session.sessionData.competenciasTrans
            : [];

          transversalRows.forEach((item: any) => {
            const competencyName = String(item?.comp || '').trim();
            const capacities = extractCapacidades(String(item?.cap || '').trim());
            if (!competencyName || capacities.length === 0) return;

            const competencyKey = `${source}::${normalizeLoose(competencyName)}`;
            if (!map.has(competencyKey)) {
              map.set(competencyKey, { competencyKey, competencyName, source, capacities: [] });
            }

            const group = map.get(competencyKey)!;
            capacities.forEach((capacityName) => {
              const capacityKey = `${competencyKey}::${normalizeLoose(capacityName)}`;
              if (!group.capacities.some((item) => item.key === capacityKey)) {
                group.capacities.push({ key: capacityKey, capacityName });
              }
            });
          });
          return;
        }

        const sessionAssessmentModel = session?.sessionData?.sessionAssessmentModel || buildSessionAssessmentModel(session?.sessionData || {}, {
          areaId: session.areaId,
          grade: session.grade,
          section: session.section,
          unitNumber: session.unitNumber,
          sessionNumber: session.sessionNumber,
          bimester: session.bimesterLabel
        });
        const rows = Array.isArray(sessionAssessmentModel?.rows) ? sessionAssessmentModel.rows : [];

        rows.forEach((row: any) => {
          const rowSource = String(row?.source || 'primary') === 'transversal' ? 'transversal' : 'primary';
          if (rowSource !== source) return;

          const competencyName = String(row?.competencyName || '').trim();
          const capacityName = String(row?.capacityName || '').trim();
          if (!competencyName || !capacityName) return;

          const competencyKey = `${source}::${normalizeLoose(competencyName)}`;
          if (!map.has(competencyKey)) {
            map.set(competencyKey, { competencyKey, competencyName, source, capacities: [] });
          }

          const group = map.get(competencyKey)!;
          const capacityKey = `${competencyKey}::${normalizeLoose(capacityName)}`;
          if (!group.capacities.some((item) => item.key === capacityKey)) {
            group.capacities.push({ key: capacityKey, capacityName });
          }
        });
      });
      return Array.from(map.values());
    };

    const buildFromAggregatedSnapshots = (source: 'primary' | 'transversal') => {
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

    const mergedTransversalMap = new Map<string, CapacityGroup>();
    [...buildFromSessionDefinitions('transversal'), ...buildFromAggregatedSnapshots('transversal')].forEach((group) => {
      if (!mergedTransversalMap.has(group.competencyKey)) {
        mergedTransversalMap.set(group.competencyKey, {
          competencyKey: group.competencyKey,
          competencyName: group.competencyName,
          source: group.source,
          capacities: []
        });
      }
      const target = mergedTransversalMap.get(group.competencyKey)!;
      group.capacities.forEach((capacity) => {
        if (!target.capacities.some((item) => item.key === capacity.key)) {
          target.capacities.push(capacity);
        }
      });
    });

    const normalizedTransversalCapacityMap = new Map<string, string[]>(
      Object.entries(TRANSVERSAL_CAPACITY_MAP).map(([competencyName, capacities]) => [
        normalizeLoose(competencyName),
        capacities
      ])
    );

    const transversalGroups = Array.from(mergedTransversalMap.values()).map((group) => {
      const officialCapacities = normalizedTransversalCapacityMap.get(normalizeLoose(group.competencyName)) || [];
      if (!officialCapacities.length) return group;

      return {
        ...group,
        capacities: officialCapacities.map((capacityName) => ({
          key: `${group.competencyKey}::${normalizeLoose(capacityName)}`,
          capacityName
        }))
      };
    });

    return [
      ...buildFromRows(areaCompetencyRows, 'primary'),
      ...transversalGroups
    ];
  }, [areaCompetencyRows, aggregation, detailedSessions]);
  const primaryCapacityGroups = capacityGroups.filter((g) => g.source === 'primary');
  const transversalCapacityGroups = capacityGroups.filter((g) => g.source === 'transversal');
  const allCompetencyGroups = useMemo(() => [...primaryCapacityGroups, ...transversalCapacityGroups], [primaryCapacityGroups, transversalCapacityGroups]);

  useEffect(() => {
    if (!conclusionsHydrated || !year || !areaId || !grade || !section || !conclusionScopeValue) return;

    const timeoutId = window.setTimeout(async () => {
      const records = Object.entries(editableConclusions).map(([key, value]) => {
        const separatorIndex = key.indexOf('::');
        const studentId = separatorIndex >= 0 ? key.slice(0, separatorIndex) : '';
        const competencyKey = separatorIndex >= 0 ? key.slice(separatorIndex + 2) : '';
        const group = allCompetencyGroups.find((item) => item.competencyKey === competencyKey);
        return {
          year,
          areaId,
          grade,
          section,
          scopeType: conclusionScopeType,
          scopeValue: conclusionScopeValue,
          studentId: String(studentId || '').trim(),
          competencyKey: String(competencyKey || '').trim(),
          competencyName: String(group?.competencyName || '').trim(),
          competencySource: String(group?.source || '').trim(),
          conclusionText: String(value || '').trim()
        };
      }).filter((item) => item.studentId && item.competencyKey);

      try {
        await saveEvaluacionConclusiones({ records });
      } catch (error) {
        console.error('Conclusion persistence failed:', error);
      }
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [editableConclusions, conclusionsHydrated, year, areaId, grade, section, conclusionScopeType, conclusionScopeValue, allCompetencyGroups]);

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
    const filledCapacityCodes = capacityItems
      .map((capacity) => getAggregatedCapacityCode(student, capacity.key) || getAggregatedCapacityCodeByMeta(student, competencyName || '', capacity.capacityName))
      .filter(Boolean);
    if (filledCapacityCodes.length === 0) return '';
    return getAggregatedCompetencyCode(student, competencyKey);
  };
  const isConclusionExpanded = (competencyKey: string) => !!expandedConclusions[competencyKey];
  const formatCapacityLabelList = (values: string[]) => {
    if (!values.length) return '';
    if (values.length === 1) return values[0];
    if (values.length === 2) return `${values[0]} y ${values[1]}`;
    return `${values.slice(0, -1).join(', ')} y ${values[values.length - 1]}`;
  };
  const getCompetencyConclusion = (
    student: AggregatedStudentRegister,
    competencyKey: string,
    capacityItems: Array<{ key: string; capacityName: string }>,
    competencyName: string
  ) => {
    const competencyCode = getUnitCompetencyDisplayCode(student, competencyKey, capacityItems, competencyName) || 'ne';
    const evaluatedCaps = capacityItems
      .map((capacity) => ({
        name: capacity.capacityName,
        code: getAggregatedCapacityCode(student, capacity.key) || getAggregatedCapacityCodeByMeta(student, competencyName, capacity.capacityName) || 'ne'
      }))
      .filter((item) => item.code && item.code !== 'ne');

    if (!evaluatedCaps.length) {
      return 'Sin evidencias suficientes para redactar una conclusión descriptiva.';
    }

    const strengths = evaluatedCaps.filter((item) => item.code === 'a' || item.code === 'ad').map((item) => item.name);
    const inProgress = evaluatedCaps.filter((item) => item.code === 'b').map((item) => item.name);
    const needsSupport = evaluatedCaps.filter((item) => item.code === 'c').map((item) => item.name);

    if (competencyCode === 'ad') {
      return `Destaca en ${competencyName.toLowerCase()}, con desempeño sólido en ${formatCapacityLabelList(strengths || evaluatedCaps.map((item) => item.name))}.`;
    }
    if (competencyCode === 'a') {
      const supportText = inProgress.length || needsSupport.length
        ? ` Puede seguir fortaleciendo ${formatCapacityLabelList([...inProgress, ...needsSupport])}.`
        : '';
      return `Logra satisfactoriamente ${competencyName.toLowerCase()}, evidenciando avance en ${formatCapacityLabelList(strengths.length ? strengths : evaluatedCaps.map((item) => item.name))}.${supportText}`;
    }
    if (competencyCode === 'b') {
      const progressText = strengths.length ? ` Muestra mejor desempeño en ${formatCapacityLabelList(strengths)}.` : '';
      const supportBase = [...inProgress, ...needsSupport];
      const supportText = supportBase.length ? ` Requiere acompañamiento en ${formatCapacityLabelList(supportBase)}.` : '';
      return `Se encuentra en proceso en ${competencyName.toLowerCase()}.${progressText}${supportText}`;
    }
    if (competencyCode === 'c') {
      return `Se encuentra en inicio en ${competencyName.toLowerCase()} y requiere reforzar ${formatCapacityLabelList(needsSupport.length ? needsSupport : evaluatedCaps.map((item) => item.name))}.`;
    }
    return 'Sin evidencias suficientes para redactar una conclusión descriptiva.';
  };
  const getConclusionKey = (studentId: string, competencyKey: string) => `${studentId}::${competencyKey}`;
  const normalizeConclusionText = (value: string) => String(value || '').replace(/\s+/g, ' ').trim().replace(/^[:;,\-.\s]+/, '');
  const truncateConclusionPart = (value: string, max: number) => {
    const normalized = normalizeConclusionText(value);
    if (normalized.length <= max) return normalized;
    const sliced = normalized.slice(0, Math.max(0, max - 1));
    const lastSpace = sliced.lastIndexOf(' ');
    return `${(lastSpace > 24 ? sliced.slice(0, lastSpace) : sliced).trim()}.`;
  };
  const composeStructuredConclusion = (logros: string, dificultades: string, sugerencias: string) => {
    const safeLogros = normalizeConclusionText(logros) || 'muestra avances en la competencia';
    const safeDificultades = normalizeConclusionText(dificultades) || 'requiere mayor consolidacion';
    const safeSugerencias = normalizeConclusionText(sugerencias) || 'continuar con practica guiada';

    const ensureSentence = (value: string) => {
      const normalized = normalizeConclusionText(value);
      if (!normalized) return '';
      return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
    };
    const stripLeadVerb = (value: string, options: string[]) => {
      const normalized = normalizeConclusionText(value);
      const match = options.find((option) => normalized.toLowerCase().startsWith(`${option.toLowerCase()} `));
      return match ? normalized.slice(match.length).trim() : normalized;
    };
    const lowerFirst = (value: string) => {
      const normalized = normalizeConclusionText(value);
      if (!normalized) return '';
      return normalized.charAt(0).toLowerCase() + normalized.slice(1);
    };
    const normalizeAchievementPart = (value: string) => {
      const normalized = normalizeConclusionText(value) || 'muestra avances en la competencia';
      if (/^(no|dificultad|dificultades|requiere|necesita)\b/i.test(normalized)) {
        return 'Muestra avances limitados en la competencia';
      }
      return normalized;
    };
    const normalizeDifficultyPart = (value: string) => {
      const normalized = normalizeConclusionText(value) || 'aspectos por consolidar';
      const stripped = stripLeadVerb(normalized, [
        'presenta',
        'requiere',
        'evidencia',
        'muestra',
        'tiene',
        'observa',
        'se observa'
      ]);

      if (/^no\s+/i.test(stripped)) {
        return `dificultades para ${lowerFirst(stripped.replace(/^no\s+/i, ''))}`;
      }
      if (/^(dificultad|dificultades)\b/i.test(stripped)) {
        return lowerFirst(stripped);
      }
      if (/^(crear|elaborar|proponer|resolver|analizar|identificar|organizar|explicar|argumentar|aplicar|comunicar|gestionar|planificar|evaluar|redactar|sustentar)\b/i.test(stripped)) {
        return `dificultades para ${lowerFirst(stripped)}`;
      }
      return `aspectos por consolidar en ${lowerFirst(stripped)}`;
    };
    const normalizeSuggestionPart = (value: string) => {
      const normalized = normalizeConclusionText(value) || 'continuar con practica guiada';
      const stripped = stripLeadVerb(normalized, [
        'se sugiere',
        'sugerencia',
        'conviene',
        'requiere',
        'debe',
        'se recomienda',
        'recomendacion'
      ]);

      if (/^que\s+/i.test(stripped)) return lowerFirst(stripped);
      if (/^(fortalecer|reforzar|mejorar|continuar|practicar|planificar|organizar|crear|elaborar|proponer|resolver|analizar|identificar|explicar|argumentar|aplicar|comunicar|gestionar|evaluar)\b/i.test(stripped)) {
        return lowerFirst(stripped);
      }
      return `fortalecer ${lowerFirst(stripped)}`;
    };

    const logroPart = ensureSentence(normalizeAchievementPart(safeLogros));
    const dificultadCore = normalizeDifficultyPart(safeDificultades);
    const sugerenciaCore = normalizeSuggestionPart(safeSugerencias);
    const dificultadPart = ensureSentence(`Presenta ${dificultadCore || 'aspectos por consolidar'}`);
    const sugerenciaPart = ensureSentence(`Se sugiere ${sugerenciaCore || 'continuar con practica guiada'}`);
    const fullText = `${logroPart} ${dificultadPart} ${sugerenciaPart}`.replace(/\s+/g, ' ').trim();
    if (fullText.length <= 250) return fullText;

    const maxContent = 250 - (' Presenta . Se sugiere .'.length);
    const goalsMax = Math.max(28, Math.floor(maxContent * 0.34));
    const diffMax = Math.max(28, Math.floor(maxContent * 0.33));
    const suggMax = Math.max(28, maxContent - goalsMax - diffMax);

    const compact = `${ensureSentence(truncateConclusionPart(normalizeAchievementPart(safeLogros), goalsMax))} ${ensureSentence(`Presenta ${truncateConclusionPart(dificultadCore || 'aspectos por consolidar', diffMax)}`)} ${ensureSentence(`Se sugiere ${truncateConclusionPart(sugerenciaCore || 'continuar con practica guiada', suggMax)}`)}`.replace(/\s+/g, ' ').trim();
    return compact.slice(0, 250).trim();
  };
  const buildRuleBasedConclusion = (
    student: AggregatedStudentRegister,
    competencyKey: string,
    capacityItems: Array<{ key: string; capacityName: string }>,
    competencyName: string,
    standardText: string
  ) => {
    const evaluatedCaps = capacityItems
      .map((capacity) => ({
        name: capacity.capacityName,
        code: getAggregatedCapacityCode(student, capacity.key) || getAggregatedCapacityCodeByMeta(student, competencyName, capacity.capacityName) || 'ne'
      }))
      .filter((item) => item.code && item.code !== 'ne');

    const strengths = evaluatedCaps.filter((item) => item.code === 'a' || item.code === 'ad').map((item) => item.name);
    const support = evaluatedCaps.filter((item) => item.code === 'b' || item.code === 'c').map((item) => item.name);
    const standardIdea = normalizeConclusionText(standardText).split(/[.;:]/)[0] || competencyName.toLowerCase();

    if (!evaluatedCaps.length) {
      return composeStructuredConclusion(
        `sin evidencias suficientes en ${competencyName.toLowerCase()}`,
        'falta consolidar informacion del bimestre',
        'registrar nuevas evidencias y acompanamiento focalizado'
      );
    }

    return composeStructuredConclusion(
      strengths.length ? `avanza en ${formatCapacityLabelList(strengths).toLowerCase()} segun ${standardIdea.toLowerCase()}` : `muestra avances parciales en ${competencyName.toLowerCase()}`,
      support.length ? `requiere reforzar ${formatCapacityLabelList(support).toLowerCase()}` : `necesita sostener el logro alcanzado`,
      support.length ? `practicar ${formatCapacityLabelList(support).toLowerCase()} con retroalimentacion guiada` : `mantener retos vinculados al estandar del grado`
    );
  };
  const buildStandardsMap = async () => {
    const map = new Map<string, string>();

    const addRows = (rows: any[]) => {
      rows.forEach((row) => {
        const competencyName = String(row?.competencias || '').trim();
        const standardText = String(row?.estandar || '').trim();
        if (competencyName && standardText) {
          map.set(normalizeLoose(competencyName), standardText);
        }
      });
    };

    addRows(await getEstandares(grade, areaName));

    const transversalNames = Array.from(new Set(transversalCapacityGroups.map((group) => group.competencyName)));
    const transversalResponses = await Promise.all(transversalNames.map((name) => getEstandares(grade, name)));
    transversalResponses.forEach((rows) => addRows(Array.isArray(rows) ? rows : []));

    return map;
  };
  const generateAiConclusions = async () => {
    if (mode !== 'bimester' || !aggregation || !allCompetencyGroups.length || isGeneratingAiConclusions) return;

    const apiKey = String(generalData?.gemini_api_key || process.env.API_KEY || '').trim();
    if (!apiKey || apiKey === 'undefined' || apiKey === 'null' || apiKey.length < 10) {
      setToastData({
        type: 'error',
        msg: 'No hay una API key de Gemini válida.',
        sub: 'Revisa Datos Generales y guarda una llave activa de Google AI Studio antes de usar el botón IA.'
      });
      return;
    }

    setIsGeneratingAiConclusions(true);
    setAiConclusionMessage(null);
    setToastData(null);

    try {
      const standardsMap = await buildStandardsMap();
      const primaryGroups = allCompetencyGroups.filter((group) => group.source === 'primary');
      const missingStandards = primaryGroups.filter((group) => !standardsMap.get(normalizeLoose(group.competencyName)));
      if (primaryGroups.length > 0 && missingStandards.length === primaryGroups.length) {
        throw new Error(`NO_STANDARDS::No se encontraron estándares del grado ${grade} para el área ${areaName}.`);
      }

      const requestRows = aggregation.students.flatMap((student) =>
        allCompetencyGroups.map((group) => {
          const standardText = standardsMap.get(normalizeLoose(group.competencyName)) || '';
          const fallbackText = buildRuleBasedConclusion(student, group.competencyKey, group.capacities, group.competencyName, standardText);
          const evaluatedCaps = group.capacities
            .map((capacity) => ({
              capacidad: capacity.capacityName,
              nivel: (getAggregatedCapacityCode(student, capacity.key) || getAggregatedCapacityCodeByMeta(student, group.competencyName, capacity.capacityName) || 'NE').toUpperCase()
            }))
            .filter((item) => item.nivel !== 'NE');

          return {
            key: getConclusionKey(student.studentId, group.competencyKey),
            studentId: student.studentId,
            competencyKey: group.competencyKey,
            studentName: student.studentName,
            competencyName: group.competencyName,
            level: (getUnitCompetencyDisplayCode(student, group.competencyKey, group.capacities, group.competencyName) || 'NE').toUpperCase(),
            standardText,
            capacities: evaluatedCaps,
            fallbackText
          };
        })
      );

      const ai = createGeminiClient(apiKey);
      const preferredGeminiModel = String(generalData?.gemini_model || '').trim();
      const promptRows = requestRows.map((row) => ({
        key: row.key,
        estudiante: row.studentName,
        competencia: row.competencyName,
        nivel: row.level,
        estandar: row.standardText || 'Sin estandar explicito disponible',
        capacidades: row.capacities
      }));
      const prompt = [
        'Actua como docente peruano experto en evaluacion por competencias.',
        `Genera conclusiones descriptivas para registro por bimestre del grado ${grade}, area ${areaName}, seccion ${section}, bimestre ${bimesterLabel}.`,
        'Cada respuesta debe usar de manera obligatoria el estandar del grado proporcionado como referencia central.',
        'Devuelve SOLO JSON con un arreglo llamado conclusiones.',
        'Cada item debe incluir: key, logros, dificultades, sugerencias.',
        'Escribe frases breves en tercera persona, claras y pedagogicas, vinculadas al desempeno observado y al estandar.',
        'No repitas etiquetas dentro de los campos.',
        'En "logros" escribe una idea positiva y completa, por ejemplo: "Muestra avances en...".',
        'En "dificultades" no empieces con "No..."; escribe formulaciones como "dificultades para..." o "aspectos por consolidar en...".',
        'En "sugerencias" escribe acciones breves como "fortalecer...", "practicar..." o "mejorar...", no solo palabras sueltas.',
        'No uses textos genericos como explorar necesidades basicas o participar en talleres salvo que los datos realmente lo justifiquen.',
        'Los tres campos luego se uniran en un solo parrafo corrido, sin saltos de linea ni encabezados visibles.',
        'La suma final debe mantenerse dentro de 250 caracteres incluyendo espacios.',
        `Datos: ${JSON.stringify(promptRows)}`
      ].join(' ');

      const response = await generateGeminiContent(ai, {
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.4,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              conclusiones: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    key: { type: Type.STRING },
                    logros: { type: Type.STRING },
                    dificultades: { type: Type.STRING },
                    sugerencias: { type: Type.STRING }
                  },
                  required: ['key', 'logros', 'dificultades', 'sugerencias']
                }
              }
            },
            required: ['conclusiones']
          }
        }
      }, preferredGeminiModel);

      const parsed = JSON.parse(response.text || '{}');
      const generatedList = Array.isArray(parsed?.conclusiones) ? parsed.conclusiones as GeneratedConclusionItem[] : [];
      const generatedMap = new Map(generatedList.map((item) => [String(item.key || '').trim(), item]));

      setEditableConclusions((prev) => {
        const next = { ...prev };
        requestRows.forEach((row) => {
          const aiItem = generatedMap.get(row.key);
          next[row.key] = aiItem
            ? composeStructuredConclusion(aiItem.logros || '', aiItem.dificultades || '', aiItem.sugerencias || '')
            : row.fallbackText;
        });
        return next;
      });

      setAiConclusionMessage({ type: 'success', text: 'Las conclusiones del bimestre se completaron con IA usando estandares del grado y limite de 250 caracteres.' });
      setToastData({
        type: 'success',
        msg: 'Conclusiones generadas correctamente.',
        sub: missingStandards.length > 0
          ? `Se generaron con los estándares disponibles. Faltan estándares para: ${missingStandards.map((item) => item.competencyName).join(', ')}.`
          : 'Se usaron los estándares del grado disponibles en la base de datos.'
      });
    } catch (error: any) {
      console.error('AI bimester conclusion generation failed:', error);
      const errorStr = String(error?.message || error || '').trim();
      let msg = 'No se pudieron generar las conclusiones con IA.';
      let sub = 'Ocurrió un problema no identificado durante la generación.';

      if (errorStr.startsWith('NO_STANDARDS::')) {
        msg = 'Faltan estándares del grado para esta área.';
        sub = errorStr.replace('NO_STANDARDS::', '');
      } else if (error?.status === 401 || error?.status === 403 || /api[_ ]?key|unauthorized|invalid|permission/i.test(errorStr)) {
        msg = 'La API key de Gemini no es válida o no tiene permisos.';
        sub = 'Actualiza la llave IA en Datos Generales y vuelve a intentarlo.';
      } else if (error?.status === 429 || /quota|rate limit|exceeded/i.test(errorStr)) {
        msg = 'La cuota de Gemini está saturada o agotada.';
        sub = 'Espera unos minutos o revisa el estado de tu proyecto en Google AI Studio.';
      } else if (/network|fetch|failed|connection|timeout/i.test(errorStr)) {
        msg = 'Falló la conexión al servicio de IA.';
        sub = 'Verifica internet, el backend local y vuelve a probar.';
      } else if (/empty_response|empty/i.test(errorStr)) {
        msg = 'La IA respondió vacío.';
        sub = 'El servicio no devolvió contenido útil. Intenta nuevamente.';
      } else if (errorStr) {
        sub = errorStr.slice(0, 240);
      }

      setAiConclusionMessage({ type: 'error', text: msg });
      setToastData({ type: 'error', msg, sub });
    } finally {
      setIsGeneratingAiConclusions(false);
    }
  };
  const copyAreaCompetenciesForSiagie = async () => {
    if (mode !== 'bimester' || !aggregation || !primaryCapacityGroups.length) return;

    try {
      const plainText = aggregation.students.map((student) => (
        primaryCapacityGroups.map((group) => {
          const level = (getUnitCompetencyDisplayCode(student, group.competencyKey, group.capacities, group.competencyName) || 'NE').toUpperCase();
          const conclusion = getEditableConclusionValue(student, group.competencyKey, group.capacities, group.competencyName)
            .replace(/\r?\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          return `${level}\t${conclusion}`;
        }).join('\t')
      )).join('\n');

      await navigator.clipboard.writeText(plainText);
      setCopySiagieMessage({ type: 'success', text: 'Se copiaron las notas y conclusiones de las competencias del área, sin encabezados, listas para pegar en SIAGIE.' });
    } catch (error) {
      console.error('SIAGIE copy failed:', error);
      setCopySiagieMessage({ type: 'error', text: 'No se pudo copiar al portapapeles. Intenta nuevamente.' });
    }
  };
  const getEditableConclusionValue = (
    student: AggregatedStudentRegister,
    competencyKey: string,
    capacityItems: Array<{ key: string; capacityName: string }>,
    competencyName: string
  ) => {
    const key = getConclusionKey(student.studentId, competencyKey);
    return editableConclusions[key] ?? getCompetencyConclusion(student, competencyKey, capacityItems, competencyName);
  };
  const hasExpandedConclusions = Object.values(expandedConclusions).some(Boolean);
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
  const printInstitutionName = String(generalData?.institution || 'Institución Educativa').trim();
  const printInstitutionPlace = String(generalData?.lugar || '').trim();
  const printDistrict = String(generalData?.district || '').trim();
  const printProvince = String(generalData?.province || '').trim();
  const printLocationLine = [printDistrict, printProvince].filter(Boolean).join(' - ');
  const printInstitutionMotto = String(generalData?.motto || generalData?.year_name || areaName || '').trim();
  const printHeaderDarkCellClass = 'bg-black text-white font-black text-right px-1 py-1 border border-black leading-tight print:text-[8px] print:leading-tight print:outline print:outline-1 print:outline-white print:-outline-offset-1';
  const printHeaderValueCellClass = 'px-2 py-1 border border-black print:text-[8px] print:leading-tight';
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
  const bimesterCapacityTraceRows = useMemo(() => {
    if (mode !== 'bimester' || !aggregation) return [];

    const capacityMap = new Map<string, {
      competencyName: string;
      capacityName: string;
      source: 'primary' | 'transversal';
      sessions: string[];
      units: string[];
    }>();

    aggregation.sessions.forEach((session) => {
      const sessionLabel = `U${session.unitNumber}-S${session.sessionNumber}`;
      session.students.forEach((student) => {
        student.capacities.forEach((capacity) => {
          if (!capacity.code || capacity.code === 'ne') return;
          if (!capacityMap.has(capacity.key)) {
            capacityMap.set(capacity.key, {
              competencyName: capacity.competencyName,
              capacityName: capacity.capacityName,
              source: capacity.source,
              sessions: [],
              units: []
            });
          }
          const target = capacityMap.get(capacity.key)!;
          if (!target.sessions.includes(sessionLabel)) target.sessions.push(sessionLabel);
          const unitLabel = `U${session.unitNumber}`;
          if (!target.units.includes(unitLabel)) target.units.push(unitLabel);
        });
      });
    });

    return Array.from(capacityMap.entries())
      .map(([capacityKey, item]) => ({
        capacityKey,
        ...item,
        sessions: item.sessions.sort((left, right) => {
          const [leftUnit, leftSession] = left.replace('U', '').split('-S').map(Number);
          const [rightUnit, rightSession] = right.replace('U', '').split('-S').map(Number);
          if (leftUnit !== rightUnit) return leftUnit - rightUnit;
          return leftSession - rightSession;
        }),
        units: item.units.sort((left, right) => Number(left.replace('U', '')) - Number(right.replace('U', '')))
      }))
      .sort((left, right) => {
        if (left.source !== right.source) return left.source === 'primary' ? -1 : 1;
        const competencyCompare = left.competencyName.localeCompare(right.competencyName, 'es');
        if (competencyCompare !== 0) return competencyCompare;
        return left.capacityName.localeCompare(right.capacityName, 'es');
      });
  }, [aggregation, mode]);

  const studentCapacitySessionMap = useMemo(() => {
    const map = new Map<string, string[]>();
    (aggregation?.sessions || []).forEach((session) => {
      session.students.forEach((student) => {
        student.capacities.forEach((capacity) => {
          if (!capacity.code || capacity.code === 'ne') return;
          const key = `${student.studentId}::${capacity.key}`;
          const current = map.get(key) || [];
          const baseLabel = mode === 'bimester'
            ? `U${session.unitNumber}-S${session.sessionNumber}`
            : `S${session.sessionNumber}`;
          const sessionLabel = `${baseLabel} (${(LEVEL_LABEL_MAP[capacity.code] || 'NE').toUpperCase()})`;
          if (!current.includes(sessionLabel)) current.push(sessionLabel);
          map.set(key, current);
        });
      });
    });
    return map;
  }, [aggregation, mode]);

  const studentCompetencySessionMap = useMemo(() => {
    const map = new Map<string, string[]>();
    (aggregation?.sessions || []).forEach((session) => {
      session.students.forEach((student) => {
        student.competencies.forEach((competency) => {
          if (!competency.code || competency.code === 'ne') return;
          const key = `${student.studentId}::${competency.key}`;
          const current = map.get(key) || [];
          const baseLabel = mode === 'bimester'
            ? `U${session.unitNumber}-S${session.sessionNumber}`
            : `S${session.sessionNumber}`;
          const sessionLabel = `${baseLabel} (${(LEVEL_LABEL_MAP[competency.code] || 'NE').toUpperCase()})`;
          if (!current.includes(sessionLabel)) current.push(sessionLabel);
          map.set(key, current);
        });
      });
    });
    return map;
  }, [aggregation, mode]);

  const formatSessionSources = (sources: string[]) => {
    if (!sources.length) return 'Sin sesiones con evaluación registrada';
    if (sources.length === 1) return sources[0];
    if (sources.length === 2) return `${sources[0]} y ${sources[1]}`;
    return `${sources.slice(0, -1).join(', ')} y ${sources[sources.length - 1]}`;
  };

  const getCapacitySessionSources = (studentId: string, capacityKey: string) =>
    studentCapacitySessionMap.get(`${studentId}::${capacityKey}`) || [];

  const getCompetencySessionSources = (studentId: string, competencyKey: string) =>
    studentCompetencySessionMap.get(`${studentId}::${competencyKey}`) || [];

  const renderPrintHeader = (subtitle: string) => (
    <div className="hidden print:block session-register-page-header print:pb-1">
      <div className="session-register-print-masthead">
        <div className="session-register-print-mark">
          {generalData?.insignia ? (
            <img src={generalData.insignia} alt="Insignia IE" className="session-register-print-mark-image" />
          ) : (
            <span className="session-register-print-mark-fallback">INSIGNIA</span>
          )}
        </div>
        <div className="text-center">
          <div className="session-register-print-school">
            {`Institución Educativa ${printInstitutionName || 'Institución Educativa'}${printInstitutionPlace ? ` - ${printInstitutionPlace}` : ''}`}
          </div>
          <div className="session-register-print-location">{printLocationLine || '-'}</div>
          <div className="session-register-print-motto">{printInstitutionMotto || areaName}</div>
          <div className="session-register-print-title">{subtitle}</div>
        </div>
        <div className="session-register-print-mark">
          <img src={generalData?.logo || logoBar} alt="Logo JEC" className="session-register-print-mark-image" />
        </div>
      </div>
      <div className="border border-black bg-white rounded-xl overflow-hidden">
        <table className="w-full border-collapse text-[10px] print:text-[8px]">
          <tbody>
            <tr>
              <td className={`${printHeaderDarkCellClass} w-[88px]`}>Nivel:</td>
              <td className={`${printHeaderValueCellClass} w-[64px]`}>{generalData?.level || '-'}</td>
              <td className={`${printHeaderDarkCellClass} w-[72px]`}>Grado:</td>
              <td className={`${printHeaderValueCellClass} w-[52px]`}>{grade || '-'}</td>
              <td className={`${printHeaderDarkCellClass} w-[72px]`}>Unidad:</td>
              <td className={`${printHeaderValueCellClass} w-[64px]`}>N° {unitNumber || '-'}</td>
              <td className={`${printHeaderDarkCellClass} w-[72px]`}>Registro:</td>
              <td className={printHeaderValueCellClass}>{title}</td>
            </tr>
            <tr>
              <td className={printHeaderDarkCellClass}>Área Curricular:</td>
              <td className={`${printHeaderValueCellClass} whitespace-nowrap`}>{areaName || '-'}</td>
              <td className={printHeaderDarkCellClass}>Sección:</td>
              <td className={printHeaderValueCellClass}>{section || '-'}</td>
              <td className={printHeaderDarkCellClass}>Bimestre:</td>
              <td className={printHeaderValueCellClass}>{bimesterLabel || inferBimesterLabelFromUnitNumber(unitNumber || '') || '-'}</td>
              <td className={printHeaderDarkCellClass}>Modalidad:</td>
              <td className={printHeaderValueCellClass}>{mode === 'unit' ? 'Consolidado por unidad' : 'Consolidado por bimestre'}</td>
            </tr>
            <tr>
              <td className={printHeaderDarkCellClass}>Docente:</td>
              <td className={`${printHeaderValueCellClass} whitespace-nowrap`}>{teacherName || '-'}</td>
              <td className={printHeaderDarkCellClass}>Año:</td>
              <td className={printHeaderValueCellClass}>{year || '-'}</td>
              <td className={printHeaderDarkCellClass}>Estudiantes:</td>
              <td className={printHeaderValueCellClass}>{totals.enrolled}</td>
              <td className={printHeaderDarkCellClass}>Evaluados:</td>
              <td className={printHeaderValueCellClass}>{totals.evaluated}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderPrintFooter = () => (
    <div className="session-register-print-footer hidden print:grid">
      <span className="justify-self-start">{areaName || 'Área curricular'}</span>
      <span className="justify-self-center">{mode === 'unit' ? `Unidad ${unitNumber || '-'}` : `Bimestre ${bimesterLabel || '-'}`}</span>
      <span className="justify-self-end">{teacherName || 'Docente'}</span>
    </div>
  );

  const renderLevelCell = (
    code: RegisterLevelCode | '',
    extra = '',
    useSpecialTone = false,
    variant: 'detail' | 'logro' = 'detail',
    tooltipText = ''
  ) => {
    const baseTone = variant === 'detail'
      ? (LEVEL_CELL_TONE_MAP[code] || 'bg-slate-50 text-slate-700')
      : (LEVEL_SOLID_TONE_MAP[code] || 'bg-slate-700 text-white');

    return (
      <td className={`group relative border px-1 py-0.5 text-center text-[10px] font-black ${useSpecialTone ? 'border-white/10 bg-inherit text-inherit shadow-none' : `${baseTone} border-slate-300`} ${extra}`}>
        {LEVEL_LABEL_MAP[code] || 'NE'}
        {showSessionSources && tooltipText && !useSpecialTone && (
          <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-48 -translate-x-1/2 rounded-xl bg-slate-950 px-3 py-2 text-[10px] font-medium normal-case text-white shadow-2xl group-hover:block print:hidden">
            <div className="mb-1 text-[9px] font-black uppercase tracking-wide text-emerald-300">Sesiones origen</div>
            <div className="leading-tight">{tooltipText}</div>
          </div>
        )}
      </td>
    );
  };

  const renderLevelCellWithSources = (
    code: RegisterLevelCode | '',
    extra = '',
    useSpecialTone = false,
    variant: 'detail' | 'logro' = 'detail',
    tooltipText = ''
  ) => (
    renderLevelCell(code, extra, useSpecialTone, variant, tooltipText)
  );

  return (
    <div className="space-y-6">
      {toastData ? <FloatingToast message={toastData.msg} subtext={toastData.sub} type={toastData.type} onClose={() => setToastData(null)} /> : null}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden print:rounded-none print:border-none print:shadow-none">
        <div className={`h-2 ${accentClassName} print:hidden`}></div>
        <div className="p-8 space-y-6 print:p-0">
          <div className="flex items-start justify-between gap-4 print:hidden">
            <div className="flex items-start gap-4">
              <div className={`rounded-3xl px-4 py-3 text-sm font-black text-white shadow-lg ${accentClassName}`}>{badge}</div>
              <div>
                <h2 className="text-2xl font-black italic uppercase tracking-tight text-slate-800">{title}</h2>
                <p className="mt-2 max-w-3xl text-sm font-medium leading-relaxed text-slate-500">{description}</p>
                {aiConclusionMessage ? (
                  <div className={`mt-3 inline-flex rounded-2xl px-4 py-2 text-[11px] font-bold ${aiConclusionMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                    {aiConclusionMessage.text}
                  </div>
                ) : null}
                {copySiagieMessage ? (
                  <div className={`mt-3 ml-2 inline-flex rounded-2xl px-4 py-2 text-[11px] font-bold ${copySiagieMessage.type === 'success' ? 'bg-sky-50 text-sky-700' : 'bg-rose-50 text-rose-700'}`}>
                    {copySiagieMessage.text}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {mode === 'bimester' ? (
                <button
                  type="button"
                  onClick={generateAiConclusions}
                  disabled={isGeneratingAiConclusions || loading || detailLoading || !aggregation}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-600 text-white shadow-lg transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Llenar conclusiones descriptivas con IA"
                  aria-label="Llenar conclusiones descriptivas con IA"
                >
                  <SparklesMiniIcon />
                </button>
              ) : null}
              {mode === 'bimester' ? (
                <button
                  type="button"
                  onClick={copyAreaCompetenciesForSiagie}
                  disabled={loading || detailLoading || !aggregation || !primaryCapacityGroups.length}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 text-sky-700 shadow-sm transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Copiar notas y conclusiones del área para SIAGIE"
                  aria-label="Copiar notas y conclusiones del área para SIAGIE"
                >
                  <CopyMiniIcon />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setShowSessionSources((prev) => !prev)}
                title={showSessionSources ? 'Ocultar sesiones origen' : 'Mostrar sesiones origen'}
                aria-label={showSessionSources ? 'Ocultar sesiones origen' : 'Mostrar sesiones origen'}
                aria-pressed={showSessionSources}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border text-lg font-black leading-none transition ${
                  showSessionSources
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
                }`}
              >
                {showSessionSources ? <TooltipVisibleIcon /> : <TooltipHiddenIcon />}
              </button>
              <button
                onClick={() => window.print()}
                title="Imprimir registro"
                aria-label="Imprimir registro"
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl text-lg text-white font-black leading-none bg-slate-900 hover:bg-slate-800"
              >
                <PrintMiniIcon />
              </button>
            </div>
          </div>

          <div className="hidden print:block print:px-8 print:pt-4">
            {renderPrintHeader(title)}
          </div>

          {mode === 'unit' ? (
            <div className="flex flex-wrap items-end gap-3 print:hidden">
              <div className="w-[84px]"><Select label="Anio" name="year" value={year} onChange={(e) => setYear(String(e.target.value || ''))} options={years.map((v) => ({ value: v, label: v }))} variant="compact" /></div>
              <div className="w-[220px]"><Select label="Area" name="areaId" value={areaId} onChange={(e) => setAreaId(String(e.target.value || ''))} options={areaIds.map((v) => ({ value: v, label: areaLabelMap.get(v) || v }))} variant="compact" searchable /></div>
              <div className="w-[88px]"><Select label="Grado" name="grade" value={grade} onChange={(e) => setGrade(String(e.target.value || ''))} options={grades.map((v) => ({ value: v, label: v }))} variant="compact" /></div>
              <div className="w-[96px]"><Select label="Seccion" name="section" value={section} onChange={(e) => setSection(String(e.target.value || ''))} options={sections.map((v) => ({ value: v, label: v }))} variant="compact" /></div>
              <div className="w-[86px]"><Select label="Unidad" name="unitNumber" value={unitNumber} onChange={(e) => setUnitNumber(String(e.target.value || ''))} options={units.map((v) => ({ value: v, label: `U${v}` }))} variant="compact" /></div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3 print:hidden">
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
            <div className={`rounded-[2rem] border border-slate-200 ${theme.tableTone} p-4 shadow-sm print:rounded-none print:border-none print:bg-white print:p-2 print:pt-0 print:shadow-none`}>
              <div className="overflow-hidden rounded-[1.5rem] border border-slate-300 bg-white print:hidden">
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

              <div className="mt-4 overflow-x-auto rounded-[1.5rem] border border-slate-300 bg-white print:mt-1 print:overflow-visible">
                <table className={`${hasExpandedConclusions ? 'min-w-[2200px] table-auto' : 'w-full table-fixed'} border-collapse text-[8px]`}>
                  <thead>
                    <tr>
                      <th rowSpan={2} className={`w-[24px] border border-slate-300 px-0.5 py-1 text-center font-black uppercase ${theme.headerMid}`}>N°</th>
                      <th rowSpan={2} className={`w-[230px] border border-slate-300 px-1 py-1 text-center font-black uppercase ${theme.headerMid}`}>Apellidos y nombres</th>
                      {primaryCapacityGroups.map((group: any) => <th key={group.competencyKey} colSpan={isConclusionExpanded(group.competencyKey) ? 2 : group.capacities.length + 1} className={`border border-slate-300 px-2 py-1 text-center font-black uppercase ${theme.headerDark}`}>{group.competencyName}</th>)}
                      {transversalCapacityGroups.map((group: any) => <th key={group.competencyKey} colSpan={isConclusionExpanded(group.competencyKey) ? 2 : group.capacities.length + 1} className={`border border-slate-300 px-2 py-1 text-center font-black uppercase ${theme.transHeader}`}>{group.competencyName}</th>)}
                    </tr>
                    <tr>
                      {primaryCapacityGroups.map((group: any) => (
                        <React.Fragment key={`label-${group.competencyKey}`}>
                          {!isConclusionExpanded(group.competencyKey) ? group.capacities.map((capacity: any) => <th key={`${capacity.key}-label`} className="border border-slate-300 px-0.5 py-0.5 text-center text-[7px] font-semibold leading-tight text-slate-500 break-words">{capacity.capacityName}</th>) : null}
                          <th className={`w-[44px] border border-slate-300 px-0.5 py-0.5 text-center text-[7px] font-semibold uppercase ${theme.headerMid}`}>
                            <div className="flex flex-col items-center gap-1">
                              <span>Logro</span>
                              <button
                                type="button"
                                onClick={() => setExpandedConclusions((prev) => ({ ...prev, [group.competencyKey]: !prev[group.competencyKey] }))}
                                className="inline-flex items-center justify-center rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-black leading-none hover:bg-white/25 print:hidden"
                                title={isConclusionExpanded(group.competencyKey) ? 'Ocultar conclusión' : 'Mostrar conclusión'}
                              >
                                <ToggleConclusionIcon expanded={isConclusionExpanded(group.competencyKey)} />
                              </button>
                            </div>
                          </th>
                          {isConclusionExpanded(group.competencyKey) ? (
                            <th className={`w-[520px] min-w-[520px] border border-slate-300 px-1 py-0.5 text-left text-[7px] font-semibold uppercase ${theme.headerMid}`}>Conclusión</th>
                          ) : null}
                        </React.Fragment>
                      ))}
                      {transversalCapacityGroups.map((group: any) => (
                        <React.Fragment key={`tlabel-${group.competencyKey}`}>
                          {!isConclusionExpanded(group.competencyKey) ? group.capacities.map((capacity: any) => <th key={`${capacity.key}-tlabel`} className="border border-slate-300 px-0.5 py-0.5 text-center text-[7px] font-semibold leading-tight text-slate-500 break-words">{capacity.capacityName}</th>) : null}
                          <th className={`w-[44px] border border-slate-300 px-0.5 py-0.5 text-center text-[7px] font-semibold uppercase ${theme.transHeader}`}>
                            <div className="flex flex-col items-center gap-1">
                              <span>Logro</span>
                              <button
                                type="button"
                                onClick={() => setExpandedConclusions((prev) => ({ ...prev, [group.competencyKey]: !prev[group.competencyKey] }))}
                                className="inline-flex items-center justify-center rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-black leading-none hover:bg-white/25 print:hidden"
                                title={isConclusionExpanded(group.competencyKey) ? 'Ocultar conclusión' : 'Mostrar conclusión'}
                              >
                                <ToggleConclusionIcon expanded={isConclusionExpanded(group.competencyKey)} />
                              </button>
                            </div>
                          </th>
                          {isConclusionExpanded(group.competencyKey) ? (
                            <th className={`w-[520px] min-w-[520px] border border-slate-300 px-1 py-0.5 text-left text-[7px] font-semibold uppercase ${theme.transHeader}`}>Conclusión</th>
                          ) : null}
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
                            {!isConclusionExpanded(group.competencyKey) ? group.capacities.map((capacity: any) => renderLevelCellWithSources(
                              getAggregatedCapacityCode(student, capacity.key) || getAggregatedCapacityCodeByMeta(student, group.competencyName, capacity.capacityName),
                              '',
                              hasSpecialRow,
                              'detail',
                              formatSessionSources(getCapacitySessionSources(student.studentId, capacity.key))
                            )) : null}
                            {renderLevelCellWithSources(
                              getUnitCompetencyDisplayCode(student, group.competencyKey, group.capacities, group.competencyName),
                              'border-l-2 border-l-slate-500',
                              hasSpecialRow,
                              'logro',
                              formatSessionSources(getCompetencySessionSources(student.studentId, group.competencyKey))
                            )}
                            {isConclusionExpanded(group.competencyKey) ? (
                              <td className={`w-[520px] min-w-[520px] border px-2 py-1 align-top ${hasSpecialRow ? 'border-white/10 bg-inherit text-inherit' : 'border-slate-300 bg-white/80'}`}>
                                <textarea
                                  className={`w-full min-h-[84px] resize-none rounded-lg border px-2 py-1 text-[8px] leading-tight outline-none ${hasSpecialRow ? 'border-white/20 bg-white/10 text-inherit placeholder:text-white/60' : 'border-slate-200 bg-white text-slate-700 focus:border-sky-300'}`}
                                  value={getEditableConclusionValue(student, group.competencyKey, group.capacities, group.competencyName)}
                                  onInput={(e) => autoResizeTextarea(e.currentTarget)}
                                  onChange={(e) => setEditableConclusions((prev) => ({
                                    ...prev,
                                    [getConclusionKey(student.studentId, group.competencyKey)]: e.target.value
                                  }))}
                                />
                              </td>
                            ) : null}
                          </React.Fragment>
                        ))}
                        {transversalCapacityGroups.map((group: any) => (
                          <React.Fragment key={`trow-${student.studentId}-${group.competencyKey}`}>
                            {!isConclusionExpanded(group.competencyKey) ? group.capacities.map((capacity: any) => renderLevelCellWithSources(
                              getAggregatedCapacityCode(student, capacity.key) || getAggregatedCapacityCodeByMeta(student, group.competencyName, capacity.capacityName),
                              '',
                              hasSpecialRow,
                              'detail',
                              formatSessionSources(getCapacitySessionSources(student.studentId, capacity.key))
                            )) : null}
                            {renderLevelCellWithSources(
                              getUnitCompetencyDisplayCode(student, group.competencyKey, group.capacities, group.competencyName),
                              'border-l-2 border-l-emerald-700',
                              hasSpecialRow,
                              'logro',
                              formatSessionSources(getCompetencySessionSources(student.studentId, group.competencyKey))
                            )}
                            {isConclusionExpanded(group.competencyKey) ? (
                              <td className={`w-[520px] min-w-[520px] border px-2 py-1 align-top ${hasSpecialRow ? 'border-white/10 bg-inherit text-inherit' : 'border-slate-300 bg-white/80'}`}>
                                <textarea
                                  className={`w-full min-h-[84px] resize-none rounded-lg border px-2 py-1 text-[8px] leading-tight outline-none ${hasSpecialRow ? 'border-white/20 bg-white/10 text-inherit placeholder:text-white/60' : 'border-slate-200 bg-white text-slate-700 focus:border-emerald-300'}`}
                                  value={getEditableConclusionValue(student, group.competencyKey, group.capacities, group.competencyName)}
                                  onInput={(e) => autoResizeTextarea(e.currentTarget)}
                                  onChange={(e) => setEditableConclusions((prev) => ({
                                    ...prev,
                                    [getConclusionKey(student.studentId, group.competencyKey)]: e.target.value
                                  }))}
                                />
                              </td>
                            ) : null}
                          </React.Fragment>
                        ))}
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap gap-3 print:hidden">
                <div className="rounded-xl bg-slate-900 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">Matriculados: {totals.enrolled}</div>
                <div className="rounded-xl bg-sky-700 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">Evaluados: {totals.evaluated}</div>
                <div className="rounded-xl bg-violet-700 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">No evaluados: {totals.notEvaluated}</div>
                <div className="rounded-xl bg-emerald-700 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">Aprobados: {totals.approved}</div>
                <div className="rounded-xl bg-orange-600 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">En proceso: {totals.inProgress}</div>
                <div className="rounded-xl bg-rose-600 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">En inicio: {totals.atStart}</div>
              </div>

              <div className="hidden print:block print:px-1 print:pt-3">
                {renderPrintFooter()}
              </div>
            </div>
          )}

          {mode === 'unit' && !!sessionCapacityDebugRows.length && (
            <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm print:hidden">
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

          {mode === 'bimester' && !!bimesterCapacityTraceRows.length && (
            <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm print:hidden">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Trazabilidad</p>
                  <h3 className="mt-1 text-lg font-black uppercase text-slate-800">Capacidades que forman el bimestre</h3>
                  <p className="mt-1 text-[11px] font-medium text-slate-500">
                    Cada capacidad del bimestre se calcula con las sesiones donde esa capacidad fue evaluada en las dos unidades del bimestre.
                  </p>
                </div>
                <div className="rounded-2xl bg-amber-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-amber-700">
                  {bimesterCapacityTraceRows.length} capacidades
                </div>
              </div>

              <div className="mt-4 overflow-x-auto rounded-[1.5rem] border border-slate-200">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-slate-900 text-white">
                      <th className="border border-slate-200 px-3 py-3 text-left font-black uppercase">Competencia</th>
                      <th className="border border-slate-200 px-3 py-3 text-left font-black uppercase">Capacidad</th>
                      <th className="border border-slate-200 px-3 py-3 text-center font-black uppercase">Unidades</th>
                      <th className="border border-slate-200 px-3 py-3 text-left font-black uppercase">Sesiones que aportan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bimesterCapacityTraceRows.map((row, index) => (
                      <tr key={row.capacityKey} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}>
                        <td className="border border-slate-200 px-3 py-2 font-bold text-slate-800">{row.competencyName}</td>
                        <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.capacityName}</td>
                        <td className="border border-slate-200 px-3 py-2 text-center font-black text-amber-700">{row.units.join(', ') || '-'}</td>
                        <td className="border border-slate-200 px-3 py-2 text-slate-600">{row.sessions.join(', ') || 'Sin sesiones con evidencia'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-[11px] font-medium text-slate-600">
                Fórmula usada: primero se promedia cada capacidad con todas sus sesiones del bimestre; luego la competencia se calcula con el promedio de esas capacidades consolidadas.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
