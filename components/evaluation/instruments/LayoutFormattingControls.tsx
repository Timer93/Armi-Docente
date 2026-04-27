import React from 'react';
import { createPortal } from 'react-dom';
import {
  AlignIcon,
  FillIcon,
  STANDARD_LAYOUT_COLORS,
  THEME_LAYOUT_COLORS,
  TextColorIcon,
  VAlignMiddleIcon
} from './common';
import { LayoutStyle } from './types';

interface LayoutFormatPanelProps {
  selectedLayoutStyle: LayoutStyle;
  showMergeMenu: boolean;
  showOrientationMenu: boolean;
  showFillPalette: boolean;
  showTextPalette: boolean;
  showBorderMenu: boolean;
  showBorderColorPalette: boolean;
  showBorderStyleMenu: boolean;
  setShowMergeMenu: React.Dispatch<React.SetStateAction<boolean>>;
  setShowOrientationMenu: React.Dispatch<React.SetStateAction<boolean>>;
  setShowFillPalette: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTextPalette: React.Dispatch<React.SetStateAction<boolean>>;
  setShowBorderMenu: React.Dispatch<React.SetStateAction<boolean>>;
  setShowBorderColorPalette: React.Dispatch<React.SetStateAction<boolean>>;
  setShowBorderStyleMenu: React.Dispatch<React.SetStateAction<boolean>>;
  mergeLayoutSelection: () => void;
  mergeLayoutHorizontal: () => void;
  unmergeLayoutSelection: () => void;
  applyLayoutStyle: (patch: Partial<LayoutStyle>) => void;
  applyBgColor: (color: string) => void;
  applyTextColor: (color: string) => void;
  toggleLayoutStyle: (key: 'bold' | 'italic' | 'underline') => void;
  applyBordersToSelection: (mode: 'top' | 'right' | 'bottom' | 'left' | 'all' | 'none' | 'outer' | 'outer_thick') => void;
  applyBorderColor: (color: string) => void;
  applyBorderStyleKind: (kind: LayoutStyle['borderStyle']) => void;
}

export const LayoutFormatPanel: React.FC<LayoutFormatPanelProps> = ({
  selectedLayoutStyle,
  showMergeMenu,
  showOrientationMenu,
  showFillPalette,
  showTextPalette,
  showBorderMenu,
  showBorderColorPalette,
  showBorderStyleMenu,
  setShowMergeMenu,
  setShowOrientationMenu,
  setShowFillPalette,
  setShowTextPalette,
  setShowBorderMenu,
  setShowBorderColorPalette,
  setShowBorderStyleMenu,
  mergeLayoutSelection,
  mergeLayoutHorizontal,
  unmergeLayoutSelection,
  applyLayoutStyle,
  applyBgColor,
  applyTextColor,
  toggleLayoutStyle,
  applyBordersToSelection,
  applyBorderColor,
  applyBorderStyleKind
}) => (
  <aside className="bg-zinc-700 border border-zinc-600 rounded-xl p-3 space-y-3">
    <p className="text-[10px] font-black uppercase text-zinc-100">Formato</p>
    <p className="text-[10px] text-zinc-300">Se aplica a la selección activa en cualquier instrumento.</p>

    <div className="grid grid-cols-4 gap-1 bg-zinc-800 p-1 rounded relative">
      <button className="h-8 rounded text-white text-[10px] px-1 hover:bg-zinc-700 flex items-center justify-between" onClick={() => { setShowMergeMenu(v => !v); setShowOrientationMenu(false); }}>
        <span className="truncate">⧉</span>
        <span>▾</span>
      </button>
      <button className="h-8 rounded text-white text-[10px] px-1 hover:bg-zinc-700 flex items-center justify-between" onClick={() => { setShowOrientationMenu(v => !v); setShowMergeMenu(false); }}>
        <span>ab</span>
        <span>▾</span>
      </button>
      <button className="h-8 rounded text-white hover:bg-zinc-700 flex items-center justify-center gap-1" onClick={() => { setShowFillPalette(v => !v); setShowTextPalette(false); }}>
        <FillIcon />
        <span className="text-[10px]">▾</span>
      </button>
      <button className="h-8 rounded text-white hover:bg-zinc-700 flex items-center justify-center gap-1" onClick={() => { setShowTextPalette(v => !v); setShowFillPalette(false); }}>
        <TextColorIcon />
        <span className="text-[10px]">▾</span>
      </button>

      {showMergeMenu && (
        <div className="absolute z-20 top-10 left-0 w-52 rounded border border-slate-300 bg-white shadow-xl p-1 text-[11px]">
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { mergeLayoutSelection(); applyLayoutStyle({ align: 'center' }); setShowMergeMenu(false); }}>Combinar y centrar</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { mergeLayoutHorizontal(); setShowMergeMenu(false); }}>Combinar horizontalmente</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { mergeLayoutSelection(); setShowMergeMenu(false); }}>Combinar celdas</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { unmergeLayoutSelection(); setShowMergeMenu(false); }}>Separar celdas</button>
        </div>
      )}

      {showOrientationMenu && (
        <div className="absolute z-20 top-10 left-14 w-56 rounded border border-slate-300 bg-white shadow-xl p-1 text-[11px]">
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyLayoutStyle({ orientation: 'normal' }); setShowOrientationMenu(false); }}>Texto normal</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyLayoutStyle({ orientation: 'angle_up' }); setShowOrientationMenu(false); }}>Ángulo ascendente</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyLayoutStyle({ orientation: 'angle_down' }); setShowOrientationMenu(false); }}>Ángulo descendente</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyLayoutStyle({ orientation: 'vertical' }); setShowOrientationMenu(false); }}>Texto vertical</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyLayoutStyle({ orientation: 'up' }); setShowOrientationMenu(false); }}>Girar texto hacia arriba</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyLayoutStyle({ orientation: 'down' }); setShowOrientationMenu(false); }}>Girar texto hacia abajo</button>
        </div>
      )}

      {showFillPalette && (
        <div className="absolute z-20 top-10 right-14 w-52 rounded border border-slate-300 bg-white shadow-xl p-2 space-y-2">
          <p className="text-[10px] font-black text-slate-700">Colores del tema</p>
          <div className="grid grid-cols-10 gap-1">{THEME_LAYOUT_COLORS.map((c) => <button key={`th-bg-${c}`} className="h-4 w-4 border border-slate-300" style={{ backgroundColor: c }} onClick={() => applyBgColor(c)} />)}</div>
          <p className="text-[10px] font-black text-slate-700">Colores estándar</p>
          <div className="grid grid-cols-10 gap-1">{STANDARD_LAYOUT_COLORS.map((c) => <button key={`st-bg-${c}`} className="h-4 w-4 border border-slate-300" style={{ backgroundColor: c }} onClick={() => applyBgColor(c)} />)}</div>
          <button className="w-full h-8 rounded border border-slate-300 text-[11px] text-slate-700" onClick={() => applyBgColor('#ffffff')}>Sin relleno</button>
          <label className="w-full h-8 rounded border border-slate-300 text-[11px] text-slate-700 flex items-center justify-center cursor-pointer">
            Más colores...
            <input type="color" className="sr-only" value={selectedLayoutStyle.bg} onChange={(e) => applyBgColor(e.target.value)} />
          </label>
        </div>
      )}

      {showTextPalette && (
        <div className="absolute z-20 top-10 right-0 w-52 rounded border border-slate-300 bg-white shadow-xl p-2 space-y-2">
          <p className="text-[10px] font-black text-slate-700">Colores del tema</p>
          <div className="grid grid-cols-10 gap-1">{THEME_LAYOUT_COLORS.map((c) => <button key={`th-tx-${c}`} className="h-4 w-4 border border-slate-300" style={{ backgroundColor: c }} onClick={() => applyTextColor(c)} />)}</div>
          <p className="text-[10px] font-black text-slate-700">Colores estándar</p>
          <div className="grid grid-cols-10 gap-1">{STANDARD_LAYOUT_COLORS.map((c) => <button key={`st-tx-${c}`} className="h-4 w-4 border border-slate-300" style={{ backgroundColor: c }} onClick={() => applyTextColor(c)} />)}</div>
          <label className="w-full h-8 rounded border border-slate-300 text-[11px] text-slate-700 flex items-center justify-center cursor-pointer">
            Más colores...
            <input type="color" className="sr-only" value={selectedLayoutStyle.color} onChange={(e) => applyTextColor(e.target.value)} />
          </label>
        </div>
      )}
    </div>

    <div className="grid grid-cols-5 gap-1 bg-zinc-800 p-1 rounded">
      <button className="h-8 rounded text-white hover:bg-zinc-700 flex items-center justify-center" onClick={() => applyLayoutStyle({ align: 'left' })}><AlignIcon align="left" /></button>
      <button className="h-8 rounded text-white hover:bg-zinc-700 flex items-center justify-center" onClick={() => applyLayoutStyle({ align: 'center' })}><AlignIcon align="center" /></button>
      <button className="h-8 rounded text-white hover:bg-zinc-700 flex items-center justify-center" onClick={() => applyLayoutStyle({ align: 'right' })}><AlignIcon align="right" /></button>
      <button className="h-8 rounded text-white hover:bg-zinc-700 flex items-center justify-center" onClick={() => applyLayoutStyle({ align: 'justify' })}><AlignIcon align="justify" /></button>
      <button className="h-8 rounded text-white hover:bg-zinc-700 flex items-center justify-center" title="Centrar vertical" onClick={() => applyLayoutStyle({ vAlign: 'middle' })}><VAlignMiddleIcon /></button>
    </div>

    <div className="grid grid-cols-6 gap-1 bg-zinc-100 p-1 rounded relative">
      <button className="h-8 rounded text-zinc-900 font-black text-xl leading-none hover:bg-zinc-200" onClick={() => toggleLayoutStyle('bold')}>N</button>
      <button className="h-8 rounded text-zinc-900 italic text-xl leading-none hover:bg-zinc-200" onClick={() => toggleLayoutStyle('italic')}>K</button>
      <button className="h-8 rounded text-zinc-900 text-xl leading-none underline hover:bg-zinc-200" onClick={() => toggleLayoutStyle('underline')}>S</button>
      <button className="h-8 rounded bg-white border border-slate-300 text-zinc-800 text-[10px] hover:bg-slate-100 flex items-center justify-center gap-1" onClick={() => { setShowBorderMenu(v => !v); setShowBorderColorPalette(false); setShowBorderStyleMenu(false); }}>
        <span>▦</span><span>▾</span>
      </button>
      <button className="h-8 rounded bg-white border border-slate-300 text-zinc-800 text-[10px] hover:bg-slate-100 flex items-center justify-center gap-1" onClick={() => { setShowBorderColorPalette(v => !v); setShowBorderMenu(false); setShowBorderStyleMenu(false); }}>
        <span className="w-3 h-3 border border-slate-400" style={{ backgroundColor: selectedLayoutStyle.borderColor }} />
        <span>▾</span>
      </button>
      <button className="h-8 rounded bg-white border border-slate-300 text-zinc-800 text-[10px] hover:bg-slate-100 flex items-center justify-center gap-1" onClick={() => { setShowBorderStyleMenu(v => !v); setShowBorderMenu(false); setShowBorderColorPalette(false); }}>
        <span className="w-4 border-b-2 border-zinc-700" style={{ borderBottomStyle: selectedLayoutStyle.borderStyle }} />
        <span>▾</span>
      </button>

      {showBorderMenu && (
        <div className="absolute z-20 top-10 left-0 w-52 rounded border border-slate-300 bg-white shadow-xl p-2 space-y-1 text-[11px]">
          <p className="text-[12px] font-black text-slate-700 mb-1">Bordes</p>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyBordersToSelection('bottom'); setShowBorderMenu(false); }}>Borde inferior</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyBordersToSelection('top'); setShowBorderMenu(false); }}>Borde superior</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyBordersToSelection('left'); setShowBorderMenu(false); }}>Borde izquierdo</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyBordersToSelection('right'); setShowBorderMenu(false); }}>Borde derecho</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyBordersToSelection('none'); setShowBorderMenu(false); }}>Sin borde</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyBordersToSelection('all'); setShowBorderMenu(false); }}>Todos los bordes</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyBordersToSelection('outer'); setShowBorderMenu(false); }}>Bordes externos</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyBordersToSelection('outer_thick'); setShowBorderMenu(false); }}>Borde exterior grueso</button>
        </div>
      )}

      {showBorderColorPalette && (
        <div className="absolute z-20 top-10 right-14 w-52 rounded border border-slate-300 bg-white shadow-xl p-2 space-y-2">
          <p className="text-[10px] font-black text-slate-700">Color de borde</p>
          <div className="grid grid-cols-10 gap-1">{STANDARD_LAYOUT_COLORS.map((c) => <button key={`bd-c-${c}`} className="h-4 w-4 border border-slate-300" style={{ backgroundColor: c }} onClick={() => applyBorderColor(c)} />)}</div>
          <label className="w-full h-8 rounded border border-slate-300 text-[11px] text-slate-700 flex items-center justify-center cursor-pointer">
            Más colores...
            <input type="color" className="sr-only" value={selectedLayoutStyle.borderColor} onChange={(e) => applyBorderColor(e.target.value)} />
          </label>
        </div>
      )}

      {showBorderStyleMenu && (
        <div className="absolute z-20 top-10 right-0 w-40 rounded border border-slate-300 bg-white shadow-xl p-1 text-[11px]">
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyBorderStyleKind('solid'); setShowBorderStyleMenu(false); }}>Línea sólida</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyBorderStyleKind('dashed'); setShowBorderStyleMenu(false); }}>Línea punteada</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyBorderStyleKind('dotted'); setShowBorderStyleMenu(false); }}>Línea de puntos</button>
          <button className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-100" onClick={() => { applyBorderStyleKind('double'); setShowBorderStyleMenu(false); }}>Doble línea</button>
        </div>
      )}
    </div>
  </aside>
);

interface LayoutContextMenuProps {
  layoutMenu: { x: number; y: number };
  selectedLayoutStyle: LayoutStyle;
  setLayoutMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  mergeLayoutSelection: () => void;
  unmergeLayoutSelection: () => void;
  applyLayoutStyle: (patch: Partial<LayoutStyle>) => void;
  toggleLayoutStyle: (key: 'bold' | 'italic' | 'underline') => void;
  applyBgColor: (color: string, closeMenu?: boolean) => void;
  applyTextColor: (color: string, closeMenu?: boolean) => void;
}

export const LayoutContextMenu: React.FC<LayoutContextMenuProps> = ({
  layoutMenu,
  selectedLayoutStyle,
  setLayoutMenu,
  mergeLayoutSelection,
  unmergeLayoutSelection,
  applyLayoutStyle,
  toggleLayoutStyle,
  applyBgColor,
  applyTextColor
}) => {
  if (typeof document === 'undefined') return null;

  return createPortal(
  <div className="fixed z-[1200] bg-white border border-slate-200 rounded-xl shadow-2xl w-56" style={{ left: layoutMenu.x, top: layoutMenu.y }}>
    <div className="grid grid-cols-5 gap-1 p-2 border-b border-slate-100 bg-zinc-800">
      <button className="h-8 rounded bg-slate-100 text-[10px] font-black" onClick={() => { mergeLayoutSelection(); setLayoutMenu(null); }}>⧉</button>
      <button className="h-8 rounded bg-slate-100 text-[10px] font-black" onClick={() => { unmergeLayoutSelection(); setLayoutMenu(null); }}>↺</button>
      <button className="h-8 rounded text-white hover:bg-zinc-700 flex items-center justify-center" onClick={() => { applyLayoutStyle({ align: 'left' }); setLayoutMenu(null); }}><AlignIcon align="left" /></button>
      <button className="h-8 rounded text-white hover:bg-zinc-700 flex items-center justify-center" onClick={() => { applyLayoutStyle({ align: 'center' }); setLayoutMenu(null); }}><AlignIcon align="center" /></button>
      <button className="h-8 rounded text-white hover:bg-zinc-700 flex items-center justify-center" onClick={() => { applyLayoutStyle({ align: 'right' }); setLayoutMenu(null); }}><AlignIcon align="right" /></button>
      <button className="h-8 rounded text-white hover:bg-zinc-700 flex items-center justify-center" onClick={() => { applyLayoutStyle({ align: 'justify' }); setLayoutMenu(null); }}><AlignIcon align="justify" /></button>
      <button className="h-8 rounded text-white hover:bg-zinc-700 flex items-center justify-center" onClick={() => { applyLayoutStyle({ vAlign: 'middle' }); setLayoutMenu(null); }}><VAlignMiddleIcon /></button>
      <button className="h-8 rounded text-white font-black text-lg" onClick={() => { toggleLayoutStyle('bold'); setLayoutMenu(null); }}>N</button>
      <button className="h-8 rounded text-white italic text-lg" onClick={() => { toggleLayoutStyle('italic'); setLayoutMenu(null); }}>K</button>
      <button className="h-8 rounded text-white underline text-lg" onClick={() => { toggleLayoutStyle('underline'); setLayoutMenu(null); }}>S</button>
    </div>
    <div className="p-2">
      <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Color de relleno</p>
      <div className="grid grid-cols-5 gap-1">
        {THEME_LAYOUT_COLORS.map((color) => (
          <button key={`ctx-layout-bg-${color}`} className="h-7 rounded border border-slate-200" style={{ backgroundColor: color }} onClick={() => { applyBgColor(color, true); }} />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button className="px-2 h-8 rounded border border-slate-300 text-[11px] text-slate-700" onClick={() => { applyBgColor('#ffffff', true); }}>Sin relleno</button>
        <label className="px-2 h-8 rounded border border-slate-300 text-[11px] text-slate-700 flex items-center cursor-pointer">
          Más colores...
          <input type="color" className="sr-only" value={selectedLayoutStyle.bg} onChange={(e) => applyBgColor(e.target.value, true)} />
        </label>
      </div>
    </div>
    <div className="p-2 border-t border-slate-100">
      <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Color texto</p>
      <div className="grid grid-cols-5 gap-1">
        {STANDARD_LAYOUT_COLORS.map((color) => (
          <button key={`ctx-layout-tx-${color}`} className="h-7 rounded border border-slate-200 text-[9px] font-black" style={{ color, background: '#111827' }} onClick={() => { applyTextColor(color, true); }}>A</button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <label className="px-2 h-8 rounded border border-slate-300 text-[11px] text-slate-700 flex items-center cursor-pointer">
          Más colores...
          <input type="color" className="sr-only" value={selectedLayoutStyle.color} onChange={(e) => applyTextColor(e.target.value, true)} />
        </label>
      </div>
    </div>
  </div>,
  document.body
  );
};
