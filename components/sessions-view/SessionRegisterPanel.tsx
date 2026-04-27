import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, LabelList } from 'recharts';
import logoBar from '../../src/Logo_bar.ico';
import { autoResizeTextarea, normalizeLoose } from './shared';

type GradingRecord = { level: string; observation: string };

interface SessionRegisterPanelProps {
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

export const SessionRegisterPanel: React.FC<SessionRegisterPanelProps> = ({
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
    if (!gradingCriteriaRows.length) {
        return (
            <div className="p-10 text-center text-slate-400 text-sm font-bold">
                La sesion no tiene criterios cargados para construir el registro por sesion.
            </div>
        );
    }

    const groupedCompetencies = gradingSessionGroups.groups;
    const criterionBlocks = gradingSessionGroups.criterionBlocks;
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
                                    <td className="border border-slate-200 p-1 font-black">{stat.count}</td>
                                    <td className="border border-slate-200 p-1 font-black">{Number(stat.percentage || 0).toFixed(2)}%</td>
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
        const student = filteredStudents.find((item) => String(item.id) === String(studentId));
        const normalizedEstado = normalizeLoose(String(student?.estado || ''));
        if (
            normalizedEstado === 'r' || normalizedEstado.includes('retir')
            || normalizedEstado === 't' || normalizedEstado.includes('traslad')
            || normalizedEstado === 'na' || normalizedEstado.includes('no asiste')
        ) {
            return { label: 'NE', code: 'ne', score: null };
        }
        const competencyCriteria = gradingCriteriaRows.filter((row: any) =>
            normalizeLoose(row.competencia) === normalizeLoose(competency.name)
            && String(row.source || '') === String(competency.source || '')
        );
        if (!competencyCriteria.length) return { label: '-', code: '', score: null };

        const selectedCodes = competencyCriteria.map((row: any) =>
            normalizeGradingLevelToCode(gradingRecords[getGradingKey(studentId, row.id)]?.level)
        );
        const filledCodes = selectedCodes.filter(Boolean);

        if (!filledCodes.length) {
            return { label: '...', code: '', score: null };
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
        return {
            label: level?.short || code.toUpperCase(),
            code,
            score: ['c', 'b', 'a', 'ad'].indexOf(code)
        };
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
                            <td className="bg-black text-white font-black text-right px-2 py-1 border border-black w-[120px]">Nivel:</td>
                            <td className="px-2 py-1 border border-black">{generalData?.level || '-'}</td>
                            <td className="bg-black text-white font-black text-right px-2 py-1 border border-black w-[80px]">Grado:</td>
                            <td className="px-2 py-1 border border-black w-[70px]">{selGrade || '-'}</td>
                            <td className="bg-black text-white font-black text-right px-2 py-1 border border-black w-[80px]">Unidad:</td>
                            <td className="px-2 py-1 border border-black w-[90px]">N° {unitNumber || '-'}</td>
                            <td className="bg-black text-white font-black text-right px-2 py-1 border border-black w-[80px]">Sesión:</td>
                            <td className="px-2 py-1 border border-black">{sessionData?.title || printInstrumentName || '-'}</td>
                        </tr>
                        <tr>
                            <td className="bg-black text-white font-black text-right px-2 py-1 border border-black">Área Curricular:</td>
                            <td className="px-2 py-1 border border-black">{selArea || '-'}</td>
                            <td className="bg-black text-white font-black text-right px-2 py-1 border border-black">Sección:</td>
                            <td className="px-2 py-1 border border-black">{selSection || '-'}</td>
                            <td className="bg-black text-white font-black text-right px-2 py-1 border border-black">N° Sesión:</td>
                            <td className="px-2 py-1 border border-black">N° {sessionNumber || '-'}</td>
                            <td className="bg-black text-white font-black text-right px-2 py-1 border border-black">Propósito:</td>
                            <td className="px-2 py-1 border border-black">{sessionData?.purpose || '-'}</td>
                        </tr>
                        <tr>
                            <td className="bg-black text-white font-black text-right px-2 py-1 border border-black">Docente:</td>
                            <td className="px-2 py-1 border border-black">{generalData?.teacher || '-'}</td>
                            <td className="bg-black text-white font-black text-right px-2 py-1 border border-black">Bimestre:</td>
                            <td className="px-2 py-1 border border-black">{bimesterLabel || '-'}</td>
                            <td className="bg-black text-white font-black text-right px-2 py-1 border border-black">Fecha:</td>
                            <td className="px-2 py-1 border border-black">{printFooterDate || '-'}</td>
                            <td className="bg-black text-white font-black text-right px-2 py-1 border border-black">Producto:</td>
                            <td className="px-2 py-1 border border-black">{printSessionProduct || '-'}</td>
                        </tr>
                        <tr>
                            <td className="bg-black text-white font-black text-right px-2 py-1 border border-black">Desempeño:</td>
                            <td colSpan={7} className="px-2 py-1 border border-black leading-tight">{sessionPerformanceText || '-'}</td>
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
                <button
                    onClick={() => window.print()}
                    className="print:hidden px-5 py-3 rounded-2xl text-white text-[11px] font-black uppercase tracking-widest bg-slate-900 hover:bg-slate-800"
                >
                    Imprimir Registro
                </button>
            </div>

            <div className="print:hidden">{gradingSectionTabs}</div>

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
                                                            className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-black leading-none hover:bg-white/25 print:hidden"
                                                            title={expanded ? 'Ocultar conclusión' : 'Mostrar conclusión'}
                                                        >
                                                            {expanded ? '⇤⇥' : '⇄'}
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
                                <tr className="text-white text-[9px] print:text-[16px]">
                                    {criterionBlocks.map((block: any, idx: number) => (
                                        <th
                                            key={`session-register-head-crit-${idx}`}
                                            colSpan={gradingCanonicalLevels.length}
                                            className="border border-white/20 p-2 text-left normal-case leading-tight"
                                            style={{ backgroundColor: String(block.source || '') === 'transversal' ? '#0f766e' : '#334155' }}
                                        >
                                            <div className="font-black uppercase text-[8px] print:text-[16px] tracking-wide">{block.code}</div>
<div className="mt-1 text-[9px] print:text-[16px] font-medium">{block.criterion.criterio}</div>
                                        </th>
                                    ))}
                                </tr>
                                <tr className="uppercase text-[9px] print:text-[16px] font-black">
                                    {criterionBlocks.flatMap((block: any, idx: number) =>
                                        gradingCanonicalLevels.map((level: any) => (
                                            <th
                                                key={`session-register-head-level-${idx}-${level.id}`}
                                                className={`border border-white/20 p-1 text-center ${level.color} ${level.id === 'ad' ? 'border-r-4 border-r-slate-800/60' : ''}`}
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
                                    const normalizedEstado = normalizeLoose(String(student.estado || ''));
                                    const isInactiveStudent =
                                        normalizedEstado === 'r' || normalizedEstado.includes('retir')
                                        || normalizedEstado === 't' || normalizedEstado.includes('traslad')
                                        || normalizedEstado === 'na' || normalizedEstado.includes('no asiste');
                                    const rowBaseClass = rowState.row === 'bg-white'
                                        ? (studentIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50')
                                        : rowState.row;
                                    return (
                                        <tr key={`session-register-row-${student.id}`} className={rowBaseClass}>
                                            <td className={`border border-slate-200 px-2 py-1.5 print:px-0.5 print:py-0.5 print:w-[44px] print:min-w-[44px] text-center font-medium ${rowState.numberCell}`}><span className="print:inline-block print:w-full print:whitespace-nowrap">{studentIdx + 1}</span></td>
                                            <td className={`border border-slate-200 px-2 py-1.5 print:px-0.5 print:py-0.5 print:w-[280px] print:min-w-[280px] align-middle ${rowState.studentCell}`}>
                                                <div className="block w-full overflow-hidden text-ellipsis font-black print:font-normal text-[10px] print:text-[14px] leading-tight whitespace-nowrap">{student.name}</div>
                                            </td>
                                            {groupedCompetencies.flatMap((competency: any, compIdx: number) => {
                                                const competencyBlocks = criterionBlocks.filter((block: any) =>
                                                    normalizeLoose(block.competencia) === normalizeLoose(competency.name)
                                                    && String(block.source || '') === String(competency.source || '')
                                                );
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
                                                                className={`border border-slate-200 px-1 py-1 print:px-0.5 print:py-0.5 text-center ${isInactiveStudent ? rowState.row : (levelFillMap[level.id] || '')} ${levelIdx === gradingCanonicalLevels.length - 1 ? 'border-r-4 border-r-slate-300' : ''}`}
                                                            >
                                                                <label className="flex items-center justify-center cursor-pointer">
                                                                    <input
                                                                        type="radio"
                                                                        name={`session-register-${student.id}-${block.criterion.id}`}
                                                                        className="h-4 w-4 print:h-3 print:w-3 accent-slate-800"
                                                                        checked={!isInactiveStudent && currentCode === level.id}
                                                                        disabled={isInactiveStudent}
                                                                        onChange={() => {
                                                                            if (isInactiveStudent) return;
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
                                                        className={`border border-slate-200 px-1.5 py-1 text-center font-black text-[10px] ${competencySummary.code ? (nlToneMap[competencySummary.code] || 'bg-slate-100 text-slate-700') : (isInactiveStudent ? rowState.row : (String(competency.source || '') === 'transversal' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'))}`}
                                                    >
                                                        {competencySummary.label}
                                                    </td>,
                                                    ...(expanded ? [
                                                        <td key={`session-register-obs-${student.id}-${compIdx}`} className="border border-slate-200 px-2 py-1 align-top">
                                                            <textarea
                                                                key={`session-register-obs-input-${student.id}-${summaryId}-${getStudentObservationSummary(student.id, competency)}`}
                                                                defaultValue={getStudentObservationSummary(student.id, competency)}
                                                                disabled={isInactiveStudent}
                                                                onInput={(event) => autoResizeTextarea(event.currentTarget)}
                                                                onBlur={(event) => {
                                                                    if (isInactiveStudent) return;
                                                                    const nextValue = event.target.value;
                                                                    const currentValue = getStudentObservationSummary(student.id, competency);
                                                                    if (nextValue === currentValue) return;
                                                                    updateGradingRecord(student.id, summaryId, {
                                                                        observation: nextValue
                                                                    });
                                                                }}
                                                                placeholder={isInactiveStudent ? 'No evaluado' : 'Conclusión descriptiva...'}
                                                                rows={2}
                                                                className={`w-full resize-none overflow-hidden rounded-lg border px-2 py-1 text-[9px] leading-tight ${
                                                                    isInactiveStudent
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
        </div>
    );
};
