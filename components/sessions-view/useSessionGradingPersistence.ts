import { useCallback } from 'react';
import { saveEvaluacionRegistros } from '../../services/apiService';
import { normalizeLoose } from './shared';

type GradingRecord = { level: string; observation: string };

interface UseSessionGradingPersistenceParams {
    currentSessionId: string | null;
    currentUnitId: string | null;
    gradingCriteriaRows: any[];
    gradingStudents: any[];
    gradingSessionGroups: any;
    gradingRecords: Record<string, GradingRecord>;
    sessionData: any;
    setGradingRecords: (value: any) => void;
    setGradingSaving: (value: boolean) => void;
    setToast: (value: any) => void;
}

export const useSessionGradingPersistence = ({
    currentSessionId,
    currentUnitId,
    gradingCriteriaRows,
    gradingStudents,
    gradingSessionGroups,
    gradingRecords,
    sessionData,
    setGradingRecords,
    setGradingSaving,
    setToast
}: UseSessionGradingPersistenceParams) => {
    const getGradingKey = (studentId: string | number, criteriaId: string | number) => `${studentId}::${criteriaId}`;
    
    const updateGradingRecord = (studentId: string | number, criteriaId: string | number, patch: Partial<{ level: string; observation: string }>) => {
        const key = getGradingKey(studentId, criteriaId);
        setGradingRecords(prev => ({
            ...prev,
            [key]: {
                level: patch.level ?? prev[key]?.level ?? '',
                observation: patch.observation ?? prev[key]?.observation ?? ''
            }
        }));
    };
    
    const serializeGradingRecords = useCallback((records: Record<string, { level: string; observation: string }>) =>
        JSON.stringify(
            Object.keys(records)
                .sort()
                .map((key) => [key, String(records[key]?.level || ''), String(records[key]?.observation || '')])
        )
    , []);
    
    const handleSaveGrading = async (options?: { silent?: boolean }) => {
        const silent = !!options?.silent;
        if (!currentSessionId || !currentUnitId) {
            if (!silent) setToast({ msg: 'Seleccione una sesión válida para guardar la calificación.', type: 'warning' });
            return false;
        }
        if (!gradingCriteriaRows.length || !gradingStudents.length) {
            if (!silent) setToast({ msg: 'No hay estudiantes o criterios disponibles para guardar.', type: 'warning' });
            return false;
        }
    
        const instrumentId = sessionData?.instrumentoTemplate?.id || null;
        const summaryRecordIds = gradingSessionGroups.groups.map((competency: any) =>
            `summary::${String(competency.source || 'primary')}::${normalizeLoose(String(competency.name || ''))}`
        );
        const records = [
            ...gradingStudents.flatMap((student) =>
            gradingCriteriaRows.map((criterion: any) => {
                const key = getGradingKey(student.id, criterion.id);
                const current = gradingRecords[key] || { level: '', observation: '' };
                return {
                    student_id: String(student.id),
                    session_id: currentSessionId,
                    unit_id: currentUnitId,
                    instrument_id: instrumentId,
                    criteria_id: String(criterion.id),
                    level: String(current.level || ''),
                    observation: String(current.observation || '')
                };
            })
            ),
            ...gradingStudents.flatMap((student) =>
                summaryRecordIds.map((criteriaId) => {
                    const key = getGradingKey(student.id, criteriaId);
                    const current = gradingRecords[key] || { level: '', observation: '' };
                    return {
                        student_id: String(student.id),
                        session_id: currentSessionId,
                        unit_id: currentUnitId,
                        instrument_id: instrumentId,
                        criteria_id: String(criteriaId),
                        level: '',
                        observation: String(current.observation || '')
                    };
                })
            )
        ];
    
        if (!silent) setGradingSaving(true);
        try {
            const res = await saveEvaluacionRegistros({ records });
            if (!res.success) {
                if (!silent) setToast({ msg: `No se pudo guardar la calificación: ${res.message || 'error'}`, type: 'error' });
                return false;
            }
            if (!silent) setToast({ msg: 'Calificación guardada correctamente.', type: 'success' });
            return true;
        } finally {
            if (!silent) setGradingSaving(false);
        }
    };

    return {
        getGradingKey,
        updateGradingRecord,
        serializeGradingRecords,
        handleSaveGrading
    };
};
