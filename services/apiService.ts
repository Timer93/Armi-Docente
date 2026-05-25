
import { API_BASE_URL, INITIAL_GENERAL_DATA, INITIAL_MODULE_STATUS, DEPARTAMENTOS_PERU_MOCK } from '../constants';
import { GeneralData, ModuleStatus, ApiResponse, Student, AttendanceRecord, FaceProfile, AuthSession } from '../types';

const BACKEND_URL = '/api';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const safeFetch = async (url: string, options?: RequestInit, timeoutMs = 12000): Promise<Response> => {
    const method = (options?.method || 'GET').toUpperCase();
    const shouldRetry = method === 'GET' || method === 'HEAD';
    const attempts = shouldRetry ? 4 : 1;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id);

            if (shouldRetry && response.status >= 500 && attempt < attempts) {
                await wait(700 * attempt);
                continue;
            }

            return response;
        } catch (error: any) {
            clearTimeout(id);

            if (shouldRetry && attempt < attempts && (error.name === 'AbortError' || error instanceof TypeError)) {
                await wait(700 * attempt);
                continue;
            }

            if (error.name === 'AbortError') throw new Error("Tiempo de espera agotado (Servidor no responde)");
            if (error instanceof TypeError) throw new Error("No se pudo conectar con el backend. Inicia el proyecto con `npm run dev`.");
            throw error;
        }
    }

    throw new Error('No se pudo completar la solicitud al backend.');
};

const readJsonResponse = async <T = any>(res: Response): Promise<T> => {
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    const trimmed = text.trim();

    if (!trimmed) {
        throw new Error(`El backend no devolvió contenido (HTTP ${res.status}).`);
    }

    try {
        return JSON.parse(trimmed) as T;
    } catch {
        if (!contentType.includes('application/json')) {
            throw new Error(trimmed.slice(0, 220) || `El backend no devolvió JSON válido (HTTP ${res.status}).`);
        }
        throw new Error(`El backend devolvió JSON inválido (HTTP ${res.status}).`);
    }
};

export interface SchoolResult {
    cod_mod: string;
    nombre_ie: string;
    nivel: string;
    d_dpto: string;
    d_prov: string;
    d_dist: string;
    d_dreugel: string;
    gestion: string;
}

export interface CloudSyncFileMeta {
    relativePath: string;
    scope: string;
    size: number;
    mtimeMs: number;
    checksum: string;
}

export interface CloudSyncManifest {
    version: number;
    provider: string;
    generatedAt: string;
    digest: string;
    summary?: {
        entities?: {
            programaciones?: number;
            unidades?: number;
            sesiones?: number;
            estudiantes?: number;
            egresados?: number;
            asistencias?: number;
            rostros?: number;
        };
        includesAttendance?: boolean;
        includesFaceProfiles?: boolean;
    };
    files: CloudSyncFileMeta[];
}

export interface CloudSyncStatusData {
    config: {
        mode: 'local' | 'drive_mirror' | 'apps_script_drive';
        mirrorPath: string;
        resolvedMirrorPath: string;
        mirrorPathDerivedAutomatically: boolean;
        autoSyncOnClose: boolean;
        syncUserKey: string;
        syncUserLabel: string;
        lastUpdatedAt: string | null;
        remoteProvider?: string | null;
        lastCloudVersion?: string;
        remoteLookupMessage?: string;
        remoteUser?: {
            syncUserKey?: string;
            syncUserLabel?: string;
            folderId?: string;
            folderName?: string;
            folderUrl?: string;
            currentFolderId?: string;
            currentFolderUrl?: string;
            versionsFolderId?: string;
            versionsFolderUrl?: string;
            conflictsFolderId?: string;
            conflictsFolderUrl?: string;
        } | null;
        remoteActivity?: {
            conflicts?: {
                count: number;
                latestAt?: string;
                latestId?: string;
                latestUrl?: string;
                items?: Array<{
                    id: string;
                    name: string;
                    kind: string;
                    createdAt?: string;
                    generatedAt?: string;
                    deviceId?: string;
                    digest?: string;
                    currentCloudVersion?: string;
                    baseCloudVersion?: string;
                    summary?: CloudSyncManifest['summary'];
                    url?: string;
                }>;
            };
            versions?: {
                count: number;
                latestAt?: string;
                latestId?: string;
                latestUrl?: string;
                items?: Array<{
                    id: string;
                    name: string;
                    kind: string;
                    createdAt?: string;
                    generatedAt?: string;
                    deviceId?: string;
                    digest?: string;
                    currentCloudVersion?: string;
                    baseCloudVersion?: string;
                    summary?: CloudSyncManifest['summary'];
                    url?: string;
                }>;
            };
        } | null;
    };
    localManifest: CloudSyncManifest | null;
    savedManifest: CloudSyncManifest | null;
    mirrorManifest: CloudSyncManifest | null;
    comparison: 'local-mode' | 'no-data' | 'mirror-missing' | 'mirror-newer' | 'local-newer' | 'in-sync' | 'diverged' | 'mirror-incomplete';
    lastFrontendStateAt: string | null;
    driveDesktop: {
        detected: boolean;
        candidates: Array<{
            basePath: string;
            suggestedMirrorPath: string;
        }>;
    };
    pendingLocal?: {
        createdAt?: string;
        reason?: string;
        restorePoint?: string;
        manifest?: CloudSyncManifest | null;
        counts?: Record<string, number> | null;
        note?: string;
    } | null;
    frontendState?: {
        exportedAt?: string | null;
        keys: Record<string, string>;
    } | null;
    safety: {
        restorePointsPath: string;
        retention: number;
        missingMirrorFiles: string[];
    };
}

export interface LocalCloudSyncStatusData {
    config: {
        mode: 'local' | 'drive_mirror' | 'apps_script_drive';
        autoSyncOnClose: boolean;
        syncUserKey: string;
        syncUserLabel: string;
    };
    localManifest: CloudSyncManifest | null;
    savedManifest: CloudSyncManifest | null;
    pendingLocal?: {
        createdAt?: string;
        reason?: string;
        restorePoint?: string;
        manifest?: CloudSyncManifest | null;
        counts?: Record<string, number> | null;
        note?: string;
    } | null;
    hasUnsyncedChanges: boolean;
    lastFrontendStateAt: string | null;
    frontendState?: {
        exportedAt?: string | null;
        keys: Record<string, string>;
    } | null;
}

export interface RemoteCameraSessionData {
    sessionId: string;
    phoneUrl: string;
    lanAddresses: string[];
    createdAt: string;
}

export interface RemoteCameraSessionFrame {
    sessionId: string;
    connected: boolean;
    imageData: string;
    width: number;
    height: number;
    createdAt: string;
    lastFrameAt: string | null;
}

export const loginUser = async (data: { username: string; password: string; remember?: boolean; deviceContext?: Record<string, any> }): Promise<ApiResponse<AuthSession>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }, 30000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export interface PurchasePayload {
    varNombres: string;
    varDNI: string;
    varLugar: string;
    varIE: string;
    varEspecialidad: string;
    varUsuario: string;
    varContrasena: string;
    varGmail: string;
    varOutlook: string;
    varTelegram: string;
    varWhatsApp: string;
    imageBase64: string;
    varTerminos: boolean;
    deviceContext?: Record<string, any>;
}

export const submitPurchaseRequest = async (data: PurchasePayload): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/auth/purchase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }, 150000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const checkPurchaseStatus = async (data: { varDNI?: string; varUsuario?: string }): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/auth/purchase/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }, 60000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const getPurchaseConfig = async (): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/auth/purchase/config`, undefined, 30000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

// --- SESIONES ---
export const getSesion = async (year: string, areaId: string, grade: string, section: string, unitNumber: string, sessionNumber: string): Promise<any> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sesiones?year=${year}&areaId=${areaId}&grade=${grade}&section=${section}&unitNumber=${unitNumber}&sessionNumber=${sessionNumber}`);
        const json = await res.json();
        return json.success ? json.data : null;
    } catch (e) { return null; }
};

export const saveSesion = async (payload: { year: string, areaId: string, grade: string, section: string, unitNumber: string, sessionNumber: string, date?: string, sessionData: any }): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sesiones`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const getAllSesiones = async (): Promise<Record<string, any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sesiones`);
        const json = await res.json();
        return json.success ? json.data : {};
    } catch (e) { return {}; }
};

export const deleteSesion = async (id: string): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sesiones/${id}`, {
            method: 'DELETE',
        });
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

// --- UNIDADES DIDÃCTICAS ---
export const getUnidadDidactica = async (year: string, areaId: string, grade: string, section: string, unitNumber: string): Promise<any> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/unidades-didacticas?year=${year}&areaId=${areaId}&grade=${grade}&section=${section}&unitNumber=${unitNumber}`);
        const json = await res.json();
        return json.success ? json.data : null;
    } catch (e) { return null; }
};

export const saveUnidadDidactica = async (data: any): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/unidades-didacticas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const getAllUnidadesDidacticas = async (): Promise<Record<string, any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/unidades-didacticas`);
        const json = await res.json();
        return json.success ? json.data : {};
    } catch (e) { return {}; }
};

// --- METAS DE APRENDIZAJE ---
export const getLearningGoalsStats = async (area: string, grado: string, anio: string, nivel: string): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/metas-aprendizaje/stats?area=${encodeURIComponent(area)}&grado=${encodeURIComponent(grado)}&anio=${encodeURIComponent(anio)}&nivel=${encodeURIComponent(nivel)}`);
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const saveLearningGoal = async (meta: any): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/metas-aprendizaje`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ meta }),
        });
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

// --- UBIGEO ---
export const getDepartamentos = async (): Promise<string[]> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/ubigeo/departamentos`);
        const json = await res.json();
        return (json.success && json.data.length > 0) ? json.data : DEPARTAMENTOS_PERU_MOCK;
    } catch (e) { return DEPARTAMENTOS_PERU_MOCK; }
};

export const getProvincias = async (dpto: string): Promise<string[]> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/ubigeo/provincias?dpto=${encodeURIComponent(dpto)}`);
        const json = await res.json();
        return json.data || [];
    } catch (e) { return []; }
};

export const getDistritos = async (dpto: string, prov: string): Promise<string[]> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/ubigeo/distritos?dpto=${encodeURIComponent(dpto)}&prov=${encodeURIComponent(prov)}`);
        const json = await res.json();
        return json.data || [];
    } catch (e) { return []; }
};

export const getColegios = async (dpto: string, prov: string, dist: string, nivel?: string): Promise<SchoolResult[]> => {
    try {
        let url = `${BACKEND_URL}/ubigeo/colegios?dpto=${encodeURIComponent(dpto)}&prov=${encodeURIComponent(prov)}&dist=${encodeURIComponent(dist)}`;
        if (nivel) url += `&nivel=${encodeURIComponent(nivel)}`;
        const res = await safeFetch(url);
        const json = await res.json();
        return json.data || [];
    } catch (e) { return []; }
};

export const getDatosGenerales = async (): Promise<GeneralData> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/datos-generales`);
        const json = await res.json();
        return json.data?.id ? json.data : INITIAL_GENERAL_DATA;
    } catch (e) { return INITIAL_GENERAL_DATA; }
};

export const saveDatosGenerales = async (data: GeneralData): Promise<ApiResponse<GeneralData>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/datos-generales`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return await res.json();
    } catch (e: any) { 
        return { success: false, message: "Error: " + e.message };
    }
};

export const saveImageAssetFile = async (data: {
    imageData: string;
    kind: 'general_insignia' | 'general_logo' | 'profile';
    userKey?: string;
}): Promise<ApiResponse<{ fileUrl: string; relativePath: string }>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/assets/image-file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: "Error: " + e.message };
    }
};

export const getSystemHealth = async () => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/health`);
        return await res.json();
    } catch (e) { return { success: false, status: 'offline' }; }
};

export const saveCloudFrontendState = async (state: Record<string, string>): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sync/frontend-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state }),
        });
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const getCloudSyncStatus = async (): Promise<ApiResponse<CloudSyncStatusData>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sync/status`, undefined, 30000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const saveCloudSyncConfig = async (data: {
    mode: 'local' | 'drive_mirror' | 'apps_script_drive';
    mirrorPath?: string;
    autoSyncOnClose?: boolean;
    syncUserKey?: string;
    syncUserLabel?: string;
}): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sync/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }, 30000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const pushCloudSync = async (): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sync/push`, {
            method: 'POST',
        }, 120000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const markPendingCloudSync = async (data?: { reason?: string; note?: string }): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sync/pending/mark`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data || {}),
        }, 120000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const getLocalCloudSyncStatus = async (): Promise<ApiResponse<LocalCloudSyncStatusData>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sync/status/local`, undefined, 12000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const discardPendingCloudSync = async (): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sync/pending/discard`, {
            method: 'POST',
        }, 30000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const pullCloudSync = async (data?: { force?: boolean }): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sync/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data || {}),
        }, 120000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const pullCloudArtifact = async (data: { artifactId?: string; artifactKind: 'version' | 'conflict' | 'current' }): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sync/artifact/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }, 120000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const applyCloudArtifact = async (data: { artifactId?: string; artifactKind: 'version' | 'conflict' | 'current' }): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sync/artifact/apply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }, 120000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const mergeAttendanceFromCloudArtifact = async (data: { artifactId?: string; artifactKind: 'version' | 'conflict' | 'current' }): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sync/artifact/merge-attendance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }, 120000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const mergeStudentsFromCloudArtifact = async (data: { artifactId?: string; artifactKind: 'version' | 'conflict' | 'current' }): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sync/artifact/merge-students`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }, 120000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const clearCloudVersionHistory = async (): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sync/history/clear`, {
            method: 'POST',
        }, 120000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const resolveCloudConflict = async (data: { artifactId: string }): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sync/conflict/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }, 120000);
        return await readJsonResponse(res);
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const getModuleStatus = async (): Promise<ModuleStatus> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/estado-modulos`);
        const json = await res.json();
        const raw = json.data || {};
        const status: any = {};
        Object.keys(INITIAL_MODULE_STATUS).forEach(key => {
            status[key] = !!raw[key];
        });
        return status as ModuleStatus;
    } catch (e) { return INITIAL_MODULE_STATUS; }
};

export const updateModuleStatus = async (moduleName: string, status: boolean): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/estado-modulos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [moduleName]: status ? 1 : 0 }),
        });
        return await res.json();
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

// --- ESTUDIANTES ---
export const getEstudiantes = async (): Promise<Student[]> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/estudiantes`);
        const json = await res.json();
        return json.data || [];
    } catch (e) { return []; }
};

export const saveEstudiante = async (s: Student): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/estudiantes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(s),
        });
        return await res.json();
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const deleteEstudiante = async (id: string | number): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/estudiantes/${id}`, {
            method: 'DELETE',
        });
        return await res.json();
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const getEgresados = async (query = ''): Promise<Student[]> => {
    try {
        const suffix = query ? `?q=${encodeURIComponent(query)}` : '';
        const res = await safeFetch(`${BACKEND_URL}/egresados${suffix}`);
        const json = await res.json();
        return json.data || [];
    } catch (e) { return []; }
};

export const egresarEstudiantes = async (ids: Array<string | number>): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/estudiantes/egresar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            const text = await res.text();
            if (text.includes('<!DOCTYPE') || text.includes('<html')) {
                return { success: false, message: 'El backend no reconocio la ruta de egreso. Reinicia el servidor y vuelve a intentarlo.' };
            }
            return { success: false, message: 'Respuesta invalida del servidor al intentar egresar estudiantes.' };
        }
        return await res.json();
    } catch (e: any) {
        return { success: false, message: e.message };
    }
  };

export const getAttendanceRecords = async (params: { date: string; grade: string; section: string }): Promise<AttendanceRecord[]> => {
    try {
        const search = new URLSearchParams({
            date: params.date || '',
            grade: params.grade || '',
            section: params.section || '',
        });
        const res = await safeFetch(`${BACKEND_URL}/asistencia/registros?${search.toString()}`);
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) return [];
        const json = await res.json();
        return json.data || [];
    } catch (e) { return []; }
};

export const saveAttendanceRecord = async (record: AttendanceRecord): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/asistencia/registros`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record),
        });
        try {
            return await readJsonResponse<ApiResponse<any>>(res);
        } catch (error: any) {
            const message = String(error?.message || '');
            if (message.includes('<!DOCTYPE') || message.includes('<html') || message.includes('no devolvió JSON válido')) {
                return { success: false, message: 'El backend no reconocio la ruta de asistencia. Reinicia el servidor y vuelve a intentarlo.' };
            }
            return { success: false, message: message || 'Respuesta invalida del servidor al guardar la asistencia.' };
        }
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const getFaceProfiles = async (params: { grade: string; section: string }): Promise<FaceProfile[]> => {
    try {
        const search = new URLSearchParams({
            grade: params.grade || '',
            section: params.section || '',
        });
        const res = await safeFetch(`${BACKEND_URL}/asistencia/rostros?${search.toString()}`);
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) return [];
        const json = await res.json();
        return json.data || [];
    } catch (e) { return []; }
};

export const saveFaceProfile = async (profile: Omit<FaceProfile, 'id'>): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/asistencia/rostros`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profile),
        });
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            const text = await res.text();
            if (text.includes('<!DOCTYPE') || text.includes('<html')) {
                return { success: false, message: 'El backend no reconocio la ruta de base facial. Reinicia el servidor y vuelve a intentarlo.' };
            }
            return { success: false, message: 'Respuesta invalida del servidor al registrar el rostro.' };
        }
        return await res.json();
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const deleteFaceProfile = async (id: string | number): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/asistencia/rostros/${id}`, { method: 'DELETE' });
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            return { success: false, message: 'Respuesta invalida del servidor al eliminar la muestra facial.' };
        }
        return await res.json();
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const resetStudentFaceProfiles = async (params: { studentId: string | number; grade: string; section: string }): Promise<ApiResponse<any>> => {
    try {
        const search = new URLSearchParams({
            studentId: String(params.studentId || ''),
            grade: params.grade || '',
            section: params.section || '',
        });
        const res = await safeFetch(`${BACKEND_URL}/asistencia/rostros?${search.toString()}`, { method: 'DELETE' });
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            return { success: false, message: 'Respuesta invalida del servidor al reiniciar la base facial.' };
        }
        return await res.json();
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const createRemoteCameraSession = async (): Promise<ApiResponse<RemoteCameraSessionData>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/remote-camera/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const json = await readJsonResponse<ApiResponse<RemoteCameraSessionData>>(res);
        return json;
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const getRemoteCameraSessionFrame = async (sessionId: string): Promise<ApiResponse<RemoteCameraSessionFrame>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/remote-camera/session/${encodeURIComponent(sessionId)}`);
        const json = await readJsonResponse<ApiResponse<RemoteCameraSessionFrame>>(res);
        return json;
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const closeRemoteCameraSession = async (sessionId: string): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/remote-camera/session/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE',
        });
        const json = await readJsonResponse<ApiResponse<any>>(res);
        return json;
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

// --- EVALUACIÃ“N DIAGNÃ“STICA ---
export const getResultadosDiagnostico = async (area: string, grado: string, seccion: string, anio: string, nivel: string): Promise<any[]> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/resultados-diagnostico?area=${encodeURIComponent(area)}&grado=${encodeURIComponent(grado)}&seccion=${encodeURIComponent(seccion)}&anio=${encodeURIComponent(anio)}&nivel=${encodeURIComponent(nivel)}`);
        const json = await res.json();
        return json.data || [];
    } catch (e) { return []; }
};

export const saveResultadosDiagnostico = async (results: any[]): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/resultados-diagnostico`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ results }),
        });
        return await res.json();
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const deleteResultadosDiagnostico = async (area: string, grado: string, seccion: string, anio: string, nivel: string): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/resultados-diagnostico?area=${encodeURIComponent(area)}&grado=${encodeURIComponent(grado)}&seccion=${encodeURIComponent(seccion)}&anio=${encodeURIComponent(anio)}&nivel=${encodeURIComponent(nivel)}`, {
            method: 'DELETE',
        });
        return await res.json();
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

// --- WORD MAIL MERGE ---
export const startWordGeneration = async (ids: string[], customPath: string, anchorPath: boolean): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/programacion-word/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, customPath, anchorPath }),
        });
        return await res.json();
    } catch (e) { return { success: false, message: 'Fallo al iniciar generaciÃ³n' }; }
};

export const getWordGenerationStatus = async (): Promise<any> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/programacion-word/status`);
        return await res.json();
    } catch (e) { return { active: false }; }
};

export const openWordFolder = async (customPath: string): Promise<void> => {
    await safeFetch(`${BACKEND_URL}/programacion-word/open-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPath }),
    });
};

export const pickWordFolder = async (): Promise<{ success: boolean; path?: string; message?: string; cancelled?: boolean }> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/programacion-word/pick-folder`, undefined, 600000);
        return await res.json();
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const getWordTemplateFields = async (): Promise<{ success: boolean; fields: string[]; sessionMarkers: string[]; delimiters?: { start: string; end: string }; message?: string }> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/programacion-word/template-fields`);
        return await res.json();
    } catch (e: any) {
        return { success: false, fields: [], sessionMarkers: [], message: e.message };
    }
};

export const startUnitWordGeneration = async (ids: string[], customPath: string, anchorPath: boolean): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/unidad-word/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, customPath, anchorPath }),
        });
        return await res.json();
    } catch (e) { return { success: false, message: 'Fallo al iniciar generaciÃƒÂ³n de unidades' }; }
};

export const getUnitWordGenerationStatus = async (): Promise<any> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/unidad-word/status`);
        return await res.json();
    } catch (e) { return { active: false }; }
};

export const openUnitWordFolder = async (customPath: string): Promise<void> => {
    await safeFetch(`${BACKEND_URL}/unidad-word/open-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPath }),
    });
};

export const pickUnitWordFolder = async (): Promise<{ success: boolean; path?: string; message?: string; cancelled?: boolean }> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/unidad-word/pick-folder`, undefined, 600000);
        return await res.json();
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const getUnitWordTemplateFields = async (): Promise<{ success: boolean; fields: string[]; sessionMarkers: string[]; delimiters?: { start: string; end: string }; message?: string }> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/unidad-word/template-fields`);
        return await res.json();
    } catch (e: any) {
        return { success: false, fields: [], sessionMarkers: [], message: e.message };
    }
};

export const startSessionWordGeneration = async (ids: string[], customPath: string, anchorPath: boolean): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sesion-word/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, customPath, anchorPath }),
        });
        return await res.json();
    } catch (e) { return { success: false, message: 'Fallo al iniciar generación de sesiones' }; }
};

export const getSessionWordGenerationStatus = async (): Promise<any> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sesion-word/status`);
        return await res.json();
    } catch (e) { return { active: false }; }
};

export const openSessionWordFolder = async (customPath: string): Promise<void> => {
    await safeFetch(`${BACKEND_URL}/sesion-word/open-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPath }),
    });
};

export const pickSessionWordFolder = async (): Promise<{ success: boolean; path?: string; message?: string; cancelled?: boolean }> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sesion-word/pick-folder`, undefined, 600000);
        return await res.json();
    } catch (e: any) {
        return { success: false, message: e.message };
    }
};

export const getSessionWordTemplateFields = async (): Promise<{ success: boolean; fields: string[]; sessionMarkers: string[]; delimiters?: { start: string; end: string }; message?: string }> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/sesion-word/template-fields`);
        return await res.json();
    } catch (e: any) {
        return { success: false, fields: [], sessionMarkers: [], message: e.message };
    }
};

// --- DATABASE ADMIN ---
export const getAdminTables = async (): Promise<{ tables: string[], isDemo: boolean }> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/admin/tables`);
        const json = await res.json();
        return { tables: json.data || [], isDemo: false };
    } catch (e) { return { tables: [], isDemo: false }; }
};

export const getAdminTableData = async (table: string): Promise<any[]> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/admin/table-data?table=${encodeURIComponent(table)}`);
        const json = await res.json();
        return json.data || [];
    } catch (e) { return []; }
};

export const deleteAdminRow = async (table: string, id: any): Promise<boolean> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/admin/delete-row`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table, id }),
        });
        const json = await res.json();
        return !!json.success;
    } catch (e) { return false; }
};

export const updateAdminRow = async (table: string, id: any, data: any): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/admin/update-row`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table, id, data }),
        });
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const bulkImportTable = async (table: string, data: any[]): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/admin/bulk-import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table, data }),
        });
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const clearAdminTable = async (table: string): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/admin/clear-table`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table }),
        });
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const bulkImportCompetencias = async (data: any[]): Promise<ApiResponse<any>> => {
    return bulkImportTable('db_competencias', data);
};

export const bulkImportEstandares = async (data: any[]): Promise<ApiResponse<any>> => {
    return bulkImportTable('db_estandares', data);
};

// --- OTROS ---
export const getProgramacionesAnuales = async (): Promise<Record<string, any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/programacion-anual`);
        const json = await res.json();
        return json.data || {};
    } catch (e) { return {}; }
};

export const saveProgramacionAnual = async (data: any): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/programacion-anual`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return await res.json();
    } catch (e) { return { success: false, message: 'Error de servidor' }; }
};

export const deleteProgramacionAnual = async (id: string): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/admin/delete-row`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table: 'programacion_anual', id }),
        });
        return await res.json();
    } catch (e: any) {
        return { success: false, message: e.message || 'Error de servidor' };
    }
};

export const deleteUnidadDidactica = async (id: string): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/unidades-didacticas/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
        return await res.json();
    } catch (e: any) {
        return { success: false, message: e.message || 'Error de servidor' };
    }
};

export const getCompetencias = async (grado?: string, area?: string): Promise<any[]> => {
    try {
        let url = `${BACKEND_URL}/competencias`;
        const params = [];
        if (grado) params.push(`grado=${encodeURIComponent(grado)}`);
        if (area) params.push(`area=${encodeURIComponent(area)}`);
        if (params.length > 0) url += `?${params.join('&')}`;
        const res = await safeFetch(url);
        const json = await res.json();
        return json.data || [];
    } catch (e) { return []; }
};

export const getEstandares = async (grado?: string, area?: string): Promise<any[]> => {
    try {
        let url = `${BACKEND_URL}/estandares`;
        const params = [];
        if (grado) params.push(`grado=${encodeURIComponent(grado)}`);
        if (area) params.push(`area=${encodeURIComponent(area)}`);
        if (params.length > 0) url += `?${params.join('&')}`;
        const res = await safeFetch(url);
        const json = await res.json();
        return json.data || [];
    } catch (e) { return []; }
};

export const getAreas = async (nombre?: string): Promise<any[]> => {
    try {
        let url = `${BACKEND_URL}/areas`;
        if (nombre) url += `?nombre=${encodeURIComponent(nombre)}`;
        const res = await safeFetch(url);
        const json = await res.json();
        return json.data || [];
    } catch (e) { return []; }
};

// --- EVALUACIÃ“N (NUEVO) ---
export const getInstrumentos = async (filters?: any): Promise<ApiResponse<any[]>> => {
    try {
        let url = `${BACKEND_URL}/evaluacion/instrumentos`;
        if (filters) {
            const params = new URLSearchParams(filters);
            url += `?${params.toString()}`;
        }
        const res = await safeFetch(url);
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const saveInstrumento = async (data: any): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/evaluacion/instrumentos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const deleteInstrumento = async (id: number | string): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/evaluacion/instrumentos/${id}`, {
            method: 'DELETE',
        }, 30000);
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const getEvaluacionRegistros = async (filters?: any): Promise<ApiResponse<any[]>> => {
    try {
        let url = `${BACKEND_URL}/evaluacion/registros`;
        if (filters) {
            const params = new URLSearchParams(filters);
            url += `?${params.toString()}`;
        }
        const res = await safeFetch(url);
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const saveEvaluacionRegistros = async (data: { records: any[] }): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/evaluacion/registros`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return await res.json();
  } catch (e: any) { return { success: false, message: e.message }; }
};

export const getEvaluacionConclusiones = async (filters?: any): Promise<ApiResponse<any[]>> => {
    try {
        let url = `${BACKEND_URL}/evaluacion/conclusiones`;
        if (filters) {
            const params = new URLSearchParams(filters);
            url += `?${params.toString()}`;
        }
        const res = await safeFetch(url);
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const saveEvaluacionConclusiones = async (data: { records: any[] }): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/evaluacion/conclusiones`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const getEvaluacionEvidencias = async (filters?: any): Promise<ApiResponse<any[]>> => {
    try {
        let url = `${BACKEND_URL}/evaluacion/evidencias`;
        if (filters) {
            const params = new URLSearchParams(filters);
            url += `?${params.toString()}`;
        }
        const res = await safeFetch(url);
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const saveEvaluacionEvidencia = async (data: any): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/evaluacion/evidencias`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }, 60000);
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const deleteEvaluacionEvidencia = async (id: number | string): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/evaluacion/evidencias/${id}`, {
            method: 'DELETE',
        }, 30000);
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const getEvaluacionConfig = async (year: string, areaId: string): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/evaluacion/configuracion?year=${year}&areaId=${areaId}`);
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

export const saveEvaluacionConfig = async (data: any): Promise<ApiResponse<any>> => {
    try {
        const res = await safeFetch(`${BACKEND_URL}/evaluacion/configuracion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return await res.json();
    } catch (e: any) { return { success: false, message: e.message }; }
};

