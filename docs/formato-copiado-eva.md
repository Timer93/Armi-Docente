# Formato de copiado ARMI → EVA

El botón EVA del registro bimestral copia texto tabulado (TSV), sin encabezados.
Cada fila corresponde a un estudiante. No contiene DNI ni notas numéricas.

## Orden de los campos

1. Nombre completo del estudiante.
2. Nota literal de la primera competencia del área.
3. Conclusión de esa competencia.
4. Se repite el par **nota literal + conclusión** para las demás competencias del área, en el orden del registro de ARMI.
5. Nota literal de TIC y su conclusión.
6. Nota literal de aprendizaje autónomo y su conclusión.

Para EPT, con una competencia del área y las dos transversales, son **7 campos por fila**:

```text
Nombre completo<TAB>Nota EPT<TAB>Conclusión EPT<TAB>Nota TIC<TAB>Conclusión TIC<TAB>Nota autonomía<TAB>Conclusión autonomía
```

Esta línea describe el formato; no se incluye en el portapapeles. `<TAB>` representa una tabulación real.

## Lectura en EVA

- Separar las filas por salto de línea y los campos por tabulación. Los campos vacíos deben conservar su posición, incluidos los del final: no aplicar `trim()` al texto completo antes de separarlo.
- Usar el nombre completo para localizar al estudiante dentro del grado y sección de destino. Si no hay una coincidencia única, solicitar revisión; no asignar por número de fila.
- Las notas posibles son `C`, `B`, `A`, `AD` y `NE`. Una nota pendiente o ausente se copia como campo vacío. La conclusión existente se conserva aunque la nota esté pendiente.
- Si falta una competencia transversal, sus dos campos quedan vacíos para mantener el orden.
- Los saltos de línea y tabulaciones internos de nombres y conclusiones se convierten en espacios; cada estudiante sigue ocupando una sola fila.
- EVA debe verificar el área, año, grado, sección y bimestre de destino antes de aplicar los datos: esos datos de contexto no forman parte del texto copiado.
- Un campo vacío no debe interpretarse como C, cero ni una orden automática de borrar una nota existente.

Las notas literales y conclusiones se toman del registro consolidado actual de ARMI. El copiado no modifica las calificaciones.
