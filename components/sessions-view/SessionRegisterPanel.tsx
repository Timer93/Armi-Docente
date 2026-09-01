import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, LabelList } from 'recharts';
import logoBar from '../../src/Logo_bar.ico';
import { deleteEvaluacionEvidencia, getEvaluacionEvidencias, getPendingEvidenceReviews, saveEvaluacionEvidencia } from '../../services/apiService';
import { EvidenceDeliveryWindowControl } from '../evaluation/EvidenceDeliveryWindowControl';
import { autoResizeTextarea, normalizeLoose } from './shared';

type GradingRecord = { level: string; observation: string };
type SessionEvidenceItem = {
    id: string | number;
    fileName: string;
    fileSize: number;
    fileType: string;
    fileUrl: string;
    uploadedAt: string;
    source: string;
    available: boolean;
    previewKind: 'image' | 'video' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'custom' | 'generic';
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

const getFileExtension = (fileName: string) => {
    const parts = String(fileName || '').split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
};

const getPreviewKind = (extension: string): SessionEvidenceItem['previewKind'] => {
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

const canOpenInline = (previewKind: SessionEvidenceItem['previewKind']) => (
    previewKind === 'image' || previewKind === 'video' || previewKind === 'pdf'
);

interface SessionRegisterPanelProps {
    currentSessionId: string | null;
    bimesterLabel: string;
    filteredStudents: any[];
    generalData: any;
    gradingCanonicalLevels: Array<{ id: string; label: string; short: string; color: string }>;
    gradingCriteriaRows: any[];
    gradingLoading: boolean;
    gradingRecords: Record<string, GradingRecord>;
    gradingSectionTabs: React.ReactNode;
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
    currentSessionId,
    bimesterLabel,
    filteredStudents,
    generalData,
    gradingCanonicalLevels,
    gradingCriteriaRows,
    gradingLoading,
    gradingRecords,
    gradingSectionTabs,
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
    const [pendingReviewStudentIds, setPendingReviewStudentIds] = React.useState<Set<string>>(new Set());
    const evidenceInputRef = React.useRef<HTMLInputElement | null>(null);

    const currentYear = String(generalData?.year || new Date().getFullYear());
    const currentAreaId = String(sessionData?.sessionAssessmentModel?.scope?.areaId || sessionData?.areaId || selArea || '').trim();

    React.useEffect(() => {
        let active = true;
        if (!currentSessionId) {
            setPendingReviewStudentIds(new Set());
            return;
        }
        const timeout = window.setTimeout(async () => {
            const result = await getPendingEvidenceReviews(currentSessionId);
            if (!active) return;
            if (!result.success) {
                setPendingReviewStudentIds(new Set());
                return;
            }
            setPendingReviewStudentIds(new Set(
                (result.data || []).filter((item) => item.pending).map((item) => String(item.studentId))
            ));
        }, 1300);
        return () => {
            active = false;
            window.clearTimeout(timeout);
        };
    }, [currentSessionId, gradingRecords]);

    const loadSessionEvidences = React.useCallback(async (target?: typeof evidenceModal | null) => {
        const active = target || evidenceModal;
        if (!active || !currentAreaId || !selGrade || !selSection || !unitNumber || !sessionNumber) {
            setSessionEvidences([]);
            return;
        }
        setEvidenceBusy(true);
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
        if (!res.success) {
            setEvidenceMessage(res.message || 'No se pudieron cargar las evidencias.');
            setSessionEvidences([]);
            setEvidenceBusy(false);
            return;
        }
        setSessionEvidences((res.data || []).map((item: any) => {
            const extension = getFileExtension(item.fileName || '');
            return {
                id: item.id,
                fileName: item.fileName || 'Archivo',
                fileSize: Number(item.fileSize || 0),
                fileType: item.fileType || '',
                fileUrl: item.fileUrl || '',
                uploadedAt: item.updatedAt || '',
                source: item.source || 'teacher',
                available: item.available === true,
                previewKind: getPreviewKind(extension)
            };
        }));
        setEvidenceMessage('');
        setEvidenceBusy(false);
    }, [bimesterLabel, currentAreaId, currentSessionId, currentYear, evidenceModal, selGrade, selSection, sessionNumber, unitNumber]);

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
        setEvidenceMessage('');
        setSessionEvidences([]);
        setEvidenceModal({
            studentId: student.id,
            studentName: String(student.name || 'Estudiante'),
            competency,
            summaryId: getCompetencySummaryId(competency),
            summaryLabel
        });
    };

    const closeEvidenceModal = () => {
        setEvidenceModal(null);
        setSessionEvidences([]);
        setEvidenceMessage('');
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

    const handleOpenEvidence = (item: SessionEvidenceItem) => {
        if (!item.available) {
            setEvidenceMessage('La entrega está registrada, pero el archivo todavía no terminó de sincronizarse en esta PC. Mantén Google Drive abierto y pulsa Actualizar.');
            return;
        }
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
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 print:hidden">
                <div>
                    <h3 className="text-lg font-black text-slate-800 uppercase">Registro por Sesión</h3>
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        {filteredStudents.length} estudiantes · {gradingCriteriaRows.length} criterios · {groupedCompetencies.length} competencias activas
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setShowCellDescriptors((prev) => !prev)}
                        title={showCellDescriptors ? 'Ocultar descripciones emergentes' : 'Mostrar descripciones emergentes'}
                        aria-label={showCellDescriptors ? 'Ocultar descripciones emergentes' : 'Mostrar descripciones emergentes'}
                        aria-pressed={showCellDescriptors}
                        className={`print:hidden inline-flex h-11 w-11 items-center justify-center rounded-2xl border text-lg font-black leading-none transition ${
                            showCellDescriptors
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
                        }`}
                    >
                        {showCellDescriptors ? <TooltipVisibleIcon /> : <TooltipHiddenIcon />}
                    </button>
                    <button
                        onClick={() => window.print()}
                        title="Imprimir registro"
                        aria-label="Imprimir registro"
                        className="print:hidden inline-flex h-11 w-11 items-center justify-center rounded-2xl text-lg text-white font-black leading-none bg-slate-900 hover:bg-slate-800"
                    >
                        <PrintMiniIcon />
                    </button>
                </div>
            </div>

            <div className="print:hidden">{gradingSectionTabs}</div>

            {currentSessionId ? (
                <details className="group rounded-3xl border border-violet-100 bg-white print:hidden">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-[10px] font-black uppercase tracking-[0.15em] text-violet-700">
                        <span>Plazo de entrega de evidencias</span>
                        <span className="rounded-full bg-violet-50 px-3 py-1 text-[9px] text-violet-600 group-open:hidden">Configurar</span>
                        <span className="hidden rounded-full bg-violet-50 px-3 py-1 text-[9px] text-violet-600 group-open:inline">Ocultar</span>
                    </summary>
                    <div className="border-t border-violet-100 p-3">
                        <EvidenceDeliveryWindowControl
                            sessionId={currentSessionId}
                            sessionLabel={`Sesión ${sessionNumber}${sessionData?.title ? ` · ${sessionData.title}` : ''}`}
                        />
                    </div>
                </details>
            ) : null}

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
                                    const hasPendingReview = pendingReviewStudentIds.has(String(student.id));
                                    const groupName = String(student.group || student.grupo || '').trim();
                                    const groupVisual = groupName ? groupVisuals.get(groupName) : undefined;
                                    const groupCellStyle = !inactiveStudent && groupVisual
                                        ? { backgroundColor: groupVisual.surface, color: groupVisual.text, WebkitPrintColorAdjust: 'exact' as const }
                                        : undefined;
                                    const studentTooltip = [
                                        groupName ? `Grupo: ${groupName}` : '',
                                        hasPendingReview ? 'Tiene una evidencia nueva pendiente de revisión' : ''
                                    ].filter(Boolean).join(' · ') || undefined;
                                    return (
                                        <tr key={`session-register-row-${student.id}`} className={rowBaseClass}>
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
                                                <div
                                                    className={`block w-full overflow-hidden text-ellipsis font-black print:font-normal text-[10px] print:text-[14px] leading-tight whitespace-nowrap ${hasPendingReview ? 'armi-evidence-review-pending' : ''}`}
                                                >
                                                    {student.name}
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
                                                        title={inactiveStudent ? 'Estudiante no evaluable' : 'Clic para adjuntar evidencias de esta nota'}
                                                        className={`border border-slate-200 px-1.5 py-1 text-center font-black text-[10px] ${inactiveStudent ? 'cursor-not-allowed' : 'cursor-pointer hover:brightness-110'} ${competencySummary.code ? (nlToneMap[competencySummary.code] || 'bg-slate-100 text-slate-700') : (inactiveStudent ? rowState.row : (String(competency.source || '') === 'transversal' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'))}`}
                                                    >
                                                        <div className="flex items-center justify-center gap-1">
                                                            <span>{competencySummary.label}</span>
                                                        </div>
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
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4 print:hidden">
                    <div className="w-full max-w-3xl rounded-[2rem] border border-slate-200 bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
                            <div>
                                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-600">Evidencias de la nota</div>
                                <h4 className="text-xl font-black text-slate-800">{evidenceModal.studentName}</h4>
                                <p className="text-sm font-bold text-slate-500">{evidenceModal.competency?.name || 'Competencia'} · NL {evidenceModal.summaryLabel}</p>
                            </div>
                            <button
                                type="button"
                                onClick={closeEvidenceModal}
                                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-lg font-black text-slate-600 hover:bg-slate-100"
                            >
                                ×
                            </button>
                        </div>
                        <div className="space-y-4 p-6">
                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => evidenceInputRef.current?.click()}
                                    disabled={evidenceBusy}
                                    className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60"
                                >
                                    Subir evidencia
                                </button>
                                <button
                                    type="button"
                                    onClick={() => loadSessionEvidences(evidenceModal)}
                                    disabled={evidenceBusy}
                                    className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                                >
                                    Actualizar
                                </button>
                                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-700">
                                    Tambien puedes pegar una captura con `Ctrl + V` desde el recortador de Windows.
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
                            </div>
                            {evidenceMessage ? (
                                <div className={`rounded-2xl border px-4 py-3 text-sm font-bold ${evidenceMessage.toLowerCase().includes('no se pudo') || evidenceMessage.toLowerCase().includes('formato no valido') ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                                    {evidenceMessage}
                                </div>
                            ) : null}
                            <div className="max-h-[55vh] overflow-y-auto rounded-[1.5rem] border border-slate-200">
                                {evidenceBusy ? (
                                    <div className="p-8 text-center text-sm font-bold text-slate-400">Procesando evidencias...</div>
                                ) : sessionEvidences.length === 0 ? (
                                    <div className="p-8 text-center text-sm font-bold text-slate-400">Aun no hay evidencias asociadas a esta nota.</div>
                                ) : (
                                    <div className="divide-y divide-slate-200">
                                        {sessionEvidences.map((item) => (
                                            <div key={item.id} className="flex items-center justify-between gap-4 px-4 py-4">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-black text-slate-800">{item.fileName}</div>
                                                    <div className="mt-1 text-xs font-bold text-slate-500">
                                                        {formatFileSize(item.fileSize)} · {item.uploadedAt || 'Sin fecha'}
                                                    </div>
                                                    <div className={`mt-1 text-[10px] font-black uppercase tracking-wide ${item.available ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                        {item.available
                                                            ? (item.source === 'student_portal' ? 'Entrega del estudiante · Disponible' : 'Adjunta por el docente · Disponible')
                                                            : 'Entrega registrada · Archivo sincronizándose'}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenEvidence(item)}
                                                        className={`rounded-xl border px-3 py-2 text-xs font-black ${item.available ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100' : 'border-amber-200 bg-amber-50 text-amber-700'}`}
                                                    >
                                                        {item.available ? 'Ver' : 'Esperando archivo'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteEvidence(item.id)}
                                                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100"
                                                    >
                                                        Eliminar
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
};
