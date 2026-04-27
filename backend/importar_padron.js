
import * as XLSX from 'xlsx'; 
import db from './db.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const excelPath = path.join(__dirname, 'padron.xlsx');

if (!fs.existsSync(excelPath)) {
    console.error("❌ Error: No se encuentra 'padron.xlsx' en la carpeta backend.");
    process.exit(1);
}

console.log("📂 Leyendo archivo Excel como Buffer (Modo ESM)...");
let workbook;
try {
    // Solución Error 2: Leer como buffer evita fallos de XLSX.readFile en ESM/Windows
    const buffer = fs.readFileSync(excelPath);
    workbook = XLSX.read(buffer, { type: 'buffer' });
} catch (e) {
    console.error("❌ Error al procesar el archivo Excel:", e.message);
    process.exit(1);
}

const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const datos = XLSX.utils.sheet_to_json(sheet, { defval: "" });

if (datos.length === 0) {
    console.error("❌ El Excel parece estar vacío.");
    process.exit(1);
}

// Helper para búsqueda flexible de columnas
const buscarValor = (fila, ...posiblesNombres) => {
    const keysFila = Object.keys(fila);
    for (const nombre of posiblesNombres) {
        const match = keysFila.find(k => k.trim().toLowerCase() === nombre.trim().toLowerCase());
        if (match && fila[match]) return fila[match];
    }
    return "";
};

console.log("🚀 Iniciando importación a SQLite...");

const insert = db.prepare(`
    INSERT INTO padron_colegios (cod_mod, nombre_ie, nivel, d_dpto, d_prov, d_dist, d_dreugel, gestion)
    VALUES (@cod_mod, @nombre_ie, @nivel, @d_dpto, @d_prov, @d_dist, @d_dreugel, @gestion)
`);

const transaction = db.transaction((lista) => {
    db.prepare('DELETE FROM padron_colegios').run();
    // Solución Error 3: Comillas simples para valores de texto en SQLite
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'padron_colegios'").run();

    let count = 0;
    for (const fila of lista) {
        const registro = {
            cod_mod: buscarValor(fila, 'Código Modular', 'COD_MOD', 'COD_MOD7'),
            nombre_ie: buscarValor(fila, 'Nombre de SS.EE.', 'CEN_EDU', 'Nombre de I.E.', 'NOMBRE IE'),
            nivel: buscarValor(fila, 'Nivel / Modalidad', 'D_NIV_MOD', 'Nivel'),
            d_dpto: buscarValor(fila, 'Departamento', 'D_DPTO', 'REGION'),
            d_prov: buscarValor(fila, 'Provincia', 'D_PROV'),
            d_dist: buscarValor(fila, 'Distrito', 'D_DIST'),
            d_dreugel: buscarValor(fila, 'DRE / UGEL', 'D_DREUGEL'),
            gestion: buscarValor(fila, 'Gestion / Dependencia', 'D_GESTION')
        };

        if (registro.nombre_ie && registro.d_dpto) {
            insert.run(registro);
            count++;
        }
    }
    return count;
});

try {
    const total = transaction(datos);
    console.log(`✅ Importación finalizada: ${total} registros insertados en armi.db`);
} catch (err) {
    console.error("❌ Error durante la transacción SQL:", err.message);
}
