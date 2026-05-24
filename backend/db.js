
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
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

const SYNC_EXCLUDED_TABLES = new Set([
    'padron_colegios',
    'db_areas',
    'db_competencias',
    'db_estandares',
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
                observation TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS evaluacion_evidencias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id TEXT, session_id TEXT, criteria_id TEXT,
                file_path TEXT, file_type TEXT, observation TEXT,
                year TEXT, area_id TEXT, grade TEXT, section TEXT,
                bimester TEXT, unit_number TEXT, session_number TEXT,
                student_ids TEXT, student_names TEXT,
                file_name TEXT, file_size INTEGER DEFAULT 0,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS evaluacion_configuracion (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                year TEXT, area_id TEXT, scale_type TEXT,
                scale_data TEXT, weights TEXT,
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
        `);

        const dgColumns = db.prepare(`PRAGMA table_info(datos_generales)`).all();
        const hasManagementWeeksColumn = dgColumns.some(column => column.name === 'management_weeks_u1');
        if (!hasManagementWeeksColumn) {
            db.exec(`ALTER TABLE datos_generales ADD COLUMN management_weeks_u1 TEXT DEFAULT '0';`);
        }
        
        const checkAndAdd = (table, col, type) => {
            const info = db.prepare(`PRAGMA table_info("${table}")`).all();
            if (!info.map(c => c.name).includes(col)) {
                db.exec(`ALTER TABLE "${table}" ADD COLUMN ${col} ${type}`);
                console.log(`🔹 Columna ${col} añadida a ${table}`);
            }
        };

        checkAndAdd('datos_generales', 'gemini_api_key', 'TEXT');
        checkAndAdd('datos_generales', 'openai_api_key', 'TEXT');
        checkAndAdd('datos_generales', 'ai_provider', "TEXT DEFAULT 'gemini'");
        checkAndAdd('datos_generales', 'ai_pedagogical_route', "TEXT DEFAULT ''");
        checkAndAdd('datos_generales', 'ai_institutional_problems', "TEXT DEFAULT ''");
        checkAndAdd('datos_generales', 'ai_unit_pedagogical_focus', "TEXT DEFAULT ''");
        checkAndAdd('datos_generales', 'year_name', 'TEXT');
        checkAndAdd('resultados_diagnóstico', 'nivel', 'TEXT');
        checkAndAdd('resultados_diagnóstico', 'estudiante_nombre', 'TEXT');
        checkAndAdd('programacion_anual', 'metas_datos', 'TEXT');
        checkAndAdd('db_estudiantes', 'fecha_nacimiento', 'TEXT');
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
        checkAndAdd('evaluacion_conclusiones', 'competency_name', 'TEXT');
        checkAndAdd('evaluacion_conclusiones', 'competency_source', 'TEXT');

        console.log(`✅ Base de Datos ARMI Sincronizada.`);
    } catch (e) {
        console.error("❌ Error inicializando base de datos:", e.message);
    }
};

initDb();
syncReferenceTablesFromBundledDatabase();
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

export { dbPath, listUserTables, dumpDatabase, restoreDatabase, SYNC_EXCLUDED_TABLES };
export default db;
