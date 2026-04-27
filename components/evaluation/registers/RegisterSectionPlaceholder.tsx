import React from 'react';

interface RegisterSectionPlaceholderProps {
  title: string;
  accentClassName: string;
  badge: string;
  description: string;
  bullets: string[];
}

export const RegisterSectionPlaceholder: React.FC<RegisterSectionPlaceholderProps> = ({
  title,
  accentClassName,
  badge,
  description,
  bullets
}) => {
  return (
    <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden">
      <div className={`h-2 ${accentClassName}`}></div>
      <div className="p-8 space-y-6">
        <div className="flex items-start gap-4">
          <div className={`rounded-3xl px-4 py-3 text-sm font-black text-white shadow-lg ${accentClassName}`}>
            {badge}
          </div>
          <div>
            <h2 className="text-2xl font-black italic uppercase tracking-tight text-slate-800">
              {title}
            </h2>
            <p className="mt-2 max-w-3xl text-sm font-medium leading-relaxed text-slate-500">
              {description}
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {bullets.map((bullet, index) => (
            <div
              key={`${title}-bullet-${index}`}
              className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4 shadow-sm"
            >
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Paso {index + 1}
              </p>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-700">
                {bullet}
              </p>
            </div>
          ))}
        </div>

        <div className="rounded-[2rem] border border-dashed border-slate-300 bg-slate-50/80 px-6 py-5">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">
            Base compartida
          </p>
          <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-600">
            Esta vista queda lista para conectarse luego al mismo núcleo de evaluación que ya usa el
            registro por sesión: competencias, capacidades, criterios, niveles de logro, transversales,
            NL y resúmenes.
          </p>
        </div>
      </div>
    </div>
  );
};
