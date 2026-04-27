import React from 'react';

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
}

export const TextArea: React.FC<TextAreaProps> = ({ label, error, className = '', ...props }) => {
  return (
    <div className="group mb-3">
      <label className="block text-sm font-medium text-slate-700 mb-1 ml-1 transition-colors group-focus-within:text-blue-600">
        {label}
      </label>
      <div className="relative">
        <textarea
          className={`
            w-full bg-slate-50 text-slate-800 placeholder:text-slate-400
            border rounded-xl px-3 py-2.5 min-h-[100px] transition-all duration-300 ease-in-out
            focus:outline-none focus:bg-white focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500
            ${error 
              ? 'border-red-300 bg-red-50 focus:border-red-500 focus:ring-red-200' 
              : 'border-slate-200 hover:border-slate-300'} 
            ${className}
          `}
          {...props}
        />
      </div>
      {error && <p className="mt-1 ml-1 text-xs font-medium text-red-500 animate-fade-in">{error}</p>}
    </div>
  );
};