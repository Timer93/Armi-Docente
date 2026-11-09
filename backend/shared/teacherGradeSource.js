// Legacy HTML practice integration wrote these literal rows automatically.
// Retain them for traceability, but do not present them as teacher assessment.
export const isAutomaticPracticeGrade = row => {
  if((row?.grading_mode || 'literal_traditional') !== 'literal_traditional')return false;
  const note=String(row?.observation || '');
  if(!/^\[Actividad HTML:[^\]\r\n]+\]/.test(note))return false;
  const original=note.match(/: (\d+(?:\.\d+)?)\/20(?:\s|$)/);
  if(!original || row.numeric_score==null)return false;
  const score=Number(original[1]);
  const level=score>=18?'AD':score>=14?'A':score>=11?'B':'C';
  // A teacher may have corrected an old imported row without changing its note.
  // Keep such corrections; exclude only the unchanged automatic score/level.
  return score===Number(row.numeric_score) && String(row.level || '').toUpperCase()===level;
};
export const teacherGradeRecords = records => records.filter(row => !isAutomaticPracticeGrade(row));
