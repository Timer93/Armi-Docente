import { useCallback } from 'react';
import { saveSesion } from '../../services/apiService';
import {
    buildAssessmentModelFromData,
    buildSessionAssessmentModel,
    ensureAssessmentModel,
    ensureSessionAssessmentModel,
    syncResourcesFromActivity
} from './shared';
import { getMissingRequiredSessionFields, type MissingSessionField } from './sessionValidation';

interface UseSessionPersistenceParams {
    year: string;
    selArea: string;
    selGrade: string;
    selSection: string;
    unitNumber: string;
    sessionNumber: string;
    bimesterLabel: string;
    assignments: any[];
    sessionData: any;
    sessionDate: string;
    dateOptions: Array<{ value?: string; label?: string }>;
    timeoutRef: { current: ReturnType<typeof setTimeout> | null };
    setSessionData: (value: any) => void;
    setToast: (value: any) => void;
    focusMissingSessionField: (field: MissingSessionField) => void;
    onSuccess: () => void;
}

export const useSessionPersistence = ({
    year,
    selArea,
    selGrade,
    selSection,
    unitNumber,
    sessionNumber,
    bimesterLabel,
    assignments,
    sessionData,
    sessionDate,
    dateOptions,
    timeoutRef,
    setSessionData,
    setToast,
    focusMissingSessionField,
    onSuccess
}: UseSessionPersistenceParams) => {
    const handleSave = useCallback(async (options?: { silent?: boolean }) => {
        const silent = !!options?.silent;
        if (!selArea || !selGrade || !selSection) {
            if (!silent) setToast({ msg: 'Seleccione Area, Grado y Seccion.', type: 'warning' });
            return false;
        }
    
        const missingFields = getMissingRequiredSessionFields(sessionData, { sessionDate, dateOptions });
        if (missingFields.length > 0) {
            const firstMissing = missingFields[0];
            if (!silent) {
                setToast({ msg: `⚠️ No se guardó la sesión. Falta completar: ${firstMissing.label}. Te llevamos al campo pendiente.`, type: 'warning' });
                focusMissingSessionField(firstMissing);
            }
            return false;
        }
    
        
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
    
        const syncedData = JSON.parse(JSON.stringify(sessionData));
        const pairs = [
            ['secuencia.inicio.saberes', 'secuencia.inicio.saberes_recursos'],
            ['secuencia.inicio.conflicto', 'secuencia.inicio.conflicto_recursos'],
            ['secuencia.proceso.construccion', 'secuencia.proceso.construccion_recursos'],
            ['secuencia.proceso.aplicacion', 'secuencia.proceso.aplicacion_recursos'],
            ['secuencia.proceso.metacognicion', 'secuencia.proceso.metacognicion_recursos'],
            ['secuencia.salida.evaluacion', 'secuencia.salida.evaluacion_recursos']
        ] as const;
    
        const getPath = (obj: any, path: string) => path.split('.').reduce((acc: any, key: string) => acc?.[key], obj);
        const setPath = (obj: any, path: string, value: string) => {
            const keys = path.split('.');
            let ptr = obj;
            for (let i = 0; i < keys.length - 1; i++) ptr = ptr[keys[i]];
            ptr[keys[keys.length - 1]] = value;
        };
    
        pairs.forEach(([activityPath, resourcePath]) => {
            const activity = String(getPath(syncedData, activityPath) || '');
            const resources = String(getPath(syncedData, resourcePath) || '');
            const customInstrument = String(syncedData?.competenciaPrio?.inst || '');
            const { updatedResources, changed } = syncResourcesFromActivity(activity, resources, customInstrument);
            if (changed) setPath(syncedData, resourcePath, updatedResources);
        });
    
        syncedData.assessmentModel = buildAssessmentModelFromData(syncedData, 'system');
        syncedData.sessionAssessmentModel = buildSessionAssessmentModel(syncedData, {
            areaId: assignments.find(a => a.areaName === selArea)?.areaId || selArea,
            grade: selGrade,
            section: selSection,
            unitNumber,
            sessionNumber,
            bimester: bimesterLabel
        });
    
        setSessionData(ensureSessionAssessmentModel(ensureAssessmentModel(syncedData, 'system'), {
            areaId: assignments.find(a => a.areaName === selArea)?.areaId || selArea,
            grade: selGrade,
            section: selSection,
            unitNumber,
            sessionNumber,
            bimester: bimesterLabel
        }));
        const areaId = assignments.find(a => a.areaName === selArea)?.areaId || selArea;
        
        const validDateOptions = dateOptions.filter((option) => String(option?.value || '').trim());
        const resolvedDate = sessionDate || validDateOptions[0]?.value || '';
        const payload = {
            year,
            areaId,
            grade: selGrade,
            section: selSection,
            unitNumber,
            sessionNumber,
            date: resolvedDate,
            sessionData: {
                ...syncedData,
                date: resolvedDate,
                selectedSessionDate: sessionDate,
                sessionDateOptions: validDateOptions
            }
        };
    
        const res = await saveSesion(payload);
        if (res.success) {
            if (!silent) setToast({ msg: '✅ Sesión sincronizada correctamente en SQL.', type: 'success' });
            onSuccess();
            return true;
        } else {
            if (!silent) setToast({ msg: '❌ Error al guardar en SQL: ' + res.message, type: 'error' });
            return false;
        }
    }, [
        assignments,
        bimesterLabel,
        dateOptions,
        focusMissingSessionField,
        onSuccess,
        selArea,
        selGrade,
        selSection,
        sessionData,
        sessionDate,
        sessionNumber,
        setSessionData,
        setToast,
        timeoutRef,
        unitNumber,
        year
    ]);

    return { handleSave };
};
