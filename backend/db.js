
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { appRoot, databaseRoot } from './paths.js';

if (!fs.existsSync(databaseRoot)) {
    fs.mkdirSync(databaseRoot, { recursive: true });
}

const dbPath = path.join(databaseRoot, 'armi.db');
const bundledDatabaseRoot = process.resourcesPath
    ? path.join(process.resourcesPath, 'database')
    : path.join(appRoot, 'database');
const bundledDbPath = path.join(bundledDatabaseRoot, 'armi.db');

const seedDatabaseFromBundleIfNeeded = () => {
    if (fs.existsSync(dbPath)) return;
    if (!fs.existsSync(bundledDbPath)) return;

    fs.copyFileSync(bundledDbPath, dbPath);

    const optionalCompanionFiles = ['armi.db-wal', 'armi.db-shm'];
    optionalCompanionFiles.forEach((filename) => {
        const source = path.join(bundledDatabaseRoot, filename);
        const target = path.join(databaseRoot, filename);
        if (fs.existsSync(source) && !fs.existsSync(target)) {
            fs.copyFileSync(source, target);
        }
    });

    console.log(`✅ Base maestra copiada al perfil local desde ${bundledDatabaseRoot}`);
};

seedDatabaseFromBundleIfNeeded();

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const GENERAL_DATA_COLUMN_DEFINITIONS = {
    b1_start: 'TEXT',
    b1_end: 'TEXT',
    b2_start: 'TEXT',
    b2_end: 'TEXT',
    b3_start: 'TEXT',
    b3_end: 'TEXT',
    b4_start: 'TEXT',
    b4_end: 'TEXT',
    vac_start: 'TEXT',
    vac_end: 'TEXT',
    u1_start: 'TEXT',
    u1_end: 'TEXT',
    u2_start: 'TEXT',
    u2_end: 'TEXT',
    u3_start: 'TEXT',
    u3_end: 'TEXT',
    u4_start: 'TEXT',
    u4_end: 'TEXT',
    u5_start: 'TEXT',
    u5_end: 'TEXT',
    u6_start: 'TEXT',
    u6_end: 'TEXT',
    u7_start: 'TEXT',
    u7_end: 'TEXT',
    u8_start: 'TEXT',
    u8_end: 'TEXT',
    u_vac_start: 'TEXT',
    u_vac_end: 'TEXT',
    ie_anniversary_date: 'TEXT',
    achievement_day_1_date: 'TEXT',
    community_anniversary_date: 'TEXT',
    achievement_day_2_date: 'TEXT',
    province_anniversary_date: 'TEXT',
    other_important_date: 'TEXT',
    gemini_api_key: 'TEXT',
    openai_api_key: 'TEXT',
    ai_provider: "TEXT DEFAULT 'gemini'",
    gemini_model: 'TEXT',
    openai_model: 'TEXT',
    ai_pedagogical_route: "TEXT DEFAULT ''",
    ai_institutional_problems: "TEXT DEFAULT ''",
    ai_unit_pedagogical_focus: "TEXT DEFAULT ''",
    year_name: 'TEXT',
    evidence_storage_path: "TEXT DEFAULT ''",
};

const SYNC_EXCLUDED_TABLES = new Set([
    'padron_colegios',
    'db_areas',
    'db_competencias',
    'db_estandares',
    'student_chat_groups',
    'student_chat_members',
    'student_chat_messages',
    'portal_sesiones_estudiantes',
]);

const syncReferenceTablesFromBundledDatabase = () => {
    if (!fs.existsSync(bundledDbPath) || path.resolve(bundledDbPath) === path.resolve(dbPath)) return;

    let bundledDb = null;
    try {
        bundledDb = new Database(bundledDbPath, { readonly: true });
        const tablesToSync = [
            {
                name: 'padron_colegios',
                createSql: `
                    CREATE TABLE IF NOT EXISTS padron_colegios (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        cod_mod TEXT,
                        nombre_ie TEXT,
                        nivel TEXT,
                        d_dpto TEXT,
                        d_prov TEXT,
                        d_dist TEXT,
                        d_dreugel TEXT,
                        gestion TEXT
                    )
                `,
            },
            {
                name: 'db_areas',
                createSql: `
                    CREATE TABLE IF NOT EXISTS db_areas (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        area TEXT,
                        proposito TEXT,
                        enfoque TEXT
                    )
                `,
            },
            {
                name: 'db_competencias',
                createSql: `
                    CREATE TABLE IF NOT EXISTS db_competencias (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        area TEXT,
                        competencias TEXT,
                        capacidades TEXT,
                        grado TEXT,
                        desempenos_dcbn TEXT,
                        desempenos_precisados TEXT
                    )
                `,
            },
            {
                name: 'db_estandares',
                createSql: `
                    CREATE TABLE IF NOT EXISTS db_estandares (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        area TEXT,
                        competencias TEXT,
                        grado TEXT,
                        desempenos_dcbn TEXT,
                        estandar TEXT
                    )
                `,
            },
        ];

        tablesToSync.forEach(({ name, createSql }) => {
            const bundledHasTable = bundledDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
            if (!bundledHasTable) return;

            db.exec(createSql);

            const localCount = db.prepare(`SELECT COUNT(*) as total FROM "${name}"`).get().total;
            const bundledCount = bundledDb.prepare(`SELECT COUNT(*) as total FROM "${name}"`).get().total;
            if (localCount > 0 || bundledCount <= 0) return;

            const rows = bundledDb.prepare(`SELECT * FROM "${name}"`).all();
            const columns = bundledDb.prepare(`PRAGMA table_info("${name}")`).all().map((column) => column.name);
            const placeholders = columns.map(() => '?').join(', ');
            const insert = db.prepare(`INSERT INTO "${name}" (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${placeholders})`);
            const transaction = db.transaction(() => {
                rows.forEach((row) => {
                    insert.run(...columns.map((column) => row[column] ?? null));
                });
            });
            transaction();
            console.log(`✅ Tabla maestra ${name} restaurada desde la base incluida (${bundledCount} registros).`);
        });
    } catch (error) {
        console.error(`⚠️ No se pudo sincronizar la base maestra incluida: ${error.message}`);
    } finally {
        try { bundledDb?.close(); } catch {}
    }
};

const ensureInitialModuleStatusRow = () => {
    try {
        const hasGeneralData = !!db.prepare('SELECT id FROM datos_generales LIMIT 1').get();
        const existing = db.prepare('SELECT id FROM estado_modulos WHERE id = 1').get();
        if (!existing?.id) {
            db.prepare(`
                INSERT INTO estado_modulos (
                    id, datos_generales, calendario, areas_grados, estudiantes, horario,
                    programacion_anual, unidades_didacticas, sesiones, evaluacion
                ) VALUES (1, 0, 0, 0, 0, 0, 0, 0, 0, 0)
            `).run();
            console.log('✅ Estado inicial de modulos creado en modo primer uso.');
            return;
        }

        if (!hasGeneralData) {
            db.prepare(`
                UPDATE estado_modulos
                SET datos_generales = 0,
                    calendario = 0,
                    areas_grados = 0,
                    estudiantes = 0,
                    horario = 0,
                    programacion_anual = 0,
                    unidades_didacticas = 0,
                    sesiones = 0,
                    evaluacion = 0
                WHERE id = 1
            `).run();
            console.log('✅ Estado de modulos reiniciado para primer uso.');
        }
    } catch (error) {
        console.error(`⚠️ No se pudo crear el estado inicial de modulos: ${error.message}`);
    }
};

const ensureGeneralDataIntegrity = () => {
    const ensureColumn = (column, type) => {
        const info = db.prepare(`PRAGMA table_info("datos_generales")`).all();
        if (!info.some((item) => item.name === column)) {
            db.exec(`ALTER TABLE "datos_generales" ADD COLUMN ${column} ${type}`);
            console.log(`🔹 Columna ${column} añadida a datos_generales`);
        }
    };

    Object.entries(GENERAL_DATA_COLUMN_DEFINITIONS).forEach(([column, type]) => {
        ensureColumn(column, type);
    });

    const existingRow = db.prepare('SELECT id FROM datos_generales ORDER BY id ASC LIMIT 1').get();
    if (!existingRow) {
        db.prepare(`
            INSERT INTO datos_generales (
                year,
                lugar,
                school_shift,
                level,
                motto,
                year_name,
                management_weeks_u1,
                context_description,
                gemini_api_key,
                openai_api_key,
                ai_provider,
                gemini_model,
                openai_model,
                ai_pedagogical_route,
                ai_institutional_problems,
                ai_unit_pedagogical_focus,
                updated_at
            ) VALUES (
                @year,
                '',
                '',
                '',
                '',
                '',
                '0',
                '',
                '',
                '',
                'gemini',
                '',
                '',
                '',
                '',
                '',
                CURRENT_TIMESTAMP
            )
        `).run({
            year: new Date().getFullYear().toString(),
        });
        console.log('✅ Fila base de datos_generales creada automáticamente.');
    }
};

const initDb = () => {
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS datos_generales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                year TEXT, department TEXT, region TEXT, province TEXT, ugel TEXT, district TEXT, institution TEXT,
                lugar TEXT,
                school_shift TEXT, level TEXT, motto TEXT, year_name TEXT, director TEXT, teacher TEXT, insignia TEXT, logo TEXT,
                management_weeks_u1 TEXT DEFAULT '0',
                subdirector TEXT, pedagogical_coordinator TEXT, toe_coordinator TEXT, context_description TEXT,
                path_word_default TEXT,
                gemini_api_key TEXT,
                openai_api_key TEXT,
                ai_provider TEXT DEFAULT 'gemini',
                gemini_model TEXT,
                openai_model TEXT,
                ai_pedagogical_route TEXT DEFAULT '',
                ai_institutional_problems TEXT DEFAULT '',
                ai_unit_pedagogical_focus TEXT DEFAULT '',
                updated_at DATETIME
            );
            
            CREATE TABLE IF NOT EXISTS db_estudiantes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nivel TEXT,
                dni TEXT,
                estudiantes TEXT,
                grado TEXT,
                secc TEXT,
                fecha_nacimiento TEXT,
                gmail TEXT,
                outlook TEXT,
                estado TEXT DEFAULT 'A',
                grupo TEXT,
                sexo TEXT,
                edad INTEGER,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS db_egresados (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                estudiante_id_origen TEXT,
                nivel TEXT,
                dni TEXT,
                estudiantes TEXT,
                grado TEXT,
                secc TEXT,
                fecha_nacimiento TEXT,
                gmail TEXT,
                outlook TEXT,
                estado TEXT,
                grupo TEXT,
                sexo TEXT,
                edad INTEGER,
                egresado_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS asistencia_rostros (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id TEXT,
                student_name TEXT,
                grade TEXT,
                section TEXT,
                image_data TEXT,
                descriptor TEXT,
                source TEXT DEFAULT 'manual_capture',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS asistencia_registros (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                attendance_date TEXT,
                grade TEXT,
                section TEXT,
                student_id TEXT,
                student_name TEXT,
                dni TEXT,
                status TEXT DEFAULT 'P',
                marked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                source TEXT DEFAULT 'manual',
                notes TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(attendance_date, grade, section, student_id)
            );

            CREATE TABLE IF NOT EXISTS "resultados_diagnóstico" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "año" TEXT,
                "estudiante_id" TEXT,
                "estudiante_nombre" TEXT,
                "area" TEXT,
                "grado" TEXT,
                "seccion" TEXT,
                "nivel" TEXT,
                "competencia" TEXT,
                "nivel_logro" TEXT,
                "conclusion_descriptiva" TEXT,
                "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS metas_aprendizaje (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                anio TEXT, area TEXT, grado TEXT, seccion TEXT, competencia TEXT, tipo TEXT, 
                cant_destacado INTEGER DEFAULT 0, cant_esperado INTEGER DEFAULT 0,
                cant_proceso INTEGER DEFAULT 0, cant_inicio INTEGER DEFAULT 0,
                cant_no_evaluado INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(anio, area, grado, seccion, competencia, tipo)
            );

            CREATE TABLE IF NOT EXISTS programacion_anual (
                id_programa TEXT PRIMARY KEY, nro_pa TEXT, area_id TEXT, area_curricular TEXT,
                grade TEXT, section TEXT, ugel TEXT, ie TEXT, lugar TEXT, duracion TEXT,
                docente TEXT, coord_ped TEXT, director TEXT, sub_director TEXT, coord_tut TEXT,
                area_purpose TEXT, area_enfoque TEXT, area_standards TEXT,
                caracterizacion_context TEXT, caracterizacion_adolecente TEXT,
                temp_curr_area TEXT, matrix_checks TEXT, resources_checks TEXT,
                inicio_bim_i TEXT, inicio_bim_ii TEXT, inicio_bim_iii TEXT, inicio_bim_iv TEXT,
                fin_bim_i TEXT, fin_bim_ii TEXT, fin_bim_iii TEXT, fin_bim_iv TEXT,
                titulo_u1 TEXT, titulo_u2 TEXT, titulo_u3 TEXT, titulo_u4 TEXT, 
                titulo_u5 TEXT, titulo_u6 TEXT, titulo_u7 TEXT, titulo_u8 TEXT,
                st_cont_u1 TEXT, st_cont_u2 TEXT, st_cont_u3 TEXT, st_cont_u4 TEXT, 
                st_cont_u5 TEXT, st_cont_u6 TEXT, st_cont_u7 TEXT, st_cont_u8 TEXT,
                alumnos TEXT, ciclo TEXT, horas_sem TEXT, metas_datos TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS unidades_didacticas (
                id_unidad TEXT PRIMARY KEY,
                year TEXT, area_id TEXT, grade TEXT, section TEXT, unit_number TEXT,
                title TEXT, purpose TEXT, product TEXT, situation TEXT,
                criterios TEXT, evidencias TEXT, instrumentos TEXT,
                criterios_trans TEXT, evidencias_trans TEXT, instrumentos_trans TEXT,
                sesiones TEXT, recursos TEXT, bibliografia TEXT, evaluacion TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sesiones (
                id_sesion TEXT PRIMARY KEY,
                year TEXT, area_id TEXT, grade TEXT, section TEXT, unit_number TEXT, session_number TEXT,
                session_data TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS programacion_recursos (
                id_programa TEXT PRIMARY KEY,
                medios TEXT, materiales TEXT, recursos TEXT, espacios TEXT, apps TEXT, softwares TEXT, plataformas TEXT,
                referencias TEXT, linkografia TEXT,
                FOREIGN KEY(id_programa) REFERENCES programacion_anual(id_programa) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS db_areas (
                id INTEGER PRIMARY KEY AUTOINCREMENT, area TEXT, proposito TEXT, enfoque TEXT
            );

            CREATE TABLE IF NOT EXISTS db_competencias (
                id INTEGER PRIMARY KEY AUTOINCREMENT, area TEXT, competencias TEXT, capacidades TEXT, grado TEXT, desempenos_dcbn TEXT, desempenos_precisados TEXT
            );

            CREATE TABLE IF NOT EXISTS db_estandares (
                id INTEGER PRIMARY KEY AUTOINCREMENT, area TEXT, competencias TEXT, grado TEXT, desempenos_dcbn TEXT, estandar TEXT
            );

            CREATE TABLE IF NOT EXISTS estado_modulos (
                id INTEGER PRIMARY KEY,
                datos_generales INTEGER DEFAULT 0, calendario INTEGER DEFAULT 0,
                areas_grados INTEGER DEFAULT 0, estudiantes INTEGER DEFAULT 0,
                horario INTEGER DEFAULT 0, programacion_anual INTEGER DEFAULT 0,
                unidades_didacticas INTEGER DEFAULT 0, sesiones INTEGER DEFAULT 0,
                evaluacion INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS evaluacion_instrumentos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                year TEXT, area_id TEXT, grade TEXT, section TEXT,
                type TEXT, name TEXT, structure TEXT, version INTEGER DEFAULT 1,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS evaluacion_registros (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id TEXT, session_id TEXT, unit_id TEXT,
                instrument_id INTEGER, criteria_id TEXT, level TEXT,
                observation TEXT,
                grading_mode TEXT NOT NULL DEFAULT 'literal_traditional',
                numeric_score REAL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS student_chat_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL, year TEXT, grade TEXT, section TEXT,
                portfolio_url TEXT DEFAULT '', created_by_student_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS student_chat_members (
                group_id INTEGER NOT NULL, student_id TEXT NOT NULL,
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(group_id, student_id)
            );
            CREATE TABLE IF NOT EXISTS student_chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL,
                sender_type TEXT DEFAULT 'student', sender_id TEXT, sender_name TEXT,
                message_text TEXT DEFAULT '', file_path TEXT DEFAULT '', file_name TEXT DEFAULT '',
                file_type TEXT DEFAULT '', file_size INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS student_achievement_points (
                id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL,
                year TEXT, bimester TEXT, unit_number TEXT, points REAL DEFAULT 0,
                reason TEXT, source TEXT DEFAULT 'teacher', reference_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS evaluacion_modos_calificacion (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                year TEXT NOT NULL,
                area_id TEXT NOT NULL,
                grade TEXT NOT NULL DEFAULT '',
                section TEXT NOT NULL DEFAULT '',
                grading_mode TEXT NOT NULL DEFAULT 'literal_traditional',
                effective_from TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(year, area_id, grade, section)
            );

            CREATE TABLE IF NOT EXISTS evaluacion_evidencias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                evidence_key TEXT,
                student_id TEXT, session_id TEXT, criteria_id TEXT,
                file_path TEXT, file_type TEXT, observation TEXT,
                year TEXT, area_id TEXT, grade TEXT, section TEXT,
                bimester TEXT, unit_number TEXT, session_number TEXT,
                student_ids TEXT, student_names TEXT,
                file_name TEXT, file_size INTEGER DEFAULT 0,
                relative_path TEXT, source TEXT DEFAULT 'teacher',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS evaluacion_configuracion (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                year TEXT, area_id TEXT, scale_type TEXT,
                scale_data TEXT, weights TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS evaluacion_ventanas_entrega (
                session_id TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 1,
                open_from TEXT,
                close_at TEXT,
                exceptional INTEGER NOT NULL DEFAULT 0,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS evaluacion_conclusiones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                year TEXT, area_id TEXT, grade TEXT, section TEXT,
                scope_type TEXT, scope_value TEXT,
                student_id TEXT,
                competency_key TEXT, competency_name TEXT, competency_source TEXT,
                conclusion_text TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(year, area_id, grade, section, scope_type, scope_value, student_id, competency_key)
            );

            CREATE TABLE IF NOT EXISTS portal_sesiones_estudiantes (
                token TEXT PRIMARY KEY,
                student_id TEXT NOT NULL,
                must_change_password INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                last_seen_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_portal_sesiones_student_id ON portal_sesiones_estudiantes(student_id);
            CREATE INDEX IF NOT EXISTS idx_portal_sesiones_expires_at ON portal_sesiones_estudiantes(expires_at);
        `);

        const checkAndAdd = (table, col, type) => {
            const info = db.prepare(`PRAGMA table_info("${table}")`).all();
            if (!info.map(c => c.name).includes(col)) {
                db.exec(`ALTER TABLE "${table}" ADD COLUMN ${col} ${type}`);
                console.log(`🔹 Columna ${col} añadida a ${table}`);
            }
        };

        ensureGeneralDataIntegrity();
        checkAndAdd('resultados_diagnóstico', 'nivel', 'TEXT');
        checkAndAdd('resultados_diagnóstico', 'estudiante_nombre', 'TEXT');
        checkAndAdd('programacion_anual', 'metas_datos', 'TEXT');
        checkAndAdd('db_estudiantes', 'fecha_nacimiento', 'TEXT');
        checkAndAdd('db_estudiantes', 'password_hash', 'TEXT');
        checkAndAdd('db_estudiantes', 'password_changed_at', 'TEXT');
        checkAndAdd('db_estudiantes', 'notifications_enabled', 'INTEGER DEFAULT 0');
        checkAndAdd('db_egresados', 'fecha_nacimiento', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'year', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'area_id', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'grade', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'section', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'bimester', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'unit_number', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'session_number', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'student_ids', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'student_names', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'file_name', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'file_size', 'INTEGER DEFAULT 0');
        checkAndAdd('evaluacion_evidencias', 'relative_path', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'source', "TEXT DEFAULT 'teacher'");
        checkAndAdd('evaluacion_evidencias', 'evidence_key', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'version_group_id', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'version_number', 'INTEGER DEFAULT 1');
        checkAndAdd('evaluacion_evidencias', 'is_latest', 'INTEGER DEFAULT 1');
        checkAndAdd('evaluacion_evidencias', 'submitted_at', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'submission_ip', 'TEXT');
        checkAndAdd('evaluacion_evidencias', 'submission_user_agent', 'TEXT');
        checkAndAdd('evaluacion_conclusiones', 'competency_name', 'TEXT');
        checkAndAdd('evaluacion_conclusiones', 'competency_source', 'TEXT');
        checkAndAdd('evaluacion_registros', 'grading_mode', "TEXT NOT NULL DEFAULT 'literal_traditional'");
        checkAndAdd('evaluacion_registros', 'numeric_score', 'REAL');

        db.exec(`
            UPDATE evaluacion_registros
            SET grading_mode = 'literal_traditional'
            WHERE grading_mode IS NULL OR TRIM(grading_mode) = '';

            CREATE INDEX IF NOT EXISTS idx_evaluacion_registros_mode_scope
            ON evaluacion_registros(grading_mode, session_id, student_id, criteria_id);

            CREATE INDEX IF NOT EXISTS idx_evaluacion_evidencias_versions
            ON evaluacion_evidencias(student_id, session_id, version_group_id, version_number);

            CREATE UNIQUE INDEX IF NOT EXISTS idx_evaluacion_evidencias_portable_key
            ON evaluacion_evidencias(evidence_key)
            WHERE evidence_key IS NOT NULL AND TRIM(evidence_key) <> '';

            UPDATE evaluacion_evidencias
            SET version_group_id = 'legacy-' || id
            WHERE version_group_id IS NULL OR TRIM(version_group_id) = '';

            UPDATE evaluacion_evidencias
            SET version_number = 1
            WHERE version_number IS NULL OR version_number < 1;

            UPDATE evaluacion_evidencias
            SET is_latest = 1
            WHERE is_latest IS NULL;

            UPDATE evaluacion_evidencias
            SET submitted_at = COALESCE(submitted_at, updated_at, CURRENT_TIMESTAMP)
            WHERE submitted_at IS NULL OR TRIM(submitted_at) = '';
        `);

        console.log(`✅ Base de Datos ARMI Sincronizada.`);
    } catch (e) {
        console.error("❌ Error inicializando base de datos:", e.message);
    }
};

initDb();
syncReferenceTablesFromBundledDatabase();
ensureGeneralDataIntegrity();
ensureInitialModuleStatusRow();

const listUserTables = () => db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => row.name)
    .filter(Boolean);

const resolveDumpTables = (options = {}) => {
    const tables = listUserTables();
    const excludeTables = new Set(Array.isArray(options.excludeTables) ? options.excludeTables : []);
    return tables.filter((table) => !excludeTables.has(table));
};

const dumpDatabase = (options = {}) => {
    const tables = resolveDumpTables(options);
    const includeExportedAt = options.includeExportedAt !== false;
    const snapshot = {
        tables: {},
        sqliteSequence: [],
    };

    if (includeExportedAt) {
        snapshot.exportedAt = new Date().toISOString();
    }

    tables.forEach((table) => {
        snapshot.tables[table] = db.prepare(`SELECT * FROM "${table}"`).all();
    });

    try {
        if (tables.length === 0) {
            snapshot.sqliteSequence = [];
        } else {
            snapshot.sqliteSequence = db.prepare('SELECT name, seq FROM sqlite_sequence WHERE name IN (' + tables.map(() => '?').join(', ') + ')').all(...tables);
        }
    } catch {
        snapshot.sqliteSequence = [];
    }

    return snapshot;
};

const restoreDatabase = (snapshot) => {
    const payloadTables = snapshot?.tables || {};
    const tables = Object.keys(payloadTables).filter((table) => listUserTables().includes(table));

    const transaction = db.transaction(() => {
        db.pragma('foreign_keys = OFF');

        tables.forEach((table) => {
            db.prepare(`DELETE FROM "${table}"`).run();
        });

        try {
            if (tables.length > 0) {
                db.prepare('DELETE FROM sqlite_sequence WHERE name IN (' + tables.map(() => '?').join(', ') + ')').run(...tables);
            }
        } catch {}

        tables.forEach((table) => {
            const rows = Array.isArray(payloadTables[table]) ? payloadTables[table] : [];
            if (rows.length === 0) return;

            const tableColumns = db.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name);

            rows.forEach((row) => {
                const columns = Object.keys(row).filter((column) => tableColumns.includes(column));
                if (columns.length === 0) return;
                const placeholders = columns.map(() => '?').join(', ');
                db.prepare(
                    `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${placeholders})`
                ).run(...columns.map((column) => row[column] ?? null));
            });
        });

        if (Array.isArray(snapshot?.sqliteSequence)) {
            snapshot.sqliteSequence.forEach((entry) => {
                if (!entry?.name || !tables.includes(entry.name)) return;
                db.prepare('INSERT INTO sqlite_sequence(name, seq) VALUES (?, ?)').run(entry.name, entry.seq ?? 0);
            });
        }

        db.pragma('foreign_keys = ON');
    });

    transaction();
};

const portalSessionCache = new Map();
const portalSessionKey = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

const getPortalSessionToken = (token) => {
    if (!token) return null;
    try {
        const tokenKey = portalSessionKey(token);
        const cached = portalSessionCache.get(tokenKey);
        if (cached && Number(cached.expiresAt || 0) > Date.now()) return { ...cached };
        if (cached) portalSessionCache.delete(tokenKey);
        const row = db.prepare(`
            SELECT token, student_id AS studentId, must_change_password AS mustChangePassword,
                   created_at AS createdAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt
            FROM portal_sesiones_estudiantes
            WHERE token = ?
        `).get(tokenKey);
        if (!row) return null;
        if (Number(row.expiresAt || 0) <= Date.now()) {
            deletePortalSessionToken(token);
            return null;
        }
        const session = {
            ...row,
            mustChangePassword: Boolean(row.mustChangePassword)
        };
        portalSessionCache.set(tokenKey, session);
        return { ...session };
    } catch {
        return null;
    }
};

const setPortalSessionToken = (token, sessionData) => {
    if (!token || !sessionData?.studentId) return;
    try {
        const tokenKey = portalSessionKey(token);
        const normalized = {
            token: tokenKey,
            studentId: String(sessionData.studentId),
            mustChangePassword: Boolean(sessionData.mustChangePassword),
            createdAt: Number(sessionData.createdAt || Date.now()),
            lastSeenAt: Number(sessionData.lastSeenAt || Date.now()),
            expiresAt: Number(sessionData.expiresAt || Date.now() + 600000),
        };
        db.prepare(`
            INSERT INTO portal_sesiones_estudiantes (token, student_id, must_change_password, created_at, last_seen_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(token) DO UPDATE SET
                student_id = excluded.student_id,
                must_change_password = excluded.must_change_password,
                last_seen_at = excluded.last_seen_at,
                expires_at = excluded.expires_at
        `).run(
            normalized.token,
            normalized.studentId,
            normalized.mustChangePassword ? 1 : 0,
            normalized.createdAt,
            normalized.lastSeenAt,
            normalized.expiresAt
        );
        portalSessionCache.set(tokenKey, normalized);
    } catch (e) {
        console.error('Error saving portal session:', e.message);
    }
};

const touchPortalSessionToken = (token, ttlMs = 600000) => {
    if (!token) return;
    try {
        const now = Date.now();
        const tokenKey = portalSessionKey(token);
        db.prepare(`
            UPDATE portal_sesiones_estudiantes
            SET last_seen_at = ?, expires_at = ?
            WHERE token = ?
        `).run(now, now + ttlMs, tokenKey);
        const cached = portalSessionCache.get(tokenKey);
        if (cached) portalSessionCache.set(tokenKey, { ...cached, lastSeenAt: now, expiresAt: now + ttlMs });
    } catch {}
};

const deletePortalSessionToken = (token) => {
    if (!token) return;
    try {
        const tokenKey = portalSessionKey(token);
        portalSessionCache.delete(tokenKey);
        db.prepare(`DELETE FROM portal_sesiones_estudiantes WHERE token = ?`).run(tokenKey);
    } catch {}
};

const deleteStudentPortalSessions = (studentId) => {
    if (!studentId) return;
    try {
        const normalizedStudentId = String(studentId);
        for (const [key, session] of portalSessionCache.entries()) {
            if (String(session.studentId) === normalizedStudentId) portalSessionCache.delete(key);
        }
        db.prepare(`DELETE FROM portal_sesiones_estudiantes WHERE student_id = ?`).run(normalizedStudentId);
    } catch {}
};

const cleanupExpiredPortalSessions = () => {
    try {
        const now = Date.now();
        for (const [key, session] of portalSessionCache.entries()) {
            if (Number(session.expiresAt || 0) <= now) portalSessionCache.delete(key);
        }
        db.prepare(`DELETE FROM portal_sesiones_estudiantes WHERE expires_at <= ?`).run(now);
    } catch {}
};

export {
    dbPath,
    listUserTables,
    dumpDatabase,
    restoreDatabase,
    SYNC_EXCLUDED_TABLES,
    getPortalSessionToken,
    setPortalSessionToken,
    touchPortalSessionToken,
    deletePortalSessionToken,
    deleteStudentPortalSessions,
    cleanupExpiredPortalSessions
};
export default db;
