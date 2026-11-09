type GradeRow = { student_id: string; criteria_id: string; level: string; observation: string };

// A stale table may contain hundreds of unchanged rows from the other PC.
// Only the cells edited since the last successful read/save belong in a write.
export const selectChangedSessionGrades = <T extends GradeRow>(records: T[], savedSnapshot: string): T[] => {
  const savedRows = new Map<string, string[]>(JSON.parse(savedSnapshot || '[]')
    .map(([key, level, observation]: string[]) => [key, [level, observation]]));
  return records.filter(record => {
    const previous = savedRows.get(`${record.student_id}::${record.criteria_id}`) || ['', ''];
    return previous[0] !== record.level || previous[1] !== record.observation;
  });
};
