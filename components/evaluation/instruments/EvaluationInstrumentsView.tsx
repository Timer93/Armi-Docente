import React, { useEffect, useMemo, useState } from 'react';
import { deleteInstrumento, getDatosGenerales, getInstrumentos, saveInstrumento } from '../../../services/apiService';
import { GeneralData, TeachingAssignment } from '../../../types';
import { ChecklistEditor } from './ChecklistEditor';
import { GuideEditor } from './GuideEditor';
import { InstrumentPreviewCard, InstrumentThumbnail } from './InstrumentPreview';
import { InstrumentTableEditor } from './InstrumentTableEditor';
import { LayoutContextMenu, LayoutFormatPanel } from './LayoutFormattingControls';
import { RubricaEditor } from './RubricaEditor';
import { ScaleEditor } from './ScaleEditor';
import { useInstrumentLayoutEditor } from './useInstrumentLayoutEditor';

import { getChecklistOptionConfig, normalizeChecklistOptionValue } from './checklist';
import {
  getGuideCriterionStartCol,
  getGuideLevelForColumn,
  normalizeGuideStructure
} from './guide';
import {
  ensureRubricaHeaderStyles,
  normalizeRubricaStructure
} from './rubrica';
import {
  ensureScaleLayout,
  getScaleLabels,
  getScaleLevelForColumn,
  normalizeScaleCompetencies,
  normalizeScaleStructure
} from './scale';
import {
  QUICK_LAYOUT_COLORS,
  clampCount,
  layoutCellId,
  mkId,
  normalizeDesign,
  normalizeLoose
} from './common';
import { DEFAULT_TEMPLATES, normalizeByType } from './templates';
import { InstrumentRecord, InstrumentType, TemplateDef } from './types';


export const EvaluationInstruments: React.FC = () => {
  const currentYear = new Date().getFullYear().toString();
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [generalData, setGeneralData] = useState<GeneralData | null>(null);
  const [filters, setFilters] = useState({
    year: currentYear,
    areaId: '',
    grade: '',
    section: ''
  });

  const [instruments, setInstruments] = useState<InstrumentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [toast, setToast] = useState<string>('');
  const [previewInstrument, setPreviewInstrument] = useState<InstrumentRecord | null>(null);
  const [showEditorPreview, setShowEditorPreview] = useState(false);

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editor, setEditor] = useState<InstrumentRecord>({
    year: currentYear,
    areaId: '',
    grade: '',
    section: '',
    type: 'rubrica',
    name: '',
    structure: normalizeByType('rubrica', DEFAULT_TEMPLATES[0].structure),
    version: 1
  });

  const {
    layout,
    layoutSelectedCount,
    selectedLayoutStyle,
    layoutMenu,
    setLayoutMenu,
    layoutDragTool,
    setLayoutDragTool,
    showFillPalette,
    setShowFillPalette,
    showTextPalette,
    setShowTextPalette,
    showMergeMenu,
    setShowMergeMenu,
    showOrientationMenu,
    setShowOrientationMenu,
    showBorderMenu,
    setShowBorderMenu,
    showBorderColorPalette,
    setShowBorderColorPalette,
    showBorderStyleMenu,
    setShowBorderStyleMenu,
    setLayoutSelection,
    findLayoutMergeAt,
    inLayoutSelection,
    isLayoutCovered,
    setLayoutText,
    insertLayoutRow,
    insertLayoutCol,
    mergeLayoutSelection,
    unmergeLayoutSelection,
    mergeLayoutHorizontal,
    onLayoutCellMouseDown,
    onLayoutCellEnter,
    onLayoutCellContext,
    closeFormatPopovers,
    applyLayoutStyle,
    toggleLayoutStyle,
    applyBgColor,
    applyTextColor,
    applyBorderColor,
    applyBorderStyleKind,
    applyBordersToSelection
  } = useInstrumentLayoutEditor({ editor, setEditor });

  const structureSummary = useMemo(() => {
    if (editor.type === 'rubrica') return `${editor.structure?.criteria?.length || 0} criterios`;
    if (editor.type === 'lista_cotejo') {
      const compCount = editor.structure?.competencies?.length || editor.structure?.competenciesCount || 0;
      const capCount = (editor.structure?.competencies || []).reduce((acc: number, comp: any) => acc + (comp?.capacities?.length || 0), 0);
      const critCount = editor.structure?.items?.length || 0;
      return `${compCount} comp. / ${capCount} cap. / ${critCount} crit.`;
    }
    if (editor.type === 'escala_valoracion') {
      const compCount = editor.structure?.competencies?.length || editor.structure?.scale?.competenciesCount || 0;
      const capCount = (editor.structure?.competencies || []).reduce((acc: number, comp: any) => acc + (comp?.capacities?.length || 0), 0);
      const critCount = (editor.structure?.competencies || []).reduce((acc: number, comp: any) => acc + (comp?.capacities || []).reduce((inner: number, cap: any) => inner + (cap?.criteria?.length || 0), 0), 0);
      return `${compCount} comp. / ${capCount} cap. / ${critCount} crit.`;
    }
    const compCount = editor.structure?.competencies?.length || editor.structure?.competenciesCount || 0;
    const capCount = (editor.structure?.competencies || []).reduce((acc: number, comp: any) => acc + (comp?.capacities?.length || 0), 0);
    const critCount = (editor.structure?.competencies || []).reduce((acc: number, comp: any) => acc + (comp?.capacities || []).reduce((inner: number, cap: any) => inner + (cap?.criteria?.length || 0), 0), 0);
    return `${compCount} comp. / ${capCount} cap. / ${critCount} crit.`;
  }, [editor.type, editor.structure]);

  const areaOptions = useMemo(() => {
    const uniq = new Map<string, string>();
    assignments.forEach(a => {
      if (a.areaId && !uniq.has(a.areaId)) uniq.set(a.areaId, a.areaName || a.areaId);
    });
    return Array.from(uniq.entries()).map(([value, label]) => ({ value, label }));
  }, [assignments]);

  const filterGradeOptions = useMemo(() => {
    const rows = filters.areaId ? assignments.filter(a => a.areaId === filters.areaId) : assignments;
    return Array.from(new Set(rows.map(a => a.grade))).sort();
  }, [assignments, filters.areaId]);

  const filterSectionOptions = useMemo(() => {
    const rows = assignments.filter(a => (!filters.areaId || a.areaId === filters.areaId) && (!filters.grade || a.grade === filters.grade));
    return Array.from(new Set(rows.map(a => a.section))).sort();
  }, [assignments, filters.areaId, filters.grade]);

  const editorGradeOptions = useMemo(() => {
    const rows = editor.areaId ? assignments.filter(a => a.areaId === editor.areaId) : assignments;
    return Array.from(new Set(rows.map(a => a.grade))).sort();
  }, [assignments, editor.areaId]);

  const editorSectionOptions = useMemo(() => {
    const rows = assignments.filter(a => (!editor.areaId || a.areaId === editor.areaId) && (!editor.grade || a.grade === editor.grade));
    return Array.from(new Set(rows.map(a => a.section))).sort();
  }, [assignments, editor.areaId, editor.grade]);

  useEffect(() => {
    loadInstruments();
  }, []);

  useEffect(() => {
    const savedAssign = localStorage.getItem('armi_assignments');
    if (!savedAssign) return;
    try {
      const parsed = JSON.parse(savedAssign);
      if (Array.isArray(parsed)) setAssignments(parsed);
    } catch {
      // ignore local parse errors
    }
  }, []);

  useEffect(() => {
    getDatosGenerales()
      .then(setGeneralData)
      .catch(() => {
        // ignore fetch errors; preview has fallbacks
      });
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const loadInstruments = async () => {
    setLoading(true);
    try {
      const res = await getInstrumentos(filters);
      if (res.success) {
        const rows = (res.data || []).map((r: any) => ({
          id: r.id,
          year: r.year || '',
          areaId: r.area_id || r.areaId || '',
          grade: r.grade || '',
          section: r.section || '',
          type: r.type,
          name: r.name,
          structure: normalizeByType(r.type, r.structure),
          version: Number(r.version || 1)
        })) as InstrumentRecord[];
        setInstruments(rows);
      } else {
        showToast(`Error: ${res.message || 'No se pudieron cargar instrumentos'}`);
      }
    } catch {
      showToast('Error de conexión al cargar instrumentos');
    } finally {
      setLoading(false);
    }
  };

  const openCreateFromTemplate = (tpl: TemplateDef) => {
    setEditor({
      year: currentYear,
      areaId: filters.areaId,
      grade: filters.grade,
      section: filters.section,
      type: tpl.type,
      name: `${tpl.label} - ${filters.grade || 'General'}`,
      structure: normalizeByType(tpl.type, tpl.structure),
      version: 1
    });
    setIsEditorOpen(true);
  };

  const openEdit = (inst: InstrumentRecord) => {
    setEditor({
      ...inst,
      structure: normalizeByType(inst.type, inst.structure),
      version: Number(inst.version || 1)
    });
    setIsEditorOpen(true);
  };

  const openDuplicate = (inst: InstrumentRecord) => {
    setEditor({
      ...inst,
      id: undefined,
      year: currentYear,
      name: `${inst.name} (Copia)`,
      structure: normalizeByType(inst.type, inst.structure),
      version: Number(inst.version || 1)
    });
    setIsEditorOpen(true);
  };

  const saveEditor = async () => {
    if (!editor.name.trim()) {
      showToast('Ingresa un nombre para el instrumento');
      return;
    }
    if (!editor.areaId) {
      showToast('Selecciona el área');
      return;
    }
    if (!editor.type) {
      showToast('Selecciona el tipo de instrumento');
      return;
    }

    const payload = {
      id: editor.id,
      year: editor.year || currentYear,
      areaId: editor.areaId,
      grade: editor.grade,
      section: editor.section,
      type: editor.type,
      name: editor.name.trim(),
      structure: normalizeByType(editor.type, editor.structure),
      version: editor.version || 1
    };

    try {
      const res = await saveInstrumento(payload);
      if (!res.success) {
        showToast(`No se pudo guardar: ${res.message || 'Error desconocido'}`);
        return;
      }
      setIsEditorOpen(false);
      showToast('Instrumento guardado');
      await loadInstruments();
    } catch {
      showToast('Error de conexión al guardar');
    }
  };

  const handleDelete = async (id?: number, e?: React.MouseEvent<HTMLButtonElement>) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!id || deletingId === id) return;
    if (!confirm('¿Eliminar este instrumento de evaluación?')) return;
    setDeletingId(id);
    try {
      const res = await deleteInstrumento(id);
      if (!res.success) {
        showToast(`No se pudo eliminar: ${res.message || 'error'}`);
        return;
      }
      showToast('Instrumento eliminado');
      await loadInstruments();
    } catch {
      showToast('Error de conexión al eliminar');
    } finally {
      setDeletingId(null);
    }
  };

  const changeType = (nextType: InstrumentType) => {
    const template = DEFAULT_TEMPLATES.find(t => t.type === nextType) || DEFAULT_TEMPLATES[0];
    setEditor(prev => ({
      ...prev,
      type: nextType,
      structure: normalizeByType(nextType, template.structure)
    }));
  };

  const updateRubricaLevel = (idx: number, value: string) => {
    const levels = [...(editor.structure?.levels || [])];
    levels[idx] = { ...levels[idx], label: value };
    setEditor(prev => ({ ...prev, structure: { ...prev.structure, levels } }));
  };

  const setRubricaCriteriaCount = (value: string) => {
    const count = clampCount(value, 4, 1, 30);
    const current = editor.structure?.criteria || [];
    const criteria = Array.from({ length: count }, (_, idx) => ({
      id: current[idx]?.id || mkId(),
      name: current[idx]?.name || `Criterio ${idx + 1}`
    }));
    setEditor(prev => ({ ...prev, structure: { ...prev.structure, criteriaCount: count, criteria } }));
  };

  const updateRubricaCriterionName = (idx: number, value: string) => {
    const criteria = [...(editor.structure?.criteria || [])];
    criteria[idx] = { ...criteria[idx], name: value };
    setEditor(prev => ({ ...prev, structure: { ...prev.structure, criteria } }));
  };

  const updateChecklistCounts = (patch: Partial<{ competenciesCount: number; capacitiesPerCompetency: number; criteriaPerCapacity: number }>) => {
    setEditor(prev => ({
      ...prev,
      structure: normalizeByType('lista_cotejo', {
        ...prev.structure,
        ...patch
      })
    }));
  };

  const updateChecklistCompetencyName = (competencyIndex: number, value: string) => {
    setEditor(prev => {
      const competencies = [...(prev.structure?.competencies || [])];
      const current = competencies[competencyIndex] || { id: mkId(), capacities: [] };
      competencies[competencyIndex] = { ...current, name: value };
      return {
        ...prev,
        structure: normalizeByType('lista_cotejo', {
          ...prev.structure,
          competencies
        })
      };
    });
  };

  const updateChecklistCapacityName = (competencyIndex: number, capacityIndex: number, value: string) => {
    setEditor(prev => {
      const competencies = [...(prev.structure?.competencies || [])];
      const competency = { ...(competencies[competencyIndex] || { id: mkId(), capacities: [] }) };
      const capacities = [...(competency.capacities || [])];
      const current = capacities[capacityIndex] || { id: mkId(), criteria: [] };
      capacities[capacityIndex] = { ...current, name: value };
      competency.capacities = capacities;
      competencies[competencyIndex] = competency;
      return {
        ...prev,
        structure: normalizeByType('lista_cotejo', {
          ...prev.structure,
          competencies
        })
      };
    });
  };

  const updateChecklistCriterionName = (competencyIndex: number, capacityIndex: number, criterionIndex: number, value: string) => {
    setEditor(prev => {
      const competencies = [...(prev.structure?.competencies || [])];
      const competency = { ...(competencies[competencyIndex] || { id: mkId(), capacities: [] }) };
      const capacities = [...(competency.capacities || [])];
      const capacity = { ...(capacities[capacityIndex] || { id: mkId(), criteria: [] }) };
      const criteria = [...(capacity.criteria || [])];
      const current = criteria[criterionIndex] || { id: mkId() };
      criteria[criterionIndex] = { ...current, name: value };
      capacity.criteria = criteria;
      capacities[capacityIndex] = capacity;
      competency.capacities = capacities;
      competencies[competencyIndex] = competency;
      return {
        ...prev,
        structure: normalizeByType('lista_cotejo', {
          ...prev.structure,
          competencies
        })
      };
    });
  };

  const updateChecklistOptions = (value: string) => {
    const normalized = normalizeChecklistOptionValue(value);
    const nextExpectedLabel = normalized === 'custom'
      ? { mode: 'custom', positive: 'Opción 1', negative: 'Opción 2' }
      : normalized;
    setEditor(prev => ({
      ...prev,
      structure: normalizeByType('lista_cotejo', {
        ...prev.structure,
        expectedLabel: nextExpectedLabel
      })
    }));
  };

  const updateChecklistCustomOption = (field: 'positive' | 'negative', value: string) => {
    setEditor(prev => ({
      ...prev,
      structure: normalizeByType('lista_cotejo', {
        ...prev.structure,
        expectedLabel: {
          mode: 'custom',
          positive: field === 'positive' ? value : String(prev.structure?.expectedLabel?.positive || 'Opción 1'),
          negative: field === 'negative' ? value : String(prev.structure?.expectedLabel?.negative || 'Opción 2')
        }
      })
    }));
  };

  const updateChecklistSelection = (row: number, col: number, checked: boolean) => {
    setEditor(prev => {
      const currentLayout = prev.structure?.layout || {};
      const nextTexts = { ...(currentLayout.texts || {}) };
      delete nextTexts[layoutCellId(row, 2)];
      delete nextTexts[layoutCellId(row, 3)];
      if (checked) {
        const optionConfig = getChecklistOptionConfig(prev.structure?.expectedLabel);
        const value = col === 2 ? optionConfig.positive : optionConfig.negative;
        if (value) nextTexts[layoutCellId(row, col)] = value;
      }
      return {
        ...prev,
        structure: normalizeByType('lista_cotejo', {
          ...prev.structure,
          layout: { ...currentLayout, texts: nextTexts }
        })
      };
    });
  };

  const updateScaleCounts = (patch: Partial<{ competenciesCount: number; capacitiesPerCompetency: number; criteriaPerCapacity: number }>) => {
    setEditor(prev => {
      const scale = {
        ...(prev.structure?.scale || {}),
        ...patch
      };
      return {
        ...prev,
        structure: normalizeByType('escala_valoracion', {
          ...prev.structure,
          scale
        })
      };
    });
  };

  const updateScaleCompetencyName = (competencyIndex: number, value: string) => {
    setEditor(prev => {
      const { competencies } = normalizeScaleCompetencies(prev.structure);
      competencies[competencyIndex] = { ...competencies[competencyIndex], name: value };
      return { ...prev, structure: normalizeByType('escala_valoracion', { ...prev.structure, competencies }) };
    });
  };

  const updateScaleCapacityName = (competencyIndex: number, capacityIndex: number, value: string) => {
    setEditor(prev => {
      const { competencies } = normalizeScaleCompetencies(prev.structure);
      const competency = competencies[competencyIndex];
      const capacities = [...(competency?.capacities || [])];
      capacities[capacityIndex] = { ...capacities[capacityIndex], name: value };
      competencies[competencyIndex] = { ...competency, capacities };
      return { ...prev, structure: normalizeByType('escala_valoracion', { ...prev.structure, competencies }) };
    });
  };

  const updateScaleCriterionName = (competencyIndex: number, capacityIndex: number, criterionIndex: number, value: string) => {
    setEditor(prev => {
      const { competencies } = normalizeScaleCompetencies(prev.structure);
      const competency = competencies[competencyIndex];
      const capacities = [...(competency?.capacities || [])];
      const capacity = capacities[capacityIndex];
      const criteria = [...(capacity?.criteria || [])];
      criteria[criterionIndex] = { ...criteria[criterionIndex], name: value };
      capacities[capacityIndex] = { ...capacity, criteria };
      competencies[competencyIndex] = { ...competency, capacities };
      return { ...prev, structure: normalizeByType('escala_valoracion', { ...prev.structure, competencies }) };
    });
  };

  const updateScaleLabel = (idx: number, value: string) => {
    const labels = [...getScaleLabels(editor.structure)];
    labels[idx] = value;
    setEditor(prev => ({
      ...prev,
      structure: normalizeByType('escala_valoracion', {
        ...prev.structure,
        scale: {
          ...(prev.structure?.scale || {}),
          labels
        }
      })
    }));
  };

  const updateScaleLevelSelection = (row: number, col: number, checked: boolean) => {
    setEditor(prev => {
      const currentLayout = prev.structure?.layout || {};
      const nextTexts = { ...(currentLayout.texts || {}) };
      const labelCount = getScaleLabels(prev.structure).length;
      for (let levelCol = 2; levelCol < labelCount + 2; levelCol += 1) delete nextTexts[layoutCellId(row, levelCol)];
      if (checked) nextTexts[layoutCellId(row, col)] = getScaleLevelForColumn(prev.structure, col);
      return {
        ...prev,
        structure: normalizeByType('escala_valoracion', {
          ...prev.structure,
          layout: { ...currentLayout, texts: nextTexts }
        })
      };
    });
  };

  const updateGuideCounts = (patch: Partial<{ competenciesCount: number; capacitiesPerCompetency: number; criteriaPerCapacity: number }>) => {
    setEditor(prev => ({
      ...prev,
      structure: normalizeByType('guia_observacion', {
        ...prev.structure,
        competenciesCount: 1,
        ...patch
      })
    }));
  };

  const updateGuideCapacityName = (competencyIndex: number, capacityIndex: number, value: string) => {
    setEditor(prev => {
      const competencies = [...(prev.structure?.competencies || [])];
      const competency = { ...(competencies[competencyIndex] || { id: mkId(), capacities: [] }) };
      const capacities = [...(competency.capacities || [])];
      const current = capacities[capacityIndex] || { id: mkId(), criteria: [] };
      capacities[capacityIndex] = { ...current, name: value };
      competency.capacities = capacities;
      competencies[competencyIndex] = competency;
      return {
        ...prev,
        structure: normalizeByType('guia_observacion', {
          ...prev.structure,
          competencies
        })
      };
    });
  };

  const updateGuideCriterionName = (competencyIndex: number, capacityIndex: number, criterionIndex: number, value: string) => {
    setEditor(prev => {
      const competencies = [...(prev.structure?.competencies || [])];
      const competency = { ...(competencies[competencyIndex] || { id: mkId(), capacities: [] }) };
      const capacities = [...(competency.capacities || [])];
      const capacity = { ...(capacities[capacityIndex] || { id: mkId(), criteria: [] }) };
      const criteria = [...(capacity.criteria || [])];
      const current = criteria[criterionIndex] || { id: mkId() };
      criteria[criterionIndex] = { ...current, name: value };
      capacity.criteria = criteria;
      capacities[capacityIndex] = capacity;
      competency.capacities = capacities;
      competencies[competencyIndex] = competency;
      return {
        ...prev,
        structure: normalizeByType('guia_observacion', {
          ...prev.structure,
          competencies
        })
      };
    });
  };

  const updateGuideCapacityNameByFlatIndex = (flatIndex: number, value: string) => {
    const competencies = editor.structure?.competencies || [];
    let offset = 0;
    for (let compIdx = 0; compIdx < competencies.length; compIdx += 1) {
      const capacities = competencies[compIdx]?.capacities || [];
      if (flatIndex < offset + capacities.length) {
        updateGuideCapacityName(compIdx, flatIndex - offset, value);
        return;
      }
      offset += capacities.length;
    }
  };

  const updateGuideCriterionNameByFlatIndex = (flatIndex: number, value: string) => {
    const competencies = editor.structure?.competencies || [];
    let offset = 0;
    for (let compIdx = 0; compIdx < competencies.length; compIdx += 1) {
      const capacities = competencies[compIdx]?.capacities || [];
      for (let capIdx = 0; capIdx < capacities.length; capIdx += 1) {
        const criteria = capacities[capIdx]?.criteria || [];
        if (flatIndex < offset + criteria.length) {
          updateGuideCriterionName(compIdx, capIdx, flatIndex - offset, value);
          return;
        }
        offset += criteria.length;
      }
    }
  };

  const updateGuideLevelSelection = (row: number, col: number, checked: boolean) => {
    setEditor(prev => {
      const currentLayout = prev.structure?.layout || {};
      const nextTexts = { ...(currentLayout.texts || {}) };
      const startCol = getGuideCriterionStartCol(col);
      for (let offset = 0; offset < 4; offset += 1) {
        delete nextTexts[layoutCellId(row, startCol + offset)];
      }
      if (checked) {
        nextTexts[layoutCellId(row, col)] = getGuideLevelForColumn(col);
      }
      return {
        ...prev,
        structure: normalizeByType('guia_observacion', {
          ...prev.structure,
          layout: {
            ...currentLayout,
            texts: nextTexts
          }
        })
      };
    });
  };

  const updateDesignField = (key: string, value: string | number | boolean) => {
    setEditor(prev => ({
      ...prev,
      structure: {
        ...prev.structure,
        design: normalizeDesign({ ...(prev.structure?.design || {}), [key]: value })
      }
    }));
  };

  const getAreaName = (areaId: string) => {
    if (!areaId) return 'Área no definida';
    const found = assignments.find(a => a.areaId === areaId);
    return found?.areaName || areaId;
  };


  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-8 right-8 z-[10000] bg-slate-900 text-white px-5 py-3 rounded-2xl text-[11px] font-bold uppercase tracking-wider shadow-2xl">
          {toast}
        </div>
      )}

      <div className="bg-white rounded-[2rem] p-6 shadow-lg border border-slate-100">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <input className="p-3 rounded-xl border border-slate-200 text-xs font-bold" placeholder="Año" value={filters.year} onChange={e => setFilters(prev => ({ ...prev, year: e.target.value }))} />
          <select className="p-3 rounded-xl border border-slate-200 text-xs font-bold" value={filters.areaId} onChange={e => setFilters(prev => ({ ...prev, areaId: e.target.value, grade: '', section: '' }))}>
            <option value="">Área (todas)</option>
            {areaOptions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          <select className="p-3 rounded-xl border border-slate-200 text-xs font-bold" value={filters.grade} onChange={e => setFilters(prev => ({ ...prev, grade: e.target.value, section: '' }))}>
            <option value="">Grado (todos)</option>
            {filterGradeOptions.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select className="p-3 rounded-xl border border-slate-200 text-xs font-bold" value={filters.section} onChange={e => setFilters(prev => ({ ...prev, section: e.target.value }))}>
            <option value="">Sección (todas)</option>
            {filterSectionOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="bg-slate-100 text-slate-700 rounded-xl px-4 py-3 text-xs font-black uppercase" onClick={loadInstruments}>Buscar</button>
          <button className="bg-emerald-600 text-white rounded-xl px-4 py-3 text-xs font-black uppercase" onClick={() => openCreateFromTemplate(DEFAULT_TEMPLATES[0])}>+ Nuevo</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-white rounded-[2rem] p-8 shadow-lg border border-slate-100">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight italic">Instrumentos de Evaluación</h2>
            <span className="text-[10px] font-black text-slate-400 uppercase">{loading ? 'Cargando...' : `${instruments.length} registros`}</span>
          </div>

          {instruments.length === 0 ? (
            <div className="text-center py-20 bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200">
              <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest">No hay instrumentos para este filtro</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {instruments.map((inst) => (
                <div key={inst.id} className="bg-slate-50 p-3 rounded-3xl border border-slate-100 hover:shadow-md transition-all group">
                  <InstrumentThumbnail inst={inst} />
                  <div className="flex justify-between items-center mt-3">
                    <span className="text-[8px] font-black text-slate-500 uppercase">{inst.type.replace('_', ' ')}</span>
                    <span className="text-[8px] font-bold text-slate-400">v{inst.version}</span>
                  </div>
                  <div className="flex items-center justify-end gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-all">
                    <button className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-black" title="Previsualizar" onClick={() => setPreviewInstrument(inst)}>👁</button>
                    <button className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 text-sm font-black" title="Editar" onClick={() => openEdit(inst)}>✎</button>
                    <button className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 text-sm font-black" title="Duplicar" onClick={() => openDuplicate(inst)}>⧉</button>
                    <button
                      className="w-8 h-8 rounded-lg bg-rose-50 text-rose-700 text-sm font-black disabled:opacity-50"
                      title="Eliminar"
                      onClick={(e) => handleDelete(inst.id, e)}
                      disabled={deletingId === inst.id}
                    >
                      {deletingId === inst.id ? '…' : '🗑'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-[2rem] p-8 shadow-lg border border-slate-100">
          <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight italic mb-8">Plantillas Base</h2>
          <div className="space-y-4">
            {DEFAULT_TEMPLATES.map((tpl) => (
              <button
                key={tpl.type}
                onClick={() => openCreateFromTemplate(tpl)}
                className="w-full flex items-center gap-4 p-4 bg-slate-50 rounded-2xl hover:bg-emerald-50 hover:border-emerald-200 border border-transparent transition-all text-left group"
              >
                <div className="bg-white w-12 h-12 rounded-xl flex items-center justify-center text-xl shadow-sm group-hover:scale-110 transition-transform">{tpl.icon}</div>
                <div>
                  <p className="text-[10px] font-black text-slate-800 uppercase tracking-tight">{tpl.label}</p>
                  <p className="text-[8px] font-bold text-slate-400 uppercase mt-1">Crear desde plantilla</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {isEditorOpen && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/70 backdrop-blur-sm p-6 overflow-y-auto">
          <div className="max-w-6xl mx-auto bg-white rounded-[2rem] border border-slate-200 shadow-2xl overflow-hidden">
            <div className="bg-emerald-600 p-6 text-white flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-black uppercase tracking-widest">{editor.id ? 'Editar Instrumento' : 'Crear Instrumento'}</h3>
                  <div className="bg-emerald-700/70 rounded-full px-3 py-1 text-[11px] font-black text-white tracking-wider">{editor.year || currentYear}</div>
                </div>
                <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-100">{editor.type.replace('_', ' ')} - {structureSummary}</p>
              </div>
              <button className="text-white text-2xl leading-none" onClick={() => setIsEditorOpen(false)}>x</button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                <input className="p-3 rounded-2xl border border-slate-200 text-xs font-bold md:col-span-4" placeholder="Nombre del instrumento" value={editor.name} onChange={e => setEditor(prev => ({ ...prev, name: e.target.value }))} />
                <select className="p-3 rounded-2xl border border-slate-200 text-xs font-bold uppercase md:col-span-2" value={editor.type} onChange={e => changeType(e.target.value as InstrumentType)}>
                  <option value="rubrica">Rúbrica</option>
                  <option value="lista_cotejo">Lista de cotejo</option>
                  <option value="escala_valoracion">Escala de valoración</option>
                  <option value="guia_observacion">Guía de observación</option>
                </select>
                  <div className="md:col-span-2">
                    <select className={`w-full p-3 rounded-2xl border text-xs font-bold ${editor.areaId ? 'border-slate-200' : 'border-rose-300 bg-rose-50/40'}`} value={editor.areaId} onChange={e => setEditor(prev => ({ ...prev, areaId: e.target.value, grade: '', section: '' }))}>
                      <option value="">Área *</option>
                      {areaOptions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>
                    <p className={`text-[10px] italic mt-1 ${editor.areaId ? 'text-slate-400' : 'text-rose-500'}`}>* obligatorio</p>
                  </div>
                <div className="md:col-span-2">
                  <select className="w-full p-3 rounded-2xl border border-slate-200 text-xs font-bold" value={editor.grade} onChange={e => setEditor(prev => ({ ...prev, grade: e.target.value, section: '' }))}>
                    <option value="">Grado</option>
                    {editorGradeOptions.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <p className="text-[10px] text-slate-400 italic mt-1">* opcional</p>
                </div>
                <div className="md:col-span-2">
                  <select className="w-full p-3 rounded-2xl border border-slate-200 text-xs font-bold" value={editor.section} onChange={e => setEditor(prev => ({ ...prev, section: e.target.value }))}>
                    <option value="">Sección</option>
                    {editorSectionOptions.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <p className="text-[10px] text-slate-400 italic mt-1">* opcional</p>
                </div>
              </div>

              {editor.type === 'rubrica' && <RubricaEditor structure={editor.structure} onLevelChange={updateRubricaLevel} onCriteriaCountChange={setRubricaCriteriaCount} />}

              {editor.type === 'lista_cotejo' && <ChecklistEditor structure={editor.structure} onCountsChange={updateChecklistCounts} onOptionsChange={updateChecklistOptions} onCustomOptionChange={updateChecklistCustomOption} />}

              {editor.type === 'escala_valoracion' && <ScaleEditor structure={editor.structure} onLabelChange={updateScaleLabel} onCountsChange={updateScaleCounts} />}

              {editor.type === 'guia_observacion' && <GuideEditor structure={editor.structure} onCountsChange={updateGuideCounts} onCapacityNameChange={updateGuideCapacityName} onCriterionNameChange={updateGuideCriterionName} />}

              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
                <h4 className="text-[11px] font-black uppercase text-slate-700">Diseño de Plantilla</h4>
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_230px] gap-4">
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
                      <input
                        className="w-full p-2 rounded-lg border border-slate-200 text-[11px] font-bold"
                        placeholder="Título de cabecera de tabla (opcional)"
                        value={editor.structure?.design?.titleLine || ''}
                        onChange={e => updateDesignField('titleLine', e.target.value)}
                      />
                      <span className="text-[10px] font-black text-slate-500 whitespace-nowrap">{layoutSelectedCount} sel.</span>
                    </div>

                    {editor.type === 'rubrica' ? (
                      <InstrumentTableEditor
                        editor={editor}
                        layout={layout}
                        layoutDragTool={layoutDragTool}
                        setLayoutDragTool={setLayoutDragTool}
                        closeFormatPopovers={closeFormatPopovers}
                        inLayoutSelection={inLayoutSelection}
                        isLayoutCovered={isLayoutCovered}
                        findLayoutMergeAt={findLayoutMergeAt}
                        onLayoutCellMouseDown={onLayoutCellMouseDown}
                        onLayoutCellEnter={onLayoutCellEnter}
                        onLayoutCellContext={onLayoutCellContext}
                        setLayoutText={setLayoutText}
                        setLayoutSelection={setLayoutSelection}
                        insertLayoutRow={insertLayoutRow}
                        insertLayoutCol={insertLayoutCol}
                        updateRubricaLevel={updateRubricaLevel}
                        updateRubricaCriterionName={updateRubricaCriterionName}
                         updateChecklistCompetencyName={updateChecklistCompetencyName}
                         updateChecklistCapacityName={updateChecklistCapacityName}
                         updateChecklistCriterionName={updateChecklistCriterionName}
                         updateChecklistSelection={updateChecklistSelection}
                         updateScaleCompetencyName={updateScaleCompetencyName}
                         updateScaleCapacityName={updateScaleCapacityName}
                         updateScaleCriterionName={updateScaleCriterionName}
                         updateScaleLabel={updateScaleLabel}
                         updateScaleLevelSelection={updateScaleLevelSelection}
                         updateGuideCapacityNameByFlatIndex={updateGuideCapacityNameByFlatIndex}
                         updateGuideCriterionNameByFlatIndex={updateGuideCriterionNameByFlatIndex}
                         updateGuideLevelSelection={updateGuideLevelSelection}
                       />
                    ) : editor.type === 'lista_cotejo' ? (
                      <InstrumentTableEditor
                        editor={editor}
                        layout={layout}
                        layoutDragTool={layoutDragTool}
                        setLayoutDragTool={setLayoutDragTool}
                        closeFormatPopovers={closeFormatPopovers}
                        inLayoutSelection={inLayoutSelection}
                        isLayoutCovered={isLayoutCovered}
                        findLayoutMergeAt={findLayoutMergeAt}
                        onLayoutCellMouseDown={onLayoutCellMouseDown}
                        onLayoutCellEnter={onLayoutCellEnter}
                        onLayoutCellContext={onLayoutCellContext}
                        setLayoutText={setLayoutText}
                        setLayoutSelection={setLayoutSelection}
                        insertLayoutRow={insertLayoutRow}
                        insertLayoutCol={insertLayoutCol}
                        updateRubricaLevel={updateRubricaLevel}
                        updateRubricaCriterionName={updateRubricaCriterionName}
                         updateChecklistCompetencyName={updateChecklistCompetencyName}
                         updateChecklistCapacityName={updateChecklistCapacityName}
                          updateChecklistCriterionName={updateChecklistCriterionName}
                          updateChecklistSelection={updateChecklistSelection}
                         updateScaleCompetencyName={updateScaleCompetencyName}
                         updateScaleCapacityName={updateScaleCapacityName}
                         updateScaleCriterionName={updateScaleCriterionName}
                         updateScaleLabel={updateScaleLabel}
                         updateScaleLevelSelection={updateScaleLevelSelection}
                         updateGuideCapacityNameByFlatIndex={updateGuideCapacityNameByFlatIndex}
                         updateGuideCriterionNameByFlatIndex={updateGuideCriterionNameByFlatIndex}
                         updateGuideLevelSelection={updateGuideLevelSelection}
                       />
                    ) : editor.type === 'escala_valoracion' ? (
                      <InstrumentTableEditor
                        editor={editor}
                        layout={layout}
                        layoutDragTool={layoutDragTool}
                        setLayoutDragTool={setLayoutDragTool}
                        closeFormatPopovers={closeFormatPopovers}
                        inLayoutSelection={inLayoutSelection}
                        isLayoutCovered={isLayoutCovered}
                        findLayoutMergeAt={findLayoutMergeAt}
                        onLayoutCellMouseDown={onLayoutCellMouseDown}
                        onLayoutCellEnter={onLayoutCellEnter}
                        onLayoutCellContext={onLayoutCellContext}
                        setLayoutText={setLayoutText}
                        setLayoutSelection={setLayoutSelection}
                        insertLayoutRow={insertLayoutRow}
                        insertLayoutCol={insertLayoutCol}
                        updateRubricaLevel={updateRubricaLevel}
                        updateRubricaCriterionName={updateRubricaCriterionName}
                         updateChecklistCompetencyName={updateChecklistCompetencyName}
                         updateChecklistCapacityName={updateChecklistCapacityName}
                          updateChecklistCriterionName={updateChecklistCriterionName}
                          updateChecklistSelection={updateChecklistSelection}
                         updateScaleCompetencyName={updateScaleCompetencyName}
                         updateScaleCapacityName={updateScaleCapacityName}
                         updateScaleCriterionName={updateScaleCriterionName}
                         updateScaleLabel={updateScaleLabel}
                         updateScaleLevelSelection={updateScaleLevelSelection}
                         updateGuideCapacityNameByFlatIndex={updateGuideCapacityNameByFlatIndex}
                         updateGuideCriterionNameByFlatIndex={updateGuideCriterionNameByFlatIndex}
                         updateGuideLevelSelection={updateGuideLevelSelection}
                       />
                    ) : (
                      <InstrumentTableEditor
                        editor={editor}
                        layout={layout}
                        layoutDragTool={layoutDragTool}
                        setLayoutDragTool={setLayoutDragTool}
                        closeFormatPopovers={closeFormatPopovers}
                        inLayoutSelection={inLayoutSelection}
                        isLayoutCovered={isLayoutCovered}
                        findLayoutMergeAt={findLayoutMergeAt}
                        onLayoutCellMouseDown={onLayoutCellMouseDown}
                        onLayoutCellEnter={onLayoutCellEnter}
                        onLayoutCellContext={onLayoutCellContext}
                        setLayoutText={setLayoutText}
                        setLayoutSelection={setLayoutSelection}
                        insertLayoutRow={insertLayoutRow}
                        insertLayoutCol={insertLayoutCol}
                        updateRubricaLevel={updateRubricaLevel}
                        updateRubricaCriterionName={updateRubricaCriterionName}
                         updateChecklistCompetencyName={updateChecklistCompetencyName}
                         updateChecklistCapacityName={updateChecklistCapacityName}
                          updateChecklistCriterionName={updateChecklistCriterionName}
                          updateChecklistSelection={updateChecklistSelection}
                         updateScaleCompetencyName={updateScaleCompetencyName}
                         updateScaleCapacityName={updateScaleCapacityName}
                         updateScaleCriterionName={updateScaleCriterionName}
                         updateScaleLabel={updateScaleLabel}
                         updateScaleLevelSelection={updateScaleLevelSelection}
                         updateGuideCapacityNameByFlatIndex={updateGuideCapacityNameByFlatIndex}
                         updateGuideCriterionNameByFlatIndex={updateGuideCriterionNameByFlatIndex}
                         updateGuideLevelSelection={updateGuideLevelSelection}
                       />
                    )}
                  </div>

                  <LayoutFormatPanel
                    selectedLayoutStyle={selectedLayoutStyle}
                    showMergeMenu={showMergeMenu}
                    showOrientationMenu={showOrientationMenu}
                    showFillPalette={showFillPalette}
                    showTextPalette={showTextPalette}
                    showBorderMenu={showBorderMenu}
                    showBorderColorPalette={showBorderColorPalette}
                    showBorderStyleMenu={showBorderStyleMenu}
                    setShowMergeMenu={setShowMergeMenu}
                    setShowOrientationMenu={setShowOrientationMenu}
                    setShowFillPalette={setShowFillPalette}
                    setShowTextPalette={setShowTextPalette}
                    setShowBorderMenu={setShowBorderMenu}
                    setShowBorderColorPalette={setShowBorderColorPalette}
                    setShowBorderStyleMenu={setShowBorderStyleMenu}
                    mergeLayoutSelection={mergeLayoutSelection}
                    mergeLayoutHorizontal={mergeLayoutHorizontal}
                    unmergeLayoutSelection={unmergeLayoutSelection}
                    applyLayoutStyle={applyLayoutStyle}
                    applyBgColor={applyBgColor}
                    applyTextColor={applyTextColor}
                    toggleLayoutStyle={toggleLayoutStyle}
                    applyBordersToSelection={applyBordersToSelection}
                    applyBorderColor={applyBorderColor}
                    applyBorderStyleKind={applyBorderStyleKind}
                  />
                </div>
              </div>

              {layoutMenu && (
                <LayoutContextMenu
                  layoutMenu={layoutMenu}
                  selectedLayoutStyle={selectedLayoutStyle}
                  setLayoutMenu={setLayoutMenu}
                  mergeLayoutSelection={mergeLayoutSelection}
                  unmergeLayoutSelection={unmergeLayoutSelection}
                  applyLayoutStyle={applyLayoutStyle}
                  toggleLayoutStyle={toggleLayoutStyle}
                  applyBgColor={applyBgColor}
                  applyTextColor={applyTextColor}
                />
              )}

              <div className="bg-slate-900 rounded-2xl p-4 border border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-black uppercase text-slate-100">Previsualización</h4>
                  <button
                    className="px-3 py-1 rounded-lg bg-slate-700 text-slate-100 text-[10px] font-black uppercase"
                    onClick={() => setShowEditorPreview(v => !v)}
                  >
                    {showEditorPreview ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
                {showEditorPreview ? <InstrumentPreviewCard inst={editor} generalData={generalData} getAreaName={getAreaName} /> : (
                  <p className="text-[10px] italic text-slate-400">Previsualización plegada. Haz clic en Mostrar.</p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={saveEditor} className="bg-emerald-600 text-white px-6 py-3 rounded-xl text-[11px] font-black uppercase">Guardar</button>
                <button onClick={() => setIsEditorOpen(false)} className="bg-slate-100 text-slate-500 px-6 py-3 rounded-xl text-[11px] font-black uppercase">Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewInstrument && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/70 backdrop-blur-sm p-6 overflow-y-auto">
          <div className="max-w-5xl mx-auto bg-white rounded-[2rem] border border-slate-200 shadow-2xl overflow-hidden">
            <div className="bg-slate-800 p-5 text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest">Previsualización</h3>
                <p className="text-[10px] uppercase tracking-wider text-slate-200 mt-1">{previewInstrument.name}</p>
              </div>
              <button className="text-2xl leading-none" onClick={() => setPreviewInstrument(null)}>x</button>
            </div>
            <div className="p-6">
              <InstrumentPreviewCard inst={previewInstrument} generalData={generalData} getAreaName={getAreaName} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
