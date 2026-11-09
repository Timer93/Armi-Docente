import { openStudentPhoto } from '../students/studentPhotoViewer';
﻿import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, LabelList } from 'recharts';
import { Check, Download, Eye, Pencil, Trash2, Users, X } from 'lucide-react';
import logoBar from '../../src/Logo_bar.ico';
import { deleteEvaluacionEvidencia, getEvaluacionEvidencias, getPendingEvidenceReviews, renameEvaluacionEvidencia, saveEvaluacionEvidencia, updateEvaluacionEvidenciaFeedback } from '../../services/apiService';
import { EvidenceDeliveryWindowControl } from '../evaluation/EvidenceDeliveryWindowControl';
import { EvidenceTemplateDocuments } from './EvidenceTemplateWorkspace';
import { autoResizeTextarea, colorTokenToCss, extractCapacidades, extractRichTextItems, hexToRgba, normalizeLoose } from './shared';
import {
    EVIDENCE_ACCEPT,
    VALID_EVIDENCE_EXTENSIONS,
    canPreviewEvidence,
    getEvidenceExtension as getFileExtension,
    getEvidencePreviewKind,
    type EvidencePreviewKind,
} from '../../utils/evidenceFormats';

type GradingRecord = { level: string; observation: string };
type SessionEvidenceItem = {
    id: string | number;
    fileName: string;
    fileSize: number;
    fileType: string;
    fileUrl: string;
    previewUrl: string;
    thumbnailUrl: string;
    uploadedAt: string;
    source: string;
    deliveryTiming: 'on_time' | 'late' | 'unknown' | 'teacher';
    lateByMs: number;
    onTimeCloseAt: string;
    renamedBy: string;
    observation: string;
    requestedEvidence?: { id: string; text: string; competency: string; source: string; color: string } | null;
    evidenceLink: string;
    teacherComment: string;
    teacherCommentedAt: string;
    studentIds: Array<string | number>;
    studentNames: string[];
    available: boolean;
    previewKind: EvidencePreviewKind;
};

const getPreviewKind = (extension: string): SessionEvidenceItem['previewKind'] => {
    return getEvidencePreviewKind(`evidencia.${extension}`);
};

const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
    return `${Math.round(bytes / 104857.6) / 10} MB`;
};

const formatEvidenceDate = (value: string) => {
    if (!value) return 'Sin fecha';
    const parsed = new Date(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
    return Number.isNaN(parsed.getTime())
        ? value
        : new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(parsed);
};

const formatLateDuration = (value: number) => {
    const totalMinutes = Math.max(1, Math.ceil(Number(value || 0) / 60_000));
    const days = Math.floor(totalMinutes / 1_440);
    const hours = Math.floor((totalMinutes % 1_440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
    if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
    return `${minutes} min`;
};

const canOpenInline = (previewKind: SessionEvidenceItem['previewKind']) => canPreviewEvidence(previewKind);

interface SessionRegisterPanelProps {
    performanceText?: string;
    navigationTarget?: import('../../utils/sessionRegisterNavigation').SessionRegisterTarget | null;
    currentSessionId: string | null;
    bimesterLabel: string;
    filteredStudents: any[];
    generalData: any;
    gradingCanonicalLevels: Array<{ id: string; label: string; short: string; color: string }>;
    gradingCriteriaRows: any[];
    gradingLoading: boolean;
    gradingRecords: Record<string, GradingRecord>;
    gradingSectionTabs: React.ReactNode;
    activeGradingSection?: string;
    gradingSessionGroups: { groups: any[]; criterionBlocks: any[] };
    gradingCodeToStoredLevel: (code: string) => string;
    normalizeGradingLevelToCode: (rawLevel: any) => string;
    sessionData: any;
    selArea: string;
    selGrade: string;
    selSection: string;
    sessionDate: string;
    sessionNumber: string;
    unitNumber: string;
    expandedSessionRegisterObservations: Record<string, boolean>;
    setExpandedSessionRegisterObservations: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    updateGradingRecord: (studentId: string | number, criteriaId: string | number, patch: Partial<GradingRecord>) => void;
    getGradingKey: (studentId: string | number, criteriaId: string | number) => string;
}

const PrintMiniIcon = () => (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 9V4h10v5" />
        <rect x="4" y="9" width="16" height="8" rx="2" />
        <path d="M7 14h10v6H7z" />
        <path d="M17 12h.01" />
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

const UploadEvidenceIcon = () => (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" />
    </svg>
);

const RefreshEvidenceIcon = ({ busy = false }: { busy?: boolean }) => (
    <svg viewBox="0 0 24 24" className={`h-6 w-6 ${busy ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6v5h-5" />
        <path d="M4 18v-5h5" />
        <path d="M18.5 9A7 7 0 0 0 6.2 6.2L4 8" />
        <path d="M5.5 15A7 7 0 0 0 17.8 17.8L20 16" />
    </svg>
);

const StudentEvidenceAvatar = ({ studentId, studentName }: { studentId: string | number; studentName: string }) => {
    const [imageReady, setImageReady] = React.useState(false);
    const [imageFailed, setImageFailed] = React.useState(false);
    const initials = String(studentName || 'E')
        .split(/[\s,]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('') || 'E';

    React.useEffect(() => {
        setImageReady(false);
        setImageFailed(false);
    }, [studentId]);
    React.useEffect(() => {
        const refresh = (event: Event) => {
            if ((event as CustomEvent).detail?.studentId === String(studentId)) {
                setImageFailed(false); setImageReady(false);
            }
        };
        window.addEventListener('armi:student-photo-updated', refresh);
        return () => window.removeEventListener('armi:student-photo-updated', refresh);
    }, [studentId]);

    return (
        <button type="button" onClick={() => void openStudentPhoto(studentId, studentName)} aria-label={`Ampliar foto de ${studentName}`} className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-white bg-gradient-to-br from-violet-100 to-sky-100 text-[11px] font-black text-violet-700 shadow-md ring-1 ring-slate-200" title={`Foto de ${studentName}`}>
            <span aria-hidden="true">{initials}</span>
            {!imageFailed ? (
                <img
                    src={`/api/asistencia/rostros/${encodeURIComponent(String(studentId))}/avatar`}
                    alt={`Foto de perfil de ${studentName}`}
                    data-student-photo-id={String(studentId)}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    onLoad={() => setImageReady(true)}
                    onError={() => setImageFailed(true)}
                    className={`absolute inset-0 h-full w-full object-cover transition-opacity ${imageReady ? 'opacity-100' : 'opacity-0'}`}
                />
            ) : null}
        </button>
    );
};

const STUDENT_GROUP_PALETTE = [
    { surface: '#dbeafe', dot: '#2563eb', text: '#1e3a8a' },
    { surface: '#dcfce7', dot: '#16a34a', text: '#14532d' },
    { surface: '#fef3c7', dot: '#d97706', text: '#78350f' },
    { surface: '#fce7f3', dot: '#db2777', text: '#831843' },
    { surface: '#ede9fe', dot: '#7c3aed', text: '#4c1d95' },
    { surface: '#cffafe', dot: '#0891b2', text: '#164e63' },
    { surface: '#ffedd5', dot: '#ea580c', text: '#7c2d12' },
    { surface: '#e2e8f0', dot: '#475569', text: '#1e293b' }
];

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

export const SessionRegisterPanel: React.FC<SessionRegisterPanelProps> = ({
    navigationTarget,
    currentSessionId,
    performanceText,
    bimesterLabel,
    filteredStudents,
    generalData,
    gradingCanonicalLevels,
    gradingCriteriaRows,
    gradingLoading,
    gradingRecords,
    gradingSectionTabs,
    activeGradingSection,
    gradingSessionGroups,
    gradingCodeToStoredLevel,
    normalizeGradingLevelToCode,
    sessionData,
    selArea,
    selGrade,
    selSection,
    sessionDate,
    sessionNumber,
    unitNumber,
    expandedSessionRegisterObservations,
    setExpandedSessionRegisterObservations,
    updateGradingRecord,
    getGradingKey
}) => {
    const focusedStudentRef = React.useRef<HTMLTableRowElement | null>(null);
    const lastFocusedTargetRef = React.useRef('');
    React.useEffect(() => {
        const key = navigationTarget ? `${navigationTarget.sessionId}:${navigationTarget.studentId}` : '';
        if (!key || gradingLoading || lastFocusedTargetRef.current === key || !focusedStudentRef.current) return;
        focusedStudentRef.current.focus({ preventScroll: true });
        focusedStudentRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
        lastFocusedTargetRef.current = key;
    }, [navigationTarget, gradingLoading, filteredStudents]);
    const [showCellDescriptors, setShowCellDescriptors] = React.useState(true);
    const [evidenceModal, setEvidenceModal] = React.useState<null | {
        studentId: string | number;
        studentName: string;
        competency: any;
        summaryId: string;
        summaryLabel: string;
    }>(null);
    const [sessionEvidences, setSessionEvidences] = React.useState<SessionEvidenceItem[]>([]);
    const [evidenceBusy, setEvidenceBusy] = React.useState(false);
    const [evidenceMessage, setEvidenceMessage] = React.useState('');
    const [renamingEvidence, setRenamingEvidence] = React.useState<{ id: string | number; name: string } | null>(null);
    const [teacherCommentDrafts, setTeacherCommentDrafts] = React.useState<Record<string, string>>({});
    const [showEvidenceGroup, setShowEvidenceGroup] = React.useState(false);
    const [pendingReviewStudentIds, setPendingReviewStudentIds] = React.useState<Set<string>>(new Set());
    const [studentEvidenceCounts, setStudentEvidenceCounts] = React.useState<Record<string, number>>({});
    const [templateDraftCounts, setTemplateDraftCounts] = React.useState<Record<string, number>>({});
    const [evidenceSummarySessionId, setEvidenceSummarySessionId] = React.useState<string | null>(null);
    const [evidenceSummaryState, setEvidenceSummaryState] = React.useState<'loading' | 'ready' | 'error'>('loading');
    const evidenceInputRef = React.useRef<HTMLInputElement | null>(null);
    const evidenceLoadRequestRef = React.useRef(0);

    const currentYear = String(generalData?.year || new Date().getFullYear());
    const currentAreaId = String(sessionData?.sessionAssessmentModel?.scope?.areaId || sessionData?.areaId || selArea || '').trim();

    React.useEffect(() => {
        let active = true;
        let reading = false;
        setEvidenceSummarySessionId(currentSessionId);
        setPendingReviewStudentIds(new Set());
        setStudentEvidenceCounts({});
        setTemplateDraftCounts({});
        setEvidenceSummaryState('loading');
        if (!currentSessionId) {
            setPendingReviewStudentIds(new Set());
            return;
        }
        const refresh = async () => {
            if (document.visibilityState === 'hidden' || reading) return;
            reading = true;
            const [result, templates] = await Promise.all([
                getPendingEvidenceReviews(currentSessionId),
                fetch(`/api/evidence-templates/${encodeURIComponent(currentSessionId)}/documents`, {signal:AbortSignal.timeout(6000)}).then(response=>response.json()).catch(()=>null)
            ]);
            reading = false;
            if (!active) return;
            if (templates?.success) {
                const counts: Record<string,number> = {};
                for (const doc of templates.data || []) if (doc.status !== 'submitted') for (const member of doc.participants || []) counts[String(member.id)] = (counts[String(member.id)] || 0) + 1;
                setTemplateDraftCounts(counts);
            }
            if (!result.success) {
                setEvidenceSummaryState('error');
                return;
            }
            setEvidenceSummaryState('ready');
            setStudentEvidenceCounts(Object.fromEntries((result.data || []).map(item => [String(item.studentId), Number(item.evidenceCount || 0)])));
            setPendingReviewStudentIds(new Set(
                (result.data || []).filter((item) => item.pending).map((item) => String(item.studentId))
            ));
        };
        void refresh();
        const wake = () => { void refresh(); };
        document.addEventListener('visibilitychange', wake);
        const timer = window.setInterval(refresh, 5000);
        return () => {
            active = false;
            document.removeEventListener('visibilitychange', wake);
            window.clearInterval(timer);
        };
    }, [currentSessionId]);

    const loadSessionEvidences = React.useCallback(async (target?: typeof evidenceModal | null, background = false) => {
        const requestId = ++evidenceLoadRequestRef.current;
        const active = target || evidenceModal;
        if (!active || !currentAreaId || !selGrade || !selSection || !unitNumber || !sessionNumber) {
            setSessionEvidences([]);
            return;
        }
        if (!background) setEvidenceBusy(true);
        const res = await getEvaluacionEvidencias({
            sessionId: currentSessionId,
            year: currentYear,
            areaId: currentAreaId,
            grade: selGrade,
            section: selSection,
            bimester: bimesterLabel,
            unitNumber,
            sessionNumber,
            studentId: String(active.studentId),
            criteriaId: active.summaryId
        });
        if (requestId !== evidenceLoadRequestRef.current) return;
        if (!res.success) {
            setEvidenceMessage(res.message || 'No se pudieron cargar las evidencias.');
            setSessionEvidences([]);
            setEvidenceBusy(false);
            return;
        }
        const nextEvidences = (res.data || []).map((item: any) => {
            const extension = getFileExtension(item.fileName || '');
            return {
                id: item.id,
                fileName: item.fileName || 'Archivo',
                fileSize: Number(item.fileSize || 0),
                fileType: item.fileType || '',
                fileUrl: item.fileUrl || '',
                previewUrl: item.previewUrl || '',
                thumbnailUrl: item.thumbnailUrl || '',
                uploadedAt: item.submittedAt || item.updatedAt || '',
                source: item.source || 'teacher',
                deliveryTiming: item.deliveryTiming || (item.source === 'student_portal' ? 'unknown' : 'teacher'),
                lateByMs: Number(item.lateByMs || 0),
                onTimeCloseAt: item.onTimeCloseAt || '',
                renamedBy: item.renamedBy || '',
                observation: item.observation || '',
                requestedEvidence: item.requestedEvidence || null,
                evidenceLink: item.evidenceLink || '',
                teacherComment: item.teacherComment || '',
                teacherCommentedAt: item.teacherCommentedAt || '',
                studentIds: Array.isArray(item.studentIds) ? item.studentIds : [],
                studentNames: Array.isArray(item.studentNames) ? item.studentNames : [],
                available: item.available === true,
                previewKind: getPreviewKind(extension)
            };
        });
        setSessionEvidences(nextEvidences);
        if (!background) setTeacherCommentDrafts(Object.fromEntries(nextEvidences.map((item: SessionEvidenceItem) => [String(item.id), item.teacherComment])));
        setEvidenceMessage('');
        setEvidenceBusy(false);
    }, [bimesterLabel, currentAreaId, currentSessionId, currentYear, evidenceModal, selGrade, selSection, sessionNumber, unitNumber]);

    React.useEffect(() => {
        if (!evidenceModal) return;
        let reading = false;
        const refresh = async () => {
            if (reading || document.visibilityState !== 'visible' || evidenceBusy) return;
            reading = true;
            try { await loadSessionEvidences(undefined, true); } finally { reading = false; }
        };
        const timer = window.setInterval(refresh, 5000);
        return () => window.clearInterval(timer);
    }, [evidenceModal, evidenceBusy, loadSessionEvidences]);

    const uploadEvidenceFiles = React.useCallback(async (files: File[]) => {
        if (!evidenceModal || files.length === 0) return;
        const accepted = files.filter((file) => VALID_EVIDENCE_EXTENSIONS.has(getFileExtension(file.name)));
        if (accepted.length === 0) {
            setEvidenceMessage('Formato no valido. Usa imagenes, Office, PDF o .armi.');
            return;
        }
        setEvidenceBusy(true);
        setEvidenceMessage('');
        for (const file of accepted) {
            const res = await saveEvaluacionEvidencia({
                sessionId: currentSessionId,
                year: currentYear,
                areaId: currentAreaId,
                grade: selGrade,
                section: selSection,
                bimester: bimesterLabel,
                unitNumber,
                sessionNumber,
                studentIds: [evidenceModal.studentId],
                studentNames: [evidenceModal.studentName],
                criteriaId: evidenceModal.summaryId,
                observation: `Evidencia asociada al nivel de logro ${evidenceModal.summaryLabel}`,
                fileName: file.name,
                fileType: file.type || getFileExtension(file.name) || 'application/octet-stream',
                fileSize: file.size
            }, file);
            if (!res.success) {
                setEvidenceBusy(false);
                setEvidenceMessage(res.message || 'No se pudo guardar la evidencia.');
                return;
            }
        }
        await loadSessionEvidences(evidenceModal);
        setEvidenceBusy(false);
        setEvidenceMessage('Evidencia guardada correctamente.');
    }, [bimesterLabel, currentAreaId, currentSessionId, currentYear, evidenceModal, loadSessionEvidences, selGrade, selSection, sessionNumber, unitNumber]);

    React.useEffect(() => {
        if (!evidenceModal) return;
        loadSessionEvidences(evidenceModal);
    }, [evidenceModal, loadSessionEvidences]);

    React.useEffect(() => {
        if (!evidenceModal) return;
        const onPaste = (event: ClipboardEvent) => {
            const items = Array.from(event.clipboardData?.items || []);
            const imageItem = items.find((item) => item.type.startsWith('image/'));
            if (!imageItem) return;
            const blob = imageItem.getAsFile();
            if (!blob) return;
            event.preventDefault();
            const ext = blob.type.includes('png') ? 'png' : (blob.type.split('/')[1] || 'png');
            const pastedFile = new File([blob], `captura-${Date.now()}.${ext}`, { type: blob.type || 'image/png' });
            uploadEvidenceFiles([pastedFile]);
        };
        window.addEventListener('paste', onPaste);
        return () => window.removeEventListener('paste', onPaste);
    }, [evidenceModal, uploadEvidenceFiles]);

    const openEvidenceModal = (student: any, competency: any, summaryLabel: string) => {
        evidenceLoadRequestRef.current++;
        setEvidenceMessage('');
        setRenamingEvidence(null);
        setSessionEvidences([]);
        setShowEvidenceGroup(false);
        setEvidenceModal({
            studentId: student.id,
            studentName: String(student.name || 'Estudiante'),
            competency,
            summaryId: getCompetencySummaryId(competency),
            summaryLabel
        });
    };

    const closeEvidenceModal = () => {
        evidenceLoadRequestRef.current++;
        setEvidenceModal(null);
        setSessionEvidences([]);
        setEvidenceMessage('');
        setRenamingEvidence(null);
        setShowEvidenceGroup(false);
    };

    const handleEvidenceFiles = async (files: FileList | null) => {
        if (!files) return;
        await uploadEvidenceFiles(Array.from(files));
    };

    const handleDeleteEvidence = async (id: string | number) => {
        setEvidenceBusy(true);
        const res = await deleteEvaluacionEvidencia(id);
        if (!res.success) {
            setEvidenceBusy(false);
            setEvidenceMessage(res.message || 'No se pudo eliminar la evidencia.');
            return;
        }
        await loadSessionEvidences();
        setEvidenceBusy(false);
        setEvidenceMessage('Evidencia eliminada.');
    };

    const handleRenameEvidence = async () => {
        if (!renamingEvidence) return;
        const nextName = renamingEvidence.name.trim();
        if (!nextName) {
            setEvidenceMessage('No se pudo renombrar: escribe un nombre para la evidencia.');
            return;
        }
        const original = sessionEvidences.find((item) => item.id === renamingEvidence.id);
        if (nextName === original?.fileName) {
            setRenamingEvidence(null);
            return;
        }
        setEvidenceBusy(true);
        const res = await renameEvaluacionEvidencia(renamingEvidence.id, nextName);
        if (!res.success) {
            setEvidenceBusy(false);
            setEvidenceMessage(res.message || 'No se pudo renombrar la evidencia.');
            return;
        }
        await loadSessionEvidences(evidenceModal);
        setEvidenceBusy(false);
        setRenamingEvidence(null);
        setEvidenceMessage('Evidencia renombrada correctamente.');
    };

    const handleSaveTeacherComment = async (item: SessionEvidenceItem) => {
        setEvidenceBusy(true);
        const comment = String(teacherCommentDrafts[String(item.id)] || '').trim();
        const res = await updateEvaluacionEvidenciaFeedback(item.id, comment);
        if (!res.success) {
            setEvidenceBusy(false);
            setEvidenceMessage(res.message || 'No se pudo guardar el comentario docente.');
            return;
        }
        await loadSessionEvidences(evidenceModal);
        setEvidenceBusy(false);
        setEvidenceMessage(comment ? 'Comentario docente guardado.' : 'Comentario docente eliminado.');
    };

    const handleDownloadEvidence = (item: SessionEvidenceItem) => {
        if (!item.available) {
            setEvidenceMessage('El archivo todavía está sincronizándose en esta PC. Pulsa Actualizar cuando termine.');
            return;
        }
        if (!item.fileUrl) return;
        const url = new URL(item.fileUrl, window.location.href);
        url.searchParams.set('download', '1');
        const link = document.createElement('a');
        link.href = url.href;
        link.download = item.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    const handleOpenEvidence = (item: SessionEvidenceItem) => {
        if (!item.available) {
            setEvidenceMessage('La entrega está registrada, pero el archivo todavía no terminó de sincronizarse en esta PC. Mantén Google Drive abierto y pulsa Actualizar.');
            return;
        }
        if (!item.fileUrl) return;
        if (canOpenInline(item.previewKind)) {
            window.open(item.previewUrl || item.fileUrl, '_blank', 'noopener,noreferrer');
            return;
        }
        handleDownloadEvidence(item);
    };

    const sessionDeliverables = React.useMemo(() => {
        if (!evidenceModal) return [];
        return gradingSessionGroups.groups.filter((group: any) => !evidenceModal.summaryId
            || (normalizeLoose(String(group.name || '')) === normalizeLoose(String(evidenceModal.competency?.name || ''))
                && String(group.source || 'primary') === String(evidenceModal.competency?.source || 'primary'))).map((group: any) => {
            const isTransversal = String(group.source || '') === 'transversal';
            const source = isTransversal
                ? (Array.isArray(sessionData?.competenciasTrans) ? sessionData.competenciasTrans : [])
                    .find((item: any) => normalizeLoose(String(item?.comp || '')) === normalizeLoose(String(group.name || '')))
                : sessionData?.competenciaPrio;
            const rawEvidence = String(source?.evidence || (!isTransversal ? (sessionData?.product || sessionData?.producto || '') : ''));
            const evidences = Array.from(new Set(extractRichTextItems(rawEvidence)));
            const capacities = group.capacities.map((capacity: any) => String(capacity.name || '').trim()).filter(Boolean);
            const sourceCapacities = extractCapacidades(String(source?.cap || ''));
            const effectiveCapacities = capacities.length ? capacities : sourceCapacities;
            const color = isTransversal ? colorTokenToCss(String(source?.rowColor || '#007c59')) : '#0f172a';
            return {
                name: String(group.name || 'Competencia'),
                color,
                rows: evidences.map((evidence, index) => ({
                    evidence,
                    capacity: effectiveCapacities.length === 1
                        ? effectiveCapacities[0]
                        : effectiveCapacities.length === evidences.length
                            ? effectiveCapacities[index]
                            : 'Capacidades de la competencia',
                })),
            };
        }).filter((group: any) => group.rows.length > 0);
    }, [evidenceModal, gradingSessionGroups.groups, sessionData]);
    const sessionDeliverableCount = sessionDeliverables.reduce((total: number, group: any) => total + group.rows.length, 0);

    if (!gradingCriteriaRows.length) {
        return (
            <div className="p-10 text-center text-slate-400 text-sm font-bold">
                La sesion no tiene criterios cargados para construir el registro por sesion.
            </div>
        );
    }

    const groupedCompetencies = gradingSessionGroups.groups;
    const criterionBlocks = gradingSessionGroups.criterionBlocks;
    const competencyCacheKey = (competency: any) =>
        `${normalizeLoose(String(competency?.name || competency?.competencia || ''))}::${String(competency?.source || 'primary')}`;
    const studentsById = new Map(filteredStudents.map((student) => [String(student.id), student]));
    const modalStudent = evidenceModal ? studentsById.get(String(evidenceModal.studentId)) : null;
    const modalGroupName = String(modalStudent?.group || modalStudent?.grupo || '').trim();
    const modalGroupMembers = modalGroupName
        ? filteredStudents.filter((student) => normalizeLoose(String(student.group || student.grupo || '')) === normalizeLoose(modalGroupName))
        : modalStudent ? [modalStudent] : [];
    const groupVisuals = new Map<string, typeof STUDENT_GROUP_PALETTE[number]>();
    Array.from(new Set(
        filteredStudents
            .map((student) => String(student.group || student.grupo || '').trim())
            .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
        .forEach((groupName, index) => {
            groupVisuals.set(groupName, STUDENT_GROUP_PALETTE[index % STUDENT_GROUP_PALETTE.length]);
        });
    const criteriaByCompetency = new Map<string, any[]>();
    gradingCriteriaRows.forEach((row: any) => {
        const key = competencyCacheKey(row);
        const rows = criteriaByCompetency.get(key) || [];
        rows.push(row);
        criteriaByCompetency.set(key, rows);
    });
    const blocksByCompetency = new Map<string, any[]>();
    criterionBlocks.forEach((block: any) => {
        const key = competencyCacheKey(block);
        const blocks = blocksByCompetency.get(key) || [];
        blocks.push(block);
        blocksByCompetency.set(key, blocks);
    });
    const competencySummaryCache = new Map<string, { label: string; code: string; score: number | null }>();
    const getCompetencySummaryId = (competency: any) =>
        `summary::${String(competency?.source || 'primary')}::${normalizeLoose(String(competency?.name || ''))}`;
    const isObservationExpanded = (competency: any) => !!expandedSessionRegisterObservations[getCompetencySummaryId(competency)];
    const registerFixedColumns = {
    number: '28px',
    student: '180px'
    };

const registerColumnUnits = {
    criterionLevel: 1,
    nl: 1.25,
    observation: 4.8
};

const totalDynamicRegisterColumnUnits = groupedCompetencies.reduce(
    (sum: number, competency: any) => {
        const competencyCriteriaCount = competency.capacities.reduce(
            (capSum: number, capacity: any) => capSum + capacity.criteria.length,
            0
        );
        return sum
            + (competencyCriteriaCount * gradingCanonicalLevels.length * registerColumnUnits.criterionLevel)
            + registerColumnUnits.nl
            + (isObservationExpanded(competency) ? registerColumnUnits.observation : 0);
    },
    0
);

const getRegisterDynamicWidth = (units: number) =>
    `${(units / Math.max(totalDynamicRegisterColumnUnits, 1)) * 100}%`;
    const nlToneMap: Record<string, string> = {
        c: 'bg-rose-600 text-white',
        b: 'bg-orange-500 text-white',
        a: 'bg-emerald-500 text-white',
        ad: 'bg-sky-500 text-white',
        ne: 'bg-black text-white'
    };
    const levelFillMap: Record<string, string> = {
        c: 'bg-rose-50',
        b: 'bg-orange-50',
        a: 'bg-emerald-50',
        ad: 'bg-sky-50'
    };
    const levelRadioToneMap: Record<string, { border: string; fill: string }> = {
        c: { border: '#e11d48', fill: '#f43f5e' },
        b: { border: '#ea580c', fill: '#f97316' },
        a: { border: '#059669', fill: '#10b981' },
        ad: { border: '#0284c7', fill: '#0ea5e9' }
    };
    const summaryLevelConfig = [
        { id: 'c', label: 'INICIO', color: '#e11d48' },
        { id: 'b', label: 'PROCESO', color: '#f97316' },
        { id: 'a', label: 'LOGRADO', color: '#22c55e' },
        { id: 'ad', label: 'DESTACADO', color: '#0ea5e9' },
        { id: 'ne', label: 'NO EVALUADOS', color: '#111827' }
    ];
    const summaryLevelLabelColorMap = summaryLevelConfig.reduce((acc, level) => {
        acc[level.label] = level.color;
        return acc;
    }, {} as Record<string, string>);
    const isInactiveStudent = (student: any) => {
        const normalizedEstado = normalizeLoose(String(student?.estado || ''));
        return (
            normalizedEstado === 'r' || normalizedEstado.includes('retir')
            || normalizedEstado === 't' || normalizedEstado.includes('traslad')
            || normalizedEstado === 'na' || normalizedEstado.includes('no asiste')
        );
    };
    const applyLevelToCriterionColumn = (criteriaId: string | number, levelCode: string) => {
        const storedLevel = gradingCodeToStoredLevel(levelCode);
        filteredStudents.forEach((student) => {
            if (isInactiveStudent(student)) return;
            updateGradingRecord(student.id, criteriaId, { level: storedLevel });
        });
    };
    const clearCriterionLevel = (studentId: string | number, criteriaId: string | number) => {
        updateGradingRecord(studentId, criteriaId, { level: '' });
    };
    const getCriterionLevelDescriptor = (criterion: any, levelId: string) => {
        const descriptor = String(
            criterion?.levelDescriptors?.[levelId]
            || criterion?.[levelId]
            || ''
        ).trim();
        return descriptor;
    };
    const formatTooltipValue = (value: any, _name: any, props: any) => {
        const label = String(props?.payload?.label || 'Nivel');
        const color = summaryLevelLabelColorMap[label] || '#334155';
        return [
            <span style={{ color, fontWeight: 700 }}>{`${value} estudiantes`}</span>,
            <span style={{ color, fontWeight: 800 }}>{label}</span>
        ];
    };
    const renderSessionSummaryCard = (
    competency: any,
    stats: Array<{ id: string; label: string; count: number; percentage: number; color: string }>,
    total: number,
    idx: number,
    variant: 'full' | 'half' = 'half'
) => {
    const isTransversal = String(competency.source || '') === 'transversal';
    const accent = isTransversal ? '#0f766e' : '#334155';

    

    const gridClass =
    variant === 'full'
        ? 'grid grid-cols-[190px_1fr_1fr] gap-2 items-stretch'
        : 'grid grid-cols-[190px_1fr_1fr] gap-2 items-stretch';

    const pieHeight = variant === 'full' ? 170 : 150;
    const barHeight = variant === 'full' ? 170 : 150;
    const pieInnerRadius = variant === 'full' ? 38 : 34;
    const pieOuterRadius = variant === 'full' ? 64 : 56;
    const yAxisWidth = variant === 'full' ? 78 : 72;

    return (
        <div
            key={`session-summary-${idx}`}
            className="rounded-[2rem] border border-slate-200 bg-slate-50/50 p-5 print:rounded-xl print:border-black print:bg-white print:p-2 print:break-inside-avoid print:overflow-hidden"
        >
            <div
                className="mb-2 text-[10px] print:text-[8px] font-black uppercase tracking-[0.15em]"
                style={{ color: accent }}
            >
                {competency.name}
            </div>

            <div className={gridClass}>
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white print:rounded-xl print:border-black">
                    <table className="w-full table-fixed text-[10px] border-collapse print:text-[8px]">
                        <colgroup>
                            <col style={{ width: '50%' }} />
                            <col style={{ width: '20%' }} />
                            <col style={{ width: '30%' }} />
                        </colgroup>
                        <thead>
                            <tr>
                                <th
                                    colSpan={3}
                                    className="p-2 text-white uppercase font-black"
                                    style={{ backgroundColor: accent }}
                                >
                                    Nivel de logro
                                </th>
                            </tr>
                            <tr className="bg-slate-100 uppercase text-[9px] print:text-[8px]">
                                <th className="border border-slate-200 px-1 py-1 whitespace-normal break-words print:whitespace-nowrap print:break-normal">Nivel</th>
                                <th className="border border-slate-200 px-1 py-1">Total</th>
                                <th className="border border-slate-200 px-1 py-1">%</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.map((stat) => (
                                <tr key={`${competency.name}-${stat.id}`} className="text-center">
                                    <td
                                        className="border border-slate-200 px-1 py-1 font-black text-white whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                                        style={{ backgroundColor: stat.color }}
                                        title={stat.label}
                                    >
                                        {stat.label}
                                    </td>
                                    <td
                                        className="border border-slate-200 p-1 font-black"
                                        style={{
                                            color: stat.color,
                                            backgroundColor: `${stat.color}14`
                                        }}
                                    >
                                        {stat.count}
                                    </td>
                                    <td
                                        className="border border-slate-200 p-1 font-black"
                                        style={{
                                            color: stat.color,
                                            backgroundColor: `${stat.color}14`
                                        }}
                                    >
                                        {Number(stat.percentage || 0).toFixed(2)}%
                                    </td>
                                </tr>
                            ))}
                            <tr className="bg-slate-100 font-black text-center">
                                <td className="border border-slate-200 px-1 py-1 whitespace-normal break-words print:whitespace-nowrap print:break-normal">TOTAL</td>
                                <td className="border border-slate-200 p-1">{total}</td>
                                <td className="border border-slate-200 p-1">100%</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-1 print:rounded-[18px] print:border-black print:overflow-hidden">
                    <div className="text-[9px] print:text-[8px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2 text-center">
                        Distribución porcentual
                    </div>
                    <div className="w-full mx-auto">
                        <ResponsiveContainer width="100%" height={pieHeight}>
                            <PieChart margin={{ top: 6, right: 6, bottom: 6, left: 6 }}>
                                <Pie
                                    data={stats}
                                    dataKey="count"
                                    nameKey="label"
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={pieInnerRadius}
                                    outerRadius={pieOuterRadius}
                                    paddingAngle={2}
                                >
                                    {stats.map((entry) => (
                                        <Cell key={`${competency.name}-pie-${entry.id}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={formatTooltipValue} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-2 print:rounded-[18px] print:border-black print:overflow-hidden">
                    <div className="text-[9px] print:text-[8px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2 text-center">
                        Frecuencia
                    </div>
                    <div className="w-full mx-auto">
                        <ResponsiveContainer width="100%" height={barHeight}>
                            <BarChart
                                data={stats}
                                layout="vertical"
                                barCategoryGap="18%"
                                margin={{ top: 8, right: 14, left: 4, bottom: 8 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 8, fontWeight: 700 }} />
                                <YAxis
                                    dataKey="label"
                                    type="category"
                                    width={yAxisWidth}
                                    interval={0}
                                    tickFormatter={(value: any) => String(value || '')}
                                    tick={(props: any) => {
                                        const { x, y, payload } = props;
                                        const value = String(payload?.value || '');
                                        return (
                                            <text
                                                x={x}
                                                y={y}
                                                dy={4}
                                                textAnchor="end"
                                                fill={summaryLevelLabelColorMap[value] || '#334155'}
                                                fontSize={8}
                                                fontWeight={700}
                                            >
                                                {value}
                                            </text>
                                        );
                                    }}
                                />
                                <Tooltip formatter={formatTooltipValue} />
                                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                                    {stats.map((entry) => (
                                        <Cell key={`${competency.name}-bar-${entry.id}`} fill={entry.color} />
                                    ))}
                                    <LabelList
                                        dataKey="count"
                                        position="right"
                                        offset={4}
                                        style={{ fill: '#334155', fontSize: 8, fontWeight: 700 }}
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
    const sessionPerformanceText = String(sessionData?.competenciaPrio?.des || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<li[^>]*>/gi, '\n- ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;|&#160;|&amp;nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();

    const getStudentRowStateClass = (estado: string | undefined) => {
        const normalizedEstado = normalizeLoose(String(estado || ''));
        if (normalizedEstado === 'r' || normalizedEstado.includes('retir')) {
            return {
                row: 'bg-slate-900/95 text-white',
                numberCell: 'text-white bg-slate-950/95',
                studentCell: 'text-white bg-slate-900/95'
            };
        }
        if (normalizedEstado === 't' || normalizedEstado.includes('traslad')) {
            return {
                row: 'bg-violet-700/10 text-violet-950',
                numberCell: 'text-violet-900 bg-violet-700/20',
                studentCell: 'text-violet-950 bg-violet-700/10'
            };
        }
        if (normalizedEstado === 'na' || normalizedEstado.includes('no asiste')) {
            return {
                row: 'bg-rose-700/10 text-rose-950',
                numberCell: 'text-rose-900 bg-rose-700/20',
                studentCell: 'text-rose-950 bg-rose-700/10'
            };
        }
        return {
            row: 'bg-white',
            numberCell: 'text-slate-600',
            studentCell: 'text-slate-800'
        };
    };

    const getStudentCompetencySummary = (studentId: string | number, competency: any) => {
        const competencyKey = competencyCacheKey(competency);
        const cacheKey = `${String(studentId)}::${competencyKey}`;
        const cached = competencySummaryCache.get(cacheKey);
        if (cached) return cached;
        const student = studentsById.get(String(studentId));
        const normalizedEstado = normalizeLoose(String(student?.estado || ''));
        if (
            normalizedEstado === 'r' || normalizedEstado.includes('retir')
            || normalizedEstado === 't' || normalizedEstado.includes('traslad')
            || normalizedEstado === 'na' || normalizedEstado.includes('no asiste')
        ) {
            const result = { label: 'NE', code: 'ne', score: null };
            competencySummaryCache.set(cacheKey, result);
            return result;
        }
        const competencyCriteria = criteriaByCompetency.get(competencyKey) || [];
        if (!competencyCriteria.length) {
            const result = { label: '-', code: '', score: null };
            competencySummaryCache.set(cacheKey, result);
            return result;
        }

        const selectedCodes = competencyCriteria.map((row: any) =>
            normalizeGradingLevelToCode(gradingRecords[getGradingKey(studentId, row.id)]?.level)
        );
        const filledCodes = selectedCodes.filter(Boolean);

        if (!filledCodes.length) {
            const result = { label: '...', code: '', score: null };
            competencySummaryCache.set(cacheKey, result);
            return result;
        }

        const numericScores = selectedCodes
            .map((code) => {
                const idx = ['c', 'b', 'a', 'ad'].indexOf(code);
                return idx >= 0 ? idx : 0;
            })
            .sort((left, right) => left - right);
        const middleIndex = Math.floor(numericScores.length / 2);
        const median = numericScores.length % 2 === 0
            ? (numericScores[middleIndex - 1] + numericScores[middleIndex]) / 2
            : numericScores[middleIndex];
        let code = 'c';
        if (median >= 2.5) code = 'ad';
        else if (median > 1.5) code = 'a';
        else if (median >= 0.5) code = 'b';
        const level = gradingCanonicalLevels.find((item: any) => item.id === code);
        const result = {
            label: level?.short || code.toUpperCase(),
            code,
            score: ['c', 'b', 'a', 'ad'].indexOf(code)
        };
        competencySummaryCache.set(cacheKey, result);
        return result;
    };

    const getStudentObservationSummary = (studentId: string | number, competency: any) => {
        const summaryId = getCompetencySummaryId(competency);
        const record = gradingRecords[getGradingKey(studentId, summaryId)] || { observation: '' };
        return String(record.observation || '');
    };

    const sessionSummaryByCompetency = groupedCompetencies.map((competency: any) => {
        const counts = { c: 0, b: 0, a: 0, ad: 0, ne: 0 } as Record<string, number>;
        filteredStudents.forEach((student) => {
            const summary = getStudentCompetencySummary(student.id, competency);
            const code = ['c', 'b', 'a', 'ad', 'ne'].includes(summary.code) ? summary.code : 'ne';
            counts[code] += 1;
        });
        const total = filteredStudents.length || 1;
        const stats = summaryLevelConfig.map((level) => ({
            ...level,
            count: counts[level.id] || 0,
            percentage: Number((((counts[level.id] || 0) / total) * 100).toFixed(2))
        }));
        return { competency, stats, total: filteredStudents.length };
    });
    const primarySessionSummaries = sessionSummaryByCompetency.filter(({ competency }) => String(competency.source || '') !== 'transversal');
    const transversalSessionSummaries = sessionSummaryByCompetency.filter(({ competency }) => String(competency.source || '') === 'transversal');

    const printInstrumentName = String(sessionData?.instrumentoTemplate?.name || sessionData?.competenciaPrio?.inst || 'Instrumento');
    const printInstitutionName = String(generalData?.institution || 'Instituci\u00F3n Educativa').trim();
    const printInstitutionPlace = String(generalData?.lugar || '').trim();
    const printDistrict = String(generalData?.district || '').trim();
    const printProvince = String(generalData?.province || '').trim();
    const printLocationLine = [printDistrict, printProvince].filter(Boolean).join(' - ');
    const printInstitutionMotto = String(generalData?.motto || generalData?.year_name || selArea || '').trim();
    const printFooterDate = String(sessionDate || '-').trim();
    const printSessionProduct = String(
        sessionData?.product
        || sessionData?.producto
        || sessionData?.competenciaPrio?.evidence
        || ''
    )
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<li[^>]*>/gi, '\n- ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;|&#160;|&amp;nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
    const printHeaderDarkCellClass = 'bg-black text-white font-black text-right px-1 py-1 border border-black leading-tight print:text-[8px] print:leading-tight print:outline print:outline-1 print:outline-white print:-outline-offset-1';
    const printHeaderValueCellClass = 'px-2 py-1 border border-black print:text-[8px] print:leading-tight';

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
                    <div className="session-register-print-motto">{printInstitutionMotto || selArea}</div>
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
                            <td className={`${printHeaderValueCellClass} w-[52px]`}>{selGrade || '-'}</td>
                            <td className={`${printHeaderDarkCellClass} w-[72px]`}>Unidad:</td>
                            <td className={`${printHeaderValueCellClass} w-[64px]`}>N° {unitNumber || '-'}</td>
                            <td className={`${printHeaderDarkCellClass} w-[72px]`}>Sesión:</td>
                            <td className={printHeaderValueCellClass}>{sessionData?.title || printInstrumentName || '-'}</td>
                        </tr>
                        <tr>
                            <td className={printHeaderDarkCellClass}>Área Curricular:</td>
                            <td className={`${printHeaderValueCellClass} whitespace-nowrap`}>
                                {selArea || '-'}
                            </td>
                            <td className={printHeaderDarkCellClass}>Sección:</td>
                            <td className={printHeaderValueCellClass}>{selSection || '-'}</td>
                            <td className={printHeaderDarkCellClass}>N° Sesión:</td>
                            <td className={printHeaderValueCellClass}>N° {sessionNumber || '-'}</td>
                            <td className={printHeaderDarkCellClass}>Propósito:</td>
                            <td className={printHeaderValueCellClass}>{sessionData?.purpose || '-'}</td>
                        </tr>
                        <tr>
                            <td className={printHeaderDarkCellClass}>Docente:</td>
                            <td className={`${printHeaderValueCellClass} whitespace-nowrap`}>
                                {generalData?.teacher || '-'}
                            </td>
                            <td className={printHeaderDarkCellClass}>Bimestre:</td>
                            <td className={printHeaderValueCellClass}>{bimesterLabel || '-'}</td>
                            <td className={printHeaderDarkCellClass}>Fecha:</td>
                            <td className={printHeaderValueCellClass}>{printFooterDate || '-'}</td>
                            <td className={printHeaderDarkCellClass}>Producto:</td>
                            <td className={printHeaderValueCellClass}>{printSessionProduct || '-'}</td>
                        </tr>
                        <tr>
                            <td className={printHeaderDarkCellClass}>Desempeño:</td>
                            <td colSpan={7} className={`${printHeaderValueCellClass} leading-tight`}>{sessionPerformanceText || '-'}</td>
                        </tr>
                    </tbody>
                </table>
            </div>



            
        </div>
    );

    const renderPrintFooter = () => (
        <div className="session-register-print-footer hidden print:grid">
            <span className="justify-self-start">{selArea || 'Área curricular'}</span>
            <span className="justify-self-center">{printFooterDate || '-'}</span>
            <span className="justify-self-end">{generalData?.teacher || 'Docente'}</span>
        </div>
    );

    return (
        <div className="space-y-2" data-numeric-average-rounding={sessionData?.numericAverageRounding || undefined}>
            {performanceText ? (
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-snug text-slate-700 print:hidden">
                    <span className="mr-2 font-black text-slate-500">Desempeño</span>{performanceText}
                </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 print:hidden">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="text-sm font-black uppercase text-slate-800">Registro por sesión</h3>
                    <p className="text-[10px] font-bold text-slate-500">{filteredStudents.length} estudiantes · {gradingCriteriaRows.length} criterios · {groupedCompetencies.length} competencias</p>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="mr-1 text-[10px] font-semibold text-emerald-800">Evidencias · Ámbar: por revisar</span>
                    <button type="button" onClick={() => setShowCellDescriptors(prev => !prev)}
                        title={showCellDescriptors ? 'Ocultar descripciones emergentes' : 'Mostrar descripciones emergentes'}
                        aria-label={showCellDescriptors ? 'Ocultar descripciones emergentes' : 'Mostrar descripciones emergentes'} aria-pressed={showCellDescriptors}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border transition ${showCellDescriptors ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'}`}>
                        {showCellDescriptors ? <TooltipVisibleIcon /> : <TooltipHiddenIcon />}
                    </button>
                    <button type="button" onClick={() => window.print()} title="Imprimir registro" aria-label="Imprimir registro"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white hover:bg-slate-800"><PrintMiniIcon /></button>
                </div>
            </div>
            {navigationTarget ? <p className="text-xs font-semibold text-amber-800 print:hidden">{navigationTarget.pending ? 'Notas pendientes de' : 'Origen de la nota de'} {navigationTarget.studentName}: {navigationTarget.capacityName || navigationTarget.competencyName}.</p> : null}
            <div className="flex flex-wrap items-start gap-2 print:hidden">
                {gradingSectionTabs}
                {currentSessionId ? (
                    <details className="group ml-auto min-w-[210px] rounded-xl border border-violet-100 bg-white open:w-full">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-[10px] font-black text-violet-700">
                            <span>Plazo de evidencias</span>
                            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[9px] group-open:hidden">Configurar</span>
                            <span className="hidden rounded-full bg-violet-50 px-2 py-0.5 text-[9px] group-open:inline">Ocultar</span>
                        </summary>
                        <div className="border-t border-violet-100 p-2">
                            <EvidenceDeliveryWindowControl key={`${currentSessionId}:${activeGradingSection || selSection}`} section={activeGradingSection || selSection}
                                sessionId={currentSessionId} sessionLabel={`Sesión ${sessionNumber}${sessionData?.title ? ` · ${sessionData.title}` : ''}`} />
                        </div>
                    </details>
                ) : null}
            </div>
            {evidenceSummaryState !== 'ready' ? <p role="status" className={`text-xs print:hidden ${evidenceSummaryState === 'error' ? 'text-amber-800' : 'text-slate-500'}`}>
                {evidenceSummaryState === 'error' ? 'No se pudo actualizar el estado de evidencias. Se conserva la última información; no interpretes un nombre sin resaltar como ausencia de archivos.' : 'Comprobando evidencias de la sesión…'}
            </p> : null}

            {gradingLoading ? (
                <div className="p-10 text-center text-slate-400 text-sm font-bold">Cargando registros de calificación...</div>
            ) : filteredStudents.length === 0 ? (
                <div className="p-10 text-center text-slate-400 text-sm font-bold">No hay estudiantes para el grado y sección seleccionados.</div>
            ) : (
                <>
                    <div className="session-register-print-page print:break-after-page print:w-full print:max-w-full print:overflow-hidden">
                        {renderPrintHeader(`Registro por sesión - ${printInstrumentName}`)}
                        <div className="session-register-page-body">
                        <div className="session-register-print-sheet overflow-x-auto rounded-[2rem] border border-slate-200 print:w-full print:max-w-full print:overflow-hidden print:box-border print:rounded-[10px] print:border print:border-black">
                            <table className="w-full border-collapse text-[10px] print:w-full print:text-[16px] print:table-fixed">
                            <colgroup>
                                <col className="session-register-number-col" style={{ width: registerFixedColumns.number }} />
                                <col className="session-register-student-col" style={{ width: registerFixedColumns.student }} />
                                {groupedCompetencies.flatMap((competency: any, compIdx: number) => {
                                    const competencyCriteria = competency.capacities.reduce((sum: number, capacity: any) => sum + capacity.criteria.length, 0);
                                    const expanded = isObservationExpanded(competency);
                                    return [
                                        ...Array.from({ length: competencyCriteria * gradingCanonicalLevels.length }).map((_, idx) => (
                                            <col key={`session-register-col-${compIdx}-${idx}`} style={{ width: getRegisterDynamicWidth(registerColumnUnits.criterionLevel) }} />
                                        )),
                                        <col key={`session-register-col-nl-${compIdx}`} style={{ width: getRegisterDynamicWidth(registerColumnUnits.nl) }} />,
                                        ...(expanded ? [<col key={`session-register-col-obs-${compIdx}`} style={{ width: getRegisterDynamicWidth(registerColumnUnits.observation) }} />] : [])
                                    ];
                                })}
                            </colgroup>
                            <thead>
                                <tr className="text-white uppercase text-[9px] print:text-[16px]">
                                    <th rowSpan={4} className="border border-white/20 p-3 print:p-1 bg-slate-900">N°</th>
                                    <th rowSpan={4} className="border border-white/20 p-3 print:p-1 print:w-[280px] print:min-w-[280px] bg-slate-900 text-left">Estudiantes</th>
                                    {groupedCompetencies.map((competency: any, compIdx: number) => {
                                        const criteriaCount = competency.capacities.reduce((sum: number, capacity: any) => sum + capacity.criteria.length, 0);
                                        const isTransversal = String(competency.source || '') === 'transversal';
                                        return (
                                            <th
                                                key={`session-register-head-comp-${compIdx}`}
                                                colSpan={(Math.max(criteriaCount, 1) * gradingCanonicalLevels.length) + 1 + (isObservationExpanded(competency) ? 1 : 0)}
                                                className="border border-white/20 p-2 print:p-1 text-left"
                                                style={{ backgroundColor: isTransversal ? '#0f766e' : '#334155' }}
                                            >
                                                {competency.name}
                                            </th>
                                        );
                                    })}
                                </tr>
                                <tr className="text-white uppercase text-[9px] print:text-[16px]">
                                    {groupedCompetencies.flatMap((competency: any, compIdx: number) =>
                                        (() => {
                                            const summaryId = getCompetencySummaryId(competency);
                                            const expanded = isObservationExpanded(competency);
                                            return [
                                                ...competency.capacities.map((capacity: any, capIdx: number) => {
                                                    const isTransversal = String(capacity.source || competency.source || '') === 'transversal';
                                                    return (
                                                        <th
                                                            key={`session-register-head-cap-${compIdx}-${capIdx}`}
                                                            colSpan={Math.max(capacity.criteria.length, 1) * gradingCanonicalLevels.length}
                                                            className="border border-white/20 p-2 text-left"
                                                            style={{ backgroundColor: isTransversal ? '#0d9488' : '#475569' }}
                                                        >
                                                            {capacity.name}
                                                        </th>
                                                    );
                                                }),
                                                <th
                                                    key={`session-register-head-nl-${compIdx}`}
                                                    rowSpan={3}
                                                    className="border border-white/20 p-2 text-center"
                                                    style={{ backgroundColor: String(competency.source || '') === 'transversal' ? '#0f766e' : '#334155' }}
                                                >
                                                    <div className="flex flex-col items-center gap-1">
                                                        <span>NL</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setExpandedSessionRegisterObservations((prev) => ({ ...prev, [summaryId]: !prev[summaryId] }))}
                                                            className="inline-flex items-center justify-center rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-black leading-none hover:bg-white/25 print:hidden"
                                                            title={expanded ? 'Ocultar conclusión' : 'Mostrar conclusión'}
                                                        >
                                                            <ToggleConclusionIcon expanded={expanded} />
                                                        </button>
                                                    </div>
                                                </th>,
                                                ...(expanded ? [
                                                    <th
                                                        key={`session-register-head-obs-${compIdx}`}
                                                        rowSpan={3}
                                                        className="border border-white/20 p-2 text-left"
                                                        style={{ backgroundColor: String(competency.source || '') === 'transversal' ? '#0f766e' : '#334155' }}
                                                    >
                                                        Conclusión
                                                    </th>
                                                ] : [])
                                            ];
                                        })()
                                    )}
                                </tr>
                                <tr className="text-white text-[9px] print:text-[14px]">
                                    {criterionBlocks.map((block: any, idx: number) => (
                                        <th
                                            key={`session-register-head-crit-${idx}`}
                                            colSpan={gradingCanonicalLevels.length}
                                            className="border border-white/20 p-2 text-left align-top normal-case leading-tight print:p-1 print:align-top"
                                            style={{ backgroundColor: String(block.source || '') === 'transversal' ? '#0f766e' : '#334155' }}
                                        >
                                            <div className="font-black uppercase text-[8px] print:text-[10px] tracking-wide leading-tight">{block.code}</div>
                                            <div className="mt-1 text-[9px] print:text-[14px] font-medium leading-tight whitespace-normal break-words">
                                                {block.criterion.criterio}
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                                <tr className="uppercase text-[9px] print:text-[16px] font-black">
                                    {criterionBlocks.flatMap((block: any, idx: number) =>
                                        gradingCanonicalLevels.map((level: any) => (
                                            <th
                                                key={`session-register-head-level-${idx}-${level.id}`}
                                                onClick={() => applyLevelToCriterionColumn(block.criterion.id, level.id)}
                                                title={`Aplicar ${String(level.short || level.label || '').toUpperCase()} a toda la columna`}
                                                className={`border border-white/20 p-1 text-center ${level.color} ${level.id === 'ad' ? 'border-r-4 border-r-slate-800/60' : ''} cursor-pointer transition hover:brightness-110 hover:shadow-inner`}
                                            >
                                                {level.short}
                                            </th>
                                        ))
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredStudents.map((student, studentIdx) => {
                                    const rowState = getStudentRowStateClass(student.estado);
                                    const inactiveStudent = isInactiveStudent(student);
                                    const rowBaseClass = rowState.row === 'bg-white'
                                        ? (studentIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50')
                                        : rowState.row;
                                    const evidenceCount = evidenceSummarySessionId === currentSessionId ? studentEvidenceCounts[String(student.id)] || 0 : 0;
                                    const hasPendingReview = evidenceSummarySessionId === currentSessionId && pendingReviewStudentIds.has(String(student.id));
                                    const groupName = String(student.group || student.grupo || '').trim();
                                    const groupVisual = groupName ? groupVisuals.get(groupName) : undefined;
                                    const groupCellStyle = !inactiveStudent && groupVisual
                                        ? { backgroundColor: groupVisual.surface, color: groupVisual.text, WebkitPrintColorAdjust: 'exact' as const }
                                        : undefined;
                                    const studentTooltip = [
                                        String(student.name || ''),
                                        groupName ? `Grupo: ${groupName}` : '',
                                        evidenceCount ? `${evidenceCount} evidencia(s) disponible(s)` : '',
                                        hasPendingReview ? 'Tiene evidencia pendiente de revisión en su competencia' : ''
                                    ].filter(Boolean).join(' · ') || undefined;
                                    return (
                                        <tr key={`session-register-row-${student.id}`} ref={String(student.id) === navigationTarget?.studentId ? focusedStudentRef : undefined} tabIndex={String(student.id) === navigationTarget?.studentId ? -1 : undefined} className={`${rowBaseClass} ${String(student.id) === navigationTarget?.studentId ? 'outline outline-2 outline-amber-400 print:outline-none' : ''}`}>
                                            <td
                                                className={`border border-slate-200 px-2 py-1.5 print:px-0.5 print:py-0.5 print:w-[44px] print:min-w-[44px] text-center font-medium ${rowState.numberCell}`}
                                                style={groupCellStyle}
                                                title={groupName ? `Grupo: ${groupName}` : undefined}
                                            >
                                                <span className="inline-flex items-center justify-center gap-1 print:w-full print:whitespace-nowrap">
                                                    {groupVisual && !inactiveStudent ? (
                                                        <span
                                                            className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/80 shadow-sm print:h-2 print:w-2"
                                                            style={{ backgroundColor: groupVisual.dot }}
                                                            aria-label={`Grupo ${groupName}`}
                                                        />
                                                    ) : null}
                                                    {studentIdx + 1}
                                                </span>
                                            </td>
                                            <td
                                                className={`border border-slate-200 px-2 py-1.5 print:px-0.5 print:py-0.5 print:w-[280px] print:min-w-[280px] align-middle ${rowState.studentCell}`}
                                                style={groupCellStyle}
                                                title={studentTooltip}
                                            >
                                                <div className="flex min-w-0 items-center gap-1.5">
                                                <div className={`min-w-0 flex-1 overflow-hidden text-ellipsis font-black print:font-normal text-[10px] print:text-[14px] leading-tight whitespace-nowrap ${evidenceCount ? 'armi-evidence-present' : ''} ${hasPendingReview ? 'armi-evidence-review-pending' : ''}`}>
                                                    {student.name}
                                                </div>
                                                {templateDraftCounts[String(student.id)] > 0 ? <button type="button" title="Hay plantillas en elaboración. Ábrelas para revisar el avance antes de calificar." onClick={() => {setSessionEvidences([]);setEvidenceModal({studentId:student.id,studentName:student.name,competency:null,summaryId:'',summaryLabel:''});}} className="shrink-0 rounded-md border border-violet-200 bg-violet-50 px-1 py-0.5 text-[9px] font-bold text-violet-700 print:hidden">✎ {templateDraftCounts[String(student.id)]}</button> : null}
                                                {evidenceCount > 0 ? <button type="button"
                                                    onClick={() => { evidenceLoadRequestRef.current++; setSessionEvidences([]); setEvidenceMessage(''); setShowEvidenceGroup(false); setEvidenceModal({ studentId: student.id, studentName: student.name, competency: null, summaryId: '', summaryLabel: '' }); }}
                                                    aria-label={`Ver ${evidenceCount} evidencias de ${student.name}`}
                                                    title={`${evidenceCount} evidencia(s) · ${hasPendingReview ? 'Pendiente de revisión' : 'Sin revisiones pendientes'}. Ver todos los archivos de la sesión.`}
                                                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black text-emerald-800 hover:bg-emerald-100 print:hidden"><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${hasPendingReview ? 'bg-amber-500' : 'bg-emerald-500'}`} />{evidenceCount} ev.</button> : null}
                                                </div>
                                            </td>
                                            {groupedCompetencies.flatMap((competency: any, compIdx: number) => {
                                                const competencyBlocks = blocksByCompetency.get(competencyCacheKey(competency)) || [];
                                                const competencySummary = getStudentCompetencySummary(student.id, competency);
                                                const expanded = isObservationExpanded(competency);
                                                const summaryId = getCompetencySummaryId(competency);
                                                return [
                                                    ...competencyBlocks.flatMap((block: any, blockIdx: number) => {
                                                        const current = gradingRecords[getGradingKey(student.id, block.criterion.id)] || { level: '', observation: '' };
                                                        const currentCode = normalizeGradingLevelToCode(current.level);
                                                        return gradingCanonicalLevels.map((level: any, levelIdx: number) => (
                                                            <td
                                                                key={`session-register-cell-${student.id}-${compIdx}-${blockIdx}-${level.id}`}
                                                                className={`group relative border border-slate-200 px-1 py-1 print:px-0.5 print:py-0.5 text-center ${inactiveStudent ? rowState.row : (levelFillMap[level.id] || '')} ${levelIdx === gradingCanonicalLevels.length - 1 ? 'border-r-4 border-r-slate-300' : ''}`}
                                                                onContextMenu={(event) => {
                                                                    if (inactiveStudent) return;
                                                                    event.preventDefault();
                                                                    clearCriterionLevel(student.id, block.criterion.id);
                                                                }}
                                                            >
                                                                {showCellDescriptors ? (() => {
                                                                    const descriptor = getCriterionLevelDescriptor(block.criterion, level.id);
                                                                    const levelLabel = String(level.short || level.label || '').toUpperCase();
                                                                    if (!descriptor && inactiveStudent) return null;
                                                                    return (
                                                                        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-left shadow-xl backdrop-blur-sm group-hover:block print:hidden">
                                                                            <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-700">
                                                                                {block.code} · {levelLabel}
                                                                            </div>
                                                                            <div className="text-[10px] leading-snug text-slate-600">
                                                                                {inactiveStudent
                                                                                    ? 'Estudiante no evaluable en esta fila.'
                                                                                    : (descriptor || 'Este nivel no tiene descripción cargada todavía.')}
                                                                            </div>
                                                                            {!inactiveStudent ? (
                                                                                <div className="mt-2 text-[9px] font-semibold text-slate-400">
                                                                                    Clic derecho: desmarcar
                                                                                </div>
                                                                            ) : null}
                                                                        </div>
                                                                    );
                                                                })() : null}
                                                                <label className={`flex items-center justify-center ${inactiveStudent ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                                                                    <input
                                                                        type="radio"
                                                                        name={`session-register-${student.id}-${block.criterion.id}`}
                                                                        className="appearance-none h-4 w-4 print:h-3 print:w-3 rounded-full border-2 bg-white transition-all duration-150"
                                                                        checked={!inactiveStudent && currentCode === level.id}
                                                                        disabled={inactiveStudent}
                                                                        style={(() => {
                                                                            const tone = levelRadioToneMap[level.id];
                                                                            const isChecked = !inactiveStudent && currentCode === level.id;
                                                                            if (!tone) {
                                                                                return {
                                                                                    borderColor: isChecked ? '#0f172a' : '#a1a1aa',
                                                                                    backgroundColor: isChecked ? '#0f172a' : '#ffffff',
                                                                                    boxShadow: isChecked ? 'inset 0 0 0 2px #ffffff' : 'none'
                                                                                };
                                                                            }
                                                                            return {
                                                                                borderColor: isChecked ? tone.border : '#8a8f98',
                                                                                backgroundColor: isChecked ? tone.fill : '#ffffff',
                                                                                boxShadow: isChecked
                                                                                    ? 'inset 0 0 0 2px #ffffff'
                                                                                    : 'none',
                                                                                opacity: inactiveStudent ? 0.65 : 1
                                                                            };
                                                                        })()}
                                                                        title={showCellDescriptors
                                                                            ? (inactiveStudent
                                                                                ? 'Estudiante no evaluable'
                                                                                : `${String(level.short || level.label || '').toUpperCase()}: ${getCriterionLevelDescriptor(block.criterion, level.id) || 'Sin descripción cargada'} · Clic derecho para desmarcar`)
                                                                            : ''}
                                                                        onChange={() => {
                                                                            if (inactiveStudent) return;
                                                                            updateGradingRecord(student.id, block.criterion.id, {
                                                                                level: gradingCodeToStoredLevel(level.id)
                                                                            });
                                                                        }}
                                                                    />
                                                                </label>
                                                            </td>
                                                        ));
                                                    }),
                                                    <td
                                                        key={`session-register-nl-${student.id}-${compIdx}`}
                                                        onClick={() => {
                                                            if (inactiveStudent) return;
                                                            openEvidenceModal(student, competency, competencySummary.label);
                                                        }}
                                                        title={inactiveStudent ? 'Estudiante no evaluable' : 'Ver evidencias de esta competencia'}
                                                        className={`border border-slate-200 px-1.5 py-1 text-center font-black text-[10px] ${inactiveStudent ? 'cursor-not-allowed' : 'cursor-pointer hover:brightness-110'} ${competencySummary.code ? (nlToneMap[competencySummary.code] || 'bg-slate-100 text-slate-700') : (inactiveStudent ? rowState.row : (String(competency.source || '') === 'transversal' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'))}`}
                                                    >
                                                        <button type="button" disabled={inactiveStudent} aria-label={`Ver evidencias de ${competency.name} de ${student.name}`} className="flex w-full items-center justify-center gap-1">
                                                            <span>{competencySummary.label}</span>
                                                        </button>
                                                    </td>,
                                                    ...(expanded ? [
                                                        <td key={`session-register-obs-${student.id}-${compIdx}`} className="border border-slate-200 px-2 py-1 align-top">
                                                            <textarea
                                                                key={`session-register-obs-input-${student.id}-${summaryId}-${getStudentObservationSummary(student.id, competency)}`}
                                                                defaultValue={getStudentObservationSummary(student.id, competency)}
                                                                disabled={inactiveStudent}
                                                                onInput={(event) => autoResizeTextarea(event.currentTarget)}
                                                                onBlur={(event) => {
                                                                    if (inactiveStudent) return;
                                                                    const nextValue = event.target.value;
                                                                    const currentValue = getStudentObservationSummary(student.id, competency);
                                                                    if (nextValue === currentValue) return;
                                                                    updateGradingRecord(student.id, summaryId, {
                                                                        observation: nextValue
                                                                    });
                                                                }}
                                                                placeholder={inactiveStudent ? 'No evaluado' : 'Conclusión descriptiva...'}
                                                                rows={2}
                                                                className={`w-full resize-none overflow-hidden rounded-lg border px-2 py-1 text-[9px] leading-tight ${
                                                                    inactiveStudent
                                                                        ? 'border-slate-300 bg-slate-100 text-slate-400 cursor-not-allowed'
                                                                        : 'border-slate-200 bg-white text-slate-700'
                                                                }`}
                                                            />
                                                        </td>
                                                    ] : [])
                                                ];
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                            </table>
                        </div>
                        </div>
                        {renderPrintFooter()}
                    </div>

                    <div className="session-register-print-page print:break-before-page print:w-full print:max-w-full print:overflow-hidden">
                        {renderPrintHeader(`Resumen estad?stico - ${printInstrumentName}`)}
                        <div className="session-register-page-body">
                        <div className="session-register-summary-print-sheet print:w-full print:max-w-full print:overflow-hidden">
                        <div className="mt-4 space-y-3 print:mt-3">
    
    {/* PRIMER BLOQUE (GRANDE) */}
    {primarySessionSummaries.length > 0 && (
        <div>
            {renderSessionSummaryCard(
                primarySessionSummaries[0].competency,
                primarySessionSummaries[0].stats,
                primarySessionSummaries[0].total,
                0,
                "full"
            )}
        </div>
    )}

    {/* BLOQUES INFERIORES (2 COLUMNAS) */}
    <div className="grid grid-cols-2 gap-3">
        {transversalSessionSummaries.map(({ competency, stats, total }, idx) =>
            renderSessionSummaryCard(
                competency,
                stats,
                total,
                idx + 1,
                "half"
            )
        )}
    </div>

</div>
                        </div>
                        </div>
                        {renderPrintFooter()}
                    </div>
                </>
            )}
            {evidenceModal ? (
                <div role="dialog" aria-modal="true" aria-label={`Evidencias de ${evidenceModal.studentName}`} className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4 print:hidden">
                    <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl">
                        <div className="relative flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
                            <div className="flex min-w-0 items-center gap-3">
                                <StudentEvidenceAvatar studentId={evidenceModal.studentId} studentName={evidenceModal.studentName} />
                                <div className="min-w-0">
                                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-600">{evidenceModal.summaryId ? 'Evidencias de la competencia' : 'Evidencias del estudiante'}</div>
                                    <h4 className="truncate text-xl font-black text-slate-800">{evidenceModal.studentName}</h4>
                                    <p className="truncate text-sm font-bold text-slate-500">{evidenceModal.summaryId ? <>{evidenceModal.competency?.name || 'Competencia'} · NL {evidenceModal.summaryLabel}</> : 'Todas las evidencias de la sesión'}</p>
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowEvidenceGroup((current) => !current)}
                                    className={`relative inline-flex h-11 items-center gap-2 rounded-2xl border px-3 shadow-sm transition hover:-translate-y-0.5 ${showEvidenceGroup ? 'border-violet-300 bg-violet-100 text-violet-800' : 'border-violet-200 bg-violet-50 text-violet-700'}`}
                                    title="Ver grupo del estudiante"
                                    aria-label="Ver grupo del estudiante"
                                    aria-expanded={showEvidenceGroup}
                                >
                                    <Users className="h-5 w-5" aria-hidden="true" />
                                    <span className="hidden max-w-32 truncate text-[10px] font-black sm:block">{modalGroupName || 'Sin grupo'}</span>
                                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[9px] font-black">{modalGroupMembers.length || 1}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => evidenceInputRef.current?.click()}
                                    disabled={evidenceBusy}
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-200 transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
                                    title="Subir evidencia"
                                    aria-label="Subir evidencia"
                                >
                                    <UploadEvidenceIcon />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => loadSessionEvidences(evidenceModal)}
                                    disabled={evidenceBusy}
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-300 bg-white text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-wait disabled:opacity-60"
                                    title="Actualizar evidencias"
                                    aria-label="Actualizar evidencias"
                                >
                                    <RefreshEvidenceIcon busy={evidenceBusy} />
                                </button>
                                <button
                                    type="button"
                                    onClick={closeEvidenceModal}
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-lg font-black text-slate-600 hover:bg-slate-100"
                                    aria-label="Cerrar evidencias"
                                >
                                    ×
                                </button>
                            </div>
                            {showEvidenceGroup ? (
                                <div className="absolute right-6 top-[4.6rem] z-30 w-[min(22rem,calc(100vw-3rem))] overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-2xl">
                                    <div className="flex items-center justify-between bg-violet-700 px-4 py-3 text-white">
                                        <div><span className="block text-[9px] font-black uppercase tracking-[0.16em] text-violet-200">Grupo del estudiante</span><b className="text-sm">{modalGroupName || 'Sin grupo asignado'}</b></div>
                                        <button type="button" onClick={() => setShowEvidenceGroup(false)} className="grid h-8 w-8 place-items-center rounded-full bg-white/15 text-lg hover:bg-white/25" aria-label="Cerrar integrantes">×</button>
                                    </div>
                                    <div className="max-h-72 overflow-y-auto p-3">
                                        {modalGroupMembers.length ? modalGroupMembers.map((member, index) => (
                                            <div key={String(member.id)} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-violet-50">
                                                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-100 text-[10px] font-black text-violet-700">{index + 1}</span>
                                                <div className="min-w-0"><b className="block truncate text-xs text-slate-800">{member.name || member.estudiantes || 'Estudiante'}</b><span className="text-[9px] font-bold text-slate-400">{member.grade || member.grado || selGrade} · {member.section || member.secc || selSection}</span></div>
                                            </div>
                                        )) : <p className="p-4 text-center text-xs font-bold text-slate-400">Este estudiante todavía no tiene un grupo asignado.</p>}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                        <div className="space-y-4 overflow-y-auto p-6">
                            <EvidenceTemplateDocuments sessionId={currentSessionId} studentId={String(evidenceModal.studentId)} criteriaId={evidenceModal.summaryId}/>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-600">{evidenceModal.summaryId ? 'Entregables de esta competencia' : 'Entregables de esta sesión'}</span>
                                        <span className="rounded-full bg-white px-2 py-0.5 text-[8px] font-black text-slate-600 shadow-sm">{sessionDeliverableCount}</span>
                                    </div>
                                    {sessionDeliverables.length > 0 ? (
                                        <div className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
                                            {sessionDeliverables.map((group: any) => (
                                                <div key={group.name} className="overflow-hidden rounded-xl border" style={{ borderColor: hexToRgba(group.color, 0.25), backgroundColor: hexToRgba(group.color, 0.07) }}>
                                                    <div className="px-2.5 py-1 text-[9px] font-black uppercase leading-tight text-white" style={{ backgroundColor: group.color }}>
                                                        {group.name}
                                                    </div>
                                                    <div className="divide-y" style={{ borderColor: hexToRgba(group.color, 0.15) }}>
                                                        {group.rows.map((row: { capacity: string; evidence: string }, index: number) => (
                                                            <div key={`${index}-${row.evidence}`} className="grid grid-cols-[minmax(100px,0.8fr)_minmax(0,1.6fr)] gap-2 px-2.5 py-1.5 text-[9px] leading-snug text-slate-700">
                                                                <span className="font-black" style={{ color: group.color }} title="Capacidad">{row.capacity}</span>
                                                                <span className="font-semibold" title="Evidencia">{row.evidence}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="mt-1.5 text-[9px] font-bold text-slate-400">No se definieron entregables para las competencias evaluadas.</p>
                                    )}
                                </div>
                                <input
                                    ref={evidenceInputRef}
                                    type="file"
                                    multiple
                                    accept={EVIDENCE_ACCEPT}
                                    className="hidden"
                                    onChange={(event) => {
                                        handleEvidenceFiles(event.target.files);
                                        event.currentTarget.value = '';
                                    }}
                                />
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-700">
                                También puedes pegar una captura con <kbd className="rounded border border-emerald-200 bg-white px-1.5 py-0.5 font-black">Ctrl + V</kbd> desde el recortador de Windows.
                            </div>
                            {evidenceMessage ? (
                                <div className={`rounded-2xl border px-4 py-3 text-sm font-bold ${evidenceMessage.toLowerCase().includes('no se pudo') || evidenceMessage.toLowerCase().includes('formato no valido') ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                                    {evidenceMessage}
                                </div>
                            ) : null}
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-3 px-1">
                                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{evidenceModal.summaryId ? 'Archivos de esta competencia' : 'Todos los archivos de la sesión'}</span>
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black text-slate-600">{sessionEvidences.length}</span>
                                </div>
                            <div className="max-h-[42vh] overflow-y-auto rounded-[1.5rem] border border-slate-200">
                                {evidenceBusy ? (
                                    <div className="p-8 text-center text-sm font-bold text-slate-400">Procesando evidencias...</div>
                                ) : sessionEvidences.length === 0 ? (
                                    <div className="p-8 text-center text-sm font-bold text-slate-400">{evidenceModal.summaryId ? 'Aún no hay evidencias asociadas a esta competencia.' : 'Aún no hay evidencias en esta sesión.'}</div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                        {sessionEvidences.map((item) => (
                                            <article key={item.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                                                <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200">
                                                    {item.thumbnailUrl || item.previewKind === 'image' ? (
                                                        <img src={item.thumbnailUrl || item.fileUrl} alt={item.fileName} loading="lazy" className="h-full w-full object-cover" />
                                                    ) : (
                                                        <div className="grid h-full place-items-center p-4 text-center">
                                                            <div>
                                                                <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white text-xl font-black uppercase text-violet-700 shadow-sm">{getFileExtension(item.fileName).slice(0, 4) || 'FILE'}</span>
                                                                <span className="mt-3 block text-[9px] font-black uppercase tracking-widest text-slate-500">{item.previewKind}</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div className="absolute inset-x-0 top-0 flex justify-end gap-1.5 bg-gradient-to-b from-slate-950/55 to-transparent p-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                                                        <button type="button" onClick={() => handleOpenEvidence(item)} className="grid h-8 w-8 place-items-center rounded-full bg-white/95 text-slate-700 shadow hover:bg-white" title={item.available ? 'Ver evidencia' : 'Archivo pendiente de sincronización'} aria-label={`Ver ${item.fileName}`}><Eye className="h-4 w-4" /></button>
                                                        <button type="button" onClick={() => handleDownloadEvidence(item)} disabled={!item.available} className="grid h-8 w-8 place-items-center rounded-full bg-emerald-600 text-white shadow hover:bg-emerald-700 disabled:opacity-50" title="Descargar evidencia" aria-label={`Descargar ${item.fileName}`}><Download className="h-4 w-4" /></button>
                                                        <button type="button" onClick={() => { setEvidenceMessage(''); setRenamingEvidence({ id: item.id, name: item.fileName }); }} disabled={evidenceBusy} className="grid h-8 w-8 place-items-center rounded-full bg-blue-600 text-white shadow hover:bg-blue-700 disabled:opacity-50" title="Renombrar evidencia" aria-label={`Renombrar ${item.fileName}`}><Pencil className="h-4 w-4" /></button>
                                                        <button type="button" onClick={() => handleDeleteEvidence(item.id)} className="grid h-8 w-8 place-items-center rounded-full bg-rose-600 text-white shadow hover:bg-rose-700" title="Eliminar evidencia" aria-label={`Eliminar ${item.fileName}`}><Trash2 className="h-4 w-4" /></button>
                                                    </div>
                                                    {item.teacherComment ? <span className="absolute bottom-2 right-2 rounded-full bg-emerald-600 px-2 py-1 text-[8px] font-black uppercase text-white shadow">Comentada</span> : null}
                                                </div>
                                                <div className="min-w-0 p-3">
                                                    {item.requestedEvidence && <div className="mb-2 border-l-2 pl-2 text-[10px]" style={{ borderColor: /^#[a-f0-9]{6}$/i.test(item.requestedEvidence.color) ? item.requestedEvidence.color : '#334155' }}>
                                                        <span className="block font-bold text-slate-500">{item.requestedEvidence.competency}</span>
                                                        <span className="block font-semibold text-slate-700">{item.requestedEvidence.text}</span>
                                                    </div>}
                                                    {renamingEvidence?.id === item.id ? (
                                                        <form className="flex items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); void handleRenameEvidence(); }}>
                                                            <input
                                                                autoFocus
                                                                value={renamingEvidence.name}
                                                                onChange={(event) => setRenamingEvidence({ ...renamingEvidence, name: event.target.value })}
                                                                onKeyDown={(event) => { if (event.key === 'Escape') setRenamingEvidence(null); }}
                                                                className="min-w-0 flex-1 rounded-lg border border-blue-300 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-200"
                                                                aria-label="Nuevo nombre de la evidencia"
                                                            />
                                                            <button type="submit" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blue-600 text-white hover:bg-blue-700" title="Guardar nombre" aria-label="Guardar nombre"><Check className="h-3.5 w-3.5" /></button>
                                                            <button type="button" onClick={() => setRenamingEvidence(null)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100" title="Cancelar" aria-label="Cancelar renombrado"><X className="h-3.5 w-3.5" /></button>
                                                        </form>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            <span className="truncate text-[11px] font-black text-slate-800" title={item.fileName}>{item.fileName}</span>
                                                            {item.renamedBy === 'teacher' || item.renamedBy === 'student' ? (
                                                                <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[8px] font-black ${item.renamedBy === 'teacher' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`} title={item.renamedBy === 'teacher' ? 'Renombrada por el docente' : 'Renombrada por el estudiante'} aria-label={item.renamedBy === 'teacher' ? 'Renombrada por el docente' : 'Renombrada por el estudiante'}>
                                                                    {item.renamedBy === 'teacher' ? 'D' : 'E'}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                    )}
                                                    <div className="mt-1 text-[9px] font-bold text-slate-500">
                                                        {formatFileSize(item.fileSize)} · {formatEvidenceDate(item.uploadedAt)}
                                                    </div>
                                                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[8px] font-black uppercase tracking-wide">
                                                        <span className={item.available ? 'text-emerald-600' : 'text-amber-600'}>
                                                            {item.available
                                                                ? (item.source === 'student_portal' ? 'Entrega del estudiante · Disponible' : 'Adjunta por el docente · Disponible')
                                                                : 'Entrega registrada · Archivo sincronizándose'}
                                                        </span>
                                                        {item.source === 'student_portal' && item.deliveryTiming === 'on_time' ? (
                                                            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-emerald-700" title={item.onTimeCloseAt ? `Plazo: ${formatEvidenceDate(item.onTimeCloseAt)}` : undefined}>A tiempo</span>
                                                        ) : null}
                                                        {item.source === 'student_portal' && item.deliveryTiming === 'late' ? (
                                                            <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-rose-700" title={item.onTimeCloseAt ? `Plazo: ${formatEvidenceDate(item.onTimeCloseAt)}` : undefined}>Tarde ({formatLateDuration(item.lateByMs)})</span>
                                                        ) : null}
                                                    </div>
                                                    {item.observation || item.evidenceLink ? (
                                                        <div className="mt-2 space-y-1.5 rounded-xl border border-violet-100 bg-violet-50/70 p-2 text-[9px] text-slate-700">
                                                            {item.observation ? (
                                                                <div><span className="block text-[8px] font-black uppercase tracking-wider text-violet-700">Descripción</span><p className="mt-0.5 line-clamp-3 whitespace-pre-wrap font-semibold leading-relaxed" title={item.observation}>{item.observation}</p></div>
                                                            ) : null}
                                                            {item.evidenceLink ? (
                                                                <a href={item.evidenceLink} target="_blank" rel="noopener noreferrer" className="block truncate font-black text-blue-600 underline decoration-blue-300 underline-offset-2">Abrir enlace adjunto ↗</a>
                                                            ) : null}
                                                        </div>
                                                    ) : item.source === 'student_portal' ? (
                                                        <p className="mt-2 text-[8px] font-bold italic text-slate-400">Sin descripción ni enlace.</p>
                                                    ) : null}
                                                    <details className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/60 open:bg-white">
                                                            <summary className="cursor-pointer px-2.5 py-2 text-[9px] font-black uppercase tracking-wide text-emerald-700">
                                                                Comentario docente {item.teacherComment ? '· Guardado' : '· Pendiente'}
                                                            </summary>
                                                            <div className="space-y-2 border-t border-emerald-100 p-2.5">
                                                                <textarea
                                                                    value={teacherCommentDrafts[String(item.id)] ?? item.teacherComment}
                                                                    onChange={(event) => setTeacherCommentDrafts((current) => ({ ...current, [String(item.id)]: event.target.value }))}
                                                                    maxLength={4000}
                                                                    rows={3}
                                                                    placeholder="Escribe una devolución específica sobre esta evidencia..."
                                                                    className="w-full resize-y rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-[10px] font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-200"
                                                                />
                                                                <div className="flex items-center justify-end gap-2">
                                                                    <button type="button" disabled={evidenceBusy} onClick={() => void handleSaveTeacherComment(item)} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[9px] font-black text-white hover:bg-emerald-700 disabled:opacity-50">Guardar</button>
                                                                </div>
                                                            </div>
                                                    </details>
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                )}
                            </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
};
