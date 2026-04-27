
import React, { useState, useEffect, useMemo } from 'react';
import { getEstudiantes, getEvaluacionRegistros, saveEvaluacionRegistros } from '../../services/apiService';
import { Student, EvaluationLevel } from '../../types';
import { Select } from '../Select';

export const AuxiliaryRegister: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [selArea, setSelArea] = useState('');
  const [selGrade, setSelGrade] = useState('');
  const [selSection, setSelSection] = useState('');
  const [selUnit, setSelUnit] = useState('1');
  const [selSession, setSelSession] = useState('1');

  useEffect(() => {
    loadStudents();
  }, []);

  useEffect(() => {
    if (selUnit && selSession) {
      loadRecords();
    }
  }, [selUnit, selSession]);

  const loadStudents = async () => {
    try {
      const data = await getEstudiantes();
      setStudents(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadRecords = async () => {
    try {
      const res = await getEvaluacionRegistros({ sessionId: `U${selUnit}S${selSession}` });
      if (res.success) setRecords(res.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const filteredStudents = useMemo(() => {
    return students.filter(s => 
      (!selGrade || s.grade === selGrade) && 
      (!selSection || s.section === selSection)
    );
  }, [students, selGrade, selSection]);

  const handleGradeChange = (studentId: string, level: string) => {
    const newRecords = [...records];
    const index = newRecords.findIndex(r => r.student_id === studentId && r.session_id === `U${selUnit}S${selSession}`);
    
    if (index >= 0) {
      newRecords[index].level = level;
    } else {
      newRecords.push({
        student_id: studentId,
        session_id: `U${selUnit}S${selSession}`,
        unit_id: `U${selUnit}`,
        level: level,
        criteria_id: 'default'
      });
    }
    setRecords(newRecords);
  };

  const handleSave = async () => {
    try {
      const res = await saveEvaluacionRegistros({ records });
      if (res.success) {
        alert('Registro guardado correctamente');
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[2rem] p-8 shadow-lg border border-slate-100">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <Select 
            label="Grado" 
            options={Array.from(new Set(students.map(s => s.grade))).map(g => ({ value: g, label: g }))}
            value={selGrade}
            onChange={e => setSelGrade(e.target.value)}
          />
          <Select 
            label="Sección" 
            options={Array.from(new Set(students.map(s => s.section))).map(s => ({ value: s, label: s }))}
            value={selSection}
            onChange={e => setSelSection(e.target.value)}
          />
          <Select 
            label="Unidad" 
            options={Array.from({ length: 8 }, (_, i) => ({ value: (i + 1).toString(), label: `U${i + 1}` }))}
            value={selUnit}
            onChange={e => setSelUnit(e.target.value)}
          />
          <Select 
            label="Sesión" 
            options={Array.from({ length: 15 }, (_, i) => ({ value: (i + 1).toString(), label: `S${i + 1}` }))}
            value={selSession}
            onChange={e => setSelSession(e.target.value)}
          />
          <div className="flex items-end">
            <button 
              onClick={handleSave}
              className="w-full bg-emerald-600 text-white py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg hover:bg-emerald-700 transition-all"
            >
              Guardar Cambios
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-3xl border border-slate-100">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-black uppercase text-slate-400 tracking-widest border-b border-slate-100">
                <th className="p-6 w-16 text-center">N°</th>
                <th className="p-6">Estudiante</th>
                <th className="p-6 text-center">Calificación</th>
                <th className="p-6">Observaciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredStudents.map((student, idx) => {
                const record = records.find(r => r.student_id === student.id && r.session_id === `U${selUnit}S${selSession}`);
                return (
                  <tr key={student.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-6 text-center font-bold text-slate-400 text-xs">{idx + 1}</td>
                    <td className="p-6">
                      <p className="font-black text-slate-800 uppercase text-xs">{student.name}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase mt-1">DNI: {student.dni || '---'}</p>
                    </td>
                    <td className="p-6">
                      <div className="flex justify-center gap-2">
                        {['AD', 'A', 'B', 'C'].map((level) => (
                          <button
                            key={level}
                            onClick={() => handleGradeChange(student.id.toString(), level)}
                            className={`
                              w-10 h-10 rounded-xl font-black text-xs transition-all
                              ${record?.level === level 
                                ? 'bg-emerald-600 text-white shadow-lg scale-110' 
                                : 'bg-white border border-slate-200 text-slate-400 hover:border-emerald-300 hover:text-emerald-600'}
                            `}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="p-6">
                      <input 
                        type="text"
                        className="w-full bg-transparent border-b border-slate-100 focus:border-emerald-500 outline-none p-2 text-xs text-slate-600 italic"
                        placeholder="Agregar observación..."
                        value={record?.observation || ''}
                        onChange={e => {
                          const newRecords = [...records];
                          const index = newRecords.findIndex(r => r.student_id === student.id && r.session_id === `U${selUnit}S${selSession}`);
                          if (index >= 0) {
                            newRecords[index].observation = e.target.value;
                          } else {
                            newRecords.push({
                              student_id: student.id,
                              session_id: `U${selUnit}S${selSession}`,
                              unit_id: `U${selUnit}`,
                              level: '',
                              observation: e.target.value,
                              criteria_id: 'default'
                            });
                          }
                          setRecords(newRecords);
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
