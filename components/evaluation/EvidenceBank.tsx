import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  deleteEvaluacionEvidencia,
  getSessionIndex,
  getDatosGenerales,
  getEvidenceStorageConfig,
  getEvaluacionEvidencias,
  getEstudiantes,
  getProgramacionesAnuales,
  getRemoteAccessStatus,
  getRemoteAccessStudents,
  pickEvidenceStorageFolder,
  recoverEvidenceStorageToMirror,
  analyzeEvidenceRecoveryFolder,
  recoverEvidenceFolder,
  restartRemoteAccess,
  saveEvidenceStorageConfig,
  saveEvaluacionEvidencia,
  startRemoteAccess,
  stopRemoteAccess
} from '../../services/apiService';
import { Student, TeachingAssignment } from '../../types';
import { StudentChatMonitor } from './StudentChatMonitor';
import { TeacherMessages } from './TeacherMessages';
import { StudentForumMonitor } from './StudentForumMonitor';
import {
  EVIDENCE_ACCEPT,
  VALID_EVIDENCE_EXTENSIONS,
  canPreviewEvidence,
  getEvidenceExtension as getFileExtension,
  getEvidencePreviewKind,
  type EvidencePreviewKind,
} from '../../utils/evidenceFormats';

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
  previewUrl: string;
  thumbnailUrl: string;
  uploadedAt: string;
  previewKind: EvidencePreviewKind;
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

type RemoteAccessState = {
  enabledByTeacher: boolean;
  tunnelStatus: 'DISABLED' | 'STARTING' | 'CONNECTED' | 'RECONNECTING' | 'STOPPING' | 'DISCONNECTED' | 'ERROR';
  publicUrl: string;
  accessEndsAt?: string;
  pendingAccessDurationMs?: number;
  configured: boolean;
  cloudflaredInstalled: boolean;
  connectedStudents: number;
  activeUploads: number;
  queuedUploads: number;
  activeTransfers: number;
  lastError?: string | null;
  configuration?: {
    mode?: 'quick' | 'named' | 'remote';
    cloudflaredPath?: string;
    configPath?: string;
    tunnelName?: string;
    tokenFileConfigured?: boolean;
    publicUrl?: string;
  };
};

type RemoteStudentPresence = {
  sessionId: string;
  userId: string;
  names: string;
  grade: string;
  section: string;
  online: boolean;
  currentActivity: string;
  uploadStatus: 'IDLE' | 'UPLOADING' | 'QUEUED' | 'VERIFYING';
  connectedAt: string;
  lastHeartbeatAt: string;
  source: 'lan' | 'remote';
};

const EMPTY_REMOTE_STATE: RemoteAccessState = {
  enabledByTeacher: false,
  tunnelStatus: 'DISABLED',
  publicUrl: '',
  accessEndsAt: '',
  configured: false,
  cloudflaredInstalled: false,
  connectedStudents: 0,
  activeUploads: 0,
  queuedUploads: 0,
  activeTransfers: 0,
  lastError: null,
};

const EVIDENCE_RENDER_BATCH_SIZE = 24;

const formatRemoteDuration = (durationMs: number) => {
  const seconds = Math.max(0, Math.round(Number(durationMs || 0) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
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

const getPreviewKind = (extension: string): EvidenceFileItem['previewKind'] => {
  return getEvidencePreviewKind(`evidencia.${extension}`);
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104857.6) / 10} MB`;
};

const canOpenInline = (previewKind: EvidenceFileItem['previewKind']) => canPreviewEvidence(previewKind);

const getFileAccent = (previewKind: EvidenceFileItem['previewKind']) => {
  if (previewKind === 'pdf') return { bg: 'bg-red-600', soft: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'PDF' };
  if (previewKind === 'doc') return { bg: 'bg-blue-600', soft: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: 'DOC' };
  if (previewKind === 'sheet') return { bg: 'bg-emerald-600', soft: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'XLS' };
  if (previewKind === 'slides') return { bg: 'bg-orange-500', soft: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', label: 'PPT' };
  if (previewKind === 'audio') return { bg: 'bg-fuchsia-600', soft: 'bg-fuchsia-50', text: 'text-fuchsia-700', border: 'border-fuchsia-200', label: 'AUDIO' };
  if (previewKind === 'html') return { bg: 'bg-cyan-600', soft: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', label: 'HTML' };
  if (previewKind === 'text') return { bg: 'bg-teal-600', soft: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', label: 'TEXTO' };
  if (previewKind === 'archive') return { bg: 'bg-amber-600', soft: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'ZIP' };
  if (previewKind === 'svg') return { bg: 'bg-violet-600', soft: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', label: 'SVG' };
  if (previewKind === 'custom') return { bg: 'bg-slate-700', soft: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300', label: 'ARMI' };
  return { bg: 'bg-slate-600', soft: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300', label: 'FILE' };
};

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
  const [recoveryPlan, setRecoveryPlan] = useState<any>(null);
  const [remoteAccess, setRemoteAccess] = useState<RemoteAccessState>(EMPTY_REMOTE_STATE);
  const [remoteStudents, setRemoteStudents] = useState<RemoteStudentPresence[]>([]);
  const [remoteBackendAvailable, setRemoteBackendAvailable] = useState<boolean | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteMessage, setRemoteMessage] = useState('');
  const [remoteOperation, setRemoteOperation] = useState<'idle' | 'starting' | 'stopping'>('idle');
  const remoteOperationRef = useRef<'idle' | 'starting' | 'stopping'>('idle');
  const pendingRemoteDurationMsRef = useRef(0);
  const [remoteEndTime, setRemoteEndTime] = useState(() => {
    const later = new Date(Date.now() + 60 * 60 * 1000);
    later.setSeconds(0, 0);
    return `${later.getFullYear()}-${String(later.getMonth() + 1).padStart(2, '0')}-${String(later.getDate()).padStart(2, '0')}T${String(later.getHours()).padStart(2, '0')}:${String(later.getMinutes()).padStart(2, '0')}`;
  });
  const [remoteNow, setRemoteNow] = useState(Date.now());
  const [remoteQr, setRemoteQr] = useState('');
  const [visibleEvidenceLimit, setVisibleEvidenceLimit] = useState(EVIDENCE_RENDER_BATCH_SIZE);
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

    const savedAssignments = localStorage.getItem('armi_assignments');
    if (savedAssignments) {
      try {
        const parsed = JSON.parse(savedAssignments);
        if (Array.isArray(parsed)) setAssignments(parsed);
      } catch {
        // ignore local parse errors
      }
    }

    setLoading(false);

    const loadPrimaryData = async () => {
      const results = await Promise.allSettled([
        getDatosGenerales(),
        getEstudiantes(),
        getProgramacionesAnuales(),
        getSessionIndex()
      ]);
      if (!active) return;

      const [generalDataResult, studentsResult, programsResult, sessionsResult] = results;
      if (generalDataResult.status === 'fulfilled') {
        const generalData = generalDataResult.value;
        setFilters((prev) => ({ ...prev, year: generalData?.year || prev.year || getDefaultYear() }));
      }
      if (studentsResult.status === 'fulfilled') {
        const fetchedStudents = studentsResult.value;
        setStudents(Array.isArray(fetchedStudents) ? fetchedStudents : []);
      }
      if (programsResult.status === 'fulfilled') setPrograms(programsResult.value || {});
      if (sessionsResult.status === 'fulfilled') setAllSessions(Object.values(sessionsResult.value || {}));
    };

    const applyStorageConfig = (storageConfig: any) => {
      if (!active || !storageConfig?.success) return false;
      setStoragePath(storageConfig.data?.configuredPath || storageConfig.data?.effectivePath || '');
      setPortalUrls(Array.isArray(storageConfig.data?.portalUrls) ? storageConfig.data.portalUrls : []);
      setAutomaticMirrorStorage(storageConfig.data?.automaticMirror === true);
      if (storageConfig.data?.recovery) setStorageRecovery(storageConfig.data.recovery);
      setStorageMessage('');
      return true;
    };

    const loadSecondaryData = async () => {
      void loadSavedEvidences();
      const storageConfig = await getEvidenceStorageConfig();
      if (!active) return;
      if (!applyStorageConfig(storageConfig)) setStorageMessage('');

      window.setTimeout(async () => {
        if (!active) return;
        const refreshed = await getEvidenceStorageConfig();
        if (!active) return;
        applyStorageConfig(refreshed);
      }, 3000);
    };

    const onSessionIndexUpdated = (event: Event) => {
      const data = (event as CustomEvent<Record<string, any>>).detail;
      if (active && data) setAllSessions(Object.values(data));
    };
    window.addEventListener('armi-session-index-updated', onSessionIndexUpdated as EventListener);

    void loadPrimaryData();
    void loadSecondaryData();

    return () => {
      active = false;
      window.removeEventListener('armi-session-index-updated', onSessionIndexUpdated as EventListener);
    };
  }, []);

  const applyRemoteState = (next: any) => {
    if (!next) return;
    setRemoteAccess({ ...EMPTY_REMOTE_STATE, ...next });
  };

  const updateRemoteOperation = (next: 'idle' | 'starting' | 'stopping') => {
    remoteOperationRef.current = next;
    setRemoteOperation(next);
  };

  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (!active || refreshing) return;
      refreshing = true;
      try {
      const [result, presenceResult] = await Promise.all([getRemoteAccessStatus(), getRemoteAccessStudents()]);
      if (!active) return;
      // A reported tunnel error is still a valid response from the backend.
      // Keep its retry controls available instead of claiming the service died.
      if (result.data && typeof result.data.tunnelStatus === 'string') {
        setRemoteBackendAvailable(true);
        const operation = remoteOperationRef.current;
        let nextRemoteState = result.data;
        if (operation === 'starting' && result.data.tunnelStatus === 'DISABLED') {
          nextRemoteState = {
            ...result.data,
            enabledByTeacher: true,
            tunnelStatus: 'STARTING',
            publicUrl: '',
            lastError: null,
            accessEndsAt: result.data.accessEndsAt || '',
            pendingAccessDurationMs: result.data.pendingAccessDurationMs || pendingRemoteDurationMsRef.current,
          };
        }
        applyRemoteState(nextRemoteState);
        if (operation === 'starting' && ['CONNECTED', 'ERROR'].includes(result.data.tunnelStatus)) {
          updateRemoteOperation('idle');
        } else if (operation === 'stopping' && result.data.tunnelStatus === 'DISABLED') {
          updateRemoteOperation('idle');
        }
      } else {
        setRemoteBackendAvailable(false);
        setRemoteMessage(result.message || 'El servicio local de ARMI se está recuperando.');
      }
      if (presenceResult.data?.students) setRemoteStudents(presenceResult.data.students);
      } finally { refreshing = false; }
    };
    void refresh();
    const unsubscribeRecovery = window.armiApp?.onBackendRecovered?.(() => {
      if (active) void refresh();
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, remoteOperation === 'idle' ? (remoteAccess.enabledByTeacher ? 5000 : 15000) : 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
      if (typeof unsubscribeRecovery === 'function') unsubscribeRecovery();
    };
  }, [remoteAccess.enabledByTeacher, remoteOperation]);

  useEffect(() => {
    if (!remoteAccess.accessEndsAt) return;
    const timer = window.setInterval(() => setRemoteNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [remoteAccess.accessEndsAt]);

  const remoteStudentGroups = useMemo(() => {
    const groups = new Map<string, RemoteStudentPresence[]>();
    remoteStudents.filter((student) => student.online).forEach((student) => {
      const key = `${student.grade} · ${student.section}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)?.push(student);
    });
    return [...groups.entries()];
  }, [remoteStudents]);

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
      previewUrl: item.previewUrl || '',
      thumbnailUrl: item.thumbnailUrl || '',
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
    let reading = false;
    const refresh = async () => {
      if (reading || document.visibilityState !== 'visible') return;
      reading = true;
      try { await loadSavedEvidences(); } finally { reading = false; }
    };
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);

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
    setUnitSessions([]);
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
      previewUrl: '',
      thumbnailUrl: '',
      available: false,
      availabilitySource: 'pending-upload',
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
      const res = await saveEvaluacionEvidencia({
        id: replaceId || undefined,
        sessionId: `${draft.filters.year}-${draft.filters.areaId}-${draft.filters.grade}-${draft.filters.section}-U${draft.filters.unit}-S${draft.filters.session}`,
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
        fileSize: draft.fileSize
      }, file);
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
      window.open(item.previewUrl || item.fileUrl, '_blank', 'noopener,noreferrer');
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

  const renderedCards = useMemo(
    () => visibleCards.slice(0, visibleEvidenceLimit),
    [visibleCards, visibleEvidenceLimit]
  );

  useEffect(() => {
    setVisibleEvidenceLimit(EVIDENCE_RENDER_BATCH_SIZE);
  }, [filters.year, filters.areaId, filters.bimester, filters.unit, filters.session, filters.grade, filters.section, selectedStudentIds]);

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

  const analyzeRecoveryFolder = async () => {
    setStorageBusy(true); setRecoveryPlan(null); setStorageMessage('');
    try {
      const picked = await pickEvidenceStorageFolder();
      if (picked.cancelled) return;
      if (!picked.success || !picked.path) throw new Error(picked.message || 'No se pudo seleccionar la carpeta.');
      const result = await analyzeEvidenceRecoveryFolder(picked.path);
      if (!result.success) throw new Error(result.message);
      setRecoveryPlan(result.data);
    } catch(error: any) { setStorageMessage(error.message); }
    finally { setStorageBusy(false); }
  };
  const recoverAnalyzedFolder = async () => {
    if (!recoveryPlan?.token) return;
    setStorageBusy(true);
    try {
      const result = await recoverEvidenceFolder(recoveryPlan.token);
      if (!result.success) throw new Error(result.message);
      setStorageRecovery(result.data.recovery); setRecoveryPlan(null);
      setStorageMessage(result.message + (result.data.failures?.length ? ` ${result.data.failures.map((item: any) => `${item.fileName}: ${item.reason}`).join('; ')}` : ' Espera a que Google Drive termine de sincronizar.'));
      await loadSavedEvidences();
    } catch(error: any) { setRecoveryPlan(null); setStorageMessage(error.message); }
    finally { setStorageBusy(false); }
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

  const remotePortalUrl = remoteAccess.publicUrl
    ? `${remoteAccess.publicUrl.replace(/\/+$/, '')}/estudiante`
    : '';
  const remoteIsConnected = remoteAccess.tunnelStatus === 'CONNECTED' && Boolean(remotePortalUrl);
  const remoteIsStarting = remoteOperation === 'starting' || (remoteOperation === 'idle' && ['STARTING', 'RECONNECTING'].includes(remoteAccess.tunnelStatus));
  const remoteIsStopping = remoteOperation === 'stopping' || remoteAccess.tunnelStatus === 'STOPPING';
  const remoteNeedsRetry = !remoteIsStarting && !remoteIsStopping && remoteAccess.enabledByTeacher && ['DISCONNECTED', 'ERROR'].includes(remoteAccess.tunnelStatus);
  const remoteNotice = remoteBackendAvailable === false
    ? 'El servicio local de ARMI se está recuperando automáticamente.'
    : remoteIsStopping
      ? 'ARMI está desactivando y cerrando el enlace por Internet.'
      : remoteIsStarting
        ? 'ARMI está creando y verificando el enlace por Internet.'
        : remoteAccess.tunnelStatus === 'ERROR'
          ? remoteAccess.lastError || remoteMessage
          : remoteMessage || remoteAccess.lastError;

  useEffect(() => {
    if (remoteAccess.tunnelStatus === 'ERROR' && remoteAccess.lastError) {
      setRemoteMessage(remoteAccess.lastError);
    } else if (remoteAccess.tunnelStatus === 'CONNECTED') {
      setRemoteMessage('Acceso remoto conectado y verificado.');
    }
  }, [remoteAccess.tunnelStatus, remoteAccess.lastError]);

  const remoteStatusView = remoteBackendAvailable === false
    ? { dot: 'bg-amber-300 animate-pulse', label: 'Recuperando servicio', text: 'text-amber-200' }
    : remoteIsStarting
      ? { dot: 'bg-amber-300 animate-pulse', label: 'Creando enlace', text: 'text-amber-200' }
      : remoteIsStopping
        ? { dot: 'bg-amber-300 animate-pulse', label: 'Desactivando', text: 'text-amber-200' }
        : {
    DISABLED: { dot: 'bg-slate-300', label: 'Desactivado', text: 'text-slate-200' },
    STARTING: { dot: 'bg-amber-300 animate-pulse', label: 'Iniciando', text: 'text-amber-200' },
    CONNECTED: { dot: 'bg-emerald-400', label: 'Conectado', text: 'text-emerald-200' },
    RECONNECTING: { dot: 'bg-orange-300 animate-pulse', label: 'Reconectando', text: 'text-orange-200' },
    STOPPING: { dot: 'bg-amber-300 animate-pulse', label: 'Desactivando', text: 'text-amber-200' },
    DISCONNECTED: { dot: 'bg-orange-400', label: 'Sin conexión', text: 'text-orange-200' },
    ERROR: { dot: 'bg-red-400', label: 'Error', text: 'text-red-200' },
      }[remoteAccess.tunnelStatus] || { dot: 'bg-slate-300', label: 'Desactivado', text: 'text-slate-200' };

  const toggleRemoteAccess = async () => {
    const shouldStop = remoteIsConnected || remoteIsStarting;
    if (!shouldStop && !remoteNeedsRetry && (!Number.isFinite(new Date(remoteEndTime).getTime()) || new Date(remoteEndTime).getTime() <= Date.now())) {
      setRemoteMessage('Selecciona una hora de cierre posterior a la hora actual.');
      return;
    }
    setRemoteBusy(true);
    setRemoteMessage(shouldStop ? 'Desactivando acceso remoto...' : remoteNeedsRetry ? 'Creando un nuevo enlace por Internet...' : 'Comprobando servidor, Internet y túnel seguro...');
    if (!shouldStop) {
      const requestedDurationMs = Math.max(1_000, new Date(remoteEndTime).getTime() - Date.now());
      if (!remoteNeedsRetry) pendingRemoteDurationMsRef.current = requestedDurationMs;
      updateRemoteOperation('starting');
      setRemoteAccess((current) => ({
        ...current,
        enabledByTeacher: true,
        tunnelStatus: remoteNeedsRetry ? 'RECONNECTING' : 'STARTING',
        publicUrl: '',
        lastError: null,
        accessEndsAt: remoteNeedsRetry ? current.accessEndsAt : '',
        pendingAccessDurationMs: remoteNeedsRetry ? current.pendingAccessDurationMs : requestedDurationMs,
      }));
    }
    const result = shouldStop
      ? await stopRemoteAccess()
      : remoteNeedsRetry
        ? await restartRemoteAccess()
        : await startRemoteAccess(new Date(remoteEndTime).toISOString());
    const acceptedStartStillPreparing = !shouldStop && result.success && result.data?.tunnelStatus === 'DISABLED';
    const effectiveResultState = acceptedStartStillPreparing
      ? { ...result.data, enabledByTeacher: true, tunnelStatus: remoteNeedsRetry ? 'RECONNECTING' : 'STARTING', publicUrl: '', lastError: null }
      : result.data;
    if (effectiveResultState) applyRemoteState(effectiveResultState);
    if (!result.success && !result.data) {
      updateRemoteOperation('idle');
      setRemoteAccess((current) => ({
        ...current,
        enabledByTeacher: true,
        tunnelStatus: 'ERROR',
        publicUrl: '',
        lastError: result.message || 'No se pudo iniciar el acceso remoto.',
      }));
    }
    const nextStatus = effectiveResultState?.tunnelStatus;
    if (['CONNECTED', 'ERROR'].includes(nextStatus)) updateRemoteOperation('idle');
    setRemoteMessage(!result.success
      ? result.message || result.data?.lastError || 'No se pudo cambiar el acceso remoto.'
      : nextStatus === 'CONNECTED'
        ? 'Acceso remoto conectado y verificado.'
        : nextStatus === 'DISABLED'
          ? 'Acceso remoto desactivado.'
          : result.message || 'Creando y verificando el enlace por Internet...');
    setRemoteBusy(false);
  };

  const copyRemotePortalUrl = async () => {
    if (!remotePortalUrl) return;
    await navigator.clipboard.writeText(remotePortalUrl);
    setRemoteMessage('Enlace remoto copiado.');
  };

  const showRemoteQrCode = async () => {
    if (!remotePortalUrl) return;
    try {
      setRemoteQr(await QRCode.toDataURL(remotePortalUrl, { width: 360, margin: 2 }));
    } catch {
      setRemoteMessage('No se pudo generar el código QR.');
    }
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
      <TeacherMessages />
      <StudentChatMonitor />
      <StudentForumMonitor />
      <div className="overflow-hidden rounded-[2rem] border border-violet-100 bg-gradient-to-br from-slate-950 via-violet-950 to-cyan-950 p-6 text-white shadow-xl">
        <div className="grid gap-5 xl:grid-cols-[1fr_0.75fr]">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">Recepción por red local</p>
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
                {(storageRecovery.historicalFiles || 0) > 0 && <p className="mt-2">{storageRecovery.historicalFiles} archivos de versiones reemplazadas se conservan en el historial y no se cuentan como pendientes.</p>}
                {(storageRecovery.duplicateRecords || 0) > 0 && <p className="mt-1">Los registros repetidos se cuentan una sola vez por archivo.</p>}
                {(storageRecovery.deletedRecords || 0) > 0 && <p className="mt-1">Las evidencias con borrado registrado no se incluyen en la recuperaci?n.</p>}
                {storageRecovery.missingFiles > 0 && <button type="button" onClick={analyzeRecoveryFolder} disabled={storageBusy} className="mt-3 rounded-xl bg-white px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-900 disabled:opacity-50">Buscar pendientes en una carpeta</button>}
                {recoveryPlan && <div className="mt-4 rounded-xl bg-slate-950/50 p-4">
                  <p className="break-all">Carpeta analizada: {recoveryPlan.folder}</p>
                  <p className="mt-2">{recoveryPlan.files} archivos coinciden con los pendientes · {recoveryPlan.records} registros recuperables</p>
                  <p className="mt-1">{recoveryPlan.scannedFiles ?? 0} archivos revisados en la carpeta y sus subcarpetas.</p>
                  <p className="mt-2">Se copiarán al espejo verificando su integridad. Los originales permanecerán en su carpeta.</p>
                  <div className="mt-3 max-h-64 overflow-auto space-y-2">
                    {recoveryPlan.items.map((item: any) => <div key={item.relativePath} className="rounded-lg bg-white/10 p-2"><b className="break-all">{item.fileName}</b><p>{item.size.toLocaleString()} bytes · {item.records} registros</p><p>{item.matchType}</p><p className="break-all">Origen: {item.source}</p></div>)}
                    {recoveryPlan.unresolved.map((item: any) => <div key={item.relativePath} className="rounded-lg bg-white/5 p-2 break-all"><b>{item.fileName}</b><p>{item.reason}</p>{item.storedName && <p>Nombre guardado: {item.storedName}</p>}{item.expectedSize > 0 && <p>Tamaño esperado: {item.expectedSize.toLocaleString()} bytes</p>}{item.candidates?.map((candidate: any) => <p key={candidate.path}>Encontrado: {candidate.path} · {candidate.size?.toLocaleString() ?? '?'} bytes</p>)}</div>)}
                    {recoveryPlan.warnings?.map((warning: string) => <p key={warning}>{warning}</p>)}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={recoverAnalyzedFolder} disabled={storageBusy || !recoveryPlan.files} className="rounded-xl bg-emerald-300 px-4 py-2 text-emerald-950 disabled:opacity-50">Copiar y enlazar {recoveryPlan.files} archivos</button><button type="button" onClick={() => setRecoveryPlan(null)} disabled={storageBusy} className="rounded-xl border border-white/30 px-4 py-2">Cancelar</button></div>
                </div>}
                {storageRecovery.recoverableHere > 0 ? (
                  <button type="button" onClick={recoverStorageToMirror} disabled={storageBusy} className="mt-3 rounded-xl bg-amber-300 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-amber-950 disabled:opacity-50">
                    Copiar y enlazar {storageRecovery.recoverableHere} archivos sin borrar originales
                  </button>
                ) : storageRecovery.missingFiles > 0 ? (
                  <p className="mt-2 leading-relaxed">ARMI no encuentra algunos originales. En la PC que los conserve, usa “Buscar pendientes en una carpeta” y selecciona su ubicación antigua.</p>
                ) : (
                  <p className="mt-2">Todas las evidencias vigentes est?n disponibles desde la carpeta espejo.</p>
                )}
              </div>
            ) : null}
            {storageMessage ? <div className="mt-3 text-[11px] font-bold text-amber-200">{storageMessage}</div> : null}
          </div>
          <div className="space-y-3">
            <div className="rounded-3xl border border-white/10 bg-white/10 p-5 backdrop-blur-sm">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">Acceso local · LAN / Wi-Fi</div>
              <div className="mt-3 break-all rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm font-black text-white">
                {portalUrls[0] || 'Conecta este equipo a una red para detectar su IP.'}
              </div>
              <button type="button" onClick={copyPortalUrl} disabled={!portalUrls.length} className="mt-3 w-full rounded-2xl bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-violet-800 hover:bg-violet-50 disabled:opacity-50">
                Copiar enlace local
              </button>
              <p className="mt-3 text-[10px] font-semibold leading-relaxed text-slate-300">Funciona dentro de la misma red y permanece disponible aunque el acceso remoto esté apagado.</p>
            </div>

            <div className="rounded-3xl border border-cyan-300/20 bg-slate-950/35 p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">Acceso remoto</div>
                <div className={`flex items-center gap-2 text-[10px] font-black uppercase ${remoteStatusView.text}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${remoteStatusView.dot}`} />
                  {remoteStatusView.label}
                </div>
              </div>

              {remotePortalUrl ? (
                <div className="mt-3 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3">
                  <div className="text-[8px] font-black uppercase tracking-[0.16em] text-emerald-300">Enlace por Internet para estudiantes</div>
                  <div className="mt-1 break-all text-xs font-black text-white">{remotePortalUrl}</div>
                </div>
              ) : (
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-bold text-slate-300">
                  {remoteBackendAvailable === null
                    ? 'Comprobando el servicio local de ARMI…'
                    : remoteBackendAvailable === false
                      ? 'El servicio local de ARMI se está recuperando automáticamente. Espera unos segundos.'
                      : !remoteAccess.cloudflaredInstalled
                    ? 'Falta el componente de acceso remoto. Reinstala o actualiza ARMI.'
                    : remoteIsStopping
                      ? 'Desactivando el acceso remoto y cerrando el enlace por Internet…'
                    : remoteIsStarting
                      ? 'Creando y verificando el enlace por Internet… Todavía no lo compartas.'
                      : remoteNeedsRetry
                        ? remoteAccess.lastError || 'No hay un enlace por Internet activo. El enlace local mostrado arriba solo funciona dentro de la misma red.'
                        : 'Listo para crear un enlace por Internet. Se mostrará aquí cuando esté verificado.'}
                </div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2 text-center text-[9px] font-black uppercase text-slate-300 sm:grid-cols-4">
                <div className="rounded-xl bg-white/5 px-2 py-2"><b className="block text-sm text-white">{remoteAccess.connectedStudents}</b>Online</div>
                <div className="rounded-xl bg-white/5 px-2 py-2"><b className="block text-sm text-white">{remoteAccess.activeUploads}</b>Subiendo</div>
                <div className="rounded-xl bg-white/5 px-2 py-2"><b className="block text-sm text-white">{remoteAccess.queuedUploads}</b>En cola</div>
                <div className="rounded-xl bg-white/5 px-2 py-2"><b className="block text-sm text-white">{remoteAccess.activeTransfers}</b>Transferencias</div>
              </div>

              {remoteStudentGroups.length > 0 ? (
                <div className="mt-3 max-h-52 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/30 p-3">
                  {remoteStudentGroups.map(([group, studentsInGroup]) => (
                    <div key={group} className="rounded-xl bg-white/5 p-3">
                      <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-cyan-100">
                        <span>{group}</span><span>{studentsInGroup.length} en línea</span>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {studentsInGroup.map((student) => (
                          <div key={student.sessionId} className="flex items-center justify-between gap-3 text-[10px] font-semibold text-slate-200">
                            <span className="min-w-0 truncate"><i className={`mr-2 inline-block h-2 w-2 rounded-full ${student.uploadStatus === 'UPLOADING' ? 'bg-blue-400' : student.uploadStatus === 'QUEUED' ? 'bg-amber-300' : 'bg-emerald-400'}`} />{student.names}</span>
                            <span className="shrink-0 text-[8px] font-black uppercase text-slate-400">{student.uploadStatus === 'UPLOADING' ? 'Subiendo' : student.uploadStatus === 'QUEUED' ? 'En cola' : student.currentActivity || 'En línea'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-center text-[9px] font-bold text-slate-400">Todavía no hay estudiantes en línea.</p>
              )}

              {remoteIsStarting && !remoteAccess.accessEndsAt ? (
                <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-[10px] font-bold text-amber-100">
                  El contador iniciará cuando el enlace esté validado
                  {' · '}Duración: {formatRemoteDuration(remoteAccess.pendingAccessDurationMs || pendingRemoteDurationMsRef.current)}
                </div>
              ) : remoteAccess.accessEndsAt && (remoteAccess.enabledByTeacher || remoteIsStopping) ? (
                <div className={`mt-3 rounded-xl border px-3 py-2 text-[10px] font-bold ${remoteIsStarting ? 'border-amber-300/30 bg-amber-300/10 text-amber-100' : 'border-cyan-300/25 bg-cyan-300/10 text-cyan-50'}`}>
                  Cierre automático: {new Date(remoteAccess.accessEndsAt).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' })}
                  {' · '}Quedan {(() => { const seconds = Math.max(0, Math.ceil((new Date(remoteAccess.accessEndsAt).getTime() - remoteNow) / 1000)); return `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; })()}
                </div>
              ) : !remoteAccess.enabledByTeacher ? (
                <label className="mt-3 block text-[10px] font-bold text-cyan-50" htmlFor="remoteEndTime">
                  Acceso remoto activo hasta
                  <input id="remoteEndTime" type="datetime-local" value={remoteEndTime} onChange={event => setRemoteEndTime(event.target.value)} className="mt-1 w-full rounded-xl border border-white/20 bg-slate-900 px-3 py-2 text-xs text-white [color-scheme:dark]" />
                </label>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={toggleRemoteAccess} disabled={remoteBusy || remoteBackendAvailable !== true || remoteIsStarting || remoteIsStopping} aria-busy={remoteBusy || remoteIsStarting || remoteIsStopping} className={`flex-1 rounded-2xl px-4 py-3 text-[10px] font-black uppercase tracking-widest disabled:opacity-70 ${remoteIsStarting || remoteIsStopping ? 'cursor-wait bg-amber-300 text-amber-950' : remoteIsConnected ? 'bg-red-100 text-red-700 hover:bg-red-50' : remoteNeedsRetry ? 'bg-amber-300 text-amber-950 hover:bg-amber-200' : 'bg-emerald-400 text-emerald-950 hover:bg-emerald-300'}`}>
                  {remoteBackendAvailable !== true
                    ? remoteBackendAvailable === null ? 'Comprobando servicio local…' : 'Recuperando servicio local…'
                    : remoteIsStopping
                    ? <span className="inline-flex items-center justify-center gap-2"><span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />Desactivando acceso remoto…</span>
                    : remoteBusy || remoteIsStarting
                    ? <span className="inline-flex items-center justify-center gap-2"><span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />Creando y validando enlace…</span>
                    : remoteIsConnected
                      ? 'Desactivar acceso remoto'
                      : remoteNeedsRetry
                          ? 'Reintentar acceso remoto'
                          : 'Activar acceso remoto'}
                </button>
              </div>

              {remoteIsStarting ? (
                <button type="button" onClick={async () => {
                  setRemoteBusy(true);
                  updateRemoteOperation('stopping');
                  setRemoteMessage('Cancelando la creación del enlace remoto...');
                  const result = await stopRemoteAccess();
                  if (result.data) applyRemoteState(result.data);
                  updateRemoteOperation('idle');
                  setRemoteMessage(result.success ? 'Creación cancelada. El acceso remoto está desactivado.' : result.message || 'No se pudo cancelar la activación.');
                  setRemoteBusy(false);
                }} disabled={remoteBusy} className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-300 hover:bg-white/10 disabled:opacity-50">
                  Cancelar creación del enlace
                </button>
              ) : null}

              <p className="mt-3 text-[9px] font-semibold leading-relaxed text-slate-400">
                No requiere cuenta, dominio ni token. El enlace cambia cada vez que lo activas y deja de funcionar al desactivarlo o cerrar ARMI.
              </p>


              {remoteNeedsRetry ? (
                <button type="button" onClick={async () => {
                  setRemoteBusy(true);
                  setRemoteMessage('Cancelando los intentos de conexión...');
                  const result = await stopRemoteAccess();
                  if (result.data) applyRemoteState(result.data);
                  setRemoteMessage(result.success ? 'Acceso remoto desactivado.' : result.message || 'No se pudo desactivar.');
                  setRemoteBusy(false);
                }} disabled={remoteBusy} className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-300 disabled:opacity-50">Cancelar y dejar desactivado</button>
              ) : null}

              {remotePortalUrl ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" onClick={copyRemotePortalUrl} className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest hover:bg-white/20">Copiar enlace</button>
                  <button type="button" onClick={showRemoteQrCode} className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest hover:bg-white/20">Mostrar QR</button>
                </div>
              ) : null}

              {remoteNotice ? (
                <p className={`mt-3 text-[10px] font-bold leading-relaxed ${remoteAccess.tunnelStatus === 'ERROR' ? 'text-red-200' : 'text-amber-100'}`}>{remoteNotice}</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {remoteQr ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-sm" onClick={() => setRemoteQr('')}>
          <div className="w-full max-w-sm rounded-[2rem] bg-white p-6 text-center shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-600">Portal remoto de estudiantes</div>
            <img src={remoteQr} alt="Código QR del portal remoto" className="mx-auto mt-4 h-64 w-64 rounded-2xl border border-slate-100" />
            <p className="mt-3 break-all text-xs font-bold text-slate-600">{remotePortalUrl}</p>
            <button type="button" onClick={() => setRemoteQr('')} className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white">Cerrar</button>
          </div>
        </div>
      ) : null}
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
                renderedCards.map((card, cardIndex) => (
                  <div
                    key={card.id}
                    className="group overflow-hidden rounded-3xl border border-slate-100 bg-white transition-all hover:shadow-xl"
                    style={{ contentVisibility: 'auto', containIntrinsicSize: '360px' }}
                  >
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
                        <img
                          src={card.thumbnailUrl || card.fileUrl}
                          alt={card.fileName}
                          loading={cardIndex < 8 ? 'eager' : 'lazy'}
                          decoding="async"
                          fetchPriority={cardIndex < 4 ? 'high' : 'auto'}
                          onError={(event) => {
                            const image = event.currentTarget;
                            if (image.dataset.originalFallback === '1' || !card.fileUrl) return;
                            image.dataset.originalFallback = '1';
                            image.src = card.fileUrl;
                          }}
                          className="h-full w-full object-cover"
                        />
                      ) : card.previewKind === 'video' ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-indigo-100 via-violet-100 to-slate-100 px-4 text-center">
                          {card.thumbnailUrl ? <img src={card.thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-45" /> : null}
                          <span className="rounded-2xl bg-indigo-600 px-4 py-3 text-2xl font-black uppercase text-white">VIDEO</span>
                          <span className="line-clamp-2 rounded-xl border border-indigo-200 bg-white/80 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-indigo-700">{card.fileName}</span>
                          <span className="text-[8px] font-bold uppercase tracking-widest text-indigo-500">Pulsa Ver para reproducir</span>
                        </div>
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
            {renderedCards.length < visibleCards.length ? (
              <div className="mt-6 flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleEvidenceLimit((current) => current + EVIDENCE_RENDER_BATCH_SIZE)}
                  className="rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-emerald-700 hover:bg-emerald-100"
                >
                  Mostrar {Math.min(EVIDENCE_RENDER_BATCH_SIZE, visibleCards.length - renderedCards.length)} evidencias más
                </button>
                <p className="text-[9px] font-bold text-slate-400">Mostrando {renderedCards.length} de {visibleCards.length}</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
