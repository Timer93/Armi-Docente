import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import QRCode from 'qrcode';
import { closeRemoteCameraSession, createRemoteCameraSession, deleteFaceProfile, getAttendanceRecords, getFaceProfiles, getRemoteCameraSessionFrame, resetStudentFaceProfiles, saveAttendanceRecord, saveFaceProfile } from '../../services/apiService';
import { AttendanceRecord, FaceProfile, GeneralData, ScheduleEntry, Student, TeachingAssignment } from '../../types';

interface Props {
  students: Student[];
  assignments: TeachingAssignment[];
  generalData: GeneralData;
  showToast: (msg: string, type: 'error' | 'success') => void;
}

type HumanInstance = any;
type RemoteCameraSession = {
  sessionId: string;
  phoneUrl: string;
  lanAddresses: string[];
  createdAt: string;
};

const HUMAN_MODEL_BASE = 'https://cdn.jsdelivr.net/npm/@vladmandic/human/models';
const MATCH_THRESHOLD = 0.58;
const SAMPLE_TARGET = 5;
const ENROLLMENT_STEPS = [
  { id: 'frente', label: 'Mira al frente' },
  { id: 'izquierda', label: 'Gira levemente a la izquierda' },
  { id: 'derecha', label: 'Gira levemente a la derecha' },
  { id: 'frente_2', label: 'Vuelve al frente' },
  { id: 'arriba', label: 'Levanta un poco el rostro' },
];

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
};

const shiftIsoDays = (dateStr: string, delta: number) => {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  if ([year, month, day].some(Number.isNaN)) return '';
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + delta);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const normalize = (value: string | number | undefined | null) => String(value || '').trim().toLowerCase();
const dayNames: Record<number, string> = {
  0: 'DOMINGO',
  1: 'LUNES',
  2: 'MARTES',
  3: 'MIERCOLES',
  4: 'JUEVES',
  5: 'VIERNES',
  6: 'SABADO',
};
const shortDayNames: Record<number, string> = {
  0: 'do',
  1: 'lu',
  2: 'ma',
  3: 'mi',
  4: 'ju',
  5: 'vi',
  6: 'sa',
};

const normalizeDay = (value: string) => normalize(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase();

const toMinutes = (value: string) => {
  const [hh, mm] = String(value || '').split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
};

const getCurrentHourIndex = (config: any, now: Date) => {
  const startMinutes = toMinutes(config?.startTime || '');
  const classDuration = Number(config?.classDuration || 0);
  const totalHours = Number(config?.totalHours || 0);
  if (startMinutes === null || classDuration <= 0 || totalHours <= 0) return null;
  const breaks = Array.isArray(config?.breaks) ? config.breaks : [];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  let cursor = startMinutes;
  for (let hour = 1; hour <= totalHours; hour += 1) {
    const hourStart = cursor;
    const hourEnd = hourStart + classDuration;
    if (currentMinutes >= hourStart && currentMinutes < hourEnd) return hour;
    cursor = hourEnd;
    const breakInfo = breaks.find((item: any) => Number(item?.afterHour) === hour);
    if (breakInfo) {
      cursor += Number(breakInfo.duration || 0);
      if (currentMinutes >= hourEnd && currentMinutes < cursor) return null;
    }
  }
  return null;
};

const toIsoDate = (value?: string) => {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};

const compareIso = (a: string, b: string) => a.localeCompare(b);

const isBetweenIso = (value: string, start: string, end: string) => compareIso(value, start) >= 0 && compareIso(value, end) <= 0;

const overlapRange = (aStart: string, aEnd: string, bStart: string, bEnd: string) => compareIso(aStart, bEnd) <= 0 && compareIso(aEnd, bStart) <= 0;

const formatShortDate = (iso: string) => {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' });
};

const formatLongDate = (iso: string) => {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const resolveStudentRowTone = (student: Student) => {
  const estado = normalize(String(student.estado || ''));
  if (estado === 'r' || estado.includes('retir')) return 'bg-black text-white';
  if (estado === 't' || estado.includes('traslad')) return 'bg-violet-700 text-white';
  if (estado === 'na' || estado.includes('no asiste')) return 'bg-red-700 text-white';
  return '';
};

const getStatusGlyph = (status?: string) => {
  switch (String(status || '').toUpperCase()) {
    case 'P': return 'âœ“';
    case 'F': return 'âœ•';
    case 'T': return 'â°';
    case 'J': return 'â—Œ';
    default: return '';
  }
};

const getStatusTone = (status?: string) => {
  switch (String(status || '').toUpperCase()) {
    case 'P': return 'text-emerald-700';
    case 'F': return 'text-rose-700';
    case 'T': return 'text-amber-700';
    case 'J': return 'text-violet-700';
    default: return 'text-slate-300';
  }
};

const getStatusDisplayGlyph = (status?: string) => {
  switch (String(status || '').toUpperCase()) {
    case 'P': return '✓';
    case 'F': return '✗';
    case 'T': return '⌛';
    case 'J': return '✏️';
    default: return '';
  }
};

const getStatusBadgeTone = (status?: string) => {
  switch (String(status || '').toUpperCase()) {
    case 'P': return 'bg-emerald-100 text-emerald-800';
    case 'F': return 'bg-rose-100 text-rose-800';
    case 'T': return 'bg-amber-100 text-amber-800';
    case 'J': return 'bg-violet-100 text-violet-800';
    default: return 'bg-transparent text-transparent';
  }
};

const parseDescriptor = (value?: string) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => Number(item || 0)) : null;
  } catch {
    return null;
  }
};

const cosineSimilarity = (a: number[], b: number[]) => {
  if (!a.length || !b.length || a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const div = Math.sqrt(normA) * Math.sqrt(normB);
  return div ? dot / div : -1;
};

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const getFriendlyStudentName = (fullName: string) => {
  const raw = String(fullName || '').trim();
  if (!raw) return 'estudiante';
  const afterComma = raw.includes(',') ? raw.split(',')[1] : raw;
  const tokens = afterComma.trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 0) return tokens[0];
  const fallback = raw.split(/\s+/).filter(Boolean);
  return fallback[0] || 'estudiante';
};

const getWelcomeSpeech = (student: Student) => {
  const friendlyName = getFriendlyStudentName(student.name);
  const sexo = normalize(student.sexo);
  if (sexo.startsWith('f') || sexo.includes('mujer')) return `Bienvenida ${friendlyName}`;
  if (sexo.startsWith('m') || sexo.includes('hombre') || sexo.includes('varon')) return `Bienvenido ${friendlyName}`;
  return `Hola ${friendlyName}`;
};

const speakMessage = (message: string) => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(message);
    utter.lang = 'es-PE';
    utter.rate = 0.98;
    utter.pitch = 1;
    window.speechSynthesis.speak(utter);
  } catch {
    // Optional UX enhancement only.
  }
};

export const AttendanceSection: React.FC<Props> = ({ students, assignments, generalData, showToast }) => {
  const [areaId, setAreaId] = useState('');
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [date, setDate] = useState(todayIso());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [historyRecords, setHistoryRecords] = useState<AttendanceRecord[]>([]);
  const [profiles, setProfiles] = useState<FaceProfile[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [guidedMode, setGuidedMode] = useState(false);
  const [recognitionMode, setRecognitionMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'registro' | 'base' | 'control'>('registro');
  const [guidedStudentId, setGuidedStudentId] = useState('');
  const [guidedStep, setGuidedStep] = useState(0);
  const [capturePhase, setCapturePhase] = useState<'idle' | 'detecting' | 'saving' | 'completed'>('idle');
  const [captureGallery, setCaptureGallery] = useState<Array<{ stepLabel: string; imageData: string }>>([]);
  const [attemptPreview, setAttemptPreview] = useState<string>('');
  const [statusText, setStatusText] = useState('Selecciona grado y seccion para comenzar.');
  const [lastRecognized, setLastRecognized] = useState('');
  const [faceHint, setFaceHint] = useState('Detección facial no iniciada.');
  const [detectorStats, setDetectorStats] = useState('Sin lectura facial aun.');
  const [expandedBimesterView, setExpandedBimesterView] = useState(false);
  const [highlightedAttendanceStudentId, setHighlightedAttendanceStudentId] = useState('');
  const [cameraSource, setCameraSource] = useState<'local' | 'remote'>('local');
  const [remoteSession, setRemoteSession] = useState<RemoteCameraSession | null>(null);
  const [remoteFrameData, setRemoteFrameData] = useState('');
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [remoteLastFrameAt, setRemoteLastFrameAt] = useState('');
  const [remoteQrDataUrl, setRemoteQrDataUrl] = useState('');
  const [ipCameraUrl, setIpCameraUrl] = useState(() => {
    try {
      return localStorage.getItem('armi_ip_camera_url') || 'http://192.168.0.100:4747/video';
    } catch {
      return 'http://192.168.0.100:4747/video';
    }
  });
  const [remoteStreamEnabled, setRemoteStreamEnabled] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const remoteImageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const humanRef = useRef<HumanInstance | null>(null);
  const recognitionTimerRef = useRef<number | null>(null);
  const enrollmentTimerRef = useRef<number | null>(null);
  const remotePollingRef = useRef<number | null>(null);
  const recognitionBusyRef = useRef(false);
  const enrollmentBusyRef = useRef(false);
  const recentRecognitionRef = useRef<Record<string, number>>({});
  const mountedRef = useRef(true);
  const guidedActiveRef = useRef(false);
  const manualSelectionRef = useRef(false);
  const scheduleEntries = useMemo<ScheduleEntry[]>(() => {
    try {
      const raw = localStorage.getItem('armi_schedule_entries');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }, []);
  const calendarMap = useMemo<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem('armi_calendar_state');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);
  const holidays = useMemo<Array<{ id?: string; mmdd?: string; name?: string; type?: string }>>(() => {
    try {
      const raw = localStorage.getItem('armi_holidays_v7');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }, []);

  const proxiedIpCameraUrl = useMemo(() => {
    const value = String(ipCameraUrl || '').trim();
    if (!value || !remoteStreamEnabled) return '';
    return `/api/ip-camera/proxy?url=${encodeURIComponent(value)}`;
  }, [ipCameraUrl, remoteStreamEnabled]);

  useEffect(() => {
    if (cameraSource !== 'remote') return;
    if (remoteConnected) {
      setCameraReady(true);
      setFaceHint('Celular conectado por Wi-Fi mediante app IP. El video remoto ya puede usarse para reconocimiento facial.');
    }
  }, [cameraSource, remoteConnected]);

  useEffect(() => {
    try {
      localStorage.setItem('armi_ip_camera_url', ipCameraUrl);
    } catch {
      // Optional persistence only.
    }
  }, [ipCameraUrl]);

  useEffect(() => {
    let cancelled = false;
    const buildQr = async () => {
      if (!remoteSession?.phoneUrl) {
        setRemoteQrDataUrl('');
        return;
      }
      try {
        const qr = await QRCode.toDataURL(remoteSession.phoneUrl, {
          width: 220,
          margin: 1,
          color: {
            dark: '#16315f',
            light: '#ffffff',
          },
        });
        if (!cancelled) setRemoteQrDataUrl(qr);
      } catch {
        if (!cancelled) setRemoteQrDataUrl('');
      }
    };
    buildQr();
    return () => {
      cancelled = true;
    };
  }, [remoteSession]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      guidedActiveRef.current = false;
      if (recognitionTimerRef.current) window.clearInterval(recognitionTimerRef.current);
      if (enrollmentTimerRef.current) window.clearTimeout(enrollmentTimerRef.current);
      if (remotePollingRef.current) window.clearInterval(remotePollingRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const areaOptions = useMemo(() => {
    const seen = new Map<string, { value: string; label: string }>();
    assignments.forEach((item) => {
      const value = String(item.areaId || '').trim();
      const label = String(item.areaName || item.areaId || '').trim();
      if (!value || seen.has(value)) return;
      seen.set(value, { value, label });
    });
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [assignments]);

  const gradeOptions = useMemo(() => {
    const uniq = new Set<string>();
    assignments
      .filter((item) => !areaId || normalize(item.areaId) === normalize(areaId) || normalize(item.areaName) === normalize(areaId))
      .forEach((item) => item.grade && uniq.add(String(item.grade).trim()));
    students.forEach((item) => item.grade && uniq.add(String(item.grade).trim()));
    return Array.from(uniq).sort();
  }, [areaId, assignments, students]);

  const sectionOptions = useMemo(() => {
    if (!grade) return [];
    const uniq = new Set<string>();
    assignments
      .filter((item) => normalize(item.grade) === normalize(grade))
      .filter((item) => !areaId || normalize(item.areaId) === normalize(areaId) || normalize(item.areaName) === normalize(areaId))
      .forEach((item) => item.section && uniq.add(String(item.section).trim()));
    students.filter((item) => normalize(item.grade) === normalize(grade)).forEach((item) => item.section && uniq.add(String(item.section).trim()));
    return Array.from(uniq).sort();
  }, [areaId, assignments, grade, students]);

  const activeStudents = useMemo(() => (
    students
      .filter((item) => normalize(item.grade) === normalize(grade) && normalize(item.section) === normalize(section))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  ), [students, grade, section]);
  const currentAssignment = useMemo(() => assignments.find((item) => normalize(item.areaId) === normalize(areaId) && normalize(item.grade) === normalize(grade) && normalize(item.section) === normalize(section)) || null, [areaId, assignments, grade, section]);

  const attendanceMap = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    records.forEach((item) => map.set(String(item.studentId), item));
    return map;
  }, [records]);
  const historyAttendanceMap = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    historyRecords.forEach((item) => map.set(`${item.studentId}__${item.attendanceDate}`, item));
    return map;
  }, [historyRecords]);

  const profileCountMap = useMemo(() => {
    const map = new Map<string, number>();
    profiles.forEach((item) => {
      const key = String(item.studentId);
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [profiles]);

  const selectedStudent = useMemo(() => activeStudents.find((item) => String(item.id) === String(selectedStudentId)) || null, [activeStudents, selectedStudentId]);
  const selectedStudentProfiles = useMemo(() => profiles.filter((item) => String(item.studentId) === String(selectedStudentId)), [profiles, selectedStudentId]);
  const pendingStudents = useMemo(() => activeStudents.filter((item) => (profileCountMap.get(String(item.id)) || 0) < SAMPLE_TARGET), [activeStudents, profileCountMap]);

  const stats = useMemo(() => {
    const total = activeStudents.length;
    const present = activeStudents.filter((item) => attendanceMap.get(String(item.id))?.status === 'P').length;
    const tardy = activeStudents.filter((item) => attendanceMap.get(String(item.id))?.status === 'T').length;
    const base = activeStudents.filter((item) => (profileCountMap.get(String(item.id)) || 0) >= SAMPLE_TARGET).length;
    return { total, present, tardy, base };
  }, [activeStudents, attendanceMap, profileCountMap]);
  const bimesterMeta = useMemo(() => {
    const selected = toIsoDate(date);
    const ranges = [
      { id: 'I', start: toIsoDate(generalData.b1_start), end: toIsoDate(generalData.b1_end), unitNumbers: [1, 2] },
      { id: 'II', start: toIsoDate(generalData.b2_start), end: toIsoDate(generalData.b2_end), unitNumbers: [3, 4] },
      { id: 'III', start: toIsoDate(generalData.b3_start), end: toIsoDate(generalData.b3_end), unitNumbers: [5, 6] },
      { id: 'IV', start: toIsoDate(generalData.b4_start), end: toIsoDate(generalData.b4_end), unitNumbers: [7, 8] },
    ].filter((item) => item.start && item.end);
    const found = ranges.find((item) => selected && isBetweenIso(selected, item.start, item.end));
    return found || ranges[0] || null;
  }, [date, generalData]);
  const bimesterUnits = useMemo(() => {
    if (!bimesterMeta) return [];
    return bimesterMeta.unitNumbers.map((unitNumber, index, arr) => {
      const rawStart = toIsoDate((generalData as any)[`u${unitNumber}_start`]);
      const rawEnd = toIsoDate((generalData as any)[`u${unitNumber}_end`]);
      const nextUnit = arr[index + 1];
      const prevUnit = arr[index - 1];
      const nextStart = nextUnit ? toIsoDate((generalData as any)[`u${nextUnit}_start`]) : '';
      const prevEnd = prevUnit ? toIsoDate((generalData as any)[`u${prevUnit}_end`]) : '';
      let start = rawStart;
      let end = rawEnd;
      if (!start) {
        if (index === 0) start = bimesterMeta.start;
        else if (prevEnd) start = shiftIsoDays(prevEnd, 3);
      }
      if (!end) {
        if (index === arr.length - 1) end = bimesterMeta.end;
        else if (nextStart) end = shiftIsoDays(nextStart, -3);
      }
      return {
        unitNumber,
        label: `Unidad N° ${String(unitNumber).padStart(2, '0')}`,
        start,
        end,
      };
    }).filter((item) => item.start && item.end && overlapRange(item.start, item.end, bimesterMeta.start, bimesterMeta.end));
  }, [bimesterMeta, generalData]);
  const resolvedBimesterUnits = useMemo(() => {
    if (!bimesterMeta) return [];
    const units = bimesterMeta.unitNumbers.map((unitNumber) => ({
      unitNumber,
      label: `Unidad N° ${String(unitNumber).padStart(2, '0')}`,
      start: toIsoDate((generalData as any)[`u${unitNumber}_start`]),
      end: toIsoDate((generalData as any)[`u${unitNumber}_end`]),
    }));
    if (!units.length) return [];

    if (!units[0].start) units[0].start = bimesterMeta.start;
    if (!units[units.length - 1].end) units[units.length - 1].end = bimesterMeta.end;

    for (let i = 1; i < units.length; i += 1) {
      if (!units[i].start && units[i - 1].end) {
        units[i].start = shiftIsoDays(units[i - 1].end, 3);
      }
    }

    for (let i = units.length - 2; i >= 0; i -= 1) {
      if (!units[i].end && units[i + 1].start) {
        units[i].end = shiftIsoDays(units[i + 1].start, -3);
      }
    }

    return units
      .map((unit) => ({
        ...unit,
        start: unit.start && compareIso(unit.start, bimesterMeta.start) < 0 ? bimesterMeta.start : unit.start,
        end: unit.end && compareIso(unit.end, bimesterMeta.end) > 0 ? bimesterMeta.end : unit.end,
      }))
      .filter((item) => item.start && item.end && compareIso(item.start, item.end) <= 0 && overlapRange(item.start, item.end, bimesterMeta.start, bimesterMeta.end));
  }, [bimesterMeta, generalData]);
  const bimesterScheduleDays = useMemo(() => {
    if (!areaId || !grade || !section) return new Set<string>();
    return new Set(
      scheduleEntries
        .filter((entry) => normalize(entry.areaId) === normalize(areaId) || normalize(entry.areaName) === normalize(areaId))
        .filter((entry) => normalize(entry.grade) === normalize(grade) && normalize(entry.section) === normalize(section))
        .map((entry) => normalizeDay(String(entry.day || '')))
    );
  }, [areaId, grade, scheduleEntries, section]);
  const getCalendarDayMeta = useCallback((iso: string) => {
    const mmdd = iso.slice(5);
    const holiday = holidays.find((item) => String(item.mmdd || '') === mmdd);
    const code = holiday?.type || calendarMap[iso] || '';
    const isHoliday = !!holiday || code === 'D';
    const isNonLective = !!code && code !== 'A';
    return {
      code,
      holidayName: holiday?.name || '',
      isHoliday,
      isNonLective,
    };
  }, [calendarMap, holidays]);
  const bimesterDayColumns = useMemo(() => {
    if (!bimesterMeta) return [];
    const result: Array<{ unitNumber: number; unitLabel: string; dates: Array<{ date: string; isFuture: boolean; isHoliday: boolean; isNonLective: boolean; holidayName: string; code: string }> }> = [];
    const today = todayIso();
    const sourceUnits = resolvedBimesterUnits.length
      ? resolvedBimesterUnits
      : (() => {
        if (!bimesterMeta.start || !bimesterMeta.end) return [];
        const unitNumbers = bimesterMeta.unitNumbers.length ? bimesterMeta.unitNumbers : [1];
        if (unitNumbers.length === 1) {
          return [{
            unitNumber: unitNumbers[0],
            label: `Unidad N° ${String(unitNumbers[0]).padStart(2, '0')}`,
            start: bimesterMeta.start,
            end: bimesterMeta.end,
          }];
        }
        const startDate = new Date(`${bimesterMeta.start}T00:00:00`);
        const endDate = new Date(`${bimesterMeta.end}T00:00:00`);
        const totalDays = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
        const chunkSize = Math.ceil(totalDays / unitNumbers.length);
        return unitNumbers.map((unitNumber, index) => {
          const chunkStart = new Date(startDate);
          chunkStart.setDate(startDate.getDate() + (index * chunkSize));
          const chunkEnd = index === unitNumbers.length - 1 ? new Date(endDate) : new Date(startDate);
          if (index !== unitNumbers.length - 1) {
            chunkEnd.setDate(startDate.getDate() + (((index + 1) * chunkSize) - 1));
          }
          return {
            unitNumber,
            label: `Unidad N° ${String(unitNumber).padStart(2, '0')}`,
            start: chunkStart.toISOString().split('T')[0],
            end: chunkEnd.toISOString().split('T')[0],
          };
        }).filter((item) => item.start <= item.end);
      })();
    const activeSourceUnits = resolvedBimesterUnits.length ? resolvedBimesterUnits : sourceUnits;
    activeSourceUnits.forEach((unit) => {
      const dates: Array<{ date: string; isFuture: boolean; isHoliday: boolean; isNonLective: boolean; holidayName: string; code: string }> = [];
      let cursor = new Date(`${unit.start}T00:00:00`);
      const limit = new Date(`${unit.end}T00:00:00`);
      while (cursor <= limit) {
        const iso = cursor.toISOString().split('T')[0];
        const dayKey = normalizeDay(dayNames[cursor.getDay()] || '');
        if (bimesterScheduleDays.size === 0 || bimesterScheduleDays.has(dayKey)) {
          const meta = getCalendarDayMeta(iso);
          dates.push({
            date: iso,
            isFuture: iso > today,
            isHoliday: meta.isHoliday,
            isNonLective: meta.isNonLective,
            holidayName: meta.holidayName,
            code: meta.code,
          });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      if (!dates.some((item) => item.date === date) && isBetweenIso(date, unit.start, unit.end)) {
        const meta = getCalendarDayMeta(date);
        dates.push({
          date,
          isFuture: date > today,
          isHoliday: meta.isHoliday,
          isNonLective: meta.isNonLective,
          holidayName: meta.holidayName,
          code: meta.code,
        });
      }
      if (dates.length) result.push({ unitNumber: unit.unitNumber, unitLabel: unit.label, dates: dates.sort((a, b) => compareIso(a.date, b.date)) });
    });
    if (!result.length && bimesterMeta.start && bimesterMeta.end) {
      const dates: Array<{ date: string; isFuture: boolean; isHoliday: boolean; isNonLective: boolean; holidayName: string; code: string }> = [];
      let cursor = new Date(`${bimesterMeta.start}T00:00:00`);
      const limit = new Date(`${bimesterMeta.end}T00:00:00`);
      while (cursor <= limit) {
        const iso = cursor.toISOString().split('T')[0];
        const dayKey = normalizeDay(dayNames[cursor.getDay()] || '');
        if (bimesterScheduleDays.size === 0 || bimesterScheduleDays.has(dayKey)) {
          const meta = getCalendarDayMeta(iso);
          dates.push({
            date: iso,
            isFuture: iso > today,
            isHoliday: meta.isHoliday,
            isNonLective: meta.isNonLective,
            holidayName: meta.holidayName,
            code: meta.code,
          });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      if (dates.length) {
        return [{
          unitNumber: bimesterMeta.unitNumbers[0],
          unitLabel: `Unidad N° ${String(bimesterMeta.unitNumbers[0]).padStart(2, '0')}`,
          dates,
        }];
      }
    }
    if (!result.length && date) {
      const meta = getCalendarDayMeta(date);
      return [{
        unitNumber: bimesterMeta.unitNumbers[0],
        unitLabel: `Unidad N° ${String(bimesterMeta.unitNumbers[0]).padStart(2, '0')}`,
        dates: [{
          date,
          isFuture: date > today,
          isHoliday: meta.isHoliday,
          isNonLective: meta.isNonLective,
          holidayName: meta.holidayName,
          code: meta.code,
        }],
      }];
    }
    return result;
  }, [bimesterMeta, bimesterScheduleDays, resolvedBimesterUnits, date, getCalendarDayMeta]);
  const exactBimesterDayColumns = useMemo(() => {
    if (!bimesterMeta) return [];
    const today = todayIso();
    const result: Array<{ unitNumber: number; unitLabel: string; dates: Array<{ date: string; isFuture: boolean; isHoliday: boolean; isNonLective: boolean; holidayName: string; code: string }> }> = [];

    bimesterMeta.unitNumbers.forEach((unitNumber) => {
      const start = toIsoDate((generalData as any)[`u${unitNumber}_start`]);
      const end = toIsoDate((generalData as any)[`u${unitNumber}_end`]);
      if (!start || !end || compareIso(start, end) > 0) return;

      const dates: Array<{ date: string; isFuture: boolean; isHoliday: boolean; isNonLective: boolean; holidayName: string; code: string }> = [];
      let cursor = new Date(`${start}T00:00:00`);
      const limit = new Date(`${end}T00:00:00`);

      while (cursor <= limit) {
        const iso = cursor.toISOString().split('T')[0];
        const dayKey = normalizeDay(dayNames[cursor.getDay()] || '');
        if (bimesterScheduleDays.size === 0 || bimesterScheduleDays.has(dayKey)) {
          const meta = getCalendarDayMeta(iso);
          dates.push({
            date: iso,
            isFuture: iso > today,
            isHoliday: meta.isHoliday,
            isNonLective: meta.isNonLective,
            holidayName: meta.holidayName,
            code: meta.code,
          });
        }
        cursor.setDate(cursor.getDate() + 1);
      }

      if (!dates.some((item) => item.date === date) && isBetweenIso(date, start, end)) {
        const meta = getCalendarDayMeta(date);
        dates.push({
          date,
          isFuture: date > today,
          isHoliday: meta.isHoliday,
          isNonLective: meta.isNonLective,
          holidayName: meta.holidayName,
          code: meta.code,
        });
      }

      if (dates.length) {
        result.push({
          unitNumber,
          unitLabel: `Unidad N° ${String(unitNumber).padStart(2, '0')}`,
          dates: dates.sort((a, b) => compareIso(a.date, b.date)),
        });
      }
    });

    return result;
  }, [bimesterMeta, bimesterScheduleDays, date, generalData, getCalendarDayMeta]);
  const effectiveBimesterDayColumns = useMemo(
    () => (exactBimesterDayColumns.length ? exactBimesterDayColumns : bimesterDayColumns),
    [exactBimesterDayColumns, bimesterDayColumns],
  );
  const visibleBimesterDayColumns = useMemo(() => {
    if (expandedBimesterView) return effectiveBimesterDayColumns;
    return effectiveBimesterDayColumns
      .map((group) => ({ ...group, dates: group.dates.filter((item) => item.date === date) }))
      .filter((group) => group.dates.length);
  }, [effectiveBimesterDayColumns, date, expandedBimesterView]);
  const totalBimesterDays = useMemo(() => effectiveBimesterDayColumns.reduce((acc, item) => acc + item.dates.length, 0), [effectiveBimesterDayColumns]);
  const visibleBimesterDays = useMemo(() => visibleBimesterDayColumns.reduce((acc, item) => acc + item.dates.length, 0), [visibleBimesterDayColumns]);
  const expandedColumnPreset = useMemo(() => {
  if (!expandedBimesterView) return { index: 52, name: 420, day: 60, summary: 44 };
  if (visibleBimesterDays >= 24) return { index: 24, name: 220, day: 17, summary: 20 };
  if (visibleBimesterDays >= 20) return { index: 26, name: 240, day: 19, summary: 22 };
  if (visibleBimesterDays >= 16) return { index: 28, name: 280, day: 21, summary: 24 };
  return { index: 30, name: 340, day: 22, summary: 24 };
}, [expandedBimesterView, visibleBimesterDays]);
  const indexColumnWidth = expandedColumnPreset.index;
  const nameColumnWidth = expandedColumnPreset.name;
  const dayColumnWidth = expandedColumnPreset.day;
  const summaryColumnWidth = expandedColumnPreset.summary;
  const attendanceTableWidth = useMemo(() => {
    const leftColumnsWidth = indexColumnWidth + nameColumnWidth;
    const dayColumnsWidth = Math.max(visibleBimesterDays, 1) * dayColumnWidth;
    const summaryColumnsWidth = 4 * summaryColumnWidth;
    return leftColumnsWidth + dayColumnsWidth + summaryColumnsWidth;
  }, [dayColumnWidth, indexColumnWidth, nameColumnWidth, summaryColumnWidth, visibleBimesterDays]);
  const bimesterSummaries = useMemo(() => {
    const daySet = new Set(effectiveBimesterDayColumns.flatMap((item) => item.dates.map((day) => day.date)));
    const countStatus = (studentId: string | number, code: AttendanceRecord['status']) => {
      let total = 0;
      daySet.forEach((day) => {
        if (historyAttendanceMap.get(`${studentId}__${day}`)?.status === code) total += 1;
      });
      return total;
    };
    return new Map(activeStudents.map((student) => [String(student.id), {
      P: countStatus(student.id, 'P'),
      F: countStatus(student.id, 'F'),
      T: countStatus(student.id, 'T'),
      J: countStatus(student.id, 'J'),
    }]));
  }, [activeStudents, effectiveBimesterDayColumns, historyAttendanceMap]);

  const stopRecognition = useCallback(() => {
    if (recognitionTimerRef.current) window.clearInterval(recognitionTimerRef.current);
    recognitionTimerRef.current = null;
    recognitionBusyRef.current = false;
    setRecognitionMode(false);
  }, []);

  const stopGuided = useCallback(() => {
    if (enrollmentTimerRef.current) window.clearTimeout(enrollmentTimerRef.current);
    enrollmentTimerRef.current = null;
    enrollmentBusyRef.current = false;
    guidedActiveRef.current = false;
    setGuidedMode(false);
    setGuidedStudentId('');
    setGuidedStep(0);
    setCapturePhase('idle');
    setAttemptPreview('');
    setFaceHint('Registro guiado detenido.');
    setDetectorStats('Sin lectura facial aun.');
  }, []);

  const loadSectionData = useCallback(async () => {
    if (!grade || !section) {
      setRecords([]);
      setHistoryRecords([]);
      setProfiles([]);
      return;
    }
    setLoadingData(true);
    try {
      const [recordRows, historyRows, profileRows] = await Promise.all([
        getAttendanceRecords({ date, grade, section }),
        getAttendanceRecords({ date: '', grade, section }),
        getFaceProfiles({ grade, section }),
      ]);
      if (!mountedRef.current) return;
      setRecords(recordRows || []);
      setHistoryRecords(historyRows || []);
      setProfiles(profileRows || []);
    } finally {
      if (mountedRef.current) setLoadingData(false);
    }
  }, [date, grade, section]);

  useEffect(() => {
    loadSectionData();
  }, [loadSectionData]);

  useEffect(() => {
    setSelectedStudentId((prev) => (prev && activeStudents.some((item) => String(item.id) === String(prev)) ? prev : ''));
  }, [activeStudents]);

  useEffect(() => {
    if (manualSelectionRef.current || !assignments.length) return;
    try {
      const rawEntries = localStorage.getItem('armi_schedule_entries');
      const rawConfig = localStorage.getItem('armi_schedule_config');
      const entries = rawEntries ? JSON.parse(rawEntries) : [];
      const config = rawConfig ? JSON.parse(rawConfig) : null;
      const now = new Date();
      const today = normalizeDay(dayNames[now.getDay()] || '');
      const currentHour = getCurrentHourIndex(config, now);
      const matchingEntry = Array.isArray(entries)
        ? entries.find((entry: any) => normalizeDay(String(entry?.day || '')) === today && Number(entry?.hourIndex) === currentHour)
        : null;
      const fallback = assignments[0];
      const preferred = matchingEntry
        ? assignments.find((item) => normalize(item.areaId) === normalize(matchingEntry.areaId) && normalize(item.grade) === normalize(matchingEntry.grade) && normalize(item.section) === normalize(matchingEntry.section))
        : null;
      const nextSelection = preferred || fallback;
      if (!nextSelection) return;
      setAreaId(String(nextSelection.areaId || '').trim());
      setGrade(String(nextSelection.grade || '').trim());
      setSection(String(nextSelection.section || '').trim());
      setStatusText(preferred
        ? `Contexto detectado del horario actual: ${nextSelection.areaName} - ${nextSelection.grade} ${nextSelection.section}.`
        : 'Horario de hoy no coincide con ninguna clase activa, se seleccionó la primera disponible.');
    } catch {
      const fallback = assignments[0];
      if (!fallback) return;
      setAreaId(String(fallback.areaId || '').trim());
      setGrade(String(fallback.grade || '').trim());
      setSection(String(fallback.section || '').trim());
    }
  }, [assignments]);

  const ensureEngine = useCallback(async () => {
    if (humanRef.current) return humanRef.current;
    const module = await import('@vladmandic/human');
    const Human = module.default;
    const instance = new Human({
      modelBasePath: HUMAN_MODEL_BASE,
      cacheSensitivity: 0,
      backend: 'webgl',
      filter: { enabled: true, equalization: true },
      face: {
        enabled: true,
        detector: { enabled: true, maxDetected: 1, rotation: true, return: true },
        mesh: { enabled: false },
        iris: { enabled: false },
        emotion: { enabled: false },
        antispoof: { enabled: false },
        liveness: { enabled: false },
        description: { enabled: true },
      },
      body: { enabled: false },
      hand: { enabled: false },
      object: { enabled: false },
      gesture: { enabled: false },
    });
    await instance.load();
    await instance.warmup();
    humanRef.current = instance;
    setEngineReady(true);
    return instance;
  }, []);

  const stopLocalCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  }, []);

  const stopRemoteCameraPreview = useCallback(async (closeSession = false) => {
    if (remotePollingRef.current) {
      window.clearInterval(remotePollingRef.current);
      remotePollingRef.current = null;
    }
    const sessionId = remoteSession?.sessionId || '';
    setRemoteConnected(false);
    setRemoteFrameData('');
    setRemoteLastFrameAt('');
    if (closeSession && sessionId) {
      await closeRemoteCameraSession(sessionId);
      setRemoteSession(null);
    }
  }, [remoteSession]);

  const startCamera = useCallback(async () => {
    if (cameraSource === 'remote') {
      setFaceHint('La camara remota del celular esta seleccionada. Conecta una URL MJPEG de tu app IP.');
      return;
    }
    if (streamRef.current && videoRef.current) return;
    try {
      await stopRemoteCameraPreview(false);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
      setFaceHint('Camara activa. Esperando un rostro centrado.');
      setStatusText('Camara lista. Puedes iniciar el registro guiado o el reconocimiento.');
    } catch (error: any) {
      showToast(`No se pudo abrir la camara: ${error?.message || 'permiso denegado'}`, 'error');
    }
  }, [cameraSource, showToast, stopRemoteCameraPreview]);

  const createRemoteSession = useCallback(async () => {
    stopLocalCamera();
    await stopRemoteCameraPreview(true);
    const response = await createRemoteCameraSession();
    if (!response.success || !response.data) {
      showToast(response.message || 'No se pudo crear la sesion de camara remota.', 'error');
      return null;
    }
    setCameraSource('remote');
    setRemoteSession(response.data);
    setCameraReady(false);
    setRemoteConnected(false);
    setRemoteFrameData('');
    setRemoteLastFrameAt('');
    setFaceHint('Abre el enlace en tu celular y acepta el permiso de camara.');
    setStatusText('Camara remota lista para enlazarse con el celular.');
    showToast('Sesion remota creada. Abre el enlace en tu celular.', 'success');
    return response.data;
  }, [showToast, stopLocalCamera, stopRemoteCameraPreview]);

  const connectIpCameraStream = useCallback(async () => {
    const rawUrl = String(ipCameraUrl || '').trim();
    if (!rawUrl) {
      showToast('Pega la URL MJPEG de la app del celular antes de conectar.', 'error');
      return;
    }
    if (!/^https?:\/\//i.test(rawUrl)) {
      showToast('La URL de la camara debe empezar con http:// o https://', 'error');
      return;
    }
    stopLocalCamera();
    await stopRemoteCameraPreview(true);
    setRemoteSession(null);
    setRemoteQrDataUrl('');
    setRemoteConnected(false);
    setRemoteFrameData('');
    setRemoteLastFrameAt('');
    setRemoteStreamEnabled(true);
    setCameraSource('remote');
    setCameraReady(false);
    setFaceHint('Esperando el video MJPEG de la app del celular...');
    setStatusText('Conectando la camara IP del celular...');
    showToast('Conectando stream del celular...', 'success');
  }, [ipCameraUrl, showToast, stopLocalCamera, stopRemoteCameraPreview]);

  const startRemotePolling = useCallback((sessionId: string) => {
    if (remotePollingRef.current) {
      window.clearInterval(remotePollingRef.current);
      remotePollingRef.current = null;
    }
    const syncFrame = async () => {
      const response = await getRemoteCameraSessionFrame(sessionId);
      if (!response.success || !response.data) return;
      const frame = response.data;
      setRemoteConnected(frame.connected);
      setRemoteLastFrameAt(frame.lastFrameAt || '');
      if (frame.imageData) {
        setRemoteFrameData((prev) => prev === frame.imageData ? prev : frame.imageData);
        setCameraReady(true);
      }
    };
    syncFrame();
    remotePollingRef.current = window.setInterval(syncFrame, 300);
  }, []);

  const enableRemoteCamera = useCallback(async () => {
    await connectIpCameraStream();
  }, [connectIpCameraStream]);

  const useLocalCamera = useCallback(async () => {
    setCameraSource('local');
    await stopRemoteCameraPreview(false);
    setRemoteStreamEnabled(false);
    setCameraReady(false);
    setFaceHint('Volviendo a la camara de esta PC...');
    await startCamera();
  }, [startCamera, stopRemoteCameraPreview]);

  const stopRemoteCamera = useCallback(async () => {
    await stopRemoteCameraPreview(true);
    setRemoteStreamEnabled(false);
    if (remoteImageRef.current) remoteImageRef.current.src = '';
    setCameraReady(false);
    setFaceHint('Camara remota detenida.');
    setStatusText('Camara remota desconectada en ARMI.');
    setRemoteConnected(false);
  }, [stopRemoteCameraPreview]);

  const copyRemoteCameraLink = useCallback(async () => {
    if (!remoteSession?.phoneUrl) return;
    try {
      await navigator.clipboard.writeText(remoteSession.phoneUrl);
      showToast('Enlace del celular copiado.', 'success');
    } catch {
      showToast('No se pudo copiar el enlace del celular.', 'error');
    }
  }, [remoteSession, showToast]);

  const captureImage = useCallback(() => {
    const source = cameraSource === 'remote' ? remoteImageRef.current : videoRef.current;
    const canvas = canvasRef.current;
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source?.videoWidth;
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source?.videoHeight;
    if (!source || !canvas || !width || !height) return '';
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  }, [cameraSource]);

  const extractDescriptor = useCallback(async (silent = false) => {
    const source = cameraSource === 'remote' ? remoteImageRef.current : videoRef.current;
    const canvas = canvasRef.current;
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source?.videoWidth;
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source?.videoHeight;
    const isLocalVideoWaiting = source instanceof HTMLVideoElement && (source.readyState < 2 || !width || !height);
    if (!source || !canvas || !width || !height || isLocalVideoWaiting) {
      setFaceHint(cameraSource === 'remote' ? 'Esperando que el celular envie imagen...' : 'Esperando que la camara estabilice la imagen...');
      return null;
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const human = await ensureEngine();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const currentPreview = canvas.toDataURL('image/jpeg', 0.85);
      setAttemptPreview(currentPreview);
      const result = await human.detect(canvas);
      const face = result?.face?.[0] || human.result?.face?.[0];
      const overlay = overlayCanvasRef.current;
      if (overlay) {
        overlay.width = canvas.width;
        overlay.height = canvas.height;
        const overlayCtx = overlay.getContext('2d');
        if (overlayCtx) overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
        try {
          await human.draw.all(overlay, result);
        } catch {
          // Best-effort overlay only.
        }
      }
      if (!face) {
        setFaceHint(`Intento ${attempt}/3: no detecto un rostro. Mira de frente y acercate un poco.`);
        setDetectorStats(`Intento ${attempt}/3 - Rostros: 0 - Descriptor: 0`);
        await delay(220);
        continue;
      }
      const faceSize = Array.isArray(face?.box) ? Math.round(Math.min(face.box[2] || 0, face.box[3] || 0)) : 0;
      const raw = face?.embedding || face?.descriptor;
      const descriptor = Array.from(raw || []).map((item) => Number(item || 0));
      setDetectorStats(`Intento ${attempt}/3 - Rostros: 1 - Descriptor: ${descriptor.length} - Tamano: ${faceSize}px`);
      if (descriptor.length >= 64) {
        setFaceHint(`Rostro validado correctamente. Descriptor: ${descriptor.length}.`);
        return { descriptor, imageData: captureImage() };
      }
      setFaceHint(`Intento ${attempt}/3: rostro detectado, pero descriptor aun incompleto (${descriptor.length}).`);
      await delay(220);
    }
    if (!silent) showToast('No se pudo obtener un descriptor facial valido. Intenta con mejor luz o mas de frente.', 'error');
    return null;
  }, [cameraSource, captureImage, ensureEngine, showToast]);

  const saveAttendance = useCallback(async (student: Student, status: AttendanceRecord['status'], source: string, targetDate = date) => {
    const response = await saveAttendanceRecord({
      attendanceDate: targetDate,
      grade,
      section,
      studentId: student.id,
      studentName: student.name,
      dni: student.dni,
      status,
      source,
    });
    if (!response.success) {
      showToast(response.message || 'No se pudo guardar la asistencia.', 'error');
      return false;
    }
    if (targetDate === date) {
      setRecords((prev) => {
        const rest = prev.filter((item) => String(item.studentId) !== String(student.id));
        return [...rest, { attendanceDate: targetDate, grade, section, studentId: student.id, studentName: student.name, dni: student.dni, status, source }];
      });
    }
    setHistoryRecords((prev) => {
      const rest = prev.filter((item) => !(String(item.studentId) === String(student.id) && item.attendanceDate === targetDate));
      return [...rest, { attendanceDate: targetDate, grade, section, studentId: student.id, studentName: student.name, dni: student.dni, status, source }];
    });
    return true;
  }, [date, grade, section, showToast]);

  const removeFaceSample = useCallback(async (profile: FaceProfile) => {
    const response = await deleteFaceProfile(profile.id);
    if (!response.success) {
      showToast(response.message || 'No se pudo eliminar la muestra facial.', 'error');
      return;
    }
    showToast('Muestra facial eliminada.', 'success');
    await loadSectionData();
  }, [loadSectionData, showToast]);

  const resetSelectedStudentProfiles = useCallback(async () => {
    if (!selectedStudent) {
      showToast('Selecciona un estudiante para reiniciar su base facial.', 'error');
      return;
    }
    const response = await resetStudentFaceProfiles({
      studentId: selectedStudent.id,
      grade,
      section,
    });
    if (!response.success) {
      showToast(response.message || 'No se pudo reiniciar la base facial.', 'error');
      return;
    }
    setCaptureGallery([]);
    setAttemptPreview('');
    showToast(`Base facial reiniciada para ${selectedStudent.name}.`, 'success');
    await loadSectionData();
  }, [grade, loadSectionData, section, selectedStudent, showToast]);

  const nextPendingStudent = useCallback((excludeId?: string) => pendingStudents.find((item) => String(item.id) !== String(excludeId)) || null, [pendingStudents]);

  const executeEnrollmentStep = useCallback(async (student: Student, stepIndex: number) => {
    setLastRecognized(`Entrando a executeEnrollmentStep(${stepIndex + 1}/${ENROLLMENT_STEPS.length}) para ${student.name}.`);
    if (!mountedRef.current) {
      setFaceHint('El componente ya no esta montado.');
      return;
    }
    if (!guidedActiveRef.current) {
      setFaceHint('El registro guiado no esta activo en este momento.');
      return;
    }
    if (enrollmentBusyRef.current) {
      setFaceHint('Hay una captura en curso. Esperando desbloqueo interno...');
      return;
    }
    const step = ENROLLMENT_STEPS[stepIndex];
    if (!step) {
      setFaceHint(`No existe el paso ${stepIndex + 1} del registro guiado.`);
      return;
    }
    enrollmentBusyRef.current = true;
    try {
      setGuidedStudentId(String(student.id));
      setGuidedStep(stepIndex);
      setCapturePhase('detecting');
      setStatusText(`Registro guiado: ${student.name}. Paso ${stepIndex + 1}/${ENROLLMENT_STEPS.length}: ${step.label}.`);
      setFaceHint(`Buscando una captura valida para: ${step.label}.`);
      setDetectorStats(`Ejecutando deteccion del paso ${stepIndex + 1}/${ENROLLMENT_STEPS.length}...`);
      const result = await extractDescriptor(true);
      if (!result) {
        setStatusText(`Buscando rostro valido para ${student.name}. ${step.label}.`);
        enrollmentTimerRef.current = window.setTimeout(() => {
          enrollmentBusyRef.current = false;
          executeEnrollmentStep(student, stepIndex);
        }, 1200);
        return;
      }
      setLastRecognized(`Captura ${stepIndex + 1}/${ENROLLMENT_STEPS.length} lista para ${student.name}.`);
      setCapturePhase('saving');
      setStatusText(`Guardando captura ${stepIndex + 1}/${ENROLLMENT_STEPS.length} de ${student.name}...`);
      setFaceHint('Captura valida detectada. Guardando en la base facial...');
      const response = await saveFaceProfile({
        studentId: student.id,
        studentName: student.name,
        grade,
        section,
        imageData: result.imageData,
        descriptor: JSON.stringify(result.descriptor),
        source: `guided_${step.id}`,
      });
      if (!response.success) {
        showToast(response.message || 'No se pudo guardar la captura facial.', 'error');
        stopGuided();
        return;
      }
      setCaptureGallery((prev) => {
        const next = [...prev, { stepLabel: step.label, imageData: result.imageData }];
        return next.slice(-8);
      });
      const updated = await getFaceProfiles({ grade, section });
      if (mountedRef.current) setProfiles(updated || []);
      if (stepIndex < ENROLLMENT_STEPS.length - 1) {
        setCapturePhase('detecting');
        setStatusText(`Captura ${stepIndex + 1} guardada. Continua con: ${ENROLLMENT_STEPS[stepIndex + 1].label}.`);
        enrollmentTimerRef.current = window.setTimeout(() => {
          enrollmentBusyRef.current = false;
          executeEnrollmentStep(student, stepIndex + 1);
        }, 1200);
        return;
      }
      showToast(`Base facial registrada para ${student.name}.`, 'success');
      setCapturePhase('completed');
      setFaceHint('Registro facial de este estudiante completado.');
      const nextStudent = nextPendingStudent(String(student.id));
      if (nextStudent) {
        setSelectedStudentId(String(nextStudent.id));
        setGuidedStudentId(String(nextStudent.id));
        setStatusText(`Registro completado para ${student.name}. Revisa las muestras y presiona iniciar para continuar con ${nextStudent.name}.`);
        setLastRecognized(`Base facial terminada para ${student.name}. Siguiente sugerido: ${nextStudent.name}.`);
      } else {
        setStatusText('Registro guiado completado para todos los estudiantes pendientes.');
      }
      stopGuided();
    } finally {
      enrollmentBusyRef.current = false;
    }
  }, [extractDescriptor, grade, nextPendingStudent, section, showToast, stopGuided]);

  const startGuidedEnrollment = useCallback(async () => {
    if (!grade || !section) return showToast('Selecciona grado y seccion antes de registrar rostros.', 'error');
    if (!activeStudents.length) return showToast('No existe base de estudiantes para este grado y seccion.', 'error');
    stopRecognition();
    if (cameraSource === 'remote') {
      if (!remoteSession) await enableRemoteCamera();
      if (!remoteConnected) return showToast('Activa la app IP del celular y verifica la URL MJPEG antes de continuar.', 'error');
    } else {
      await startCamera();
    }
    await ensureEngine();
    const target = selectedStudent || nextPendingStudent();
    if (!target) return showToast('Todos los estudiantes ya cuentan con una base facial suficiente.', 'success');
    guidedActiveRef.current = true;
    enrollmentBusyRef.current = false;
    if (enrollmentTimerRef.current) window.clearTimeout(enrollmentTimerRef.current);
    setGuidedMode(true);
    setGuidedStudentId(String(target.id));
    setCapturePhase('detecting');
    setCaptureGallery([]);
    setAttemptPreview('');
    setFaceHint('Preparando el registro guiado...');
    setDetectorStats('Arrancando captura guiada...');
    setStatusText(`Iniciando registro guiado para ${target.name}...`);
    setGuidedStep(0);
    setLastRecognized(`Lanzando paso 1/${ENROLLMENT_STEPS.length} para ${target.name}...`);
    await delay(150);
    await executeEnrollmentStep(target, 0);
  }, [activeStudents.length, cameraSource, enableRemoteCamera, ensureEngine, executeEnrollmentStep, grade, nextPendingStudent, remoteConnected, remoteSession, section, selectedStudent, showToast, startCamera, stopRecognition]);

  const recognizeOnce = useCallback(async () => {
    if (recognitionBusyRef.current) return;
    recognitionBusyRef.current = true;
    try {
      const result = await extractDescriptor(true);
      if (!result) return;
      const matches = profiles.map((profile) => {
        const descriptor = parseDescriptor(profile.descriptor);
        if (!descriptor) return null;
        return { profile, score: cosineSimilarity(result.descriptor, descriptor) };
      }).filter(Boolean) as Array<{ profile: FaceProfile; score: number }>;
      if (!matches.length) return;
      matches.sort((a, b) => b.score - a.score);
      const best = matches[0];
      if (!best || best.score < MATCH_THRESHOLD) return;
      const studentId = String(best.profile.studentId);
      const now = Date.now();
      if ((recentRecognitionRef.current[studentId] || 0) + 9000 > now) return;
      recentRecognitionRef.current[studentId] = now;
      const student = activeStudents.find((item) => String(item.id) === studentId);
      if (!student) return;
      if (attendanceMap.get(studentId)?.status === 'P') {
        setLastRecognized(`${student.name} ya estaba marcado como presente.`);
        return;
      }
      const ok = await saveAttendance(student, 'P', 'face_auto');
      if (ok) {
        setLastRecognized(`${student.name} reconocido con coincidencia ${(best.score * 100).toFixed(1)}%.`);
        setStatusText(`Asistencia marcada automaticamente para ${student.name}.`);
        speakMessage(getWelcomeSpeech(student));
        showToast(`Asistencia registrada para ${student.name}.`, 'success');
      }
    } finally {
      recognitionBusyRef.current = false;
    }
  }, [activeStudents, attendanceMap, extractDescriptor, profiles, saveAttendance, showToast]);

  const startRecognition = useCallback(async () => {
    if (!grade || !section) return showToast('Selecciona grado y seccion antes de iniciar el reconocimiento.', 'error');
    if (!activeStudents.length) return showToast('No existe base de estudiantes para este grado y seccion.', 'error');
    if (!profiles.length) return showToast('Aun no existe base facial para este grado y seccion.', 'error');
    stopGuided();
    if (cameraSource === 'remote') {
      if (!remoteSession) await enableRemoteCamera();
      if (!remoteConnected) return showToast('Activa la app IP del celular y verifica la URL MJPEG antes de continuar.', 'error');
    } else {
      await startCamera();
    }
    await ensureEngine();
    stopRecognition();
    setRecognitionMode(true);
    setFaceHint('Reconocimiento continuo activo.');
    setStatusText('Reconocimiento activo.');
    await recognizeOnce();
    recognitionTimerRef.current = window.setInterval(() => { recognizeOnce(); }, 1800);
  }, [activeStudents.length, cameraSource, enableRemoteCamera, ensureEngine, grade, profiles.length, recognizeOnce, remoteConnected, remoteSession, section, showToast, startCamera, stopGuided, stopRecognition]);

  const exportExcel = useCallback(() => {
    const fallbackMeta = getCalendarDayMeta(date);
    const visibleGroups = effectiveBimesterDayColumns.length ? effectiveBimesterDayColumns : [{
      unitNumber: 0,
      unitLabel: 'Periodo',
      dates: [{
        date,
        isFuture: date > todayIso(),
        isHoliday: fallbackMeta.isHoliday,
        isNonLective: fallbackMeta.isNonLective,
        holidayName: fallbackMeta.holidayName,
        code: fallbackMeta.code,
      }],
    }];
    const headerRows: any[][] = [
      [generalData.institution || 'Institucion Educativa'],
      [`${generalData.district || ''} - ${generalData.province || ''}`.replace(/^\s*-\s*|\s*-\s*$/g, '')],
      [generalData.motto || ''],
      [`${bimesterMeta ? `${bimesterMeta.id} BIMESTRE` : 'ASISTENCIA'} - ${currentAssignment?.areaName || ''} - ${grade} ${section}`],
      [],
    ];
    const topHeader = ['N°', 'Apellidos y nombres'];
    const subHeader = ['', ''];
    visibleGroups.forEach((group) => {
      group.dates.forEach((day) => {
        topHeader.push(group.unitLabel);
        subHeader.push(`${shortDayNames[new Date(`${day.date}T00:00:00`).getDay()] || ''} ${formatShortDate(day.date)}`);
      });
    });
    topHeader.push('Asistencias', 'Faltas', 'Tardanzas', 'Justificadas');
    subHeader.push('', '', '', '');
    const bodyRows = activeStudents.map((student, index) => {
      const summary = bimesterSummaries.get(String(student.id)) || { P: 0, F: 0, T: 0, J: 0 };
      const row = [index + 1, student.name];
      visibleGroups.forEach((group) => {
        group.dates.forEach((day) => {
          row.push(day.isHoliday ? '★' : day.isFuture ? '—' : getStatusDisplayGlyph(historyAttendanceMap.get(`${student.id}__${day.date}`)?.status));
        });
      });
      row.push(summary.P, summary.F, summary.T, summary.J);
      return row;
    });
    const footerRows = [
      [],
      [currentAssignment?.areaName || '', '', '', '', '', '', '', generalData.teacher || ''],
    ];
    const sheet = XLSX.utils.aoa_to_sheet([...headerRows, topHeader, subHeader, ...bodyRows, ...footerRows]);
    const totalColumns = 2 + visibleGroups.reduce((acc, group) => acc + group.dates.length, 0) + 4;
    const merges: XLSX.Range[] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: totalColumns - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: totalColumns - 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: totalColumns - 1 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: totalColumns - 1 } },
    ];
    let cursorCol = 2;
    visibleGroups.forEach((group) => {
      const startCol = cursorCol;
      const endCol = cursorCol + group.dates.length - 1;
      if (endCol > startCol) merges.push({ s: { r: 5, c: startCol }, e: { r: 5, c: endCol } });
      cursorCol = endCol + 1;
    });
    sheet['!merges'] = merges;
    sheet['!cols'] = [
      { wch: 6 },
      { wch: 38 },
      ...visibleGroups.flatMap((group) => group.dates.map(() => ({ wch: 8 }))),
      { wch: 10 },
      { wch: 8 },
      { wch: 10 },
      { wch: 12 },
    ];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Asistencia');
    XLSX.writeFile(book, `Asistencia ${bimesterMeta?.id || ''} - ${currentAssignment?.areaName || 'Area'} - ${grade} ${section}.xlsx`);
  }, [activeStudents, effectiveBimesterDayColumns, bimesterMeta, currentAssignment, date, generalData.district, generalData.institution, generalData.motto, generalData.province, generalData.teacher, getCalendarDayMeta, grade, historyAttendanceMap, section, bimesterSummaries]);

  const cycleDailyStatus = useCallback(async (student: Student, targetDate: string) => {
    setHighlightedAttendanceStudentId(String(student.id));
    const current = historyAttendanceMap.get(`${student.id}__${targetDate}`)?.status;
    const sequence: AttendanceRecord['status'][] = ['P', 'T', 'F', 'J'];
    const next = sequence[(Math.max(sequence.indexOf(current as AttendanceRecord['status']), -1) + 1) % sequence.length];
    await saveAttendance(student, next, 'manual_table', targetDate);
  }, [historyAttendanceMap, saveAttendance]);

  const guidedStudent = activeStudents.find((item) => String(item.id) === guidedStudentId) || null;
  const guidedSavedCount = guidedStudent ? (profileCountMap.get(String(guidedStudent.id)) || 0) : 0;
  const capturePhaseLabel = capturePhase === 'detecting'
    ? 'Buscando rostro'
    : capturePhase === 'saving'
      ? 'Guardando captura'
      : capturePhase === 'completed'
        ? 'Registro completado'
        : 'En espera';
  const visibleProfiles = useMemo(() => {
    const baseRows = selectedStudentId
      ? profiles.filter((item) => String(item.studentId) === String(selectedStudentId))
      : profiles;
    return [...baseRows].sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  }, [profiles, selectedStudentId]);

  const remoteCameraLabel = remoteConnected
    ? `Celular conectado${remoteLastFrameAt ? ` · Ultimo frame ${remoteLastFrameAt}` : ''}`
    : cameraSource === 'remote' && !remoteStreamEnabled
      ? 'Stream remoto detenido en ARMI.'
      : cameraSource === 'remote'
      ? 'Esperando que cargue el stream MJPEG del celular.'
      : 'Camara remota inactiva.';

  const renderCameraSourcePanel = () => (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Fuente de camara</p>
          <p className="mt-1 text-[11px] font-bold text-slate-600">{cameraSource === 'remote' ? remoteCameraLabel : 'Usando la webcam de esta PC.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={useLocalCamera} className={`rounded-2xl px-3.5 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition ${cameraSource === 'local' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>PC</button>
          <button type="button" onClick={enableRemoteCamera} className={`rounded-2xl px-3.5 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition ${cameraSource === 'remote' ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>Celular app IP</button>
        </div>
      </div>
      <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-3">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-700">URL del stream MJPEG del celular</p>
        <input
          type="text"
          value={ipCameraUrl}
          onChange={(e) => setIpCameraUrl(e.target.value)}
          placeholder="http://IP_DEL_CELULAR:4747/video"
          className="mt-2 w-full rounded-xl border border-blue-100 bg-white px-3 py-2.5 text-[12px] font-bold text-slate-700 outline-none focus:border-cyan-400"
        />
        <p className="mt-2 text-[10px] font-bold leading-relaxed text-slate-600">
          Ejemplo recomendado: DroidCam en el celular mostrando `http://IP:4747/video`
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={connectIpCameraStream} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-blue-700">Conectar stream</button>
          <button type="button" onClick={stopRemoteCamera} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-rose-700">Detener camara</button>
        </div>
      </div>
      {cameraSource === 'remote' && remoteSession ? (
        <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-700">Abre este enlace en tu celular</p>
          <p className="mt-1 break-all text-[11px] font-bold text-slate-700">{remoteSession.phoneUrl}</p>
          {remoteQrDataUrl ? (
            <div className="mt-3 flex items-center gap-3 rounded-2xl border border-blue-100 bg-white/90 p-3">
              <img src={remoteQrDataUrl} alt="QR de camara remota" className="h-24 w-24 rounded-xl border border-slate-200 bg-white p-1" />
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Escanea el QR</p>
                <p className="mt-1 text-[11px] font-bold leading-relaxed text-slate-600">Con la camara del celular o cualquier lector QR, luego acepta el permiso de video.</p>
              </div>
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={copyRemoteCameraLink} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-blue-700">Copiar enlace</button>
            <button type="button" onClick={() => window.open(remoteSession.phoneUrl, '_blank', 'noopener,noreferrer')} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-blue-700">Abrir enlace</button>
          </div>
        </div>
      ) : null}
    </div>
  );

  const renderCameraViewport = () => (
    <div className="relative overflow-hidden rounded-[1.4rem] border border-white/10 bg-black">
      {cameraSource === 'remote' ? (
        proxiedIpCameraUrl ? (
          <img
            ref={remoteImageRef}
            src={proxiedIpCameraUrl}
            alt="Camara remota"
            className="aspect-[4/3] w-full object-cover"
            onLoad={() => {
              setRemoteConnected(true);
              setCameraReady(true);
              setRemoteLastFrameAt(new Date().toLocaleTimeString());
            }}
            onError={() => {
              setRemoteConnected(false);
              setCameraReady(false);
              setFaceHint('No se pudo abrir el stream MJPEG del celular. Revisa la URL y que la app siga transmitiendo.');
            }}
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center bg-slate-950 px-6 text-center text-[12px] font-bold text-slate-300">
            Pega la URL MJPEG de la app del celular para iniciar la vista remota...
          </div>
        )
      ) : (
        <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full object-cover" />
      )}
      <canvas ref={overlayCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
    </div>
  );

  const renderRemoteConnectionBanner = () => {
    if (cameraSource !== 'remote' || !remoteSession) return null;
    return (
      <div className="mx-6 mt-4 rounded-[1.6rem] border border-blue-200 bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_100%)] p-4 shadow-[0_18px_44px_rgba(37,99,235,0.10)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-700">Camara remota del celular</p>
            <p className="mt-1 text-[14px] font-black text-slate-800">Escanee este QR o abra el enlace en su telefono para iniciar la transmision.</p>
            <p className="mt-2 break-all text-[11px] font-bold text-slate-600">{remoteSession.phoneUrl}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={copyRemoteCameraLink} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-blue-700">Copiar enlace</button>
              <button type="button" onClick={() => window.open(remoteSession.phoneUrl, '_blank', 'noopener,noreferrer')} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-blue-700">Abrir enlace</button>
            </div>
            <p className="mt-3 text-[11px] font-bold text-slate-500">{remoteCameraLabel}</p>
          </div>
          <div className="shrink-0 rounded-[1.3rem] border border-blue-100 bg-white p-3">
            {remoteQrDataUrl ? (
              <img src={remoteQrDataUrl} alt="QR de camara remota" className="h-36 w-36 rounded-xl border border-slate-200 bg-white p-1" />
            ) : (
              <div className="flex h-36 w-36 items-center justify-center rounded-xl border border-dashed border-slate-200 text-center text-[11px] font-bold text-slate-400">
                Generando QR...
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const tabs: Array<{ id: 'registro' | 'base' | 'control'; label: string }> = [
    { id: 'registro', label: 'Registro' },
    { id: 'base', label: 'Base facial' },
    { id: 'control', label: 'Control diario' },
  ];
  const renderTabIcon = (tabId: 'registro' | 'base' | 'control', active: boolean) => {
    const tone = active ? '#ff8a3d' : '#ffffff';
    if (tabId === 'registro') {
      return (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke={tone} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4.5" y="6.5" width="15" height="11" rx="2.5" />
          <path d="M9 6.5l1.2-2h3.6l1.2 2" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    }
    if (tabId === 'base') {
      return (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke={tone} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 4.5c2.7 0 4.8 2.1 4.8 4.8S14.7 14.1 12 14.1 7.2 12 7.2 9.3 9.3 4.5 12 4.5z" />
          <path d="M5.5 18.5c1.8-2.2 4-3.3 6.5-3.3s4.7 1.1 6.5 3.3" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke={tone} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 18.5V10.5" />
        <path d="M12 18.5V6.5" />
        <path d="M18 18.5v-4" />
      </svg>
    );
  };
  const tabThemes: Record<'registro' | 'base' | 'control', {
    activeCard: string;
    activeHint: string;
    activeLabel: string;
    badge: string;
    panelBorder: string;
    panelBg: string;
    panelHint: string;
  }> = {
    registro: {
      activeCard: 'border-emerald-300 bg-[linear-gradient(135deg,rgba(16,185,129,0.16)_0%,rgba(6,182,212,0.10)_100%)] shadow-[0_12px_32px_rgba(16,185,129,0.14)]',
      activeHint: 'text-emerald-700',
      activeLabel: 'text-slate-900',
      badge: 'bg-emerald-500/12 text-emerald-700 border border-emerald-200',
      panelBorder: 'border-emerald-100',
      panelBg: 'bg-[linear-gradient(180deg,rgba(236,253,245,0.92)_0%,rgba(255,255,255,0.96)_38%)]',
      panelHint: 'text-emerald-700',
    },
    base: {
      activeCard: 'border-rose-300 bg-[linear-gradient(135deg,rgba(251,113,133,0.12)_0%,rgba(249,115,22,0.10)_100%)] shadow-[0_12px_32px_rgba(251,113,133,0.10)]',
      activeHint: 'text-rose-700',
      activeLabel: 'text-slate-900',
      badge: 'bg-rose-500/12 text-rose-700 border border-rose-200',
      panelBorder: 'border-rose-100',
      panelBg: 'bg-[linear-gradient(180deg,rgba(255,241,242,0.92)_0%,rgba(255,255,255,0.96)_38%)]',
      panelHint: 'text-rose-700',
    },
    control: {
      activeCard: 'border-blue-300 bg-[linear-gradient(135deg,rgba(59,130,246,0.14)_0%,rgba(99,102,241,0.10)_100%)] shadow-[0_12px_32px_rgba(59,130,246,0.12)]',
      activeHint: 'text-blue-700',
      activeLabel: 'text-slate-900',
      badge: 'bg-blue-500/12 text-blue-700 border border-blue-200',
      panelBorder: 'border-blue-100',
      panelBg: 'bg-[linear-gradient(180deg,rgba(239,246,255,0.92)_0%,rgba(255,255,255,0.96)_38%)]',
      panelHint: 'text-blue-700',
    },
  };

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white/95 shadow-[0_25px_80px_rgba(15,23,42,0.12)]">
        <div className="bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_100%)] px-6 py-5 text-white">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.35em] text-cyan-100">Estudiantes</p>
              <h2 className="text-2xl font-black uppercase tracking-[0.08em]">Asistencia con reconocimiento facial</h2>
              <p className="mt-1 text-sm text-slate-200">Registro por clase diaria.</p>
            </div>
            <button type="button" onClick={exportExcel} className="rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-white transition hover:bg-white/20">
              Exportar Excel
            </button>
          </div>
        </div>
        <div className="grid gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4 xl:grid-cols-[minmax(220px,1.25fr)_88px_88px_160px_minmax(300px,0.95fr)] xl:items-end">
          <label className="space-y-1.5">
            <span className="block text-[9px] font-black uppercase tracking-[0.22em] text-slate-500">Area</span>
            <select value={areaId} onChange={(e) => { manualSelectionRef.current = true; setAreaId(e.target.value); setGrade(''); setSection(''); }} className="w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] font-black text-slate-700 outline-none focus:border-cyan-400">
              <option value="">Seleccionar area</option>
              {areaOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="block text-[9px] font-black uppercase tracking-[0.22em] text-slate-500">Grado</span>
            <select value={grade} onChange={(e) => { manualSelectionRef.current = true; setGrade(e.target.value); setSection(''); }} className="w-20 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] font-black text-slate-700 outline-none focus:border-cyan-400">
              <option value="">Seleccionar grado</option>
              {gradeOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="block text-[9px] font-black uppercase tracking-[0.22em] text-slate-500">Seccion</span>
            <select value={section} onChange={(e) => { manualSelectionRef.current = true; setSection(e.target.value); }} className="w-20 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] font-black text-slate-700 outline-none focus:border-cyan-400">
              <option value="">Seleccionar seccion</option>
              {sectionOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="block text-[9px] font-black uppercase tracking-[0.22em] text-slate-500">Fecha</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-35 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] font-black text-slate-700 outline-none focus:border-cyan-400" />
          </label>
          <div className="ml-auto grid w-[276px] grid-cols-2 gap-2 rounded-[1.2rem] border border-slate-200 bg-white px-3 py-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
            {[
              { label: 'Estudiantes', value: stats.total, rowTone: 'bg-slate-50', labelTone: 'text-slate-500', valueTone: 'text-slate-700' },
              { label: 'Base facial lista', value: stats.base, rowTone: 'bg-emerald-50', labelTone: 'text-emerald-700', valueTone: 'text-emerald-700' },
              { label: 'Presentes', value: stats.present, rowTone: 'bg-blue-50', labelTone: 'text-blue-700', valueTone: 'text-blue-700' },
              { label: 'Tardanzas', value: stats.tardy, rowTone: 'bg-amber-50', labelTone: 'text-amber-700', valueTone: 'text-amber-700' },
            ].map((card) => (
              <div key={card.label} className={`rounded-xl px-3 py-2 ${card.rowTone}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className={`text-[9px] font-black tracking-[0.01em] ${card.labelTone}`}>{card.label}:</p>
                  <p className={`text-[9px] font-black leading-none ${card.valueTone}`}>{card.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-100 bg-white px-6 pt-3 pb-0">
            <div className="overflow-visible rounded-t-[2rem] bg-[#2f6fe8] px-4 pt-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_22px_rgba(37,99,235,0.14)]">
            <div className="grid items-end gap-0 md:grid-cols-3">
              {tabs.map((tab, index) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative min-h-[58px] overflow-visible border-0 px-5 pb-3.5 pt-2.5 text-left transition-all duration-300 ${
                      active
                        ? 'z-10 bg-white text-slate-900 shadow-[0_8px_18px_rgba(15,23,42,0.07)]'
                        : 'bg-transparent text-white/95 hover:bg-white/6'
                    }`}
                    style={{
                      borderTopLeftRadius: active ? '34px' : '0px',
                      borderTopRightRadius: active ? '34px' : '0px',
                      borderBottomLeftRadius: '0px',
                      borderBottomRightRadius: '0px',
                      marginTop: active ? '2px' : '0px',
                      marginBottom: active ? '-1px' : '0px',
                      marginLeft: active ? '4px' : '0px',
                      marginRight: active ? '4px' : '0px',
                    }}
                  >
                    {active ? <span className="pointer-events-none absolute inset-x-10 top-0 h-[3px] rounded-full bg-[#ff8a3d]" /> : null}
                    {active ? <span className="pointer-events-none absolute inset-x-0 -bottom-6 h-6 bg-white" /> : null}
                    {!active && index < tabs.length - 1 ? <span className="pointer-events-none absolute right-0 top-3.5 h-6 w-px bg-white/14" /> : null}
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center ${
                        active ? 'rounded-full bg-slate-100' : ''
                      }`}>
                        {renderTabIcon(tab.id, active)}
                      </span>
                      <div>
                        <p className={`text-[15px] font-black tracking-[0.01em] ${active ? 'text-slate-800' : 'text-white'}`}>{tab.label}</p>
                        {tab.id === 'control' ? (
                          <p className={`mt-0.5 text-[10px] font-bold ${active ? 'text-slate-500' : 'text-white/72'}`}>
                            {bimesterMeta ? `${bimesterMeta.id} bimestre · ${visibleBimesterDays} de ${totalBimesterDays || 0} fecha(s) visibles` : 'Sin bimestre'}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            </div>
          </div>

          {renderRemoteConnectionBanner()}

          <div className={`grid gap-5 rounded-t-[1.85rem] bg-white px-6 pb-6 pt-4 ${activeTab === 'control' ? 'xl:grid-cols-[1.05fr_0.95fr]' : 'grid-cols-1'}`}>
            {activeTab !== 'control' ? (
          <div className="space-y-4">
            <div className={`rounded-[1.75rem] border p-5 ${tabThemes[activeTab].panelBorder} ${tabThemes[activeTab].panelBg}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className={`text-[10px] font-black uppercase tracking-[0.24em] ${tabThemes[activeTab].panelHint}`}>{activeTab === 'registro' ? 'Registro guiado' : 'Editar y limpiar'}</p>
                  <h3 className="text-[22px] font-black uppercase tracking-[0.06em] text-slate-800">Base facial estudiante por estudiante</h3>
                </div>
                {activeTab === 'registro' ? <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={startCamera} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-700 transition hover:border-cyan-400 hover:text-cyan-700">Camara</button>
                  <button type="button" onClick={startGuidedEnrollment} className="rounded-2xl bg-emerald-500 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white shadow-[0_12px_30px_rgba(16,185,129,0.25)] transition hover:translate-y-[-1px]">Iniciar registro guiado</button>
                  <button type="button" onClick={stopGuided} className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-rose-700 transition hover:bg-rose-100">Detener registro</button>
                </div> : null}
              </div>

              <div className={`mt-4 grid gap-4 ${activeTab === 'base' ? 'lg:grid-cols-[minmax(330px,0.78fr)_minmax(520px,1.22fr)] 2xl:grid-cols-[minmax(360px,0.76fr)_minmax(640px,1.24fr)]' : 'lg:grid-cols-[minmax(320px,0.92fr)_minmax(520px,1.48fr)] 2xl:grid-cols-[minmax(360px,0.88fr)_minmax(700px,1.52fr)]'}`}>
                <div className="space-y-3">
                  <label className="space-y-2">
                    <span className="block text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Estudiante actual</span>
                    <select value={selectedStudentId} onChange={(e) => setSelectedStudentId(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 outline-none focus:border-cyan-400">
                      <option value="">{activeTab === 'base' ? 'Todos los estudiantes' : 'Seleccionar estudiante'}</option>
                      {activeStudents.map((student) => <option key={student.id} value={String(student.id)}>{student.name}</option>)}
                    </select>
                  </label>
                  {activeTab === 'registro' ? <div className="rounded-2xl border border-cyan-100 bg-cyan-50/60 p-3.5">
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-700">Mini tutorial</p>
                    <ol className="mt-3 space-y-1.5 text-[11px] font-bold text-slate-700">
                      {ENROLLMENT_STEPS.map((step, index) => (
                        <li key={step.id} className={`rounded-xl px-3 py-2 ${guidedMode && guidedStep === index ? 'bg-white text-cyan-800 shadow-sm' : ''}`}>
                          {index + 1}. {step.label}
                        </li>
                      ))}
                    </ol>
                    <p className="mt-3 text-[10px] font-bold text-slate-500">El sistema toma las capturas automaticamente y al completar un estudiante se detiene para evitar duplicados.</p>
                  </div> : null}
                  {activeTab === 'registro' ? <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Pendientes de registro</p>
                    <p className="mt-2 text-2xl font-black text-slate-800">{pendingStudents.length}</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-500">{pendingStudents.length ? 'Aun faltan estudiantes por completar su base facial.' : 'La base facial del grupo ya esta completa.'}</p>
                  </div> : null}
                  <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Registros existentes</p>
                          <p className="mt-1 text-[11px] font-bold text-slate-500">{selectedStudent ? `${selectedStudentProfiles.length} muestra(s) del estudiante actual` : `${profiles.length} muestra(s) visibles del grupo`}</p>
                        </div>
                        <button type="button" onClick={resetSelectedStudentProfiles} disabled={!selectedStudentProfiles.length} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-rose-700 disabled:cursor-not-allowed disabled:opacity-50">
                          Reiniciar base
                        </button>
                      </div>
                    <div className="mt-3 max-h-44 space-y-2 overflow-auto pr-1">
                      {visibleProfiles.length ? visibleProfiles.map((profile) => (
                        <div key={profile.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-2.5 py-2">
                          <img src={profile.imageData || ''} alt={profile.studentName} className="h-12 w-12 rounded-lg object-cover" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">{profile.source || 'captura'}</p>
                            <p className="mt-0.5 text-[10px] font-bold text-slate-500">{profile.grade} {profile.section}</p>
                            <p className="text-[10px] font-bold text-slate-500">{profile.updatedAt || profile.createdAt || 'Sin fecha'}</p>
                          </div>
                          <button type="button" onClick={() => removeFaceSample(profile)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">
                            Eliminar
                          </button>
                        </div>
                      )) : (
                          <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-[10px] font-bold text-slate-400">
                            {selectedStudent ? 'Aun no hay muestras faciales guardadas para este estudiante.' : 'Aun no hay muestras faciales guardadas para este grupo.'}
                          </div>
                        )}
                      </div>
                  </div>
                </div>

                {activeTab === 'registro' ? <div className="rounded-[1.8rem] border border-slate-200 bg-slate-950 p-4 text-white shadow-[0_18px_45px_rgba(2,6,23,0.28)]">
                  <div className="mb-3">
                    {renderCameraSourcePanel()}
                  </div>
                  <div className="relative overflow-hidden rounded-[1.4rem] border border-white/10 bg-black">
                    {renderCameraViewport()}
                    <div className="pointer-events-none absolute inset-x-4 top-4 rounded-full bg-black/50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-cyan-100">
                      {guidedMode && guidedStudentId ? `Registrando a ${activeStudents.find((item) => String(item.id) === guidedStudentId)?.name || 'estudiante'}` : recognitionMode ? 'Reconocimiento activo' : 'Camara lista para asistencia'}
                    </div>
                    <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-center justify-between gap-3 rounded-[1.2rem] bg-black/55 px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-white">
                      <span>{capturePhaseLabel}</span>
                      <span>{guidedMode ? `Paso ${guidedStep + 1}/${ENROLLMENT_STEPS.length}` : recognitionMode ? 'Escaneo continuo' : 'Listo'}</span>
                    </div>
                  </div>
                  <p className="mt-3 text-[15px] font-black leading-snug text-cyan-100">{statusText}</p>
                  <p className="mt-1 text-[10px] font-bold leading-relaxed text-cyan-200">{faceHint}</p>
                  <p className="mt-1 text-[9px] font-black uppercase tracking-[0.14em] text-amber-200">{detectorStats}</p>
                  <p className="mt-1 text-[10px] font-bold leading-relaxed text-slate-300">{lastRecognized || 'Cuando inicies el reconocimiento, la asistencia se marcara automaticamente para los rostros reconocidos.'}</p>
                  {guidedMode && guidedStudent ? (
                    <div className="mt-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-100">
                      {guidedStudent.name} - muestras guardadas: {guidedSavedCount}/{SAMPLE_TARGET}
                    </div>
                  ) : null}
                  <div className="mt-3">
                    <p className="mb-2 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Miniaturas de captura</p>
                    <div className="grid grid-cols-4 gap-2">
                      {captureGallery.length ? captureGallery.map((item, index) => (
                        <div key={`${item.stepLabel}-${index}`} className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
                          <img src={item.imageData} alt={item.stepLabel} className="h-16 w-full object-cover" />
                          <div className="px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-cyan-100">{item.stepLabel}</div>
                        </div>
                      )) : attemptPreview ? (
                        <div className="col-span-4 overflow-hidden rounded-xl border border-amber-400/20 bg-black/40">
                          <img src={attemptPreview} alt="Ultimo intento" className="h-24 w-full object-cover" />
                          <div className="px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-amber-200">Ultimo intento detectado</div>
                        </div>
                      ) : (
                        <div className="col-span-4 rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[10px] font-bold text-slate-400">
                          Aqui veras las capturas conforme el sistema las vaya guardando.
                        </div>
                      )}
                    </div>
                  </div>
                </div> : <div className="rounded-[1.8rem] border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Galeria facial</p>
                      <h4 className="mt-1 text-[18px] font-black uppercase tracking-[0.05em] text-slate-800">Muestras del estudiante actual</h4>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-600">
                      {visibleProfiles.length} muestra(s)
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
                    {visibleProfiles.length ? visibleProfiles.map((profile) => (
                      <div key={profile.id} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                        <img src={profile.imageData || ''} alt={profile.studentName} className="h-28 w-full object-cover" />
                        <div className="space-y-1.5 p-2.5">
                          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-700">{profile.source || 'captura'}</p>
                          <p className="text-[9px] font-bold text-slate-500">{profile.grade} {profile.section}</p>
                          <p className="text-[9px] font-bold text-slate-500">{profile.updatedAt || profile.createdAt || 'Sin fecha'}</p>
                          <button type="button" onClick={() => removeFaceSample(profile)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-slate-700">Eliminar</button>
                        </div>
                      </div>
                    )) : <div className="col-span-2 lg:col-span-3 rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-[10px] font-bold text-slate-400">{selectedStudent ? 'No hay muestras faciales guardadas para este estudiante.' : 'No hay muestras faciales guardadas para este grupo.'}</div>}
                  </div>
                </div>}
              </div>
            </div>
          </div>
          ) : null}

          {activeTab === 'control' && !expandedBimesterView ? <div className="space-y-4">
            <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Reconocimiento</p>
                  <h3 className="text-lg font-black uppercase tracking-[0.08em] text-slate-800">Asistencia automatica por rostro</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={startRecognition} className="rounded-2xl bg-blue-600 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white shadow-[0_12px_30px_rgba(37,99,235,0.25)] transition hover:translate-y-[-1px]">▶️</button>
                  <button type="button" onClick={stopRecognition} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-700 transition hover:bg-slate-100">⏹️</button>
                </div>
              </div>
              
              <div className="mt-4">
                {renderCameraSourcePanel()}
              </div>
              <div className="mt-4 rounded-[1.8rem] border border-slate-200 bg-slate-950 p-3.5 text-white">
                {renderCameraViewport()}
                <p className="mt-3 text-[15px] font-black leading-snug text-cyan-100">{statusText}</p>
                <p className="mt-1 text-[10px] font-bold leading-relaxed text-cyan-200">{faceHint}</p>
                <p className="mt-1 text-[9px] font-black uppercase tracking-[0.14em] text-amber-200">{detectorStats}</p>
                
              </div>
            </div>
          </div> : null}

          {activeTab === 'control' ? <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5">
            {!grade || !section ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm font-bold text-slate-500">
                Selecciona un grado y una seccion para abrir la base de estudiantes y asistencia.
              </div>
            ) : !activeStudents.length ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-10 text-center text-sm font-bold text-rose-700">
                No tenemos base de estudiantes para {grade} {section}. Primero registra o migra estudiantes en este grupo.
              </div>
            ) : (
              <>
              <div className="mt-4 rounded-[1.4rem] border border-slate-200">
                <div className="relative border-b border-slate-200 bg-[linear-gradient(135deg,#eff6ff_0%,#f8fafc_100%)] px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setExpandedBimesterView((prev) => !prev)}
                    disabled={totalBimesterDays <= 1}
                    title={expandedBimesterView ? 'Ver solo el dia actual' : totalBimesterDays > 1 ? `Mostrar las ${totalBimesterDays} fechas` : 'Solo hay 1 fecha visible'}
                    className="absolute right-4 top-3 inline-flex h-10 items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 text-slate-700 shadow-sm transition hover:border-cyan-300 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {expandedBimesterView ? (
                        <>
                          <rect x="5" y="6" width="14" height="12" rx="2" />
                          <path d="M9 10h6" />
                          <path d="M9 14h4" />
                        </>
                      ) : (
                        <>
                          <rect x="4.5" y="5.5" width="6" height="6" rx="1.2" />
                          <rect x="13.5" y="5.5" width="6" height="6" rx="1.2" />
                          <rect x="4.5" y="12.5" width="6" height="6" rx="1.2" />
                          <rect x="13.5" y="12.5" width="6" height="6" rx="1.2" />
                        </>
                      )}
                    </svg>
                    <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${expandedBimesterView ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M8 10l4 4 4-4" />
                    </svg>
                  </button>
                  <div className="flex flex-wrap items-start justify-between gap-3 pr-24">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{loadingData ? 'Sincronizando...' : `${records.length} registro(s) del dia`}</p>
                      <p className="mt-1 text-sm font-black text-slate-800">{currentAssignment?.areaName || 'Area'} - {grade} {section} - {bimesterMeta ? `${bimesterMeta.id} bimestre` : 'Sin bimestre'}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em]">
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">✓ Asistencia</span>
                      <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700">✗ Falta</span>
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">⌛ Tardanza</span>
                      <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700">✏️ Justificada</span>
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">★ Feriado</span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-500">- Futuro bloqueado</span>
                    </div>
                  </div>
                </div>
               
                <div className="max-h-[640px] overflow-x-auto overflow-y-auto pb-3">
                  <div className="inline-block min-w-max pr-6 align-top">
                  <table className="table-fixed border-collapse" style={{ minWidth: `${attendanceTableWidth}px`, width: 'max-content' }}>
                    
                    <colgroup>
                      <col style={{ width: `${indexColumnWidth}px` }} />
                      <col style={{ width: `${nameColumnWidth}px` }} />
                      {visibleBimesterDayColumns.flatMap((group) => group.dates.map((day) => (
                        <col key={`col-${group.unitNumber}-${day.date}`} style={{ width: `${dayColumnWidth}px` }} />
                      )))}
                      <col style={{ width: `${summaryColumnWidth}px` }} />
                      <col style={{ width: `${summaryColumnWidth}px` }} />
                      <col style={{ width: `${summaryColumnWidth}px` }} />
                      <col style={{ width: `${summaryColumnWidth}px` }} />
                    </colgroup>
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-900 text-white">
                        <th rowSpan={3} className="sticky left-0 z-20 border-r border-white/10 bg-slate-900 px-3 py-2 text-center text-[10px] font-black uppercase tracking-[0.18em]">N.</th>
                        <th rowSpan={3} className="sticky z-20 border-r border-white/10 bg-slate-900 px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.18em]" style={{ left: `${indexColumnWidth}px`, width: `${nameColumnWidth}px` }}>Apellidos y nombres</th>
                        <th colSpan={visibleBimesterDays} className="border-l border-white/10 bg-sky-900 px-3 py-2 text-center text-[11px] font-black uppercase tracking-[0.22em]">
                          {bimesterMeta ? `${bimesterMeta.id} bimestre` : 'Bimestre'}
                        </th>
                        <th rowSpan={3} className="border-l border-white/10 bg-sky-700 px-1 py-2 text-center text-[10px] font-black uppercase tracking-[0.18em]" style={{ width: `${summaryColumnWidth}px` }}>
                          <span className="inline-flex min-h-[110px] items-center justify-center [writing-mode:vertical-rl] rotate-180">Asistencias</span>
                        </th>
                        <th rowSpan={3} className="bg-rose-600 px-1 py-2 text-center text-[10px] font-black uppercase tracking-[0.18em]" style={{ width: `${summaryColumnWidth}px` }}>
                          <span className="inline-flex min-h-[110px] items-center justify-center [writing-mode:vertical-rl] rotate-180">Faltas</span>
                        </th>
                        <th rowSpan={3} className="bg-violet-700 px-1 py-2 text-center text-[10px] font-black uppercase tracking-[0.18em]" style={{ width: `${summaryColumnWidth}px` }}>
                          <span className="inline-flex min-h-[110px] items-center justify-center [writing-mode:vertical-rl] rotate-180">Tardanzas</span>
                        </th>
                        <th rowSpan={3} className="bg-amber-500 px-1 py-2 text-center text-[10px] font-black uppercase tracking-[0.18em]" style={{ width: `${summaryColumnWidth}px` }}>
                          <span className="inline-flex min-h-[110px] items-center justify-center [writing-mode:vertical-rl] rotate-180">Justifiaciones</span>
                        </th>
                      </tr>
                      <tr className="bg-slate-100 text-white">
                        {visibleBimesterDayColumns.map((group) => (
                          <th key={group.unitNumber} colSpan={group.dates.length} className={`border-l border-white/10 px-3 py-1.5 text-center text-[10px] font-black uppercase tracking-[0.18em] ${group.unitNumber % 2 === 0 ? 'bg-blue-800' : 'bg-sky-800'}`}>
                            {group.unitLabel}
                          </th>
                        ))}
                      </tr>
                      <tr className="bg-slate-100 text-slate-700">
                        {visibleBimesterDayColumns.flatMap((group) => group.dates.map((day) => (
                          <th key={`${group.unitNumber}-${day.date}`} className={`border-l border-slate-200 px-1 py-1.5 text-center text-[10px] font-black uppercase tracking-[0.08em] ${day.date === date ? 'bg-cyan-100 text-cyan-800' : day.isHoliday ? 'bg-amber-100 text-amber-800' : day.isFuture ? 'bg-slate-100 text-slate-400' : ''}`} style={{ width: `${dayColumnWidth}px` }}>
                            <div>{shortDayNames[new Date(`${day.date}T00:00:00`).getDay()] || ''}</div>
                            <div className="mt-0.5 text-[9px]">{formatShortDate(day.date)}</div>
                            <div className="mt-0.5 text-[9px]">{day.isHoliday ? '★' : day.isFuture ? '-' : ''}</div>
                          </th>
                        )))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeStudents.map((student) => {
                        const summary = bimesterSummaries.get(String(student.id)) || { P: 0, F: 0, T: 0, J: 0 };
                        const rowTone = resolveStudentRowTone(student);
                        const normalizedEstado = normalize(String(student.estado || ''));
                        const hasSpecialRow = normalizedEstado === 'r' || normalizedEstado === 't' || normalizedEstado === 'na' || normalizedEstado.includes('retir') || normalizedEstado.includes('traslad') || normalizedEstado.includes('no asiste');
                        const isHighlightedRow = !hasSpecialRow && String(student.id) === String(highlightedAttendanceStudentId);
                        const rowIndex = activeStudents.findIndex((item) => String(item.id) === String(student.id)) + 1;
                        return (
                          <tr key={student.id} className={`${hasSpecialRow ? rowTone : isHighlightedRow ? 'bg-cyan-100/80' : String(student.id) === String(selectedStudentId) ? 'bg-cyan-50/70' : 'bg-white'}`}>
                            <td className={`sticky left-0 z-[1] border-b border-r bg-inherit px-2 py-0.5 text-center text-[10px] font-black leading-tight ${hasSpecialRow ? 'border-white/10 text-inherit' : isHighlightedRow ? 'border-cyan-200 text-cyan-900 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)]' : 'border-slate-100 text-slate-700'}`}>{rowIndex}</td>
                            <td className={`sticky z-[1] border-b border-r bg-inherit px-3 py-0.5 ${hasSpecialRow ? 'border-white/10' : isHighlightedRow ? 'border-cyan-200 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)]' : 'border-slate-100'}`} style={{ left: `${indexColumnWidth}px`, width: `${nameColumnWidth}px` }}>
                              <button type="button" onClick={() => setSelectedStudentId(String(student.id))} className="text-left">
                                <p className={`text-[8.5px] leading-tight font-black ${hasSpecialRow ? 'text-inherit' : isHighlightedRow ? 'text-cyan-950' : 'text-slate-800'}`}>{student.name}</p>
                              </button>
                            </td>
                            {visibleBimesterDayColumns.flatMap((group) => group.dates.map((day) => {
                              const dayRecord = historyAttendanceMap.get(`${student.id}__${day.date}`);
                              const canEdit = !hasSpecialRow && !day.isFuture && !day.isNonLective;
                              const statusGlyph = getStatusDisplayGlyph(dayRecord?.status);
                              return (
                                <td
                                  key={`${student.id}-${day.date}`}
                                  onClick={canEdit ? () => cycleDailyStatus(student, day.date) : undefined}
                                  className={`border-b border-l px-1 py-0.5 text-center text-[13px] font-black leading-none ${
                                    hasSpecialRow
                                      ? 'border-white/10 bg-inherit text-inherit'
                                      : day.isHoliday || day.isNonLective
                                      ? 'bg-amber-50 text-amber-700'
                                      : day.isFuture
                                        ? 'bg-slate-100 text-slate-300'
                                        : getStatusTone(dayRecord?.status)
                                  } ${hasSpecialRow ? '' : canEdit ? isHighlightedRow ? 'cursor-pointer bg-cyan-100 hover:bg-cyan-100' : 'cursor-pointer bg-cyan-50 hover:bg-cyan-100' : !day.isHoliday && !day.isFuture ? group.unitNumber % 2 === 0 ? 'bg-blue-50/50' : 'bg-sky-50/40' : ''} ${isHighlightedRow && !hasSpecialRow ? 'border-cyan-200 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)]' : ''}`} style={{ width: `${dayColumnWidth}px` }}
                                  title={
                                    hasSpecialRow
                                      ? 'Fila bloqueada para estudiantes retirados, trasladados o no asistentes.'
                                      : day.isHoliday
                                        ? (day.holidayName || 'Feriado / dia no lectivo')
                                        : day.isFuture
                                          ? 'Fecha futura: asistencia bloqueada.'
                                          : 'Haz clic para cambiar el estado de esta fecha.'
                                  }
                                >
                                  {day.isHoliday || day.isNonLective ? (
                                    <span className="inline-flex min-h-[14px] min-w-[14px] items-center justify-center text-[11px] leading-none text-amber-700">★</span>
                                  ) : day.isFuture ? (
                                    <span className="inline-flex min-h-[14px] min-w-[14px] items-center justify-center text-[11px] leading-none text-slate-400">-</span>
                                  ) : statusGlyph ? (
                                    <span className={`inline-flex min-h-[14px] min-w-[14px] items-center justify-center rounded-full px-1 text-[10px] font-black leading-none ${getStatusBadgeTone(dayRecord?.status)}`}>
                                      {statusGlyph}
                                    </span>
                                  ) : ''}
                                </td>
                              );
                            }))}
                            <td className={`border-b border-l px-2 py-0.5 text-center text-[12px] font-black leading-none ${hasSpecialRow ? 'border-white/10 bg-inherit text-inherit' : isHighlightedRow ? 'border-cyan-200 bg-sky-100 text-sky-800 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)]' : 'border-slate-100 bg-sky-50 text-sky-700'}`} style={{ width: `${summaryColumnWidth}px` }}>{summary.P}</td>
                            <td className={`border-b px-2 py-0.5 text-center text-[12px] font-black leading-none ${hasSpecialRow ? 'border-white/10 bg-inherit text-inherit' : isHighlightedRow ? 'border-cyan-200 bg-rose-100 text-rose-800 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)]' : 'border-slate-100 bg-rose-50 text-rose-700'}`} style={{ width: `${summaryColumnWidth}px` }}>{summary.F}</td>
                            <td className={`border-b px-2 py-0.5 text-center text-[12px] font-black leading-none ${hasSpecialRow ? 'border-white/10 bg-inherit text-inherit' : isHighlightedRow ? 'border-cyan-200 bg-violet-100 text-violet-800 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)]' : 'border-slate-100 bg-violet-50 text-violet-700'}`} style={{ width: `${summaryColumnWidth}px` }}>{summary.T}</td>
                            <td className={`border-b px-2 py-0.5 text-center text-[12px] font-black leading-none ${hasSpecialRow ? 'border-white/10 bg-inherit text-inherit' : isHighlightedRow ? 'border-cyan-200 bg-amber-100 text-amber-800 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)]' : 'border-slate-100 bg-amber-50 text-amber-700'}`} style={{ width: `${summaryColumnWidth}px` }}>{summary.J}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </div>
              </div>
              </>
            )}
          </div> : null}
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};
