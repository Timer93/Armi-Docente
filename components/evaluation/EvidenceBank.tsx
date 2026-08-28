import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteEvaluacionEvidencia,
  getAllSesiones,
  getDatosGenerales,
  getEvidenceStorageConfig,
  getEvaluacionEvidencias,
  getEstudiantes,
  getProgramacionesAnuales,
  getUnidadDidactica,
  pickEvidenceStorageFolder,
  recoverEvidenceStorageToMirror,
  saveEvidenceStorageConfig,
  saveEvaluacionEvidencia
} from '../../services/apiService';
import { Student, TeachingAssignment } from '../../types';
import { StudentChatMonitor } from './StudentChatMonitor';

type EvidenceFilters = {
  year: string;
  areaId: string;
  bimester: string;
  unit: string;
  session: string;
  grade: string;
  section: string;
};

type EvidenceFileItem = {
  id: string | number;
  fileName: string;
  fileSize: number;
  fileType: string;
  extension: string;
  fileUrl: string;
  uploadedAt: string;
  previewKind: 'image' | 'video' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'custom' | 'generic';
  filters: EvidenceFilters;
  studentIds: Array<string | number>;
  studentNames: string[];
  versionGroupId: string;
  versionNumber: number;
  isLatest: boolean;
  submittedAt: string;
  submissionIp: string;
  available: boolean;
  availabilitySource: string;
};

const BIMESTER_OPTIONS = [
  { value: 'I', label: 'I Bimestre' },
  { value: 'II', label: 'II Bimestre' },
  { value: 'III', label: 'III Bimestre' },
  { value: 'IV', label: 'IV Bimestre' }
];

const ALL_BIMESTER_UNITS: Record<string, string[]> = {
  I: ['1', '2'],
  II: ['3', '4'],
  III: ['5', '6'],
  IV: ['7', '8']
};

const EVIDENCE_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.bmp,.svg,.mp4,.webm,.mov,.avi,.mkv,.m4v,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.armi';
const VALID_EVIDENCE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
  'mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v',
  'pdf',
  'doc', 'docx', 'odt',
  'xls', 'xlsx', 'ods',
  'ppt', 'pptx', 'odp',
  'armi'
]);

const getDefaultYear = () => new Date().getFullYear().toString();

const getProgramYear = (program: any) => {
  const rawId = String(program?.id || '');
  const parts = rawId.split('-');
  return parts[0] || '';
};

const parseCombinedSections = (value: string) => {
  if (!value) return [];
  if (!value.includes(' y ') && !value.includes(',')) return [value];
  return value
    .replace(/\s+y\s+/g, ',')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const sectionsOverlap = (left: string, right: string) => {
  if (!left || !right) return false;
  const leftParts = parseCombinedSections(left);
  const rightParts = parseCombinedSections(right);
  if (leftParts.length === 0 || rightParts.length === 0) return false;
  return leftParts.some((item) => rightParts.includes(item));
};

const getFileExtension = (fileName: string) => {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
};

const getPreviewKind = (extension: string): EvidenceFileItem['previewKind'] => {
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) return 'image';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'].includes(extension)) return 'video';
  if (extension === 'pdf') return 'pdf';
  if (['doc', 'docx', 'odt'].includes(extension)) return 'doc';
  if (['xls', 'xlsx', 'ods'].includes(extension)) return 'sheet';
  if (['ppt', 'pptx', 'odp'].includes(extension)) return 'slides';
  if (extension === 'armi') return 'custom';
  return 'generic';
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104857.6) / 10} MB`;
};

const canOpenInline = (previewKind: EvidenceFileItem['previewKind']) => (
  previewKind === 'image' || previewKind === 'video' || previewKind === 'pdf'
);

const getFileAccent = (previewKind: EvidenceFileItem['previewKind']) => {
  if (previewKind === 'pdf') return { bg: 'bg-red-600', soft: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'PDF' };
  if (previewKind === 'doc') return { bg: 'bg-blue-600', soft: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: 'DOC' };
  if (previewKind === 'sheet') return { bg: 'bg-emerald-600', soft: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'XLS' };
  if (previewKind === 'slides') return { bg: 'bg-orange-500', soft: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', label: 'PPT' };
  if (previewKind === 'custom') return { bg: 'bg-slate-700', soft: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300', label: 'ARMI' };
  return { bg: 'bg-slate-600', soft: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300', label: 'FILE' };
};

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
  reader.readAsDataURL(file);
});

export const EvidenceBank: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [programs, setPrograms] = useState<Record<string, any>>({});
  const [allSessions, setAllSessions] = useState<any[]>([]);
  const [unitSessions, setUnitSessions] = useState<any[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<Array<string | number>>([]);
  const [evidences, setEvidences] = useState<EvidenceFileItem[]>([]);
  const [uploadMessage, setUploadMessage] = useState('');
  const [storagePath, setStoragePath] = useState('');
  const [portalUrls, setPortalUrls] = useState<string[]>([]);
  const [storageMessage, setStorageMessage] = useState('');
  const [storageBusy, setStorageBusy] = useState(false);
  const [automaticMirrorStorage, setAutomaticMirrorStorage] = useState(false);
  const [storageRecovery, setStorageRecovery] = useState<any>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [replaceEvidenceId, setReplaceEvidenceId] = useState<string | number | null>(null);
  const [filters, setFilters] = useState<EvidenceFilters>({
    year: getDefaultYear(),
    areaId: '',
    bimester: '',
    unit: '',
    session: '',
    grade: '',
    section: ''
  });

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      setLoading(true);
      try {
        const [generalData, fetchedStudents, fetchedPrograms, fetchedSessions] = await Promise.all([
          getDatosGenerales(),
          getEstudiantes(),
          getProgramacionesAnuales(),
          getAllSesiones()
        ]);
        if (!active) return;

        const savedAssignments = localStorage.getItem('armi_assignments');
        if (savedAssignments) {
          try {
            const parsed = JSON.parse(savedAssignments);
            if (Array.isArray(parsed)) setAssignments(parsed);
          } catch {
            // ignore local parse errors
          }
        }

        setStudents(Array.isArray(fetchedStudents) ? fetchedStudents : []);
        setPrograms(fetchedPrograms || {});
        setAllSessions(Object.values(fetchedSessions || {}));
        setFilters((prev) => ({
          ...prev,
          year: generalData?.year || prev.year || getDefaultYear()
        }));
      } finally {
        if (active) setLoading(false);
      }
    };

    const loadSecondaryData = async () => {
      void loadSavedEvidences();
      let storageConfig = await getEvidenceStorageConfig();
      if (!storageConfig.success) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        if (!active) return;
        storageConfig = await getEvidenceStorageConfig();
      }
      if (!active) return;
      if (storageConfig.success) {
        setStoragePath(storageConfig.data?.configuredPath || storageConfig.data?.effectivePath || '');
        setPortalUrls(Array.isArray(storageConfig.data?.portalUrls) ? storageConfig.data.portalUrls : []);
        setAutomaticMirrorStorage(storageConfig.data?.automaticMirror === true);
        setStorageRecovery(storageConfig.data?.recovery || null);
      } else {
        setStorageMessage(storageConfig.message || 'No se pudo detectar la red local.');
      }
    };

    loadData();
    loadSecondaryData();
    return () => { active = false; };
  }, []);

  const loadSavedEvidences = async () => {
    const res = await getEvaluacionEvidencias();
    if (!res.success) return;
    const rows = (res.data || []).map((item: any) => ({
      id: item.id,
      fileName: item.fileName || 'Archivo',
      fileSize: Number(item.fileSize || 0),
      fileType: item.fileType || '',
      extension: getFileExtension(item.fileName || ''),
      fileUrl: item.fileUrl || '',
      uploadedAt: item.updatedAt || '',
      previewKind: getPreviewKind(getFileExtension(item.fileName || '')),
      filters: {
        year: item.year || '',
        areaId: item.areaId || '',
        bimester: item.bimester || '',
        unit: item.unitNumber || '',
        session: item.sessionNumber || '',
        grade: item.grade || '',
        section: item.section || ''
      },
      studentIds: Array.isArray(item.studentIds) ? item.studentIds : [],
      studentNames: Array.isArray(item.studentNames) ? item.studentNames : []
      ,versionGroupId: item.versionGroupId || `legacy-${item.id}`
      ,versionNumber: Number(item.versionNumber || 1)
      ,isLatest: item.isLatest !== false
      ,submittedAt: item.submittedAt || item.updatedAt || ''
      ,submissionIp: item.submissionIp || ''
      ,available: item.available === true
      ,availabilitySource: item.availabilitySource || 'missing'
    })) as EvidenceFileItem[];
    setEvidences(rows);
  };

  useEffect(() => {
    if (!evidences.some((item) => !item.available)) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadSavedEvidences();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [evidences]);

  const areaOptions = useMemo(() => {
    const unique = new Map<string, string>();
    assignments.forEach((item) => {
      if (item.areaId && !unique.has(item.areaId)) unique.set(item.areaId, item.areaName || item.areaId);
    });
    return Array.from(unique.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [assignments]);

  const yearOptions = useMemo(() => {
    const values = new Set<string>([getDefaultYear()]);
    if (filters.year) values.add(filters.year);

    Object.values(programs || {}).forEach((program: any) => {
      const year = getProgramYear(program);
      if (year) values.add(year);
    });

    allSessions.forEach((session) => {
      if (session?.year) values.add(String(session.year));
    });

    return Array.from(values).sort((a, b) => b.localeCompare(a));
  }, [allSessions, filters.year, programs]);

  const gradeOptions = useMemo(() => {
    const rows = filters.areaId ? assignments.filter((item) => item.areaId === filters.areaId) : assignments;
    return Array.from(new Set(rows.map((item) => item.grade))).filter(Boolean).sort();
  }, [assignments, filters.areaId]);

  const sectionOptions = useMemo(() => {
    const rows = assignments.filter((item) => (
      (!filters.areaId || item.areaId === filters.areaId)
      && (!filters.grade || item.grade === filters.grade)
    ));
    const baseSections = Array.from(new Set(rows.map((item) => item.section))).filter(Boolean).sort();
    if (baseSections.length <= 1) return baseSections;

    const combinedLabel = baseSections.length === 2
      ? `${baseSections[0]} y ${baseSections[1]}`
      : `${baseSections.slice(0, -1).join(', ')} y ${baseSections[baseSections.length - 1]}`;

    return [...baseSections, combinedLabel];
  }, [assignments, filters.areaId, filters.grade]);

  const matchingProgramEntries = useMemo(() => {
    return Object.values(programs || {}).filter((program: any) => {
      const year = getProgramYear(program);
      if (filters.year && year !== filters.year) return false;
      if (filters.areaId && program?.areaId !== filters.areaId) return false;
      if (filters.grade && program?.grade !== filters.grade) return false;
      if (filters.section && !sectionsOverlap(filters.section, String(program?.section || ''))) return false;
      return true;
    });
  }, [filters.areaId, filters.grade, filters.section, filters.year, programs]);

  const unitOptions = useMemo(() => {
    if (!filters.areaId || matchingProgramEntries.length === 0) return [];
    const allUnits = ['1', '2', '3', '4', '5', '6', '7', '8'];
    if (!filters.bimester) return allUnits;
    return ALL_BIMESTER_UNITS[filters.bimester] || allUnits;
  }, [filters.areaId, filters.bimester, matchingProgramEntries]);

  const sessionOptions = useMemo(() => {
    if (unitSessions.length > 0) {
      return unitSessions.map((item, index) => ({
        value: String(item?.id || index + 1),
        label: `Sesion ${item?.id || index + 1}${item?.title ? ` - ${item.title}` : ''}`
      }));
    }

    const activeSections = filters.section ? parseCombinedSections(filters.section) : [];
    return allSessions
      .filter((item) => (
        (!filters.year || String(item.year) === filters.year)
        && (!filters.areaId || item.areaId === filters.areaId)
        && (!filters.grade || item.grade === filters.grade)
        && (!filters.section || activeSections.length === 0 || activeSections.includes(item.section))
        && (!filters.unit || String(item.unitNumber) === filters.unit)
      ))
      .sort((a, b) => Number(a.sessionNumber) - Number(b.sessionNumber))
      .map((item) => ({
        value: String(item.sessionNumber),
        label: `Sesion ${item.sessionNumber}${item.title ? ` - ${item.title}` : ''}`
      }));
  }, [allSessions, filters.areaId, filters.grade, filters.section, filters.unit, filters.year, unitSessions]);

  const filteredStudents = useMemo(() => {
    const term = studentSearch.trim().toLowerCase();
    const activeSections = filters.section ? parseCombinedSections(filters.section) : [];
    return students
      .filter((student) => (
        (!filters.grade || student.grade === filters.grade)
        && (!filters.section || activeSections.length === 0 || activeSections.includes(student.section))
      ))
      .filter((student) => (
        !term || String(student.name || '').toLowerCase().includes(term)
      ))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [filters.grade, filters.section, studentSearch, students]);

  const selectedStudents = useMemo(() => {
    const selectedSet = new Set(selectedStudentIds.map(String));
    return students.filter((student) => selectedSet.has(String(student.id)));
  }, [selectedStudentIds, students]);

  useEffect(() => {
    setFilters((prev) => {
      if (!prev.grade) return prev;
      return gradeOptions.includes(prev.grade) ? prev : { ...prev, grade: '', section: '', unit: '', session: '' };
    });
  }, [gradeOptions]);

  useEffect(() => {
    setFilters((prev) => {
      if (!prev.section) return prev;
      return sectionOptions.includes(prev.section) ? prev : { ...prev, section: '', unit: '', session: '' };
    });
  }, [sectionOptions]);

  useEffect(() => {
    setFilters((prev) => {
      if (!prev.unit) return prev;
      return unitOptions.includes(prev.unit) ? prev : { ...prev, unit: '', session: '' };
    });
  }, [unitOptions]);

  useEffect(() => {
    setFilters((prev) => {
      if (!prev.session) return prev;
      return sessionOptions.some((item) => item.value === prev.session) ? prev : { ...prev, session: '' };
    });
  }, [sessionOptions]);

  useEffect(() => {
    const allowedIds = new Set(filteredStudents.map((student) => String(student.id)));
    setSelectedStudentIds((prev) => prev.filter((id) => allowedIds.has(String(id))));
  }, [filteredStudents]);

  useEffect(() => {
    const loadUnitSessions = async () => {
      if (!filters.year || !filters.areaId || !filters.grade || !filters.section || !filters.unit) {
        setUnitSessions([]);
        return;
      }

      const sectionCandidates = [
        filters.section,
        ...parseCombinedSections(filters.section).filter((section) => section !== filters.section)
      ];

      let foundSessions: any[] = [];
      for (const section of sectionCandidates) {
        const unitData = await getUnidadDidactica(filters.year, filters.areaId, filters.grade, section, filters.unit);
        const sessions = Array.isArray(unitData?.sesiones) ? unitData.sesiones : [];
        if (sessions.length > 0) {
          foundSessions = sessions;
          break;
        }
      }

      setUnitSessions(foundSessions);
    };

    loadUnitSessions();
  }, [filters.areaId, filters.grade, filters.section, filters.unit, filters.year]);

  const updateFilter = (key: keyof EvidenceFilters, value: string) => {
    setFilters((prev) => {
      const next: EvidenceFilters = { ...prev, [key]: value };
      if (key === 'areaId') {
        next.grade = '';
        next.section = '';
        next.unit = '';
        next.session = '';
      }
      if (key === 'bimester') {
        next.unit = '';
        next.session = '';
      }
      if (key === 'grade') {
        next.section = '';
        next.unit = '';
        next.session = '';
      }
      if (key === 'section') {
        next.unit = '';
        next.session = '';
      }
      if (key === 'unit') {
        next.session = '';
      }
      return next;
    });
  };

  const areUploadFiltersComplete = useMemo(() => (
    !!filters.year
    && !!filters.areaId
    && !!filters.bimester
    && !!filters.unit
    && !!filters.session
    && !!filters.grade
    && !!filters.section
    && selectedStudentIds.length > 0
  ), [filters, selectedStudentIds.length]);

  const buildEvidenceItem = (file: File): EvidenceFileItem | null => {
    const extension = getFileExtension(file.name);
    if (!VALID_EVIDENCE_EXTENSIONS.has(extension)) return null;
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || extension || 'application/octet-stream',
      extension,
      fileUrl: '',
      uploadedAt: new Date().toLocaleString(),
      previewKind: getPreviewKind(extension),
      filters: { ...filters },
      studentIds: [...selectedStudentIds],
      studentNames: selectedStudents.map((student) => String(student.name || 'Sin nombre'))
      ,versionGroupId: ''
      ,versionNumber: 1
      ,isLatest: true
      ,submittedAt: new Date().toISOString()
      ,submissionIp: ''
    };
  };

  const handleStartUpload = () => {
    if (!areUploadFiltersComplete) {
      setUploadMessage('Completa Año, Area, Bimestre, Unidad, Sesion, Grado, Seccion y selecciona al menos un estudiante antes de subir una evidencia.');
      return;
    }
    setUploadMessage('');
    uploadInputRef.current?.click();
  };

  const handleUploadFiles = async (files: FileList | null, replaceId?: string | number | null) => {
    if (!files || files.length === 0) return;

    const accepted = Array.from(files).filter((file) => VALID_EVIDENCE_EXTENSIONS.has(getFileExtension(file.name)));

    if (accepted.length === 0) {
      setUploadMessage('Formato no valido. Usa imagenes, Office, PDF o el formato propietario .armi.');
      return;
    }

    setUploadMessage('');
    const filesToSave = replaceId ? accepted.slice(0, 1) : accepted;

    for (const file of filesToSave) {
      const draft = buildEvidenceItem(file);
      if (!draft) continue;
      const dataUrl = await readFileAsDataUrl(file);
      const res = await saveEvaluacionEvidencia({
        id: replaceId || undefined,
        year: draft.filters.year,
        areaId: draft.filters.areaId,
        grade: draft.filters.grade,
        section: draft.filters.section,
        bimester: draft.filters.bimester,
        unitNumber: draft.filters.unit,
        sessionNumber: draft.filters.session,
        studentIds: draft.studentIds,
        studentNames: draft.studentNames,
        fileName: draft.fileName,
        fileType: draft.fileType,
        fileSize: draft.fileSize,
        dataUrl
      });
      if (!res.success) {
        setUploadMessage(res.message || 'No se pudo guardar la evidencia.');
        return;
      }
    }

    await loadSavedEvidences();
    if (replaceId) setReplaceEvidenceId(null);
  };

  const handleViewEvidence = (item: EvidenceFileItem) => {
    if (!item.fileUrl) return;
    if (canOpenInline(item.previewKind)) {
      window.open(item.fileUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    const link = document.createElement('a');
    link.href = item.fileUrl;
    link.download = item.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleReplaceEvidence = (id: string | number) => {
    setReplaceEvidenceId(id);
    replaceInputRef.current?.click();
  };

  const handleDeleteEvidence = async (id: string | number) => {
    const res = await deleteEvaluacionEvidencia(id);
    if (!res.success) {
      setUploadMessage(res.message || 'No se pudo eliminar la evidencia.');
      return;
    }
    await loadSavedEvidences();
  };

  const toggleStudent = (id: string | number) => {
    setSelectedStudentIds((prev) => (
      prev.some((item) => String(item) === String(id))
        ? prev.filter((item) => String(item) !== String(id))
        : [...prev, id]
    ));
  };

  const selectAllVisibleStudents = () => {
    setSelectedStudentIds(filteredStudents.map((student) => student.id));
  };

  const clearStudentSelection = () => {
    setSelectedStudentIds([]);
  };

  const visibleCards = useMemo(() => {
    const selectedIdSet = new Set(selectedStudentIds.map((id) => String(id)));
    return evidences.filter((item) => (
      (!filters.year || item.filters.year === filters.year)
      && (!filters.areaId || item.filters.areaId === filters.areaId)
      && (!filters.bimester || item.filters.bimester === filters.bimester)
      && (!filters.unit || item.filters.unit === filters.unit)
      && (!filters.session || item.filters.session === filters.session)
      && (!filters.grade || item.filters.grade === filters.grade)
      && (!filters.section || sectionsOverlap(item.filters.section, filters.section))
      && (
        selectedIdSet.size === 0
          ? true
          : item.studentIds.some((id) => selectedIdSet.has(String(id)))
      )
    ));
  }, [evidences, filters, selectedStudentIds]);

  const chooseStorageFolder = async () => {
    setStorageBusy(true);
    setStorageMessage('');
    const result = await pickEvidenceStorageFolder();
    if (result.success && result.path) setStoragePath(result.path);
    else if (!result.cancelled) setStorageMessage(result.message || 'No se pudo seleccionar la carpeta.');
    setStorageBusy(false);
  };

  const saveStorageFolder = async () => {
    setStorageBusy(true);
    setStorageMessage('');
    const result = await saveEvidenceStorageConfig(storagePath);
    if (result.success) {
      setStoragePath(result.data?.configuredPath || storagePath);
      setPortalUrls(Array.isArray(result.data?.portalUrls) ? result.data.portalUrls : portalUrls);
      setAutomaticMirrorStorage(result.data?.automaticMirror === true);
      setStorageRecovery(result.data?.recovery || storageRecovery);
      setStorageMessage('Carpeta verificada y guardada.');
    } else {
      setStorageMessage(result.message || 'No se pudo guardar la carpeta.');
    }
    setStorageBusy(false);
  };

  const recoverStorageToMirror = async () => {
    setStorageBusy(true);
    setStorageMessage('Copiando y verificando las evidencias disponibles en esta PC...');
    const result = await recoverEvidenceStorageToMirror();
    if (result.success) {
      setStorageRecovery(result.data?.recovery || null);
      setStorageMessage(result.message || 'Recuperacion terminada. Los archivos originales se conservaron.');
      await loadSavedEvidences();
    } else {
      setStorageMessage(result.message || 'No se pudieron recuperar las evidencias desde esta PC.');
    }
    setStorageBusy(false);
  };

  const copyPortalUrl = async () => {
    const url = portalUrls[0];
    if (!url) {
      setStorageMessage('No se detectó una dirección LAN. Verifica la conexión de red.');
      return;
    }
    await navigator.clipboard.writeText(url);
    setStorageMessage('Dirección del portal copiada.');
  };

  const FilterSelect = ({
    label,
    value,
    onChange,
    options,
    placeholder,
    disabled
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    placeholder: string;
    disabled?: boolean;
  }) => (
    <div>
      <label className="mb-2 block text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</label>
      <select
        className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700 disabled:bg-slate-100 disabled:text-slate-400"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">{placeholder}</option>
        {options.map((item) => (
          <option key={`${label}-${item.value}`} value={item.value}>{item.label}</option>
        ))}
      </select>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="rounded-[2rem] border border-slate-100 bg-white p-8 shadow-lg">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 animate-pulse">
            Cargando banco de evidencias...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StudentChatMonitor />
      <div className="overflow-hidden rounded-[2rem] border border-violet-100 bg-gradient-to-br from-slate-950 via-violet-950 to-cyan-950 p-6 text-white shadow-xl">
        <div className="grid gap-5 xl:grid-cols-[1fr_0.75fr]">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">Recepción por red local</div>
            <h2 className="mt-2 text-xl font-black">Carpeta de evidencias de estudiantes</h2>
            <p className="mt-2 max-w-2xl text-xs font-semibold leading-relaxed text-slate-300">
              {automaticMirrorStorage
                ? 'El modo espejo asigno esta carpeta automaticamente. Las evidencias nuevas se guardaran aqui y conservaran enlaces portatiles entre computadoras.'
                : 'ARMI conserva rutas relativas para poder reencontrar los archivos si configuras esta carpeta en otro equipo.'}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={storagePath}
                onChange={(event) => setStoragePath(event.target.value)}
                placeholder="Selecciona la carpeta donde se guardarán las evidencias"
                readOnly={automaticMirrorStorage}
                className="min-w-0 flex-1 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-xs font-bold text-white outline-none placeholder:text-slate-400 focus:border-violet-300 read-only:cursor-default read-only:text-emerald-200"
              />
              {!automaticMirrorStorage ? (
                <>
                  <button type="button" onClick={chooseStorageFolder} disabled={storageBusy} className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest hover:bg-white/20 disabled:opacity-50">Elegir carpeta</button>
                  <button type="button" onClick={saveStorageFolder} disabled={storageBusy || !storagePath.trim()} className="rounded-2xl bg-emerald-400 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-emerald-950 hover:bg-emerald-300 disabled:opacity-50">Guardar ruta</button>
                </>
              ) : (
                <span className="inline-flex items-center justify-center rounded-2xl border border-emerald-300/40 bg-emerald-400/15 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-emerald-200">Ruta automatica del espejo</span>
              )}
            </div>
            {automaticMirrorStorage && storageRecovery ? (
              <div className={`mt-3 rounded-2xl border px-4 py-3 text-xs font-semibold ${storageRecovery.missingFiles > 0 || storageRecovery.recoverableHere > 0 ? 'border-amber-300/40 bg-amber-300/10 text-amber-100' : 'border-emerald-300/40 bg-emerald-300/10 text-emerald-100'}`}>
                <p className="font-black uppercase tracking-[0.12em]">{storageRecovery.sharedFiles || 0} compartidas · {storageRecovery.recoverableHere || 0} recuperables aqui · {storageRecovery.missingFiles || 0} pendientes</p>
                {storageRecovery.recoverableHere > 0 ? (
                  <button type="button" onClick={recoverStorageToMirror} disabled={storageBusy} className="mt-3 rounded-xl bg-amber-300 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-amber-950 disabled:opacity-50">
                    Copiar y enlazar {storageRecovery.recoverableHere} archivos sin borrar originales
                  </button>
                ) : storageRecovery.missingFiles > 0 ? (
                  <p className="mt-2 leading-relaxed">Los enlaces estan protegidos. Abre ARMI en la PC2, entra a este banco y ejecuta alli la recuperacion cuando aparezcan como recuperables.</p>
                ) : (
                  <p className="mt-2">Todas las evidencias registradas estan disponibles desde la carpeta espejo.</p>
                )}
              </div>
            ) : null}
            {storageMessage ? <div className="mt-3 text-[11px] font-bold text-amber-200">{storageMessage}</div> : null}
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 backdrop-blur-sm">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">Acceso para estudiantes</div>
            <div className="mt-3 break-all rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm font-black text-white">
              {portalUrls[0] || 'Conecta este equipo a una red para detectar su IP.'}
            </div>
            <button type="button" onClick={copyPortalUrl} disabled={!portalUrls.length} className="mt-3 w-full rounded-2xl bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-violet-800 hover:bg-violet-50 disabled:opacity-50">
              Copiar dirección para el celular
            </button>
            <p className="mt-3 text-[10px] font-semibold leading-relaxed text-slate-300">ARMI Docente debe permanecer abierto y ambos dispositivos deben estar en la misma red Wi-Fi o LAN.</p>
          </div>
        </div>
      </div>
      <div className="rounded-[2rem] border border-slate-100 bg-white p-8 shadow-lg">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black uppercase tracking-tight italic text-slate-800">Banco de Evidencias</h2>
            <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Filtros conectados a areas, programacion anual, sesiones y estudiantes registrados
            </p>
          </div>
          <button
            className="rounded-full bg-emerald-500 px-6 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-100 transition-all hover:bg-emerald-600"
            onClick={handleStartUpload}
          >
            + Subir Evidencia
          </button>
        </div>

        <input
          ref={uploadInputRef}
          type="file"
          multiple
          accept={EVIDENCE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            handleUploadFiles(e.target.files);
            e.currentTarget.value = '';
          }}
        />
        <input
          ref={replaceInputRef}
          type="file"
          accept={EVIDENCE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            handleUploadFiles(e.target.files, replaceEvidenceId);
            setReplaceEvidenceId(null);
            e.currentTarget.value = '';
          }}
        />

        {uploadMessage && (
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] font-black uppercase tracking-wider text-amber-700">
            {uploadMessage}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_1fr]">
          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-100 bg-slate-50 p-5">
              <h3 className="mb-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Filtros</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[0.7fr_0.75fr_0.85fr]">
                  <FilterSelect
                    label="Ano"
                    value={filters.year}
                    onChange={(value) => updateFilter('year', value)}
                    options={yearOptions.map((item) => ({ value: item, label: item }))}
                    placeholder="Selecciona"
                  />

                  <FilterSelect
                    label="Grado"
                    value={filters.grade}
                    onChange={(value) => updateFilter('grade', value)}
                    options={gradeOptions.map((item) => ({ value: item, label: item }))}
                    placeholder="Todos"
                  />

                  <FilterSelect
                    label="Seccion"
                    value={filters.section}
                    onChange={(value) => updateFilter('section', value)}
                    options={sectionOptions.map((item) => ({ value: item, label: item }))}
                    placeholder={filters.grade ? 'Todas' : 'Grado'}
                    disabled={!filters.grade}
                  />
                </div>

                <FilterSelect
                  label="Area"
                  value={filters.areaId}
                  onChange={(value) => updateFilter('areaId', value)}
                  options={areaOptions}
                  placeholder="Todas las areas"
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <FilterSelect
                    label="Bimestre"
                    value={filters.bimester}
                    onChange={(value) => updateFilter('bimester', value)}
                    options={BIMESTER_OPTIONS}
                    placeholder="Todos"
                  />

                  <FilterSelect
                    label="Unidad"
                    value={filters.unit}
                    onChange={(value) => updateFilter('unit', value)}
                    options={unitOptions.map((item) => ({ value: item, label: `Unidad ${item}` }))}
                    placeholder={filters.areaId ? 'Todas' : 'Selecciona area'}
                    disabled={!filters.areaId}
                  />
                </div>

                <FilterSelect
                  label="Sesion"
                  value={filters.session}
                  onChange={(value) => updateFilter('session', value)}
                  options={sessionOptions}
                  placeholder={filters.unit ? 'Todas las sesiones' : 'Selecciona una unidad'}
                  disabled={!filters.unit}
                />

                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Estudiantes</label>
                    <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600">
                      {selectedStudentIds.length} seleccionados
                    </span>
                  </div>

                  <input
                    className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700"
                    placeholder="Buscar por nombre"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                  />

                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-100"
                      onClick={selectAllVisibleStudents}
                      disabled={filteredStudents.length === 0}
                    >
                      Seleccionar visibles
                    </button>
                    <button
                      type="button"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100"
                      onClick={clearStudentSelection}
                      disabled={selectedStudentIds.length === 0}
                    >
                      Limpiar
                    </button>
                  </div>

                  <div className="mt-3 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white">
                    {filteredStudents.length === 0 ? (
                      <div className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        No hay estudiantes para esos filtros.
                      </div>
                    ) : (
                      filteredStudents.map((student) => {
                        const checked = selectedStudentIds.some((id) => String(id) === String(student.id));
                        return (
                          <label
                            key={`student-filter-${student.id}`}
                            className="flex cursor-pointer items-start gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0 hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={checked}
                              onChange={() => toggleStudent(student.id)}
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-[11px] font-black text-slate-700">{student.name}</span>
                              <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">
                                {student.grade || '-'} {student.section || ''}
                              </span>
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                  <p className="mt-3 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    Formatos permitidos: imagenes, video, PDF, Office y formato propietario .armi
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Areas</p>
                <p className="mt-2 text-lg font-black text-slate-700">{areaOptions.length}</p>
              </div>
              <div className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Unidades</p>
                <p className="mt-2 text-lg font-black text-slate-700">{unitOptions.length}</p>
              </div>
              <div className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Sesiones</p>
                <p className="mt-2 text-lg font-black text-slate-700">{sessionOptions.length}</p>
              </div>
              <div className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Estudiantes</p>
                <p className="mt-2 text-lg font-black text-slate-700">{selectedStudents.length || filteredStudents.length}</p>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-100 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-5">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Resumen activo</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Ano: {filters.year || 'Todos'}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Area: {areaOptions.find((item) => item.value === filters.areaId)?.label || 'Todas'}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Bimestre: {filters.bimester || 'Todos'}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Unidad: {filters.unit ? `U${filters.unit}` : 'Todas'}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Sesion: {filters.session ? (sessionOptions.find((item) => item.value === filters.session)?.label || 'Seleccionada') : 'Todas'}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Grado/Seccion: {(filters.grade || '-')}{filters.section ? ` ${filters.section}` : ''}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {visibleCards.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center sm:col-span-2 xl:col-span-3">
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                    Aun no hay coincidencias para los filtros actuales.
                  </p>
                </div>
              ) : (
                visibleCards.map((card) => (
                  <div key={card.id} className="group overflow-hidden rounded-3xl border border-slate-100 bg-white transition-all hover:shadow-xl">
                    <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-emerald-100 via-cyan-100 to-slate-100">
                      {(() => {
                        const accent = getFileAccent(card.previewKind);
                        return (
                          <>
                      {!card.available ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-amber-50 px-6 text-center text-amber-900">
                          <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-amber-400 bg-white text-xl font-black">!</span>
                          <p className="text-[10px] font-black uppercase tracking-widest">Archivo pendiente de la PC2</p>
                          <p className="text-[9px] font-semibold leading-relaxed">El enlace, estudiante y sesion estan protegidos. No se eliminara mientras recuperas el original.</p>
                        </div>
                      ) : card.previewKind === 'image' ? (
                        <img src={card.fileUrl} alt={card.fileName} className="h-full w-full object-cover" />
                      ) : card.previewKind === 'video' ? (
                        <video
                          src={card.fileUrl}
                          className="h-full w-full object-cover"
                          preload="metadata"
                          muted
                          autoPlay
                          loop
                          playsInline
                        />
                      ) : (
                        <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center ${accent.soft}`}>
                          <span className={`rounded-2xl px-4 py-3 text-3xl font-black uppercase text-white ${accent.bg}`}>
                            {card.previewKind === 'pdf' ? 'PDF' : card.previewKind === 'doc' ? 'DOC' : card.previewKind === 'sheet' ? 'XLS' : card.previewKind === 'slides' ? 'PPT' : card.previewKind === 'custom' ? 'ARMI' : (card.extension || accent.label)}
                          </span>
                          <span className={`line-clamp-2 rounded-xl border bg-white/80 px-3 py-2 text-[10px] font-black uppercase tracking-widest ${accent.text} ${accent.border}`}>{card.fileName}</span>
                        </div>
                      )}
                          </>
                        );
                      })()}
                      {card.available ? (
                      <div className="absolute right-3 top-3 z-10 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          title="Ver"
                          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-sm font-black text-slate-700 backdrop-blur hover:bg-white"
                          onClick={() => handleViewEvidence(card)}
                        >
                          👁️
                        </button>
                        <button
                          type="button"
                          title="Modificar"
                          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-sm font-black text-slate-700 backdrop-blur hover:bg-white"
                          onClick={() => handleReplaceEvidence(card.id)}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          title="Eliminar"
                          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-sm font-black text-rose-600 backdrop-blur hover:bg-white"
                          onClick={() => handleDeleteEvidence(card.id)}
                        >
                          ✕
                        </button>
                      </div>
                      ) : (
                        <button type="button" onClick={loadSavedEvidences} className="absolute right-3 top-3 z-10 rounded-full border border-amber-300 bg-white px-3 py-2 text-[9px] font-black uppercase text-amber-800 shadow-sm">Comprobar</button>
                      )}
                      <div className="pointer-events-none absolute inset-0 bg-slate-900/0 transition-colors group-hover:bg-slate-900/10" />
                    </div>
                    <div className="p-5">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="block truncate text-[8px] font-black uppercase tracking-widest text-emerald-600">
                            {sessionOptions.find((item) => item.value === card.filters.session)?.label || `Sesion ${card.filters.session}`}
                          </span>
                          <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[7px] font-black uppercase tracking-widest ${card.isLatest ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            Versión {card.versionNumber} · {card.isLatest ? 'Última' : 'Anterior'}
                          </span>
                        </div>
                        <span className="whitespace-nowrap text-[8px] font-bold uppercase text-slate-400">{card.uploadedAt}</span>
                      </div>
                      <h4 className="mb-2 truncate text-[10px] font-black uppercase text-slate-800">{card.fileName}</h4>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                        {formatFileSize(card.fileSize)} | {card.extension || 'archivo'}
                      </p>
                      <p className="mt-2 text-[10px] font-bold text-slate-600">
                        {card.studentNames.length === 1 ? card.studentNames[0] : `${card.studentNames.length} estudiantes vinculados`}
                      </p>
                      <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
                        {`${card.filters.grade} ${card.filters.section} | U${card.filters.unit} | ${card.filters.bimester}`}
                      </p>
                      {card.submissionIp ? (
                        <p className="mt-1 text-[8px] font-bold text-slate-400">Envío LAN: {card.submissionIp.replace('::ffff:', '')}</p>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
