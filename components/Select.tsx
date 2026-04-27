import React, { useState, useRef, useEffect } from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label: string;
  name: string;
  value: string | number;
  onChange: (e: any) => void;
  options: SelectOption[];
  error?: string;
  icon?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  searchable?: boolean;
  labelClassName?: string;
  valueClassName?: string;
  variant?: 'default' | 'compact'; // Nuevo prop para variante compacta
}

export const Select: React.FC<SelectProps> = ({
  label,
  name,
  value,
  onChange,
  options,
  error,
  icon,
  disabled = false,
  className = '',
  placeholder = 'Seleccionar...',
  searchable = false,
  labelClassName = "text-slate-500",
  valueClassName = "text-slate-800",
  variant = 'default', // Por defecto usa el estilo normal
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find(opt => String(opt.value) === String(value));

  const filteredOptions = searchable
    ? options.filter(opt => opt.label.toLowerCase().includes(searchTerm.toLowerCase()))
    : options;

  const isCompact = variant === 'compact';

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        if (isOpen) closeMenu();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && searchable && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen, searchable]);

  const closeMenu = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
      setSearchTerm('');
    }, 150);
  };

  const toggleOpen = () => {
    if (disabled) return;
    if (isOpen) {
      closeMenu();
    } else {
      setIsOpen(true);
    }
  };

  const handleSelect = (optionValue: string) => {
    const syntheticEvent = {
      target: { name: name, value: optionValue }
    };
    onChange(syntheticEvent);
    closeMenu();
  };

  return (
    <div className={`group relative w-full ${className}`} ref={containerRef}>
      {/* Label */}
      <label
        className={`block font-black ml-1 transition-colors group-focus-within:text-blue-600 truncate uppercase tracking-[0.15em] leading-none ${
          isCompact ? 'text-[9px] mb-0.5' : 'text-[10px] mb-2'
        } ${labelClassName}`}
      >
        {label}
      </label>

      {/* Trigger (el cuadro clickable) */}
      <div
        onClick={toggleOpen}
        className={`
          relative w-full cursor-pointer
          border rounded-xl flex items-center justify-between
          transition-all duration-300 ease-in-out
          ${isCompact 
            ? 'text-[10px] h-[32px] px-2.5 py-1' 
            : 'text-sm h-[42px] px-3 py-2.5'}
          ${isOpen 
            ? 'ring-2 ring-blue-500/20 border-blue-500 bg-white shadow-lg' 
            : 'bg-slate-50 border-slate-200 hover:border-blue-300 hover:bg-white hover:shadow-sm'}
          ${error 
            ? 'border-red-300 bg-red-50 hover:bg-red-50/80' 
            : ''}
          ${disabled 
            ? 'opacity-60 cursor-not-allowed bg-slate-100 text-slate-400' 
            : ''}
        `}
      >
        <div className="flex items-center gap-1.5 truncate pr-5 w-full">
          {icon && <span className="text-slate-400 text-base">{icon}</span>}
          <span
            className={`truncate w-full text-left ${
              !selectedOption ? 'text-slate-400 italic' : `font-bold ${valueClassName}`
            }`}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>

        {/* Flecha */}
        <div
          className={`absolute right-2 transition-transform duration-300 ${
            isOpen ? 'rotate-180 text-blue-500' : 'text-slate-400'
          }`}
        >
          <svg
            className={`${isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth="2.5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Dropdown */}
      {(isOpen || isClosing) && (
        <div
          className={`
            absolute top-full left-0 mt-1 w-full bg-white border border-slate-100 rounded-xl 
            shadow-2xl overflow-hidden z-[100] dropdown-enter
            ${isOpen && !isClosing ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-95 pointer-events-none'}
          `}
          style={{ minWidth: '100%' }}
        >
          {searchable && (
            <div className="p-1.5 border-b border-slate-100 bg-slate-50">
              <input
                ref={searchInputRef}
                type="text"
                className={`w-full border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${
                  isCompact ? 'text-[10px] px-2 py-1' : 'text-xs px-2 py-1.5'
                }`}
                placeholder="Buscar..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          <div className={`max-h-48 overflow-y-auto custom-scrollbar ${isCompact ? 'p-1' : 'p-1.5'}`}>
            {filteredOptions.length === 0 ? (
              <div
                className={`p-2.5 text-center italic text-slate-400 ${
                  isCompact ? 'text-[10px]' : 'text-xs'
                }`}
              >
                No se encontraron resultados
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = String(opt.value) === String(value);
                return (
                  <div
                    key={opt.value}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelect(opt.value);
                    }}
                    className={`
                      px-3 py-2 rounded-lg cursor-pointer transition-all duration-150 mb-0.5
                      flex items-center justify-between truncate
                      ${isCompact ? 'text-[10.5px]' : 'text-xs'}
                      ${
                        isSelected
                          ? 'bg-blue-50 text-blue-700 font-black'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-bold'
                      }
                    `}
                  >
                    <span className="truncate">{opt.label}</span>
                    {isSelected && (
                      <span className="text-blue-500 flex-shrink-0">
                        <svg
                          className={`${isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5'}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p
          className={`mt-1 ml-1 font-bold text-red-500 animate-fade-in flex items-center gap-1 ${
            isCompact ? 'text-[9px]' : 'text-[10px]'
          }`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
};