// No cargar el parser de archivos del escritorio en una vista sin importación.
// Se reemplaza únicamente al compilar web, hasta adaptar y verificar ese flujo.
const unavailable = () => { throw new Error('La importación y exportación de Excel todavía no están habilitadas en la web.'); };
export const read = unavailable;
export const readFile = unavailable;
export const write = unavailable;
export const writeFile = unavailable;
export const writeFileXLSX = unavailable;
export const utils = new Proxy({}, { get: () => unavailable });
