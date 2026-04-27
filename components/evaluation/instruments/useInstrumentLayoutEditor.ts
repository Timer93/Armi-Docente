import React from 'react';
import { buildChecklistVisualRows, ensureChecklistLayout } from './checklist';
import { ensureGuideLayout } from './guide';
import {
  DEFAULT_LAYOUT_STYLE,
  intersectsLayout,
  layoutCellId,
  normalizeLayout,
  normalizeLayoutRange
} from './common';
import { normalizeByType } from './templates';
import { InstrumentLayout, InstrumentRecord, LayoutMerge, LayoutRange, LayoutStyle } from './types';

interface UseInstrumentLayoutEditorParams {
  editor: InstrumentRecord;
  setEditor: React.Dispatch<React.SetStateAction<InstrumentRecord>>;
}

export const useInstrumentLayoutEditor = ({ editor, setEditor }: UseInstrumentLayoutEditorParams) => {
  const [layoutAnchor, setLayoutAnchor] = React.useState<{ r: number; c: number } | null>(null);
  const [layoutSelection, setLayoutSelection] = React.useState<LayoutRange | null>({ sr: 0, sc: 0, er: 0, ec: 0 });
  const [layoutMenu, setLayoutMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [layoutDragTool, setLayoutDragTool] = React.useState<'row' | 'col' | 'cell' | null>(null);
  const [showFillPalette, setShowFillPalette] = React.useState(false);
  const [showTextPalette, setShowTextPalette] = React.useState(false);
  const [showMergeMenu, setShowMergeMenu] = React.useState(false);
  const [showOrientationMenu, setShowOrientationMenu] = React.useState(false);
  const [showBorderMenu, setShowBorderMenu] = React.useState(false);
  const [showBorderColorPalette, setShowBorderColorPalette] = React.useState(false);
  const [showBorderStyleMenu, setShowBorderStyleMenu] = React.useState(false);

  React.useEffect(() => {
    const onMouseUp = () => setLayoutAnchor(null);
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, []);

  const layout = editor.type === 'guia_observacion'
    ? ensureGuideLayout(normalizeLayout(editor.structure?.layout), editor.structure)
    : editor.type === 'lista_cotejo'
      ? ensureChecklistLayout(normalizeLayout(editor.structure?.layout), editor.structure)
      : normalizeLayout(editor.structure?.layout);
  const normalizedLayoutSelection = normalizeLayoutRange(layoutSelection);
  const layoutSelectedCount = normalizedLayoutSelection
    ? (normalizedLayoutSelection.er - normalizedLayoutSelection.sr + 1) * (normalizedLayoutSelection.ec - normalizedLayoutSelection.sc + 1)
    : 0;
  const selectedLayoutStyle = normalizedLayoutSelection
    ? (layout.styles?.[layoutCellId(normalizedLayoutSelection.sr, normalizedLayoutSelection.sc)] || DEFAULT_LAYOUT_STYLE)
    : DEFAULT_LAYOUT_STYLE;

  const updateLayout = React.useCallback((nextLayout: Partial<InstrumentLayout>) => {
    setEditor(prev => {
      const layout = normalizeLayout({ ...normalizeLayout(prev.structure?.layout), ...nextLayout });
      const structure = { ...prev.structure, layout };
      return {
        ...prev,
        structure: prev.type === 'guia_observacion' ? normalizeByType(prev.type, structure) : structure
      };
    });
  }, [setEditor]);

  const inLayoutSelection = React.useCallback((r: number, c: number) => {
    if (!normalizedLayoutSelection) return false;
    return r >= normalizedLayoutSelection.sr && r <= normalizedLayoutSelection.er && c >= normalizedLayoutSelection.sc && c <= normalizedLayoutSelection.ec;
  }, [normalizedLayoutSelection]);

  const findLayoutMergeAt = React.useCallback((r: number, c: number) =>
    (layout.merges || []).find((m: LayoutMerge) => r >= m.sr && r <= m.er && c >= m.sc && c <= m.ec), [layout.merges]);

  const isLayoutCovered = React.useCallback((r: number, c: number) => {
    const m = findLayoutMergeAt(r, c);
    return !!m && !(m.sr === r && m.sc === c);
  }, [findLayoutMergeAt]);

  const applyLayoutStyle = React.useCallback((patch: Partial<LayoutStyle>) => {
    if (!normalizedLayoutSelection) return;
    const checklistRows = editor.type === 'lista_cotejo' ? buildChecklistVisualRows(editor.structure) : [];
    const selectedChecklistRow = editor.type === 'lista_cotejo' && normalizedLayoutSelection.sr === normalizedLayoutSelection.er
      ? checklistRows[normalizedLayoutSelection.sr - 1]
      : null;
    const shouldExpandChecklistCapacityRow = !!selectedChecklistRow
      && selectedChecklistRow.kind !== 'crit'
      && normalizedLayoutSelection.sr > 0
      && normalizedLayoutSelection.sc === normalizedLayoutSelection.ec;
    const targetRange = shouldExpandChecklistCapacityRow
      ? { sr: normalizedLayoutSelection.sr, er: normalizedLayoutSelection.er, sc: 0, ec: 4 }
      : normalizedLayoutSelection;
    const nextStyles = { ...(layout.styles || {}) };
    for (let r = targetRange.sr; r <= targetRange.er; r += 1) {
      for (let c = targetRange.sc; c <= targetRange.ec; c += 1) {
        const id = layoutCellId(r, c);
        nextStyles[id] = { ...(layout.styles?.[id] || DEFAULT_LAYOUT_STYLE), ...patch };
      }
    }
    updateLayout({ styles: nextStyles });
  }, [editor.structure, editor.type, layout.styles, normalizedLayoutSelection, updateLayout]);

  const toggleLayoutStyle = React.useCallback((key: 'bold' | 'italic' | 'underline') => {
    if (!normalizedLayoutSelection) return;
    const nextStyles = { ...(layout.styles || {}) };
    const baseId = layoutCellId(normalizedLayoutSelection.sr, normalizedLayoutSelection.sc);
    const currentValue = !!(layout.styles?.[baseId]?.[key]);
    for (let r = normalizedLayoutSelection.sr; r <= normalizedLayoutSelection.er; r += 1) {
      for (let c = normalizedLayoutSelection.sc; c <= normalizedLayoutSelection.ec; c += 1) {
        const id = layoutCellId(r, c);
        nextStyles[id] = { ...(layout.styles?.[id] || DEFAULT_LAYOUT_STYLE), [key]: !currentValue };
      }
    }
    updateLayout({ styles: nextStyles });
  }, [layout.styles, normalizedLayoutSelection, updateLayout]);

  const setLayoutText = React.useCallback((r: number, c: number, value: string) => {
    updateLayout({ texts: { ...(layout.texts || {}), [layoutCellId(r, c)]: value } });
  }, [layout.texts, updateLayout]);

  const shiftLayoutRows = React.useCallback(<T,>(map: Record<string, T>, at: number) => {
    const next: Record<string, T> = {};
    Object.entries(map).forEach(([k, v]) => {
      const [rs, cs] = k.split(':');
      const row = Number(rs);
      const col = Number(cs);
      next[layoutCellId(row >= at ? row + 1 : row, col)] = v;
    });
    return next;
  }, []);

  const shiftLayoutCols = React.useCallback(<T,>(map: Record<string, T>, at: number) => {
    const next: Record<string, T> = {};
    Object.entries(map).forEach(([k, v]) => {
      const [rs, cs] = k.split(':');
      const row = Number(rs);
      const col = Number(cs);
      next[layoutCellId(row, col >= at ? col + 1 : col)] = v;
    });
    return next;
  }, []);

  const insertLayoutRow = React.useCallback((at: number) => {
    updateLayout({
      rows: Math.min(layout.rows + 1, 40),
      texts: shiftLayoutRows(layout.texts || {}, at),
      styles: shiftLayoutRows(layout.styles || {}, at),
      merges: (layout.merges || []).map((m: LayoutMerge) => {
        if (m.sr >= at) return { ...m, sr: m.sr + 1, er: m.er + 1 };
        if (m.er >= at) return { ...m, er: m.er + 1 };
        return m;
      })
    });
  }, [layout.merges, layout.rows, layout.styles, layout.texts, shiftLayoutRows, updateLayout]);

  const insertLayoutCol = React.useCallback((at: number) => {
    updateLayout({
      cols: Math.min(layout.cols + 1, 20),
      texts: shiftLayoutCols(layout.texts || {}, at),
      styles: shiftLayoutCols(layout.styles || {}, at),
      merges: (layout.merges || []).map((m: LayoutMerge) => {
        if (m.sc >= at) return { ...m, sc: m.sc + 1, ec: m.ec + 1 };
        if (m.ec >= at) return { ...m, ec: m.ec + 1 };
        return m;
      })
    });
  }, [layout.cols, layout.merges, layout.styles, layout.texts, shiftLayoutCols, updateLayout]);

  const mergeLayoutSelection = React.useCallback(() => {
    if (!normalizedLayoutSelection || layoutSelectedCount <= 1) return;
    const selectionAsMerge = normalizedLayoutSelection as LayoutMerge;
    updateLayout({
      merges: [...(layout.merges || []).filter((m: LayoutMerge) => !intersectsLayout(m, selectionAsMerge)), selectionAsMerge]
    });
  }, [layout.merges, layoutSelectedCount, normalizedLayoutSelection, updateLayout]);

  const unmergeLayoutSelection = React.useCallback(() => {
    if (!normalizedLayoutSelection) return;
    const selectionAsMerge = normalizedLayoutSelection as LayoutMerge;
    updateLayout({
      merges: (layout.merges || []).filter((m: LayoutMerge) => !intersectsLayout(m, selectionAsMerge))
    });
  }, [layout.merges, normalizedLayoutSelection, updateLayout]);

  const mergeLayoutHorizontal = React.useCallback(() => {
    if (!normalizedLayoutSelection || normalizedLayoutSelection.ec <= normalizedLayoutSelection.sc) return;
    const rowMerge: LayoutMerge = {
      sr: normalizedLayoutSelection.sr,
      er: normalizedLayoutSelection.sr,
      sc: normalizedLayoutSelection.sc,
      ec: normalizedLayoutSelection.ec
    };
    updateLayout({
      merges: [...(layout.merges || []).filter((m: LayoutMerge) => !intersectsLayout(m, rowMerge)), rowMerge]
    });
  }, [layout.merges, normalizedLayoutSelection, updateLayout]);

  const closeFormatPopovers = React.useCallback(() => {
    setLayoutMenu(null);
    setShowFillPalette(false);
    setShowTextPalette(false);
    setShowMergeMenu(false);
    setShowOrientationMenu(false);
    setShowBorderMenu(false);
    setShowBorderColorPalette(false);
    setShowBorderStyleMenu(false);
  }, []);

  const onLayoutCellMouseDown = React.useCallback((r: number, c: number) => {
    setLayoutAnchor({ r, c });
    setLayoutSelection({ sr: r, sc: c, er: r, ec: c });
    closeFormatPopovers();
  }, [closeFormatPopovers]);

  const onLayoutCellEnter = React.useCallback((r: number, c: number) => {
    if (!layoutAnchor) return;
    setLayoutSelection({ sr: layoutAnchor.r, sc: layoutAnchor.c, er: r, ec: c });
  }, [layoutAnchor]);

  const onLayoutCellContext = React.useCallback((e: React.MouseEvent, _r: number, _c: number) => {
    e.preventDefault();
    const menuWidth = 224;
    const menuHeight = 360;
    const margin = 12;
    const x = Math.max(margin, Math.min(e.clientX + margin, window.innerWidth - menuWidth - margin));
    const y = Math.max(margin, Math.min(e.clientY + margin, window.innerHeight - menuHeight - margin));
    setLayoutMenu({ x, y });
  }, []);

  const applyBgColor = React.useCallback((color: string, closeMenu = false) => {
    applyLayoutStyle({ bg: color });
    if (closeMenu) setLayoutMenu(null);
  }, [applyLayoutStyle]);

  const applyTextColor = React.useCallback((color: string, closeMenu = false) => {
    applyLayoutStyle({ color });
    if (closeMenu) setLayoutMenu(null);
  }, [applyLayoutStyle]);

  const applyBorderColor = React.useCallback((color: string) => {
    applyLayoutStyle({ borderColor: color });
  }, [applyLayoutStyle]);

  const applyBorderStyleKind = React.useCallback((kind: LayoutStyle['borderStyle']) => {
    applyLayoutStyle({ borderStyle: kind });
  }, [applyLayoutStyle]);

  const applyBordersToSelection = React.useCallback((mode: 'bottom' | 'top' | 'left' | 'right' | 'none' | 'all' | 'outer' | 'outer_thick') => {
    if (!normalizedLayoutSelection) return;
    const nextStyles = { ...(layout.styles || {}) };
    const { sr, sc, er, ec } = normalizedLayoutSelection;
    for (let r = sr; r <= er; r += 1) {
      for (let c = sc; c <= ec; c += 1) {
        const id = layoutCellId(r, c);
        const current = { ...(layout.styles?.[id] || DEFAULT_LAYOUT_STYLE) };
        if (mode === 'none') {
          current.borderTop = false; current.borderRight = false; current.borderBottom = false; current.borderLeft = false;
          current.borderWidth = 1;
          current.borderTopWidth = 1; current.borderRightWidth = 1; current.borderBottomWidth = 1; current.borderLeftWidth = 1;
        } else if (mode === 'all') {
          current.borderTop = true; current.borderRight = true; current.borderBottom = true; current.borderLeft = true;
          current.borderWidth = 1;
          current.borderTopWidth = 1; current.borderRightWidth = 1; current.borderBottomWidth = 1; current.borderLeftWidth = 1;
        } else if (mode === 'top') {
          current.borderTop = true;
          current.borderWidth = 1;
          current.borderTopWidth = 1;
        } else if (mode === 'bottom') {
          current.borderBottom = true;
          current.borderWidth = 1;
          current.borderBottomWidth = 1;
        } else if (mode === 'left') {
          current.borderLeft = true;
          current.borderWidth = 1;
          current.borderLeftWidth = 1;
        } else if (mode === 'right') {
          current.borderRight = true;
          current.borderWidth = 1;
          current.borderRightWidth = 1;
        } else if (mode === 'outer' || mode === 'outer_thick') {
          const edgeWidth = mode === 'outer_thick' ? 2 : 1;
          if (r === sr) {
            current.borderTop = true;
            current.borderTopWidth = edgeWidth;
          }
          if (r === er) {
            current.borderBottom = true;
            current.borderBottomWidth = edgeWidth;
          }
          if (c === sc) {
            current.borderLeft = true;
            current.borderLeftWidth = edgeWidth;
          }
          if (c === ec) {
            current.borderRight = true;
            current.borderRightWidth = edgeWidth;
          }
          current.borderWidth = edgeWidth;
        }
        nextStyles[id] = current;
      }
    }
    updateLayout({ styles: nextStyles });
  }, [layout.styles, normalizedLayoutSelection, updateLayout]);

  return {
    layout,
    layoutSelectedCount,
    selectedLayoutStyle,
    layoutMenu,
    setLayoutMenu,
    layoutDragTool,
    setLayoutDragTool,
    showFillPalette,
    setShowFillPalette,
    showTextPalette,
    setShowTextPalette,
    showMergeMenu,
    setShowMergeMenu,
    showOrientationMenu,
    setShowOrientationMenu,
    showBorderMenu,
    setShowBorderMenu,
    showBorderColorPalette,
    setShowBorderColorPalette,
    showBorderStyleMenu,
    setShowBorderStyleMenu,
    setLayoutSelection,
    findLayoutMergeAt,
    inLayoutSelection,
    isLayoutCovered,
    setLayoutText,
    insertLayoutRow,
    insertLayoutCol,
    mergeLayoutSelection,
    unmergeLayoutSelection,
    mergeLayoutHorizontal,
    onLayoutCellMouseDown,
    onLayoutCellEnter,
    onLayoutCellContext,
    closeFormatPopovers,
    applyLayoutStyle,
    toggleLayoutStyle,
    applyBgColor,
    applyTextColor,
    applyBorderColor,
    applyBorderStyleKind,
    applyBordersToSelection
  };
};
