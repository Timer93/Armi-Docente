
import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, icon, className = '', ...props }) => {
  return (
    <div className="group w-full">
      {label && (
        <label className="block text-[10px] font-black text-slate-500 mb-2 ml-1 transition-colors group-focus-within:text-blue-600 truncate uppercase tracking-[0.15em] leading-none">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-blue-500 transition-colors">
                <span className="text-base">{icon}</span>
            </div>
        )}
        <input
          className={`
            w-full bg-slate-50 text-slate-800 placeholder:text-slate-400 text-sm
            border rounded-xl px-3 py-2.5 transition-all duration-300 ease-in-out h-[42px]
            focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500
            ${icon ? 'pl-10' : ''}
            ${error 
              ? 'border-red-300 bg-red-50 focus:border-red-500 focus:ring-red-200' 
              : 'border-slate-200 hover:border-blue-300 hover:bg-white hover:shadow-sm'} 
            ${className}
          `}
          {...props}
        />
      </div>
      {error && <p className="mt-1 ml-1 text-[10px] font-bold text-red-500 animate-fade-in flex items-center gap-1">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        {error}
      </p>}
    </div>
  );
};
