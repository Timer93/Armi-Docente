
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const data = [
  { name: 'AD', value: 15, color: '#00b0f0' },
  { name: 'A', value: 45, color: '#00b050' },
  { name: 'B', value: 25, color: '#f97316' },
  { name: 'C', value: 10, color: '#ef4444' },
  { name: 'NE', value: 5, color: '#000000' },
];

const competencyData = [
  { name: 'Comp 1', AD: 4, A: 10, B: 5, C: 1 },
  { name: 'Comp 2', AD: 2, A: 12, B: 4, C: 2 },
  { name: 'Comp 3', AD: 5, A: 8, B: 6, C: 1 },
];

export const AnalysisReports: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-[2rem] p-8 shadow-lg border border-slate-100">
          <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight italic mb-8">Distribución de Logros</h2>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-4">
            {data.map((item) => (
              <div key={item.name} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                <span className="text-[10px] font-black text-slate-600">{item.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-[2rem] p-8 shadow-lg border border-slate-100">
          <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight italic mb-8">Progreso por Competencia</h2>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={competencyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold' }} />
                <Tooltip />
                <Bar dataKey="AD" stackId="a" fill="#00b0f0" radius={[0, 0, 0, 0]} />
                <Bar dataKey="A" stackId="a" fill="#00b050" radius={[0, 0, 0, 0]} />
                <Bar dataKey="B" stackId="a" fill="#f97316" radius={[0, 0, 0, 0]} />
                <Bar dataKey="C" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[2rem] p-8 shadow-lg border border-slate-100">
        <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight italic mb-8">Resumen de Secciones</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-black uppercase text-slate-400 tracking-widest border-b border-slate-100">
                <th className="p-6">Sección</th>
                <th className="p-6 text-center">Promedio</th>
                <th className="p-6 text-center">Estudiantes en Riesgo</th>
                <th className="p-6 text-center">Logro Destacado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {['4to A', '4to B', '4to C'].map((sec) => (
                <tr key={sec} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-6 font-black text-slate-800 uppercase text-xs">{sec}</td>
                  <td className="p-6 text-center font-bold text-emerald-600 text-xs">A</td>
                  <td className="p-6 text-center font-bold text-rose-500 text-xs">3</td>
                  <td className="p-6 text-center font-bold text-blue-500 text-xs">12%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
