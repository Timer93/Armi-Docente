
import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Student, GeneralData, TeachingAssignment } from '../types';
import { Input } from './Input';
import { Select } from './Select';
import { getDatosGenerales, updateModuleStatus, getEstudiantes, saveEstudiante, deleteEstudiante, getEgresados, egresarEstudiantes, resetStudentPortalPassword, openStudentPortalTestSession } from '../services/apiService';
import { INITIAL_GENERAL_DATA } from '../constants';
import { AttendanceSection } from './students/AttendanceSection';

interface Props {
  activeSection: string;
  onSuccess: () => void;
}

const GRADES_FALLBACK = [
    { value: '1ro', label: '1ro' },
    { value: '2do', label: '2do' },
    { value: '3ro', label: '3ro' },
    { value: '4to', label: '4to' },
    { value: '5to', label: '5to' },
];

const SECTIONS_FALLBACK = [
    { value: 'A', label: 'A' },
    { value: 'B', label: 'B' },
    { value: 'C', label: 'C' },
    { value: 'D', label: 'D' },
    { value: 'U', label: 'U' },
];

const SEX_OPTIONS = [
    { value: 'M', label: 'M' },
    { value: 'F', label: 'F' },
];

const NIVEL_OPTIONS = [
    { value: 'Secundaria', label: 'Secundaria' },
    { value: 'Primaria', label: 'Primaria' },
];

const GRADE_ORDER = ['1ro', '2do', '3ro', '4to', '5to'];

type StudentTableColumn = 'number' | 'nivel' | 'estado' | 'name' | 'sexo' | 'dni' | 'email' | 'microsoft' | 'birthDate' | 'group' | 'age' | 'password';
const STUDENT_COLUMN_STORAGE_KEY = 'armi_students_hidden_columns_v1';
const STUDENT_TABLE_COLUMNS: Array<{ key: StudentTableColumn; label: string }> = [
    { key: 'number', label: 'N°' }, { key: 'nivel', label: 'Nivel' }, { key: 'estado', label: 'Estado' },
    { key: 'name', label: 'Estudiante' }, { key: 'sexo', label: 'Sexo' }, { key: 'dni', label: 'DNI' },
    { key: 'email', label: 'Gmail' }, { key: 'microsoft', label: 'Microsoft' }, { key: 'birthDate', label: 'F. nacimiento' },
    { key: 'group', label: 'Grupo' }, { key: 'age', label: 'Edad' }, { key: 'password', label: 'Clave portal' },
];

const readHiddenStudentColumns = (): StudentTableColumn[] => {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(STUDENT_COLUMN_STORAGE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((key): key is StudentTableColumn => STUDENT_TABLE_COLUMNS.some((column) => column.key === key)) : [];
    } catch {
        return [];
    }
};

const normalizeBirthDate = (value?: string | null) => {
    const raw = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};

const calculateAgeFromBirthDate = (birthDate?: string | null) => {
    const normalized = normalizeBirthDate(birthDate);
    if (!normalized) return '';
    const parsed = new Date(`${normalized}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return '';
    const today = new Date();
    let age = today.getFullYear() - parsed.getFullYear();
    const monthDiff = today.getMonth() - parsed.getMonth();
    const dayDiff = today.getDate() - parsed.getDate();
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
    return age >= 0 ? String(age) : '';
};

export const StudentsView: React.FC<Props> = ({ activeSection, onSuccess }) => {
    const [students, setStudents] = useState<Student[]>([]);
    const [graduates, setGraduates] = useState<Student[]>([]);
    const [originalStudents, setOriginalStudents] = useState<Student[]>([]); 
    const [savingStudentIds, setSavingStudentIds] = useState<Array<string | number>>([]);
    const [resettingPasswordIds, setResettingPasswordIds] = useState<Array<string | number>>([]);
    const [testingPortalIds, setTestingPortalIds] = useState<Array<string | number>>([]);
    const [visiblePasswordIds, setVisiblePasswordIds] = useState<Array<string | number>>([]);
    const [hiddenColumns, setHiddenColumns] = useState<StudentTableColumn[]>(readHiddenStudentColumns);
    const [generalData, setGeneralData] = useState<GeneralData>(INITIAL_GENERAL_DATA);
    const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
    
    const [selectedStudentId, setSelectedStudentId] = useState<string | number | null>(null);
    const [formNivel, setFormNivel] = useState('Secundaria');
    const [formGrade, setFormGrade] = useState('');
    const [formSection, setFormSection] = useState('');
    const [formName, setFormName] = useState('');
    const [formDni, setFormDni] = useState('');
    const [formEmail, setFormEmail] = useState('');
    const [formMicrosoft, setFormMicrosoft] = useState('');
    const [formGroup, setFormGroup] = useState('');
    const [formSexo, setFormSexo] = useState('M');
    const [formBirthDate, setFormBirthDate] = useState('');
    const [formEdad, setFormEdad] = useState('');

    const [filters, setFilters] = useState({ name: '', estado: '', group: '', email: '', microsoft: '', dni: '', nivel: '', sexo: '', edad: '' });
    const [activeFilterField, setActiveFilterField] = useState<string | null>(null);
    const tableContainerRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const autoSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    const [rtGrade, setRtGrade] = useState('');
    const [rtSection, setRtSection] = useState('');
    const [rtStudentId, setRtStudentId] = useState<string | number>('');

    // Migración masiva
    const [isMigrateModalOpen, setIsMigrateModalOpen] = useState(false);
    const [migMode, setMigMode] = useState<'ascenso' | 'fusion' | 'separacion' | 'cambio_seccion'>('ascenso');
    const [migFromGrade, setMigFromGrade] = useState('');
    const [migFromSection, setMigFromSection] = useState('');
    const [migToGrade, setMigToGrade] = useState('');
    const [migToSection, setMigToSection] = useState('');
    const [splitTargetSections, setSplitTargetSections] = useState<string[]>([]);
    const [splitAssignments, setSplitAssignments] = useState<Record<string, string>>({});
    const [separationGradeScope, setSeparationGradeScope] = useState<'same' | 'next'>('same');
    const [sectionChangeSelectedIds, setSectionChangeSelectedIds] = useState<string[]>([]);
    const [isGraduateModalOpen, setIsGraduateModalOpen] = useState(false);
    const [graduateGrade, setGraduateGrade] = useState('');
    const [graduateSection, setGraduateSection] = useState('');
    const [isGraduateConfirmOpen, setIsGraduateConfirmOpen] = useState(false);

    const setColumnHidden = (column: StudentTableColumn, hidden: boolean) => {
        setHiddenColumns((current) => {
            const next = hidden ? (current.includes(column) ? current : [...current, column]) : current.filter((item) => item !== column);
            window.localStorage.setItem(STUDENT_COLUMN_STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    };
    const columnClass = (column: StudentTableColumn) => hiddenColumns.includes(column) ? 'hidden' : '';
    const visibleColumnCount = STUDENT_TABLE_COLUMNS.length - hiddenColumns.length;
    const HideColumnButton = ({ column }: { column: StudentTableColumn }) => (
        <button
            type="button"
            onClick={(event) => { event.stopPropagation(); setColumnHidden(column, true); }}
            className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full text-[8px] leading-none text-slate-400 hover:bg-white/20 hover:text-white"
            title={`Ocultar columna ${STUDENT_TABLE_COLUMNS.find((item) => item.key === column)?.label || ''}`}
            aria-label={`Ocultar columna ${column}`}
        >×</button>
    );

    // Estados para Toast y Confirmación
    const [toast, setToast] = useState<{msg: string, type: 'error' | 'success'} | null>(null);
    const [confirmDeleteStudentId, setConfirmDeleteStudentId] = useState<string | number | null>(null);
    const [graduateSearch, setGraduateSearch] = useState('');

    const normalizeText = (value: string | number | undefined | null) => String(value ?? '').trim().toUpperCase();
    const getNextGrade = (grade: string) => {
        const normalized = String(grade || '').trim();
        const idx = GRADE_ORDER.findIndex((item) => normalizeText(item) === normalizeText(normalized));
        if (idx < 0 || idx === GRADE_ORDER.length - 1) return '';
        return GRADE_ORDER[idx + 1];
    };

    const loadStudents = async () => {
        try {
            const res = await getEstudiantes();
            setStudents(Array.isArray(res) ? res : []);
            setOriginalStudents(JSON.parse(JSON.stringify(Array.isArray(res) ? res : [])));
        } catch (e) {
            console.error("Error cargando estudiantes:", e);
            setStudents([]);
        }
    };

    const loadGraduates = async (query = '') => {
        try {
            const res = await getEgresados(query);
            setGraduates(Array.isArray(res) ? res : []);
        } catch (e) {
            console.error("Error cargando egresados:", e);
            setGraduates([]);
        }
    };

    useEffect(() => {
        getDatosGenerales().then(data => {
            setGeneralData(data);
            if (data?.level) setFormNivel(data.level);
        });
        
        const savedAssign = localStorage.getItem('armi_assignments');
        if (savedAssign) {
            try {
                const parsedAssign = JSON.parse(savedAssign) as TeachingAssignment[];
                setAssignments(parsedAssign);
                if (parsedAssign.length > 0) {
                    setFormGrade(parsedAssign[0].grade);
                    setFormSection(parsedAssign[0].section);
                    setRtGrade(parsedAssign[0].grade);
                    setRtSection(parsedAssign[0].section);
                }
            } catch (e) {
                console.error("Error al parsear asignaciones:", e);
            }
        }

        loadStudents();
        loadGraduates();
    }, []);

    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    useEffect(() => {
        return () => {
            Object.values(autoSaveTimersRef.current).forEach((timer) => clearTimeout(timer));
        };
    }, []);

    useEffect(() => {
        const nextAge = calculateAgeFromBirthDate(formBirthDate);
        if (nextAge) {
            setFormEdad(nextAge);
        }
    }, [formBirthDate]);

    useEffect(() => {
        if (activeSection === 'egresados') {
            loadGraduates(graduateSearch);
        }
    }, [activeSection, graduateSearch]);

    const showToast = (msg: string, type: 'error' | 'success') => {
        setToast({ msg, type });
    };

    const configuredGrades = useMemo(() => {
        const grades = new Set(assignments.map(a => String(a.grade || '').trim()).filter(Boolean));
        return Array.from(grades).sort();
    }, [assignments]);

    const studentGrades = useMemo(() => {
        const grades = new Set(students.map(s => String(s.grade || '').trim()).filter(Boolean));
        return Array.from(grades).sort();
    }, [students]);

    const dynamicGrades = useMemo(() => {
        const grades = Array.from(new Set([...configuredGrades, ...studentGrades]));
        if (grades.length === 0) return GRADES_FALLBACK;
        return grades.sort().map(g => ({ value: g, label: g }));
    }, [configuredGrades, studentGrades]);

    const configuredSectionsByGrade = useMemo(() => {
        const map: Record<string, string[]> = {};
        assignments.forEach((a) => {
            const grade = String(a.grade || '').trim();
            const section = String(a.section || '').trim();
            if (!grade || !section) return;
            if (!map[grade]) map[grade] = [];
            if (!map[grade].includes(section)) map[grade].push(section);
        });
        Object.keys(map).forEach((grade) => map[grade].sort());
        return map;
    }, [assignments]);

    const studentSectionsByGrade = useMemo(() => {
        const map: Record<string, string[]> = {};
        students.forEach((s) => {
            const grade = String(s.grade || '').trim();
            const section = String(s.section || '').trim();
            if (!grade || !section) return;
            if (!map[grade]) map[grade] = [];
            if (!map[grade].includes(section)) map[grade].push(section);
        });
        Object.keys(map).forEach((grade) => map[grade].sort());
        return map;
    }, [students]);

    const dynamicSections = useMemo(() => {
        const sections = Array.from(new Set([
            ...(configuredSectionsByGrade[formGrade] || []),
            ...(studentSectionsByGrade[formGrade] || []),
        ]));
        if (sections.length === 0) return SECTIONS_FALLBACK;
        return sections.sort().map(s => ({ value: s, label: s }));
    }, [configuredSectionsByGrade, studentSectionsByGrade, formGrade]);

    const dynamicRtSections = useMemo(() => {
        const sections = Array.from(new Set([
            ...(configuredSectionsByGrade[rtGrade] || []),
            ...(studentSectionsByGrade[rtGrade] || []),
        ]));
        if (sections.length === 0) return SECTIONS_FALLBACK;
        return sections.sort().map(s => ({ value: s, label: s }));
    }, [configuredSectionsByGrade, studentSectionsByGrade, rtGrade]);

    const migrationSourceGrades = useMemo(() => {
        const grades = studentGrades.length > 0 ? studentGrades : configuredGrades;
        return (grades.length > 0 ? grades : GRADES_FALLBACK.map(g => g.value)).map(g => ({ value: g, label: g }));
    }, [studentGrades, configuredGrades]);

    const migrationSourceSections = useMemo(() => {
        const sections = studentSectionsByGrade[migFromGrade] || [];
        return (sections.length > 0 ? sections : SECTIONS_FALLBACK.map(s => s.value)).map(s => ({ value: s, label: s }));
    }, [studentSectionsByGrade, migFromGrade]);

    const migrationTargetGrades = useMemo(() => {
        const grades = configuredGrades.length > 0 ? configuredGrades : dynamicGrades.map(g => g.value);
        return grades.map(g => ({ value: g, label: g }));
    }, [configuredGrades, dynamicGrades]);

    const graduateGradeOptions = useMemo(() => {
        const grades = Array.from(new Set(
            students
                .map((s) => String(s.grade || '').trim())
                .filter((grade) => /^5to$/i.test(grade))
        )).sort();
        return grades.map((grade) => ({ value: grade, label: grade }));
    }, [students]);

    const migrationTargetSections = useMemo(() => {
        const sections = configuredSectionsByGrade[migToGrade] || [];
        return (sections.length > 0 ? sections : SECTIONS_FALLBACK.map(s => s.value)).map(s => ({ value: s, label: s }));
    }, [configuredSectionsByGrade, migToGrade]);

    const separationTargetSections = useMemo(() => {
        const mergedSections = Array.from(new Set([
            ...(configuredSectionsByGrade[migToGrade] || []),
            ...(studentSectionsByGrade[migToGrade] || []),
        ].filter(Boolean)));
        const nonUniqueSections = mergedSections.filter((section) => normalizeText(section) !== 'U');
        const fallbackSections = SECTIONS_FALLBACK
            .map((section) => section.value)
            .filter((section) => normalizeText(section) !== 'U');
        const sections = nonUniqueSections.length >= 2 ? nonUniqueSections : fallbackSections;
        return sections.map((section) => ({ value: section, label: section }));
    }, [configuredSectionsByGrade, studentSectionsByGrade, migToGrade]);

    const sourceStudentsForMigration = useMemo(() => {
        return students.filter((s) => {
            const gradeMatch = normalizeText(s.grade) === normalizeText(migFromGrade);
            if (!gradeMatch) return false;
            if (!migFromSection) return false;
            return normalizeText(s.section) === normalizeText(migFromSection);
        });
    }, [students, migFromGrade, migFromSection]);

    const sectionChangePreviewCount = useMemo(() => {
        return sourceStudentsForMigration.filter((student) => sectionChangeSelectedIds.includes(String(student.id))).length;
    }, [sourceStudentsForMigration, sectionChangeSelectedIds]);

    const migratePreviewCount = useMemo(() => {
        return students.filter((s) => {
            const gradeMatch = normalizeText(s.grade) === normalizeText(migFromGrade);
            if (!gradeMatch) return false;
            if (migMode === 'fusion') return true;
            return normalizeText(s.section) === normalizeText(migFromSection);
        }).length;
    }, [students, migFromGrade, migFromSection, migMode]);

    const splitPreview = useMemo(() => {
        const counts: Record<string, number> = {};
        splitTargetSections.forEach((section) => { counts[section] = 0; });
        Object.values(splitAssignments).forEach((section) => {
            const key = String(section || '');
            if (counts[key] !== undefined) counts[key] += 1;
        });
        return {
            counts,
            total: sourceStudentsForMigration.length
        };
    }, [splitAssignments, sourceStudentsForMigration, splitTargetSections]);

    useEffect(() => {
        if (!migFromGrade) {
            setMigToGrade('');
            return;
        }
        if (migMode === 'cambio_seccion') {
            setMigToGrade(migFromGrade);
            return;
        }
        if (migMode === 'separacion') {
            const targetGrade = separationGradeScope === 'same' ? migFromGrade : getNextGrade(migFromGrade);
            setMigToGrade(targetGrade || migFromGrade);
            return;
        }
        const nextGrade = getNextGrade(migFromGrade);
        if (nextGrade) {
            setMigToGrade(nextGrade);
        }
    }, [migFromGrade, migMode, separationGradeScope]);

    useEffect(() => {
        if (!migToGrade) {
            setMigToSection('');
            setSplitTargetSections([]);
            return;
        }
        const availableSections = (configuredSectionsByGrade[migToGrade] || []).filter(Boolean);
        if (migMode === 'fusion') {
            if (availableSections.includes('U')) {
                setMigToSection('U');
            } else if (!migToSection) {
                setMigToSection(availableSections[0] || 'U');
            }
            setSplitTargetSections([]);
            return;
        }
        if (migMode === 'cambio_seccion') {
            const options = availableSections.filter((section) => normalizeText(section) !== normalizeText(migFromSection));
            setMigToSection((prev) => (prev && normalizeText(prev) !== normalizeText(migFromSection) ? prev : (options[0] || '')));
            setSplitTargetSections([]);
            return;
        }
        if (migMode === 'separacion') {
            const nextSections = separationTargetSections.map((section) => section.value);
            setSplitTargetSections((prev) => {
                const kept = prev.filter((section) => nextSections.includes(section));
                return kept.length >= 2 ? kept : nextSections;
            });
            setMigToSection('');
            return;
        }
        if (migFromSection && availableSections.includes(migFromSection)) {
            setMigToSection(migFromSection);
        } else if (!migToSection) {
            setMigToSection(availableSections[0] || '');
        }
        setSplitTargetSections([]);
    }, [migMode, migToGrade, migFromSection, configuredSectionsByGrade, separationTargetSections]);

    useEffect(() => {
        if (migMode !== 'separacion') {
            setSplitAssignments({});
            return;
        }
        const nextAssignments: Record<string, string> = {};
        sourceStudentsForMigration.forEach((student, index) => {
            const key = String(student.id);
            const fallbackSection = splitTargetSections[index % Math.max(splitTargetSections.length, 1)] || '';
            nextAssignments[key] = splitAssignments[key] || fallbackSection;
        });
        setSplitAssignments(nextAssignments);
    }, [migMode, sourceStudentsForMigration, splitTargetSections]);

    useEffect(() => {
        if (migMode !== 'cambio_seccion') {
            setSectionChangeSelectedIds([]);
            return;
        }
        setSectionChangeSelectedIds(sourceStudentsForMigration.map((student) => String(student.id)));
    }, [migMode, sourceStudentsForMigration]);

    const graduatePreviewCount = useMemo(() => {
        if (!graduateGrade) return 0;
        return students.filter((s) => {
            const gradeMatch = normalizeText(s.grade) === normalizeText(graduateGrade);
            if (!gradeMatch) return false;
            if (!graduateSection) return true;
            return normalizeText(s.section) === normalizeText(graduateSection);
        }).length;
    }, [students, graduateGrade, graduateSection]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (activeFilterField && tableContainerRef.current) {
                const target = e.target as HTMLElement;
                if (!target.closest('.filter-popup') && !target.closest('.filter-trigger')) {
                    setActiveFilterField(null);
                }
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [activeFilterField]);

    const persistStudentRow = async (studentToSave: Student, options?: { silent?: boolean }) => {
        const idKey = String(studentToSave.id);
        setSavingStudentIds((prev) => prev.includes(studentToSave.id) ? prev : [...prev, studentToSave.id]);
        const payload: Student = {
            ...studentToSave,
            fechaNacimiento: normalizeBirthDate(studentToSave.fechaNacimiento),
            edad: studentToSave.fechaNacimiento
                ? calculateAgeFromBirthDate(studentToSave.fechaNacimiento) || studentToSave.edad
                : studentToSave.edad,
        };
        const res = await saveEstudiante(payload);
        if (res.success) {
            setStudents((prev) => prev.map((student) => student.id === studentToSave.id ? payload : student));
            setOriginalStudents((prev) => {
                const exists = prev.some((student) => student.id === studentToSave.id);
                if (!exists) return [...prev, payload];
                return prev.map((student) => student.id === studentToSave.id ? payload : student);
            });
            if (!options?.silent) showToast('Estudiante actualizado en SQL', 'success');
        } else {
            showToast('Error al sincronizar con SQL', 'error');
        }
        delete autoSaveTimersRef.current[idKey];
        setSavingStudentIds((prev) => prev.filter((item) => item !== studentToSave.id));
    };

    const scheduleStudentAutoSave = (studentToSave: Student) => {
        const idKey = String(studentToSave.id);
        if (autoSaveTimersRef.current[idKey]) {
            clearTimeout(autoSaveTimersRef.current[idKey]);
        }
        autoSaveTimersRef.current[idKey] = setTimeout(() => {
            void persistStudentRow(studentToSave, { silent: true });
        }, 700);
    };

    const handleAddStudent = async () => {
        if (!formName || !formGrade || !formSection) {
            showToast('⚠️ Complete Nombre, Grado y Sección', 'error');
            return;
        }
        const newStudent: Student = {
            id: `new-${Date.now()}`,
            nivel: formNivel,
            name: formName, 
            grade: formGrade,
            section: formSection,
            fechaNacimiento: normalizeBirthDate(formBirthDate),
            dni: formDni,
            email: formEmail,
            microsoft: formMicrosoft,
            group: formGroup.toUpperCase(),
            sexo: formSexo,
            edad: calculateAgeFromBirthDate(formBirthDate) || formEdad,
            estado: 'A' 
        };
        const res = await saveEstudiante(newStudent);
        if (res.success) {
            loadStudents();
            handleClearForm();
            await updateModuleStatus('estudiantes', true);
            onSuccess();
            showToast('Estudiante registrado correctamente', 'success');
        } else {
            showToast('Error al guardar en SQL', 'error');
        }
    };

    const handleMigrate = async () => {
        const needsSingleTargetSection = migMode !== 'separacion';
        if (!migFromGrade || !migToGrade || ((migMode !== 'fusion' && !migFromSection) || (needsSingleTargetSection && !migToSection))) return;
        if (migMode === 'separacion' && splitTargetSections.length < 2) {
            showToast('Seleccione al menos dos secciones destino para la separación', 'error');
            return;
        }
        if (migMode === 'cambio_seccion' && normalizeText(migToSection) === normalizeText(migFromSection)) {
            showToast('Seleccione una sección destino distinta a la de origen', 'error');
            return;
        }
        
        const toMigrate = students.filter((s) => {
            const gradeMatch = normalizeText(s.grade) === normalizeText(migFromGrade);
            if (!gradeMatch) return false;
            if (migMode === 'fusion') return true;
            return normalizeText(s.section) === normalizeText(migFromSection);
        });
        if (toMigrate.length === 0) {
            showToast('No hay estudiantes en el grado/sección origen seleccionado', 'error');
            return;
        }
        if (migMode === 'separacion') {
            const missing = toMigrate.filter((student) => !splitAssignments[String(student.id)] || !splitTargetSections.includes(splitAssignments[String(student.id)]));
            if (missing.length > 0) {
                showToast('Asigne todos los estudiantes a una sección destino antes de sincronizar', 'error');
                return;
            }
        }
        if (migMode === 'cambio_seccion' && sectionChangeSelectedIds.length === 0) {
            showToast('Seleccione al menos un estudiante para cambiar de sección', 'error');
            return;
        }

        for (const s of toMigrate) {
            if (migMode === 'cambio_seccion' && !sectionChangeSelectedIds.includes(String(s.id))) {
                continue;
            }
            const splitTarget = migMode === 'separacion'
                ? splitAssignments[String(s.id)]
                : migToSection;
            await saveEstudiante({ ...s, grade: migToGrade, section: splitTarget });
        }
        loadStudents();
        setIsMigrateModalOpen(false);
        const movedCount = migMode === 'cambio_seccion' ? sectionChangeSelectedIds.length : toMigrate.length;
        const actionLabel = migMode === 'fusion' ? 'Fusión' : migMode === 'separacion' ? 'Separación' : migMode === 'cambio_seccion' ? 'Cambio de sección' : 'Migración';
        showToast(`🚀 ${actionLabel} completada: ${movedCount} estudiante(s) actualizados`, 'success');
    };

    const handleSplitAssignmentChange = (studentId: string | number, targetSection: string) => {
        setSplitAssignments((prev) => ({ ...prev, [String(studentId)]: targetSection }));
    };

    const handleToggleSectionChangeStudent = (studentId: string | number) => {
        const id = String(studentId);
        setSectionChangeSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
    };

    const handleToggleSplitTargetSection = (section: string) => {
        setSplitTargetSections((prev) => {
            const exists = prev.includes(section);
            if (exists) {
                const next = prev.filter((item) => item !== section);
                return next;
            }
            return [...prev, section];
        });
    };

    const handleGraduatePromotion = async () => {
        if (!graduateGrade) return;
        const toGraduate = students.filter((s) => {
            const gradeMatch = normalizeText(s.grade) === normalizeText(graduateGrade);
            if (!gradeMatch) return false;
            if (!graduateSection) return true;
            return normalizeText(s.section) === normalizeText(graduateSection);
        });
        if (toGraduate.length === 0) {
            showToast('No hay estudiantes para egresar en el grado o sección seleccionada', 'error');
            return;
        }
        const res = await egresarEstudiantes(toGraduate.map((student) => student.id));
        if (!res.success) {
            showToast(res.message || 'No se pudo egresar la promoción seleccionada', 'error');
            return;
        }
        await loadStudents();
        await loadGraduates();
        setIsGraduateConfirmOpen(false);
        setIsGraduateModalOpen(false);
        showToast(`✅ Promoción egresada: ${toGraduate.length} estudiante(s) movidos a Egresados`, 'success');
    };

    const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (evt) => {
            const bstr = evt.target?.result;
            const wb = XLSX.read(bstr, { type: 'binary' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const data: any[] = XLSX.utils.sheet_to_json(ws);
            for (const row of data) {
                const s: Student = {
                    id: `import-${Date.now()}`,
                    nivel: row['Nivel'] || formNivel,
                    name: String(row['Estudiante'] || row['Nombre'] || row['Nombres'] || row['Apellidos y Nombres'] || ''),
                    grade: row['Grado'] || formGrade,
                    section: row['Sección'] || row['Seccion'] || formSection,
                    fechaNacimiento: normalizeBirthDate(row['Fecha de Nacimiento'] || row['Fecha Nacimiento'] || row['Nacimiento'] || row['F. Nacimiento'] || ''),
                    dni: String(row['DNI'] || row['Documento'] || '').replace(/\D/g, '').substring(0, 8),
                    email: row['Gmail'] || row['Correo'] || row['Email'] || '',
                    microsoft: row['Microsoft'] || row['Outlook'] || row['Hotmail'] || '',
                    group: (row['Grupo'] || row['Equipo'] || '').toUpperCase(),
                    estado: row['Estado'] || row['EST.'] || 'A',
                    sexo: row['Sexo'] || 'M',
                    edad: row['Edad'] || calculateAgeFromBirthDate(row['Fecha de Nacimiento'] || row['Fecha Nacimiento'] || row['Nacimiento'] || row['F. Nacimiento'] || '')
                };
                if (s.name) await saveEstudiante(s);
            }
            loadStudents();
            showToast('Importación masiva finalizada', 'success');
        };
        reader.readAsBinaryString(file);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleClearForm = () => {
        setFormName(''); setFormEmail(''); setFormMicrosoft(''); setFormGroup(''); setFormDni(''); setFormBirthDate(''); setFormEdad(''); setFormSexo('M'); setSelectedStudentId(null);
    };

    const handleStudentUpdate = (id: string | number, field: keyof Student, value: string) => {
        if (field === 'dni') value = value.replace(/\D/g, '').substring(0, 8);
        let updatedStudent: Student | null = null;
        setStudents(students.map((s) => {
            if (s.id !== id) return s;
            const nextStudent: Student = { ...s, [field]: value };
            if (field === 'fechaNacimiento') {
                nextStudent.fechaNacimiento = normalizeBirthDate(value);
                nextStudent.edad = calculateAgeFromBirthDate(nextStudent.fechaNacimiento) || '';
            }
            updatedStudent = nextStudent;
            return nextStudent;
        }));
        if (updatedStudent) {
            scheduleStudentAutoSave(updatedStudent);
        }
    };

    const handleDeleteRequest = (id: string | number) => {
        setConfirmDeleteStudentId(id);
    };

    const handleResetPortalPassword = async (student: Student) => {
        const dni = String(student.dni || '').replace(/\D+/g, '');
        if (!dni) {
            showToast('Registra primero el DNI del estudiante', 'error');
            return;
        }
        const accepted = window.confirm(
            `La clave de ${student.name} volverá a ser su DNI (${dni}). También se cerrarán sus sesiones abiertas. ¿Continuar?`
        );
        if (!accepted) return;
        setResettingPasswordIds((current) => current.includes(student.id) ? current : [...current, student.id]);
        const result = await resetStudentPortalPassword(student.id);
        setResettingPasswordIds((current) => current.filter((id) => id !== student.id));
        if (!result.success) {
            showToast(result.message || 'No se pudo restablecer la clave', 'error');
            return;
        }
        setStudents((current) => current.map((item) => item.id === student.id
            ? { ...item, portalPasswordConfigured: false }
            : item));
        setOriginalStudents((current) => current.map((item) => item.id === student.id
            ? { ...item, portalPasswordConfigured: false }
            : item));
        setVisiblePasswordIds((current) => current.includes(student.id) ? current : [...current, student.id]);
        showToast(`Clave restablecida: ${dni}. El estudiante deberá cambiarla al ingresar.`, 'success');
    };

    const handleOpenStudentPortalTest = async (student: Student) => {
        const targetWindow = window.open('about:blank', '_blank');
        setTestingPortalIds((current) => current.includes(student.id) ? current : [...current, student.id]);
        const result = await openStudentPortalTestSession(student.id);
        setTestingPortalIds((current) => current.filter((id) => id !== student.id));
        if (!result.success || !result.data?.url) {
            targetWindow?.close();
            showToast(result.message || 'No se pudo abrir el portal de prueba', 'error');
            return;
        }
        if (targetWindow) {
            targetWindow.location.href = result.data.url;
        } else {
            window.location.href = result.data.url;
        }
    };

    const confirmDelete = async () => {
        if (!confirmDeleteStudentId) return;
        const res = await deleteEstudiante(confirmDeleteStudentId);
        if (res.success) {
            loadStudents();
            if (selectedStudentId === confirmDeleteStudentId) setSelectedStudentId(null);
            setConfirmDeleteStudentId(null);
            showToast('Estudiante eliminado permanentemente', 'success');
        } else {
            showToast('Error al eliminar registro', 'error');
        }
    };

    const cancelDelete = () => {
        setConfirmDeleteStudentId(null);
    };

    const filteredStudents = useMemo(() => {
        return students.filter(s => {
            const gradeOk = !formGrade || s.grade === formGrade;
            const sectionOk = !formSection || s.section === formSection;
            const nameOk = (s.name || '').toLowerCase().includes(filters.name.toLowerCase());
            const estadoOk = (s.estado || '').toLowerCase().includes(filters.estado.toLowerCase());
            const groupOk = (s.group || '').toLowerCase().includes(filters.group.toLowerCase());
            const emailOk = (s.email || '').toLowerCase().includes(filters.email.toLowerCase());
            const microOk = (s.microsoft || '').toLowerCase().includes(filters.microsoft.toLowerCase());
            const dniOk = String(s.dni ?? '').toLowerCase().includes(filters.dni.toLowerCase());
            const nivelOk = (s.nivel || '').toLowerCase().includes(filters.nivel.toLowerCase());
            const sexoOk = (s.sexo || '').toLowerCase().includes(filters.sexo.toLowerCase());
            const edadOk = String(s.edad ?? '').toLowerCase().includes(filters.edad.toLowerCase());
            
            return gradeOk && sectionOk && nameOk && estadoOk && groupOk && emailOk && microOk && dniOk && nivelOk && sexoOk && edadOk;
        });
    }, [students, formGrade, formSection, filters]);

    const getGroupColor = (groupName?: string) => {
        if (!groupName) return 'bg-slate-100 text-slate-400 border-slate-200';
        const name = groupName.trim().toUpperCase();
        let hash = 0;
        for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
        const colors = [
            'bg-amber-100 text-amber-800 border-amber-300', 'bg-emerald-100 text-emerald-800 border-emerald-300',
            'bg-sky-100 text-sky-800 border-sky-300', 'bg-rose-100 text-rose-800 border-rose-300',
            'bg-indigo-100 text-indigo-800 border-indigo-300', 'bg-orange-100 text-orange-800 border-orange-300',
            'bg-lime-100 text-lime-800 border-lime-300', 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300'
        ];
        return colors[Math.abs(hash) % colors.length];
    };

    const isRowChanged = (student: Student) => {
        const original = originalStudents.find(s => s.id === student.id);
        if (!original) return true;
        return JSON.stringify(student) !== JSON.stringify(original);
    };

    const getRowStyle = (student: Student) => {
        const isSelected = (activeSection === 'retiros_traslados') ? rtStudentId === student.id : selectedStudentId === student.id;
        let bg = '';
        let textColor = '';
        if (isSelected) {
            switch (student.estado) {
                case 'R': bg = 'bg-slate-50 shadow-inner ring-1 ring-inset ring-slate-400'; textColor = 'text-slate-900'; break;
                case 'T': bg = 'bg-purple-50 shadow-inner ring-1 ring-inset ring-purple-400'; textColor = 'text-purple-700'; break;
                case 'NA': bg = 'bg-red-50 shadow-inner ring-1 ring-inset ring-red-400'; textColor = 'text-red-700'; break;
                default: bg = 'bg-blue-50 shadow-inner ring-1 ring-inset ring-blue-400'; textColor = 'text-blue-700'; break;
            }
        } else {
            switch (student.estado) {
                case 'R': bg = 'bg-slate-900'; textColor = 'text-white'; break;
                case 'T': bg = 'bg-purple-600'; textColor = 'text-white'; break;
                case 'NA': bg = 'bg-red-600'; textColor = 'text-white'; break;
                case 'A': bg = 'bg-white hover:bg-emerald-50/30'; textColor = 'text-slate-700'; break;
                default: bg = 'even:bg-slate-50 odd:bg-white hover:bg-blue-50/30'; textColor = 'text-slate-700'; break;
            }
        }
        return `${bg} ${textColor} transition-all duration-200 ease-in-out group`;
    };

    const FilterInput = ({ field, placeholder }: { field: keyof typeof filters, placeholder: string }) => (
        <div className="filter-popup absolute top-full left-0 mt-1 w-56 bg-white shadow-2xl rounded-2xl p-3 z-50 border border-slate-200 animate-fade-in ring-8 ring-black/5" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center px-1">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Filtrar Columna</span>
                    {(filters as any)[field] && <button onClick={() => setFilters({...filters, [field]: ''})} className="text-[9px] font-black text-red-500 uppercase hover:underline">Limpiar</button>}
                </div>
                <input autoFocus type="text" placeholder={placeholder} value={(filters as any)[field]} onChange={e => setFilters({...filters, [field]: e.target.value})} className="w-full text-[10px] p-1.5 border border-slate-300 rounded-xl outline-none focus:border-blue-600 text-slate-800 font-bold bg-slate-50 shadow-inner" />
            </div>
        </div>
    );

    const isAnyFilterActive = Object.values(filters).some(v => v !== '');

    const commonInputClass = "w-full border border-slate-200 rounded-lg h-8 text-[10px] bg-slate-50 font-bold text-slate-700 outline-none px-2 shadow-inner focus:border-blue-400 transition-all";
    const commonLabelClass = "text-[7px] font-black text-slate-400 uppercase tracking-widest mb-0.5 block ml-1";

    if (activeSection === 'retiros_traslados') {
        const rtDropdownList = students.filter(s => s.grade === rtGrade && s.section === rtSection);
        const rtTableList = students.filter(s => s.grade === rtGrade && s.section === rtSection && (s.estado === 'R' || s.estado === 'T' || s.estado === 'NA'));
        
        const updateRtStatus = async (st: string) => {
            if (!rtStudentId) {
                showToast('Seleccione un estudiante para cambiar su estado', 'error');
                return;
            }
            const target = students.find(s => String(s.id) === String(rtStudentId));
            if (!target) {
                showToast('No se encontró el estudiante seleccionado', 'error');
                return;
            }

            const res = await saveEstudiante({ ...target, estado: st });
            if (!res.success) {
                showToast(res.message || 'No se pudo actualizar el estado del estudiante', 'error');
                return;
            }

            await loadStudents();
            showToast(`Estado actualizado a ${st} para ${target.name}`, 'success');
            if (st === 'A' || st === '') setRtStudentId('');
        };

        return (
             <div className="animate-fade-in space-y-6">
                <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-200 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-400 to-slate-900"></div>
                    <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-6 flex items-center gap-3">
                        <span className="p-1 bg-red-50 rounded-xl text-red-600">🚍</span>
                        Retiros y Traslados
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end border-b border-slate-100 pb-8 mb-8">
                        <Select label="Grado" name="rtGrade" value={rtGrade} onChange={e => { setRtGrade(e.target.value); setRtSection(''); setRtStudentId(''); }} options={dynamicGrades} icon="🎓" />
                        <Select label="Sección" name="rtSection" value={rtSection} onChange={e => { setRtSection(e.target.value); setRtStudentId(''); }} options={dynamicRtSections} disabled={!rtGrade} icon="🏫" />
                        <div className="md:col-span-2 flex items-end gap-3">
                            <div className="flex-1">
                                <Select label="Estudiante (Buscador)" name="rtStudent" value={rtStudentId} onChange={e => setRtStudentId(e.target.value)} options={rtDropdownList.map(s => ({ value: String(s.id), label: s.name }))} disabled={!rtGrade || !rtSection} searchable={true} placeholder="Buscar por nombre..." icon="👤" />
                            </div>
                            <button 
                                onClick={() => setRtStudentId('')} 
                                className="btn-3d-clear scale-75 shrink-0 mb-0.5"
                                title="Limpiar Buscador"
                            >
                                <span>🧹</span>
                            </button>
                        </div>
                    </div>
                    <div className="flex justify-center gap-8 bg-slate-50 p-6 rounded-[2rem] border border-slate-100 shadow-inner">
                        {['R', 'T', 'NA', 'A'].map(st => (
                            <button 
                                key={st} 
                                onClick={() => updateRtStatus(st)} 
                                className={`btn-water w-20 h-20 rounded-full flex flex-col items-center justify-center text-white transition-all hover:scale-110 active:scale-90 ${st === 'R' ? 'bg-slate-900' : st === 'T' ? 'bg-purple-600' : st === 'NA' ? 'bg-red-600' : 'bg-emerald-500'}`}
                                title={st === 'R' ? 'Retirar' : st === 'T' ? 'Trasladar' : st === 'NA' ? 'No Asiste' : 'Activar'}
                            >
                                <span className="text-2xl font-black">{st}</span>
                                <span className="text-[8px] font-black uppercase mt-1 opacity-80">{st === 'R' ? 'Retiro' : st === 'T' ? 'Trasl.' : st === 'NA' ? 'No As.' : 'Activo'}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-200 overflow-hidden">
                    <div className="bg-slate-800 text-white p-4 font-black uppercase text-[10px] tracking-widest flex justify-between items-center">
                        <span>Historial de Retiros y Traslados ({rtGrade} {rtSection})</span>
                        <span className="bg-white/20 px-2 py-0.5 rounded-full text-[9px]">{rtTableList.length} Registros</span>
                    </div>
                    <table className="w-full text-[11px] text-left border-collapse table-fixed">
                        <thead className="bg-slate-100 text-slate-600 font-black uppercase tracking-widest text-[9px] border-b border-slate-200">
                            <tr className="divide-x divide-slate-200">
                                <th className="p-3 w-10 text-center">N°</th>
                                <th className="p-3 w-14 text-center">EST..</th>
                                <th className="p-3 w-64">ESTUDIANTE</th>
                                <th className="p-3 w-28 text-center">DNI</th>
                                <th className="p-3">GMAIL</th>
                                <th className="p-3">MICROSOFT</th>
                                <th className="p-3 w-28 text-center">GRUPO</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rtTableList.length === 0 ? (
                                <tr><td colSpan={7} className="p-10 text-center text-slate-400 italic text-[10px] uppercase tracking-widest font-bold bg-slate-50">No hay estudiantes fuera del estado "Activo" en este grado/sección</td></tr>
                            ) : (
                                rtTableList.map((s, idx) => (
                                    <tr key={s.id} onClick={() => setRtStudentId(s.id)} className={`${getRowStyle(s)} border-b border-white/5 cursor-pointer`}>
                                        <td className="p-1 text-center font-black opacity-30">{idx + 1}</td>
                                        <td className="p-1 text-center">
                                            <span className={`px-2 py-0.5 rounded-full border border-white/20 bg-white/10 text-[9px] font-black`}>{s.estado}</span>
                                        </td>
                                        <td className="p-1 font-black uppercase truncate">{s.name}</td>
                                        <td className="p-1 text-center font-mono opacity-80">{s.dni || '-'}</td>
                                        <td className="p-1 truncate opacity-70 italic">{s.email || '-'}</td>
                                        <td className="p-1 truncate opacity-70 italic">{s.microsoft || '-'}</td>
                                        <td className="p-1 text-center">
                                            <span className={`px-2.5 py-1 rounded-xl text-[9px] font-black uppercase border shadow-sm ${getGroupColor(s.group)}`}>
                                                {s.group || '-'}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                    <div className="bg-slate-50 p-3 border-t border-slate-100 flex gap-6 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                        <div className="flex items-center gap-1.5"><span className="w-2 h-2 bg-slate-900 rounded-sm"></span> R: Retirado</div>
                        <div className="flex items-center gap-1.5"><span className="w-2 h-2 bg-purple-600 rounded-sm"></span> T: Trasladado</div>
                        <div className="flex items-center gap-1.5"><span className="w-2 h-2 bg-red-600 rounded-sm"></span> NA: No Asiste</div>
                    </div>
                </div>
             </div>
        );
    }

    if (activeSection === 'egresados') {
        return (
            <div className="animate-fade-in space-y-6">
                {toast && (
                    <div className={`fixed top-8 right-8 z-[1000] px-8 py-4 rounded-[2rem] shadow-2xl border-l-[6px] text-xs font-black animate-fade-in flex items-center gap-4 ${toast.type === 'error' ? 'bg-white border-red-500 text-red-700' : 'bg-white border-emerald-500 text-emerald-700'}`}>
                        <span className="text-2xl">{toast.type === 'error' ? '🚫' : '✅'}</span>
                        <span className="uppercase tracking-widest">{toast.msg}</span>
                    </div>
                )}

                <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-200 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-slate-500 to-slate-900"></div>
                    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
                        <div>
                            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight flex items-center gap-3">
                                <span className="p-1 bg-slate-100 rounded-xl text-slate-700">🎓</span>
                                Consulta de Egresados
                            </h2>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-2">Histórico independiente de promociones egresadas</p>
                        </div>
                        <div className="w-full md:w-[28rem]">
                            <label className={commonLabelClass}>Buscar por DNI o Apellidos y Nombres</label>
                            <input
                                className={commonInputClass}
                                placeholder="Ej: 12345678 o Pérez Gómez..."
                                value={graduateSearch}
                                onChange={(e) => setGraduateSearch(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-[2.5rem] shadow-2xl border border-slate-200 overflow-hidden">
                    <div className="bg-slate-900 text-white p-4 font-black uppercase text-[10px] tracking-widest flex justify-between items-center">
                        <span>Tabla de Egresados</span>
                        <span className="bg-white/10 px-3 py-1 rounded-full text-[9px]">{graduates.length} registros</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-[11px] text-left border-collapse table-fixed">
                            <thead className="bg-slate-100 text-slate-600 font-black uppercase tracking-widest text-[9px] border-b border-slate-200">
                                <tr className="divide-x divide-slate-200">
                                    <th className="p-3 w-10 text-center">N°</th>
                                    <th className="p-3 w-24 text-center">DNI</th>
                                    <th className="p-3">Estudiante</th>
                                    <th className="p-3 w-20 text-center">Grado</th>
                                    <th className="p-3 w-20 text-center">Secc.</th>
                                    <th className="p-3 w-32 text-center">F. Nac.</th>
                                    <th className="p-3 w-20 text-center">Sexo</th>
                                    <th className="p-3 w-20 text-center">Edad</th>
                                    <th className="p-3 w-32 text-center">Egreso</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {graduates.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="p-16 text-center text-slate-400 font-bold bg-slate-50 italic uppercase tracking-widest text-[9px]">
                                            No hay egresados para la búsqueda actual
                                        </td>
                                    </tr>
                                ) : (
                                    graduates.map((student, index) => (
                                        <tr key={student.id} className="odd:bg-white even:bg-slate-50/60 hover:bg-slate-50 transition-colors">
                                            <td className="p-3 text-center font-black text-slate-400">{index + 1}</td>
                                            <td className="p-3 text-center font-mono text-slate-700">{student.dni || '-'}</td>
                                            <td className="p-3 font-black uppercase text-slate-800">{student.name || '-'}</td>
                                            <td className="p-3 text-center font-bold text-slate-600">{student.grade || '-'}</td>
                                            <td className="p-3 text-center font-bold text-slate-600">{student.section || '-'}</td>
                                            <td className="p-3 text-center font-bold text-slate-600">{student.fechaNacimiento || '-'}</td>
                                            <td className="p-3 text-center font-bold text-slate-600">{student.sexo || '-'}</td>
                                            <td className="p-3 text-center font-bold text-slate-600">{String(student.edad || '-')}</td>
                                            <td className="p-3 text-center font-bold text-slate-500">{(student as any).egresadoAt ? String((student as any).egresadoAt).slice(0, 10) : '-'}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    }

    if (activeSection === 'asistencia') {
        return (
            <div className="animate-fade-in space-y-6">
                {toast && (
                    <div className={`fixed top-8 right-8 z-[1000] px-8 py-4 rounded-[2rem] shadow-2xl border-l-[6px] text-xs font-black animate-fade-in flex items-center gap-4 ${toast.type === 'error' ? 'bg-white border-red-500 text-red-700' : 'bg-white border-emerald-500 text-emerald-700'}`}>
                        <span className="text-2xl">{toast.type === 'error' ? 'X' : 'OK'}</span>
                        <span className="uppercase tracking-widest">{toast.msg}</span>
                    </div>
                )}
                <AttendanceSection students={students} assignments={assignments} generalData={generalData} showToast={showToast} />
            </div>
        );
    }

    const studentToDelete = students.find(s => s.id === confirmDeleteStudentId);

    return (
        <div className="animate-fade-in pb-12">
             {/* Toast de Notificación */}
             {toast && (
                <div className={`fixed top-8 right-8 z-[1000] px-8 py-4 rounded-[2rem] shadow-2xl border-l-[6px] text-xs font-black animate-fade-in flex items-center gap-4 ${toast.type === 'error' ? 'bg-white border-red-500 text-red-700' : 'bg-white border-emerald-500 text-emerald-700'}`}>
                    <span className="text-2xl">{toast.type === 'error' ? '🚫' : '✅'}</span>
                    <span className="uppercase tracking-widest">{toast.msg}</span>
                </div>
             )}

             {/* Toast de Confirmación de Eliminación */}
             {confirmDeleteStudentId && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-fade-in p-4">
                    <div className="bg-white rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-slate-200 w-full max-w-md overflow-hidden animate-scale-in">
                        <div className="bg-rose-50 p-8 flex flex-col items-center text-center">
                            <div className="w-20 h-20 bg-rose-100 rounded-full flex items-center justify-center text-4xl mb-4 shadow-inner">⚠️</div>
                            <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight leading-tight">¿Eliminar Estudiante?</h3>
                            <p className="text-[10px] font-bold text-rose-600 uppercase tracking-widest mt-2 mb-4">Esta acción borrará el registro permanente en SQL</p>
                            <div className="bg-white/80 border border-rose-200 px-6 py-3 rounded-2xl shadow-sm w-full text-center">
                                <span className="text-sm font-black text-slate-700 uppercase italic">{studentToDelete?.name}</span>
                            </div>
                        </div>
                        <div className="p-6 bg-slate-50 flex gap-3 border-t border-slate-100">
                            <button onClick={cancelDelete} className="flex-1 py-4 rounded-2xl bg-white border border-slate-200 text-slate-400 font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 hover:text-slate-600 transition-all">Cancelar</button>
                            <button onClick={confirmDelete} className="flex-1 py-4 rounded-2xl bg-rose-600 text-white font-black text-[10px] uppercase tracking-widest shadow-lg shadow-rose-200 hover:bg-rose-700 active:scale-95 transition-all">Sí, Eliminar</button>
                        </div>
                    </div>
                </div>
             )}

             {/* MODAL DE MIGRACIÓN */}
              {isMigrateModalOpen && (
                  <div className="fixed inset-0 z-[500] flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-md animate-fade-in">
                      <div className="bg-white w-full max-w-4xl max-h-[92vh] rounded-[2.25rem] shadow-2xl overflow-hidden border border-slate-200 flex flex-col">
                         <div className="bg-blue-600 text-white p-4 relative shrink-0">
                             <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-3">🚀 Migración de Estudiantes</h3>
                             <p className="text-[9px] text-blue-100 mt-1 uppercase font-bold tracking-widest">Ascenso Masivo de Grado y Sección</p>
                             <button onClick={() => setIsMigrateModalOpen(false)} className="absolute top-6 right-6 text-2xl hover:scale-110 transition-transform">✕</button>
                          </div>
                          <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar">
                              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                  {[
                                      { key: 'ascenso', icon: '⬆️', title: 'Ascenso', hint: 'Mismo grupo al grado superior', active: migMode === 'ascenso', activeClass: 'bg-blue-600 border-blue-600 text-white', idleClass: 'bg-slate-50 border-slate-200 text-slate-600', onClick: () => setMigMode('ascenso') },
                                      { key: 'fusion', icon: '🧩', title: 'Fusión', hint: 'Varias secciones a una sola', active: migMode === 'fusion', activeClass: 'bg-indigo-600 border-indigo-600 text-white', idleClass: 'bg-slate-50 border-slate-200 text-slate-600', onClick: () => { setMigMode('fusion'); setMigToSection('U'); } },
                                      { key: 'separacion', icon: '🪄', title: 'Separación', hint: 'Una sección en varias', active: migMode === 'separacion', activeClass: 'bg-emerald-600 border-emerald-600 text-white', idleClass: 'bg-slate-50 border-slate-200 text-slate-600', onClick: () => setMigMode('separacion') },
                                      { key: 'cambio_seccion', icon: '🔁', title: 'Cambio', hint: 'Mover entre secciones', active: migMode === 'cambio_seccion', activeClass: 'bg-amber-600 border-amber-600 text-white', idleClass: 'bg-slate-50 border-slate-200 text-slate-600', onClick: () => setMigMode('cambio_seccion') },
                                  ].map((modeCard) => (
                                      <button
                                          key={modeCard.key}
                                          onClick={modeCard.onClick}
                                          className={`rounded-2xl border px-3 py-3 transition-all text-left hover:-translate-y-0.5 ${modeCard.active ? `${modeCard.activeClass} shadow-lg` : modeCard.idleClass}`}
                                      >
                                          <div className="flex items-center gap-2">
                                              <span className="text-lg">{modeCard.icon}</span>
                                              <span className="text-[10px] font-black uppercase tracking-[0.14em]">{modeCard.title}</span>
                                          </div>
                                          <p className={`mt-2 text-[8px] font-bold uppercase tracking-[0.08em] ${modeCard.active ? 'text-white/85' : 'text-slate-400'}`}>{modeCard.hint}</p>
                                      </button>
                                  ))}
                              </div>

                              <div className="bg-slate-50 p-4 rounded-3xl border border-slate-200">
                                  <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">1. Grado y Sección Origen</h4>
                                  <div className="grid grid-cols-2 gap-4">
                                      <Select label="Grado Actual" name="mFromG" options={migrationSourceGrades} value={migFromGrade} onChange={e => { setMigFromGrade(e.target.value); setMigFromSection(''); }} />
                                      <Select label={migMode === 'fusion' ? 'Secciones Origen' : 'Sección Actual'} name="mFromS" options={migrationSourceSections} value={migMode === 'fusion' ? 'TODAS' : migFromSection} onChange={e => setMigFromSection(e.target.value)} disabled={!migFromGrade || migMode === 'fusion'} />
                                   </div>
                                    {migMode === 'fusion' && (
                                        <p className="mt-3 text-[9px] font-bold text-indigo-600 uppercase tracking-[0.1em]">Se migrarán todas las secciones existentes del grado origen al destino seleccionado.</p>
                                    )}
                                    {migMode === 'separacion' && (
                                        <p className="mt-3 text-[9px] font-bold text-emerald-600 uppercase tracking-[0.1em]">Selecciona la sección única origen y luego reparte manualmente a qué sección irá cada estudiante.</p>
                                    )}
                                    {migMode === 'cambio_seccion' && (
                                        <p className="mt-3 text-[9px] font-bold text-amber-600 uppercase tracking-[0.1em]">Selecciona estudiantes del mismo grado para moverlos a otra sección.</p>
                                    )}
                                </div>
                              <div className="flex justify-center -my-2 relative z-10">
                                  <div className="bg-white w-10 h-10 rounded-full border-2 border-blue-200 flex items-center justify-center shadow-lg text-lg">⬇️</div>
                              </div>
                               {migMode === 'separacion' && (
                                    <div className="bg-emerald-50/60 p-4 rounded-3xl border border-emerald-100">
                                        <h4 className="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-3">Destino de separación</h4>
                                        <div className="grid grid-cols-2 gap-3">
                                           <button
                                               type="button"
                                               onClick={() => setSeparationGradeScope('same')}
                                               className={`rounded-2xl px-3 py-2 text-[9px] font-black uppercase tracking-[0.12em] border transition-all ${separationGradeScope === 'same' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-500 border-slate-200'}`}
                                           >
                                               Mismo grado
                                           </button>
                                           <button
                                               type="button"
                                               onClick={() => setSeparationGradeScope('next')}
                                               className={`rounded-2xl px-3 py-2 text-[9px] font-black uppercase tracking-[0.12em] border transition-all ${separationGradeScope === 'next' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-500 border-slate-200'}`}
                                           >
                                               Grado superior
                                           </button>
                                        </div>
                                        <p className="mt-3 text-[8px] font-bold text-slate-500 uppercase tracking-[0.08em]">El sistema autoselecciona el mismo grado o el superior según corresponda.</p>
                                    </div>
                                )}
                                <div className="bg-blue-50/50 p-4 rounded-3xl border border-blue-100">
                                     <h4 className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-3">{migMode === 'separacion' ? '2. Grado destino y secciones a dividir' : '2. Nuevo Grado y Sección Destino'}</h4>
                                    <div className={`grid gap-4 ${migMode === 'separacion' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                         <Select label="Grado Destino" name="mToG" options={migrationTargetGrades} value={migToGrade} onChange={e => { setMigToGrade(e.target.value); setMigToSection(''); }} />
                                         {migMode !== 'separacion' && (
                                             <Select label="Sección Destino" name="mToS" options={migrationTargetSections.filter(option => migMode !== 'cambio_seccion' || normalizeText(option.value) !== normalizeText(migFromSection))} value={migToSection} onChange={e => setMigToSection(e.target.value)} disabled={!migToGrade} />
                                         )}
                                      </div>
                                     {migMode === 'separacion' && (
                                         <div className="mt-4 space-y-3">
                                             <div className="flex items-center justify-between gap-3">
                                                 <div>
                                                     <p className="text-[9px] font-black text-blue-500 uppercase tracking-[0.12em]">Secciones destino marcadas</p>
                                                     <p className="mt-1 text-[8px] font-bold text-slate-500 uppercase tracking-[0.08em]">Marca A, B, C o las que necesites. Luego puedes reajustar abajo estudiante por estudiante.</p>
                                                 </div>
                                                 <span className="text-[8px] font-bold text-slate-500 uppercase tracking-[0.08em]">{splitTargetSections.length} activas</span>
                                             </div>
                                             <div className="flex flex-wrap gap-2">
                                                 {separationTargetSections
                                                     .map((option) => {
                                                         const active = splitTargetSections.includes(option.value);
                                                         return (
                                                             <button
                                                                 key={option.value}
                                                                 type="button"
                                                                 onClick={() => handleToggleSplitTargetSection(option.value)}
                                                                 className={`px-3 py-1.5 rounded-xl border text-[9px] font-black uppercase tracking-[0.1em] transition-all ${active ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                                                             >
                                                                 {option.label}
                                                             </button>
                                                         );
                                                     })}
                                             </div>
                                             <p className="text-[8px] font-bold text-slate-500 uppercase tracking-[0.08em]">
                                                 {splitTargetSections.length < 2
                                                     ? 'Selecciona por lo menos dos secciones destino para habilitar la separación.'
                                                     : `La sección origen se repartirá entre ${splitTargetSections.length} secciones del ${separationGradeScope === 'same' ? 'mismo grado' : 'grado superior'}.`}
                                             </p>
                                         </div>
                                     )}
                                 </div>
                               {migMode === 'separacion' && (
                                    <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                                       <div className="flex items-center justify-between gap-4 mb-3">
                                           <div>
                                               <p className="text-[9px] font-black text-emerald-700 uppercase tracking-[0.14em]">Asignación manual de estudiantes</p>
                                               <p className="mt-1 text-[9px] font-bold text-slate-500 uppercase tracking-[0.1em]">{splitPreview.total} estudiante(s) para repartir</p>
                                           </div>
                                           <div className="text-right">
                                               {splitTargetSections.map((section) => (
                                                   <p key={section} className="text-[9px] font-black text-slate-700 uppercase tracking-[0.12em]">{section}: {splitPreview.counts[section] || 0}</p>
                                               ))}
                                           </div>
                                       </div>
                                       <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                                           {sourceStudentsForMigration.length === 0 ? (
                                               <div className="rounded-2xl border border-dashed border-emerald-200 bg-white/60 px-4 py-5 text-center text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">
                                                   Selecciona primero el grado y sección origen
                                               </div>
                                           ) : (
                                               sourceStudentsForMigration.map((student) => (
                                                   <div key={student.id} className="rounded-2xl border border-white/80 bg-white/80 px-3 py-2.5 flex items-center justify-between gap-3 shadow-sm">
                                                       <div className="min-w-0">
                                                           <p className="text-[10px] font-black uppercase text-slate-800 truncate">{student.name || '-'}</p>
                                                           <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.1em]">{student.dni || 'Sin DNI'}</p>
                                                       </div>
                                                        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                                                            {splitTargetSections.map((section) => (
                                                                <button
                                                                    key={section}
                                                                    type="button"
                                                                    onClick={() => handleSplitAssignmentChange(student.id, section)}
                                                                    className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-[0.1em] border transition-all ${splitAssignments[String(student.id)] === section ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                                                                >
                                                                    {section}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))
                                           )}
                                       </div>
                                   </div>
                                )}
                               {migMode === 'cambio_seccion' && (
                                   <div className="rounded-3xl border border-amber-200 bg-amber-50 px-4 py-4">
                                       <div className="flex items-center justify-between gap-4 mb-3">
                                           <div>
                                               <p className="text-[9px] font-black text-amber-700 uppercase tracking-[0.14em]">Selección de estudiantes</p>
                                               <p className="mt-1 text-[9px] font-bold text-slate-500 uppercase tracking-[0.1em]">{sectionChangePreviewCount} seleccionado(s) de {sourceStudentsForMigration.length}</p>
                                           </div>
                                           <div className="flex gap-2">
                                               <button type="button" onClick={() => setSectionChangeSelectedIds(sourceStudentsForMigration.map((student) => String(student.id)))} className="px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-[0.1em] border bg-white text-slate-600 border-slate-200">Todos</button>
                                               <button type="button" onClick={() => setSectionChangeSelectedIds([])} className="px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-[0.1em] border bg-white text-slate-600 border-slate-200">Ninguno</button>
                                           </div>
                                       </div>
                                       <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                                           {sourceStudentsForMigration.length === 0 ? (
                                               <div className="rounded-2xl border border-dashed border-amber-200 bg-white/60 px-4 py-5 text-center text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">
                                                   Selecciona primero el grado y sección origen
                                               </div>
                                           ) : (
                                               sourceStudentsForMigration.map((student) => {
                                                   const isSelected = sectionChangeSelectedIds.includes(String(student.id));
                                                   return (
                                                       <button
                                                           key={student.id}
                                                           type="button"
                                                           onClick={() => handleToggleSectionChangeStudent(student.id)}
                                                           className={`w-full rounded-2xl border px-3 py-2.5 flex items-center justify-between gap-3 text-left transition-all ${isSelected ? 'bg-amber-100 border-amber-300 shadow-sm' : 'bg-white/80 border-white/80 hover:bg-white'}`}
                                                       >
                                                           <div className="min-w-0">
                                                               <p className="text-[10px] font-black uppercase text-slate-800 truncate">{student.name || '-'}</p>
                                                               <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.1em]">{student.dni || 'Sin DNI'}</p>
                                                           </div>
                                                           <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center text-[9px] font-black shrink-0 ${isSelected ? 'bg-amber-600 border-amber-600 text-white' : 'bg-white border-slate-300 text-transparent'}`}>OK</div>
                                                       </button>
                                                   );
                                               })
                                           )}
                                       </div>
                                   </div>
                               )}
                                <div className="px-2">
                                    <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-center">
                                        <p className="text-[9px] font-black text-amber-700 uppercase tracking-[0.14em]">Vista previa de migración</p>
                                       <p className="mt-2 text-xs font-black text-slate-800">{migMode === 'cambio_seccion' ? sectionChangePreviewCount : migratePreviewCount} estudiante(s) en {migFromGrade || '-'} {migFromSection || '-'}</p>
                                       <p className="mt-1 text-[9px] font-bold text-slate-500 uppercase tracking-[0.1em]">{migMode === 'fusion' ? 'Se fusionarán todas las secciones del grado origen en el destino seleccionado' : migMode === 'separacion' ? `Se dividirá la sección origen entre ${splitTargetSections.length || 0} secciones del ${separationGradeScope === 'same' ? 'mismo grado' : 'grado superior'}` : migMode === 'cambio_seccion' ? 'Se moverán estudiantes seleccionados entre secciones del mismo grado' : 'Se actualizarán al destino seleccionado sin borrar el resto de datos'}</p>
                                       <p className="mt-2 text-[9px] font-black text-blue-700 uppercase tracking-[0.1em]">Si necesitas liberar un grado destino, usa primero la opción "Egresar promoción anterior"</p>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-slate-50 p-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
                                <button onClick={() => setIsMigrateModalOpen(false)} className="px-5 py-2 text-slate-400 font-black uppercase text-[9px] tracking-widest">Cancelar</button>
                              <button onClick={handleMigrate} disabled={!migFromGrade || (migMode !== 'fusion' && !migFromSection) || !migToGrade || (migMode !== 'separacion' && !migToSection) || (migMode === 'separacion' && splitTargetSections.length < 2)} className="btn-water water-blue px-8 py-2.5 rounded-2xl text-white font-black uppercase text-[10px] shadow-xl disabled:opacity-50">{migMode === 'fusion' ? 'Sincronizar Fusión' : migMode === 'separacion' ? 'Sincronizar Separación' : migMode === 'cambio_seccion' ? 'Sincronizar Cambio' : 'Sincronizar Migración'}</button>
                            </div>
                        </div>
                    </div>
                )}

              {isGraduateModalOpen && (
                  <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-fade-in">
                      <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-200">
                          <div className="bg-rose-600 text-white p-6 relative">
                              <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-3">🎓 Egresar Promoción Anterior</h3>
                              <p className="text-[10px] text-rose-100 mt-1 uppercase font-bold tracking-widest">Liberar grado o sección antes de promover</p>
                              <button onClick={() => setIsGraduateModalOpen(false)} className="absolute top-6 right-6 text-2xl hover:scale-110 transition-transform">✕</button>
                          </div>
                          <div className="p-8 space-y-6">
                              <div className="bg-rose-50 p-6 rounded-3xl border border-rose-100">
                                  <h4 className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-4">Selecciona qué promoción egresar</h4>
                                  <div className="grid grid-cols-2 gap-4">
                                      <Select label="Grado" name="graduateGrade" options={graduateGradeOptions} value={graduateGrade} onChange={e => { setGraduateGrade(e.target.value); setGraduateSection(''); }} />
                                      <Select label="Sección" name="graduateSection" options={[{ value: '', label: 'Todas' }, ...((studentSectionsByGrade[graduateGrade] || []).map(s => ({ value: s, label: s })))]} value={graduateSection} onChange={e => setGraduateSection(e.target.value)} disabled={!graduateGrade} />
                                  </div>
                                  <p className="mt-4 text-[10px] font-bold text-slate-500 uppercase tracking-[0.12em]">Solo aparece 5to grado porque es el único que corresponde egresar al cierre del año.</p>
                              </div>
                              <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-center">
                                  <p className="text-[10px] font-black text-amber-700 uppercase tracking-[0.18em]">Vista previa de egreso</p>
                                  <p className="mt-2 text-sm font-black text-slate-800">{graduatePreviewCount} estudiante(s) serán eliminados de {graduateGrade || '-'} {graduateSection || 'Todas las secciones'}</p>
                                  <p className="mt-1 text-[10px] font-bold text-slate-500 uppercase tracking-[0.12em]">Usa esto antes de promover al grado superior cuando ya no deben quedar estudiantes antiguos</p>
                              </div>
                          </div>
                          <div className="bg-slate-50 p-6 border-t border-slate-100 flex justify-end gap-4">
                              <button onClick={() => setIsGraduateModalOpen(false)} className="px-6 py-2 text-slate-400 font-black uppercase text-[10px] tracking-widest">Cancelar</button>
                              <button onClick={() => setIsGraduateConfirmOpen(true)} disabled={!graduateGrade || graduatePreviewCount === 0} className="px-10 py-3 rounded-2xl bg-rose-600 text-white font-black uppercase text-xs shadow-xl disabled:opacity-50">Egresar Promoción</button>
                          </div>
                      </div>
                  </div>
              )}

              {isGraduateConfirmOpen && (
                  <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/45 backdrop-blur-sm animate-fade-in p-4">
                      <div className="bg-white rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-slate-200 w-full max-w-md overflow-hidden animate-scale-in">
                          <div className="bg-rose-50 p-8 flex flex-col items-center text-center">
                              <div className="w-20 h-20 bg-rose-100 rounded-full flex items-center justify-center text-4xl mb-4 shadow-inner">🎓</div>
                              <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight leading-tight">¿Confirmar Egreso?</h3>
                              <p className="text-[10px] font-bold text-rose-600 uppercase tracking-widest mt-2 mb-4">Esta acción eliminará permanentemente la promoción anterior de SQL</p>
                              <div className="bg-white/80 border border-rose-200 px-6 py-4 rounded-2xl shadow-sm w-full text-center">
                                  <p className="text-sm font-black text-slate-700 uppercase italic">{graduateGrade} {graduateSection || 'Todas las secciones'}</p>
                                  <p className="mt-2 text-[10px] font-black text-slate-500 uppercase tracking-[0.14em]">{graduatePreviewCount} estudiante(s)</p>
                              </div>
                          </div>
                          <div className="p-6 bg-slate-50 flex gap-3 border-t border-slate-100">
                              <button onClick={() => setIsGraduateConfirmOpen(false)} className="flex-1 py-4 rounded-2xl bg-white border border-slate-200 text-slate-400 font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 hover:text-slate-600 transition-all">Cancelar</button>
                              <button onClick={handleGraduatePromotion} className="flex-1 py-4 rounded-2xl bg-rose-600 text-white font-black text-[10px] uppercase tracking-widest shadow-lg shadow-rose-200 hover:bg-rose-700 active:scale-95 transition-all">Sí, Egresar</button>
                          </div>
                      </div>
                  </div>
              )}

             <div className="bg-slate-900 text-white p-5 rounded-t-[2.5rem] flex justify-between items-center shadow-xl relative overflow-hidden">
                 <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-indigo-600"></div>
                 <div className="flex items-center gap-4">
                     <div className="bg-white/10 p-2.5 rounded-2xl border border-white/20 shadow-inner"><span className="text-2xl">👨‍🎓</span></div>
                     <div className="flex flex-col">
                        <h2 className="font-black text-2xl tracking-tight leading-none uppercase">Registro de Estudiantes</h2>
                        <span className="text-[10px] text-blue-400 font-black tracking-widest uppercase mt-1 italic">Consola de Datos Sincronizada SQL</span>
                     </div>
                 </div>
                 <div className="flex items-center gap-3">
                    {isAnyFilterActive && (
                        <button onClick={() => setFilters({ name: '', estado: '', group: '', email: '', microsoft: '', dni: '', nivel: '', sexo: '', edad: '' })} className="px-4 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all shadow-lg animate-pulse">Limpiar Filtros ×</button>
                    )}
                    <div className="text-right text-[10px] font-black uppercase text-slate-500 tracking-widest leading-none">Viendo: {filteredStudents.length} de {students.length}</div>
                 </div>
             </div>

             <div className="bg-white border-x border-b border-slate-200 px-5 py-4 shadow-sm mb-8 rounded-b-[2.5rem]">
                 <div className="flex flex-col gap-4">
                   <div className="grid grid-cols-12 gap-3 h-auto">
                    <div className="col-span-2">
                        <label className={commonLabelClass}>Nivel</label>
                        <select className={commonInputClass} value={formNivel} onChange={e => setFormNivel(e.target.value)}>
                            {NIVEL_OPTIONS.map(n => <option key={n.value} value={n.value}>{n.label}</option>)}
                        </select>
                    </div>
                    <div className="col-span-1">
                        <label className={commonLabelClass}>Grado</label>
                        <select className={commonInputClass} value={formGrade} onChange={e => { setFormGrade(e.target.value); setFormSection(''); }}>
                            <option value="">Todos</option>
                            {dynamicGrades.map(g => <option key={g.value} value={g.value}>{g.value}</option>)}
                        </select>
                    </div>
                    <div className="col-span-1">
                        <label className={commonLabelClass}>Secc.</label>
                        <select className={commonInputClass} value={formSection} onChange={e => setFormSection(e.target.value)} disabled={!formGrade}>
                            <option value="">Todas</option>
                            {dynamicSections.map(s => <option key={s.value} value={s.value}>{s.value}</option>)}
                        </select>
                    </div>

                    <div className="col-span-5">
                        <label className={commonLabelClass}>Apellidos y Nombres</label>
                        <input className={commonInputClass} placeholder="Nombre completo..." value={formName} onChange={e => setFormName(e.target.value)} />
                    </div>

                    <div className="col-span-1">
                        <label className={commonLabelClass}>DNI</label>
                        <input className={`${commonInputClass} text-center font-mono`} placeholder="00000000" maxLength={8} value={formDni} onChange={e => setFormDni(e.target.value.replace(/\D/g, ''))} />
                    </div>
                    
                    <div className="col-span-1">
                        <label className={commonLabelClass}>Sexo</label>
                        <select className={commonInputClass} value={formSexo} onChange={e => setFormSexo(e.target.value)}>
                            {SEX_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                    <div className="col-span-1">
                        <label className={commonLabelClass}>Edad</label>
                        <input className={`${commonInputClass} text-center font-mono ${formBirthDate ? 'bg-slate-100 text-slate-500' : ''}`} placeholder="00" maxLength={2} value={formEdad} readOnly={!!formBirthDate} title={formBirthDate ? 'Calculada automáticamente desde la fecha de nacimiento' : 'Editable porque no hay fecha de nacimiento'} onChange={e => setFormEdad(e.target.value.replace(/\D/g, ''))} />
                    </div>
                   </div>

                   <div className="grid grid-cols-12 gap-3 items-center">
                    <div className="col-span-3">
                        <label className={commonLabelClass}>Cuenta Gmail</label>
                        <input className={commonInputClass} placeholder="correo@gmail.com" value={formEmail} onChange={e => setFormEmail(e.target.value)} />
                    </div>
                    <div className="col-span-3">
                        <label className={commonLabelClass}>Cuenta Microsoft</label>
                        <input className={commonInputClass} placeholder="cuenta@microsoft.com" value={formMicrosoft} onChange={e => setFormMicrosoft(e.target.value)} />
                    </div>
                    <div className="col-span-1">
                        <label className={commonLabelClass}>Grupo</label>
                        <input className={`${commonInputClass} text-center uppercase`} placeholder="A..." value={formGroup} onChange={e => setFormGroup(e.target.value)} />
                    </div>
                    <div className="col-span-2">
                        <label className={commonLabelClass}>F. Nacimiento</label>
                        <input className={commonInputClass} type="date" value={formBirthDate} onChange={e => { const value = normalizeBirthDate(e.target.value); setFormBirthDate(value); setFormEdad(calculateAgeFromBirthDate(value)); }} />
                    </div>
                    <div className="col-span-3 flex justify-end gap-2 border-l pl-4 border-slate-100">
                         <button onClick={handleAddStudent} title="Registrar Estudiante" className="btn-3d-orange scale-75">
                             <span>+</span>
                         </button>
                         <button onClick={() => fileInputRef.current?.click()} title="Importar Excel" className="btn-3d-darkgreen scale-75">
                             <span>📗</span>
                         </button>
                         <button onClick={() => setIsGraduateModalOpen(true)} title="Egresar Promoción Anterior" className="btn-3d-grey scale-75">
                             <span>🎓</span>
                         </button>
                         <button onClick={() => setIsMigrateModalOpen(true)} title="Migración Masiva" className="btn-3d-purple scale-75">
                             <span>🚀</span>
                         </button>
                         <button onClick={handleClearForm} title="Limpiar Formulario" className="btn-3d-clear scale-75">
                             <span>🧹</span>
                         </button>
                         <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls,.xlsm" onChange={handleImportExcel} />
                    </div>
                   </div>
                 </div>
             </div>

             <div className="bg-white rounded-[2.5rem] shadow-2xl border border-slate-200 overflow-hidden" ref={tableContainerRef}>
                 {hiddenColumns.length > 0 ? (
                     <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[8px] font-black uppercase tracking-wide text-slate-500">
                         <span className="mr-1">Columnas ocultas:</span>
                         {hiddenColumns.map((column) => (
                             <button key={column} type="button" onClick={() => setColumnHidden(column, false)} className="rounded-full border border-slate-200 bg-white px-2 py-1 text-blue-600 hover:border-blue-300 hover:bg-blue-50">
                                 + {STUDENT_TABLE_COLUMNS.find((item) => item.key === column)?.label}
                             </button>
                         ))}
                         <button type="button" onClick={() => { setHiddenColumns([]); window.localStorage.setItem(STUDENT_COLUMN_STORAGE_KEY, '[]'); }} className="ml-auto rounded-full bg-slate-900 px-2.5 py-1 text-white">Mostrar todas</button>
                     </div>
                 ) : null}
                 <div className="overflow-x-auto">
                 <table className="w-full text-[11px] text-left border-collapse table-fixed">
                     <thead className="bg-slate-900 text-white text-[10px] uppercase font-black tracking-widest">
                         <tr className="divide-x divide-white">
                             <th className={`py-1 px-3 w-10 text-center relative ${columnClass('number')}`}>N°<HideColumnButton column="number" /></th>
                             <th className={`py-1 px-3 w-20 text-center relative filter-trigger ${columnClass('nivel')}`}>
                                 <HideColumnButton column="nivel" />
                                 <div className="flex items-center justify-center gap-1 cursor-pointer hover:text-blue-400 transition-colors" onClick={(e) => { e.stopPropagation(); setActiveFilterField(activeFilterField === 'nivel' ? null : 'nivel'); }}>
                                     <span>NIVEL</span>
                                     <div className="relative"><span className={`text-[8px] ${filters.nivel ? 'text-blue-400' : 'opacity-40'}`}>🔍</span></div>
                                 </div>
                                 {activeFilterField === 'nivel' && <FilterInput field="nivel" placeholder="Prim/Sec..." />}
                             </th>
                             <th className={`py-1 px-3 w-14 text-center relative filter-trigger ${columnClass('estado')}`}>
                                 <HideColumnButton column="estado" />
                                 <div className="flex items-center justify-center gap-1 cursor-pointer hover:text-blue-400 transition-colors" onClick={(e) => { e.stopPropagation(); setActiveFilterField(activeFilterField === 'estado' ? null : 'estado'); }}>
                                     <span>EST.</span>
                                     <div className="relative"><span className={`text-[8px] ${filters.estado ? 'text-blue-400' : 'opacity-40'}`}>🔍</span></div>
                                 </div>
                                 {activeFilterField === 'estado' && <FilterInput field="estado" placeholder="A, R, T..." />}
                             </th>
                             <th className={`py-1 px-3 w-64 relative filter-trigger ${columnClass('name')}`}>
                                 <HideColumnButton column="name" />
                                 <div className="flex items-center justify-between cursor-pointer hover:text-blue-400 transition-colors" onClick={(e) => { e.stopPropagation(); setActiveFilterField(activeFilterField === 'name' ? null : 'name'); }}>
                                     <span>ESTUDIANTE</span>
                                     <div className="relative"><span className={`text-[8px] ${filters.name ? 'text-blue-400' : 'opacity-40'}`}>🔍</span></div>
                                 </div>
                                 {activeFilterField === 'name' && <FilterInput field="name" placeholder="Nombre..." />}
                             </th>
                             <th className={`py-1 px-3 w-12 text-center relative filter-trigger ${columnClass('sexo')}`}>
                                 <HideColumnButton column="sexo" />
                                 <div className="flex items-center justify-center gap-1 cursor-pointer hover:text-blue-400 transition-colors" onClick={(e) => { e.stopPropagation(); setActiveFilterField(activeFilterField === 'sexo' ? null : 'sexo'); }}>
                                     <span>S</span>
                                     <div className="relative"><span className={`text-[8px] ${filters.sexo ? 'text-blue-400' : 'opacity-40'}`}>🔍</span></div>
                                 </div>
                                 {activeFilterField === 'sexo' && <FilterInput field="sexo" placeholder="M/F..." />}
                             </th>
                             <th className={`py-1 px-3 w-20 text-center relative filter-trigger ${columnClass('dni')}`}>
                                 <HideColumnButton column="dni" />
                                 <div className="flex items-center justify-center gap-1 cursor-pointer hover:text-blue-400 transition-colors" onClick={(e) => { e.stopPropagation(); setActiveFilterField(activeFilterField === 'dni' ? null : 'dni'); }}>
                                     <span>DNI</span>
                                     <div className="relative"><span className={`text-[8px] ${filters.dni ? 'text-blue-400' : 'opacity-40'}`}>🔍</span></div>
                                 </div>
                                 {activeFilterField === 'dni' && <FilterInput field="dni" placeholder="DNI..." />}
                             </th>
                             <th className={`py-1 px-3 w-45 relative filter-trigger ${columnClass('email')}`}>
                                 <HideColumnButton column="email" />
                                 <div className="flex items-center justify-between cursor-pointer hover:text-blue-400 transition-colors" onClick={(e) => { e.stopPropagation(); setActiveFilterField(activeFilterField === 'email' ? null : 'email'); }}>
                                     <span>GMAIL</span>
                                     <div className="relative"><span className={`text-[8px] ${filters.email ? 'text-blue-400' : 'opacity-40'}`}>🔍</span></div>
                                 </div>
                                 {activeFilterField === 'email' && <FilterInput field="email" placeholder="Gmail..." />}
                             </th>
                             <th className={`py-1 px-3 w-45 relative filter-trigger ${columnClass('microsoft')}`}>
                                 <HideColumnButton column="microsoft" />
                                 <div className="flex items-center justify-between cursor-pointer hover:text-blue-400 transition-colors" onClick={(e) => { e.stopPropagation(); setActiveFilterField(activeFilterField === 'microsoft' ? null : 'microsoft'); }}>
                                     <span>MICROSOFT</span>
                                     <div className="relative"><span className={`text-[8px] ${filters.microsoft ? 'text-blue-400' : 'opacity-40'}`}>🔍</span></div>
                                 </div>
                                 {activeFilterField === 'microsoft' && <FilterInput field="microsoft" placeholder="Outlook..." />}
                             </th>
                             <th className={`py-1 px-3 w-32 text-center relative ${columnClass('birthDate')}`}>F. NAC.<HideColumnButton column="birthDate" /></th>
                             <th className={`py-1 px-3 w-16 text-center relative ${columnClass('group')}`}>GRUPO<HideColumnButton column="group" /></th>
                             <th className={`py-1 px-2 w-12 text-center relative ${columnClass('age')}`}>EDAD<HideColumnButton column="age" /></th>
                             <th className={`py-1 px-2 w-32 text-center relative ${columnClass('password')}`}>CLAVE PORTAL<HideColumnButton column="password" /></th>
                         </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-100">
                         {filteredStudents.length === 0 ? (
                             <tr><td colSpan={visibleColumnCount} className="p-20 text-center text-slate-400 font-bold bg-slate-50 italic uppercase tracking-widest text-[9px]">Sin registros encontrados</td></tr>
                         ) : (
                             filteredStudents.map((student, index) => {
                                 const isSaving = savingStudentIds.includes(student.id);
                                 return (
                                     <tr key={student.id} onClick={() => setSelectedStudentId(student.id)} className={getRowStyle(student) + " h-[18px]"}>
                                         {/* 
                                             -------------------------------------------------------------------------
                                             🛠️ CONTROL DE ALTURA DE FILAS (ULTRA-COMPACTO):
                                             1. 'py-0' en los <td>: Elimina todo el espacio vertical extra.
                                             2. 'h-[18px]' en <tr> y <td>: Fuerza físicamente la altura de la fila.
                                             3. 'h-full', 'leading-none' y 'appearance-none' en controles: Ajusta el contenido al espacio.
                                             -------------------------------------------------------------------------
                                         */}
                                         <td className={`py-0 px-2 text-center font-black opacity-30 border-r border-slate-100/10 select-none cursor-default h-[18px] ${columnClass('number')}`}>
                                             <span className="leading-none block h-full flex items-center justify-center gap-1">
                                                 <span>{index + 1}</span>
                                                 {isSaving ? <span className="text-[8px] text-amber-500">●</span> : null}
                                             </span>
                                         </td>
                                         <td className={`py-0 px-2 border-r border-slate-100/10 h-[18px] ${columnClass('nivel')}`}>
                                             <select className="w-full bg-transparent border-0 font-bold outline-none text-[9px] py-0 h-full leading-none m-0 appearance-none" value={student.nivel || 'Secundaria'} onChange={e => handleStudentUpdate(student.id, 'nivel', e.target.value)}>
                                                {NIVEL_OPTIONS.map(n => <option key={n.value} value={n.value}>{n.label}</option>)}
                                             </select>
                                         </td>
                                         <td className={`py-0 px-2 text-center font-black border-r border-slate-100/10 h-[18px] ${columnClass('estado')}`}>
                                             <span className={`px-1.5 py-0 rounded text-[8px] border border-white/20 leading-none inline-block ${student.estado === 'A' ? 'bg-emerald-500 text-white border-emerald-400' : (student.estado ? 'bg-white/20' : 'text-slate-300')}`}>
                                                 {student.estado || '-'}
                                             </span>
                                         </td>
                                         <td className={`py-0 px-3 border-r border-slate-100/10 h-[18px] ${columnClass('name')}`}>
                                             <input className={`w-full bg-transparent border-0 font-bold outline-none focus:bg-white/60 rounded px-1 transition-all py-0 h-full leading-none m-0`} value={student.name || ''} onChange={e => handleStudentUpdate(student.id, 'name', e.target.value)} />
                                         </td>
                                         <td className={`py-0 px-1 border-r border-slate-100/10 text-center h-[18px] ${columnClass('sexo')}`}>
                                             <select className="w-full bg-transparent border-0 font-black outline-none text-center text-[10px] py-0 h-full leading-none m-0 appearance-none" value={student.sexo || 'M'} onChange={e => handleStudentUpdate(student.id, 'sexo', e.target.value)}>
                                                {SEX_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                             </select>
                                         </td>
                                         <td className={`py-0 px-2 text-center border-r border-slate-100/10 h-[18px] ${columnClass('dni')}`}>
                                             <input className={`w-full bg-transparent border-0 text-center font-mono outline-none focus:bg-white/60 rounded px-1 transition-all py-0 h-full leading-none m-0`} value={student.dni || ''} maxLength={8} onChange={e => handleStudentUpdate(student.id, 'dni', e.target.value)} placeholder="0000..." />
                                         </td>
                                         <td className={`py-0 px-3 border-r border-slate-100/10 h-[18px] ${columnClass('email')}`}>
                                             <input className={`w-full bg-transparent border-0 font-medium outline-none focus:bg-white/60 rounded px-1 transition-all py-0 h-full leading-none m-0`} value={student.email || ''} onChange={e => handleStudentUpdate(student.id, 'email', e.target.value)} placeholder="gmail..." />
                                         </td>
                                         <td className={`py-0 px-3 border-r border-slate-100/10 h-[18px] ${columnClass('microsoft')}`}>
                                             <input className={`w-full bg-transparent border-0 font-medium outline-none focus:bg-white/60 rounded px-1 transition-all py-0 h-full leading-none m-0`} value={student.microsoft || ''} onChange={e => handleStudentUpdate(student.id, 'microsoft', e.target.value)} placeholder="outlook..." />
                                         </td>
                                         <td className={`py-0 px-2 text-center border-r border-slate-100/10 h-[18px] ${columnClass('birthDate')}`}>
                                             <input className="w-full bg-transparent border-0 text-center font-bold outline-none py-0 h-full leading-none m-0" type="date" value={student.fechaNacimiento || ''} onChange={e => handleStudentUpdate(student.id, 'fechaNacimiento', e.target.value)} />
                                         </td>
                                         <td className={`py-0 px-2 text-center border-r border-slate-100/10 h-[18px] ${columnClass('group')}`}>
                                             <input className="w-full bg-transparent border-0 text-center font-black uppercase outline-none py-0 h-full leading-none m-0" value={student.group || ''} onChange={e => handleStudentUpdate(student.id, 'group', e.target.value.toUpperCase())} placeholder="-" />
                                         </td>
                                         <td className={`py-0 px-1 text-center border-r border-slate-100/10 h-[18px] ${columnClass('age')}`}>
                                             <input className={`w-full bg-transparent border-0 text-center font-black outline-none py-0 h-full leading-none m-0 ${student.fechaNacimiento ? 'text-slate-500' : ''}`} value={String(student.edad || '')} maxLength={2} readOnly={!!student.fechaNacimiento} title={student.fechaNacimiento ? 'Edad calculada automáticamente' : 'Editable porque no hay fecha de nacimiento'} onChange={e => handleStudentUpdate(student.id, 'edad', e.target.value)} placeholder="-" />
                                         </td>
                                         <td className={`py-0 px-1 text-center h-[18px] ${columnClass('password')}`} onClick={(event) => event.stopPropagation()}>
                                             <div className="flex items-center justify-center gap-1">
                                                 {student.portalPasswordConfigured ? (
                                                     <span className="text-[8px] font-black text-slate-500" title="La contraseña personal está protegida y no puede descifrarse.">Protegida</span>
                                                 ) : (
                                                     <code className="min-w-[58px] text-[9px] font-black tracking-wide">
                                                         {visiblePasswordIds.includes(student.id) ? (student.dni || 'Sin DNI') : '••••••••'}
                                                     </code>
                                                 )}
                                                 {!student.portalPasswordConfigured ? (
                                                     <button
                                                         type="button"
                                                         onClick={() => setVisiblePasswordIds((current) => current.includes(student.id)
                                                             ? current.filter((id) => id !== student.id)
                                                             : [...current, student.id])}
                                                         className="rounded border border-slate-200 bg-white/80 px-1.5 py-0.5 text-[7px] font-black uppercase text-slate-600 hover:bg-white"
                                                         title={visiblePasswordIds.includes(student.id) ? 'Ocultar clave inicial' : 'Ver clave inicial'}
                                                     >
                                                         {visiblePasswordIds.includes(student.id) ? 'Ocultar' : 'Ver'}
                                                     </button>
                                                 ) : null}
                                                 <button
                                                     type="button"
                                                     disabled={testingPortalIds.includes(student.id)}
                                                     onClick={() => { void handleOpenStudentPortalTest(student); }}
                                                     className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[7px] font-black uppercase text-blue-700 hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60"
                                                     title="Abrir el portal como este estudiante durante diez minutos, sin cambiar su contraseña"
                                                 >
                                                     {testingPortalIds.includes(student.id) ? '…' : 'Probar'}
                                                 </button>
                                                 <button
                                                     type="button"
                                                     disabled={resettingPasswordIds.includes(student.id)}
                                                     onClick={() => { void handleResetPortalPassword(student); }}
                                                     className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-amber-200 bg-amber-50 text-[9px] font-black leading-none text-amber-700 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
                                                     title="Restablecer la clave al DNI del estudiante"
                                                     aria-label="Restablecer clave al DNI"
                                                 >
                                                     {resettingPasswordIds.includes(student.id) ? '…' : '↺'}
                                                 </button>
                                             </div>
                                         </td>
                                     </tr>
                                 );
                             })
                         )}
                     </tbody>
                 </table>
                 </div>
                 <div className="bg-slate-50 p-3 border-t border-slate-100 flex justify-between items-center text-[9px] font-black text-slate-400 uppercase tracking-widest shadow-inner">
                     <div className="flex gap-4">
                        <div className="flex items-center gap-1.5"><span className="w-2 h-2 bg-emerald-500 rounded-sm"></span> A: Activo</div>
                        <div className="flex items-center gap-1.5"><span className="w-2 h-2 bg-slate-900 rounded-sm"></span> R: Retirado</div>
                        <div className="flex items-center gap-1.5"><span className="w-2 h-2 bg-purple-600 rounded-sm"></span> T: Trasladado</div>
                     </div>
                     <div className="italic text-blue-600 bg-blue-50/50 px-3 py-1 rounded-full border border-blue-100 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
                        SQL Sincronizado - Gestión de Datos Estudiantiles
                     </div>
                 </div>
             </div>
        </div>
    );
};
