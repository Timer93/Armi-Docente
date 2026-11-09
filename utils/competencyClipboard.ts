export type ClipboardCompetency = { competencyKey: string; competencyName: string };
type ClipboardResult = { code?: string; conclusion?: string; pending?: boolean } | undefined;
const plainText = (value: string) => value.replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const transversalRank = (group: ClipboardCompetency) => {
  const name = normalized(group.competencyName);
  if (name.includes('entornos virtuales')) return 0;
  if (name.includes('aprendizaje') && name.includes('autonom')) return 1;
  return 2;
};

// Formatting only: final literal levels and conclusions come from the existing
// register. Each competency occupies two TSV fields; no numeric score is copied.
// EVA expects area competencies first, then TIC and autonomous learning.
export function buildCompetencyClipboardData<Student extends { studentName: string }, Group extends ClipboardCompetency>(
  students: Student[],
  areaGroups: Group[],
  transversalGroups: Group[],
  resultFor: (student: Student, group: Group) => ClipboardResult,
) {
  type Column = { column: ClipboardCompetency; group?: Group };
  const entries: Column[] = areaGroups.map(group => ({ column: group, group }));
  for (const [rank, competencyName] of [
    [0, 'Se desenvuelve en los entornos virtuales generados por las TIC'],
    [1, 'Gestiona su aprendizaje de manera autónoma'],
  ] as const) {
    const matching = transversalGroups.filter(group => transversalRank(group) === rank);
    if (matching.length) entries.push(...matching.map(group => ({ column: group, group })));
    else entries.push({ column: { competencyKey: `eva-empty-transversal-${rank}`, competencyName } });
  }
  entries.push(...transversalGroups.filter(group => transversalRank(group) === 2).map(group => ({ column: group, group })));
  let pendingCount = 0, emptyCount = 0;
  const text = students.map(student => [
    plainText(student.studentName),
    ...entries.flatMap(({ group }) => {
      const result = group ? resultFor(student, group) : undefined;
      const conclusion = plainText(result?.conclusion || '');
      if (result?.pending) { pendingCount++; return ['', conclusion]; }
      const code = String(result?.code || '').toUpperCase();
      if (['C', 'B', 'A', 'AD', 'NE'].includes(code)) {
        return [code, conclusion];
      }
      emptyCount++;
      return ['', conclusion];
    }),
  ].join('\t')).join('\r\n');
  return { text, rowCount: students.length, columns: entries.map(entry => entry.column), pendingCount, emptyCount };
}
