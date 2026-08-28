import { useCallback, useMemo } from 'react';
import type { SessionAssessmentModel, Student } from '../../types';
import {
    buildSessionInstrumentRows,
    normalizeLoose
} from './shared';

type UseSessionAssessmentModelOptions = {
    students: Student[];
    grade: string;
    section: string;
    activeSection: string;
    assessmentModel?: SessionAssessmentModel | null;
    sessionData: any;
};

const RUBRIC_LEVEL_FALLBACK = [
    { id: 'c', label: 'Inicio', color: 'text-rose-700 border-rose-200 bg-rose-50' },
    { id: 'b', label: 'Proceso', color: 'text-orange-700 border-orange-200 bg-orange-50' },
    { id: 'a', label: 'Logrado', color: 'text-sky-700 border-sky-200 bg-sky-50' },
    { id: 'ad', label: 'Destacado', color: 'text-emerald-700 border-emerald-200 bg-emerald-50' }
];

const GUIDE_LEVELS = [
    { id: 'c', label: 'C', color: 'text-rose-700 border-rose-200 bg-rose-50' },
    { id: 'b', label: 'B', color: 'text-orange-700 border-orange-200 bg-orange-50' },
    { id: 'a', label: 'A', color: 'text-sky-700 border-sky-200 bg-sky-50' },
    { id: 'ad', label: 'AD', color: 'text-emerald-700 border-emerald-200 bg-emerald-50' }
];

const CANONICAL_LEVELS = [
    { id: 'c', label: 'Inicio', short: 'C', color: 'bg-rose-600 text-white border-rose-500' },
    { id: 'b', label: 'Proceso', short: 'B', color: 'bg-orange-500 text-white border-orange-500' },
    { id: 'a', label: 'Logrado', short: 'A', color: 'bg-emerald-500 text-white border-emerald-500' },
    { id: 'ad', label: 'Destacado', short: 'AD', color: 'bg-sky-500 text-white border-sky-500' }
];

export const useSessionAssessmentModel = ({
    students,
    grade,
    section,
    activeSection,
    assessmentModel,
    sessionData
}: UseSessionAssessmentModelOptions) => {
    const gradingSections = useMemo(() => String(section || '')
        .split(/,| y /)
        .map(item => item.trim())
        .filter(Boolean), [section]);

    const gradingStudents = useMemo(() => {
        const gradeNorm = normalizeLoose(grade);
        const sectionSet = new Set(
            gradingSections.map(item => normalizeLoose(item))
        );

        return (students || [])
            .filter(student =>
                normalizeLoose(student.grade) === gradeNorm &&
                sectionSet.has(normalizeLoose(student.section))
            )
            .sort((left, right) =>
                String(left.section || '').localeCompare(String(right.section || '')) ||
                String(left.name || '').localeCompare(String(right.name || ''))
            );
    }, [students, grade, gradingSections]);

    const assessmentTemplateModel = useMemo(() => {
        const rows = Array.isArray(assessmentModel?.rows)
            ? assessmentModel.rows
            : [];
        const capacidades = Array.from(new Set(
            rows
                .map((row: any) => String(row?.capacityName || '').trim())
                .filter(Boolean)
        ));
        const criterios = rows
            .map((row: any, index: number) => ({
                id: String(row?.id || `criterion-${index + 1}`),
                competencia: String(row?.competencyName || '').trim(),
                text: String(row?.criterionText || '').trim(),
                capacidad: String(row?.capacityName || '').trim(),
                source: String(row?.source || 'primary').trim(),
                rowType: String(row?.rowType || 'criterion').trim(),
                levelDescriptors:
                    row?.levelDescriptors && typeof row.levelDescriptors === 'object'
                        ? {
                            c: String(row.levelDescriptors.c || '').trim(),
                            b: String(row.levelDescriptors.b || '').trim(),
                            a: String(row.levelDescriptors.a || '').trim(),
                            ad: String(row.levelDescriptors.ad || '').trim()
                        }
                        : undefined
            }))
            .filter((row: any) => row.text);

        return {
            competencia: String(assessmentModel?.competency?.name || '').trim(),
            capacidades,
            criterios,
            rows
        };
    }, [assessmentModel]);

    const canonicalInstrumentRows = useMemo(() => buildSessionInstrumentRows(
        sessionData?.instrumentoTemplate,
        assessmentModel,
        Array.isArray(sessionData?.instrumento) ? sessionData.instrumento : []
    ), [
        sessionData?.instrumentoTemplate,
        sessionData?.instrumento,
        assessmentModel
    ]);

    const rubricRowMode = useMemo(() => {
        const explicit = String(sessionData?.rubricaRowMode || '').trim();
        if (explicit === 'capacity' || explicit === 'criterion') return explicit;
        const rows = Array.isArray(sessionData?.instrumento)
            ? sessionData.instrumento
            : [];
        return rows.some(
            (row: any) => String(row?.rowType || '').trim() === 'capacity'
        ) ? 'capacity' : 'criterion';
    }, [sessionData?.rubricaRowMode, sessionData?.instrumento]);

    const rubricAutoRowsByMode = useMemo(() => {
        const rows = Array.isArray(assessmentModel?.rows)
            ? assessmentModel.rows
            : [];
        const orderedRows = rows
            .filter((row: any) => !!normalizeLoose(String(
                row?.criterionText || row?.capacityName || row?.competencyName || ''
            )))
            .slice()
            .sort((left: any, right: any) =>
                Number(left?.order || 0) - Number(right?.order || 0)
            );
        const currentRows = Array.isArray(sessionData?.instrumento)
            ? sessionData.instrumento
            : [];
        const makeDescriptors = (row: any, fallback: any = {}) => ({
            c: String(row?.c || row?.levelDescriptors?.c || fallback?.c || '').trim(),
            b: String(row?.b || row?.levelDescriptors?.b || fallback?.b || '').trim(),
            a: String(row?.a || row?.levelDescriptors?.a || fallback?.a || '').trim(),
            ad: String(row?.ad || row?.levelDescriptors?.ad || fallback?.ad || '').trim()
        });

        const criterionRows = orderedRows.map((row: any, index: number) => {
            const fallback = currentRows[index] || {};
            return {
                id: String(fallback?.id || row?.id || index + 1),
                rowType: 'criterion',
                source: String(row?.source || 'primary').trim(),
                competencia: String(row?.competencyName || '').trim(),
                capacidad: String(row?.capacityName || '').trim(),
                criterio: String(row?.criterionText || '').trim(),
                ...makeDescriptors(row, fallback)
            };
        });

        const seenCapacityKeys = new Set<string>();
        const capacityRows = orderedRows.reduce((result: any[], row: any) => {
            const competencia = String(row?.competencyName || '').trim();
            const capacidad = String(row?.capacityName || '').trim();
            const source = String(row?.source || 'primary').trim();
            const key = `${normalizeLoose(competencia)}::${normalizeLoose(capacidad)}::${source}`;
            if (!capacidad || seenCapacityKeys.has(key)) return result;
            seenCapacityKeys.add(key);
            const fallback = currentRows.find((item: any) =>
                String(item?.rowType || '').trim() === 'capacity' &&
                normalizeLoose(String(item?.criterio || '')) === normalizeLoose(capacidad) &&
                normalizeLoose(String(item?.competencia || '')) === normalizeLoose(competencia)
            ) || {};
            result.push({
                id: String(fallback?.id || row?.id || result.length + 1),
                rowType: 'capacity',
                source,
                competencia,
                capacidad,
                criterio: capacidad,
                c: '',
                b: '',
                a: '',
                ad: ''
            });
            return result;
        }, []);

        return { criterion: criterionRows, capacity: capacityRows };
    }, [assessmentModel, sessionData?.instrumento]);

    const filteredStudents = useMemo(() => {
        const activeSectionNorm = normalizeLoose(
            activeSection || gradingSections[0] || ''
        );
        if (!activeSectionNorm) return gradingStudents;
        return gradingStudents.filter(student =>
            normalizeLoose(student.section) === activeSectionNorm
        );
    }, [gradingStudents, activeSection, gradingSections]);

    const gradingCriteriaRows = useMemo(() => canonicalInstrumentRows
        .map((row: any, index: number) => ({
            id: String(row?.id || index + 1),
            competencia: String(row?.competencia || row?.comp || '').trim(),
            capacidad: String(row?.capacidad || row?.cap || '').trim(),
            criterio: String(row?.criterio || '').trim(),
            source: String(row?.source || 'primary').trim(),
            rowType: String(row?.rowType || 'criterion').trim(),
            c: String(row?.c || '').trim(),
            b: String(row?.b || '').trim(),
            a: String(row?.a || '').trim(),
            ad: String(row?.ad || '').trim()
        }))
        .filter((row: any) => row.criterio.length > 0), [canonicalInstrumentRows]);

    const gradingChecklistOptionPreset = useMemo(() => {
        const expectedLabel =
            sessionData?.instrumentoTemplate?.structure?.expectedLabel;
        if (
            expectedLabel &&
            typeof expectedLabel === 'object' &&
            String(expectedLabel.mode || '').trim().toLowerCase() === 'custom'
        ) {
            return {
                positive: String(expectedLabel.positive || 'Opción 1').trim() || 'Opción 1',
                negative: String(expectedLabel.negative || 'Opción 2').trim() || 'Opción 2'
            };
        }
        const raw = String(expectedLabel || '').trim().toLowerCase();
        if (raw === 'cumple_no_cumple') return { positive: 'Cumple', negative: 'No cumple' };
        if (raw === 'logrado_no_logrado') return { positive: 'Logrado', negative: 'No logrado' };
        return { positive: 'Sí', negative: 'No' };
    }, [sessionData?.instrumentoTemplate]);

    const checklistLevelMapping = useMemo(() => ({
        positiveLabel: gradingChecklistOptionPreset.positive,
        negativeLabel: gradingChecklistOptionPreset.negative,
        positiveLevel: 'a',
        negativeLevel: 'c'
    }), [gradingChecklistOptionPreset]);

    const gradingRubricaLevels = useMemo(() => {
        const levels = Array.isArray(
            sessionData?.instrumentoTemplate?.structure?.levels
        ) ? sessionData.instrumentoTemplate.structure.levels : [];
        const source = levels.length ? levels : RUBRIC_LEVEL_FALLBACK;
        return source.map((level: any, index: number) => ({
            id: String(level?.id || RUBRIC_LEVEL_FALLBACK[index]?.id || `nivel_${index + 1}`),
            label: String(level?.label || RUBRIC_LEVEL_FALLBACK[index]?.label || `Nivel ${index + 1}`),
            color: RUBRIC_LEVEL_FALLBACK[index]?.color || 'text-slate-700 border-slate-200 bg-slate-50'
        }));
    }, [sessionData?.instrumentoTemplate]);

    const normalizeGradingLevelToCode = useCallback((rawLevel: any) => {
        const levelNorm = normalizeLoose(String(rawLevel || '').trim());
        if (!levelNorm) return '';
        if (['c', 'b', 'a', 'ad'].includes(levelNorm)) return levelNorm;
        if (levelNorm === normalizeLoose(gradingChecklistOptionPreset.positive)) return 'a';
        if (levelNorm === normalizeLoose(gradingChecklistOptionPreset.negative)) return 'c';
        const rubricMatch = gradingRubricaLevels.find((item: any) =>
            normalizeLoose(item.label) === levelNorm ||
            normalizeLoose(item.id) === levelNorm
        );
        if (rubricMatch) return String(rubricMatch.id || '').trim().toLowerCase();
        const guideMatch = GUIDE_LEVELS.find(item =>
            normalizeLoose(item.label) === levelNorm ||
            normalizeLoose(item.id) === levelNorm
        );
        if (guideMatch) return String(guideMatch.id || '').trim().toLowerCase();
        if (levelNorm === 'inicio') return 'c';
        if (levelNorm === 'proceso') return 'b';
        if (levelNorm === 'logrado') return 'a';
        if (levelNorm === 'destacado') return 'ad';
        return '';
    }, [gradingChecklistOptionPreset, gradingRubricaLevels]);

    const gradingCodeToStoredLevel = useCallback((code: string) => {
        const normalized = String(code || '').trim().toLowerCase();
        if (normalized === 'c') return 'Inicio';
        if (normalized === 'b') return 'Proceso';
        if (normalized === 'a') return 'Logrado';
        if (normalized === 'ad') return 'Destacado';
        return '';
    }, []);

    const gradingSessionGroups = useMemo(() => {
        const groups = gradingCriteriaRows.reduce((result: any[], row: any) => {
            const competencia = String(row?.competencia || 'Competencia').trim() || 'Competencia';
            const capacidad = String(row?.capacidad || 'Capacidad').trim() || 'Capacidad';
            const source = String(row?.source || 'primary').trim() || 'primary';
            let competencyGroup = result.find((item: any) =>
                normalizeLoose(item.name) === normalizeLoose(competencia) &&
                item.source === source
            );
            if (!competencyGroup) {
                competencyGroup = { name: competencia, source, capacities: [] as any[] };
                result.push(competencyGroup);
            }
            let capacityGroup = competencyGroup.capacities.find((item: any) =>
                normalizeLoose(item.name) === normalizeLoose(capacidad) &&
                item.source === source
            );
            if (!capacityGroup) {
                capacityGroup = { name: capacidad, source, criteria: [] as any[] };
                competencyGroup.capacities.push(capacityGroup);
            }
            capacityGroup.criteria.push(row);
            return result;
        }, []);

        let globalCriterionIndex = 0;
        const criterionBlocks = groups.flatMap((competency: any) =>
            competency.capacities.flatMap((capacity: any) =>
                capacity.criteria.map((criterion: any) => ({
                    code: `C${++globalCriterionIndex}`,
                    competencia: competency.name,
                    capacidad: capacity.name,
                    source: competency.source,
                    criterion
                }))
            )
        );

        return { groups, criterionBlocks };
    }, [gradingCriteriaRows]);

    return {
        gradingSections,
        gradingStudents,
        assessmentTemplateModel,
        canonicalInstrumentRows,
        rubricRowMode,
        rubricAutoRowsByMode,
        filteredStudents,
        gradingCriteriaRows,
        gradingChecklistOptionPreset,
        checklistLevelMapping,
        gradingRubricaLevels,
        gradingGuideLevels: GUIDE_LEVELS,
        gradingCanonicalLevels: CANONICAL_LEVELS,
        normalizeGradingLevelToCode,
        gradingCodeToStoredLevel,
        gradingSessionGroups
    };
};
