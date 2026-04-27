import React, { useEffect } from 'react';
import { InstrumentLayout, LayoutAlign, LayoutRange, LayoutStyle, LayoutVAlign } from './types';

export const mkId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const DEFAULT_LAYOUT_STYLE: LayoutStyle = {
  bg: '#ffffff',
  color: '#0f172a',
  bold: false,
  italic: false,
  underline: false,
  orientation: 'normal',
  borderTop: true,
  borderRight: true,
  borderBottom: true,
  borderLeft: true,
  borderColor: '#cbd5e1',
  borderStyle: 'solid',
  borderWidth: 1,
  borderTopWidth: 1,
  borderRightWidth: 1,
  borderBottomWidth: 1,
  borderLeftWidth: 1,
  align: 'left',
  vAlign: 'top'
};

export const QUICK_LAYOUT_COLORS = ['#ffffff', '#fef3c7', '#dbeafe', '#dcfce7', '#fee2e2', '#e2e8f0', '#0f172a', '#1d4ed8', '#15803d', '#b91c1c'];
export const THEME_LAYOUT_COLORS = ['#000000', '#1f2937', '#4b5563', '#9ca3af', '#2563eb', '#f59e0b', '#9ca3af', '#facc15', '#60a5fa', '#6aa84f'];
export const STANDARD_LAYOUT_COLORS = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];
export const RUBRICA_HEADER_COLORS = ['#ef1c24', '#f77b28', '#28a745', '#84c7d8'];
export const layoutCellId = (r: number, c: number) => `${r}:${c}`;

export const DEFAULT_LAYOUT: InstrumentLayout = {
  rows: 10,
  cols: 6,
  texts: {},
  styles: {},
  merges: []
};

export const DEFAULT_DESIGN = {
  titleLine: '',
  headerBg: '#0f172a',
  headerText: '#ffffff',
  cellBg: '#ffffff',
  altRowBg: '#f8fafc',
  borderColor: '#cbd5e1',
  borderRadius: 14,
  mergeHeader: false
};

export const clampCount = (n: any, fallback: number, min = 1, max = 30) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
};

export const normalizeLoose = (value: any) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export const normalizeDesign = (raw: any) => ({
  ...DEFAULT_DESIGN,
  ...(raw || {}),
  borderRadius: clampCount(raw?.borderRadius, DEFAULT_DESIGN.borderRadius, 0, 40),
  mergeHeader: !!raw?.mergeHeader
});

export const normalizeLayout = (raw: any): InstrumentLayout => {
  const layout = raw || {};
  const rawStyles = layout.styles && typeof layout.styles === 'object' ? layout.styles : {};
  const styles = Object.entries(rawStyles).reduce((acc: Record<string, LayoutStyle>, [key, value]: [string, any]) => {
    const align: LayoutAlign = ['left', 'center', 'right', 'justify'].includes(value?.align) ? value.align : 'left';
    const vAlign: LayoutVAlign = ['top', 'middle', 'bottom'].includes(value?.vAlign) ? value.vAlign : 'top';
    const orientation: LayoutStyle['orientation'] = ['normal', 'angle_up', 'angle_down', 'vertical', 'up', 'down'].includes(value?.orientation)
      ? value.orientation
      : 'normal';
    acc[key] = { ...DEFAULT_LAYOUT_STYLE, ...(value || {}), align, vAlign, orientation };
    return acc;
  }, {});
  return {
    rows: clampCount(layout.rows, DEFAULT_LAYOUT.rows, 2, 40),
    cols: clampCount(layout.cols, DEFAULT_LAYOUT.cols, 2, 20),
    texts: layout.texts && typeof layout.texts === 'object' ? layout.texts : {},
    styles,
    merges: Array.isArray(layout.merges)
      ? layout.merges
          .map((m: any) => ({ sr: Number(m.sr), sc: Number(m.sc), er: Number(m.er), ec: Number(m.ec) }))
          .filter((m: any) => Number.isFinite(m.sr) && Number.isFinite(m.sc) && Number.isFinite(m.er) && Number.isFinite(m.ec))
      : []
  };
};

export const normalizeLayoutRange = (range: LayoutRange | null): LayoutRange | null => {
  if (!range) return null;
  return {
    sr: Math.min(range.sr, range.er),
    sc: Math.min(range.sc, range.ec),
    er: Math.max(range.sr, range.er),
    ec: Math.max(range.sc, range.ec)
  };
};

export const intersectsLayout = (a: { sr: number; sc: number; er: number; ec: number }, b: { sr: number; sc: number; er: number; ec: number }) =>
  !(a.ec < b.sc || a.sc > b.ec || a.er < b.sr || a.sr > b.er);

export const hasCustomLayoutStyle = (style: LayoutStyle) =>
  style.bg !== DEFAULT_LAYOUT_STYLE.bg
  || style.color !== DEFAULT_LAYOUT_STYLE.color
  || style.bold !== DEFAULT_LAYOUT_STYLE.bold
  || style.italic !== DEFAULT_LAYOUT_STYLE.italic
  || style.underline !== DEFAULT_LAYOUT_STYLE.underline
  || style.orientation !== DEFAULT_LAYOUT_STYLE.orientation
  || style.borderTop !== DEFAULT_LAYOUT_STYLE.borderTop
  || style.borderRight !== DEFAULT_LAYOUT_STYLE.borderRight
  || style.borderBottom !== DEFAULT_LAYOUT_STYLE.borderBottom
  || style.borderLeft !== DEFAULT_LAYOUT_STYLE.borderLeft
  || style.borderColor !== DEFAULT_LAYOUT_STYLE.borderColor
  || style.borderStyle !== DEFAULT_LAYOUT_STYLE.borderStyle
  || style.borderWidth !== DEFAULT_LAYOUT_STYLE.borderWidth
  || style.borderTopWidth !== DEFAULT_LAYOUT_STYLE.borderTopWidth
  || style.borderRightWidth !== DEFAULT_LAYOUT_STYLE.borderRightWidth
  || style.borderBottomWidth !== DEFAULT_LAYOUT_STYLE.borderBottomWidth
  || style.borderLeftWidth !== DEFAULT_LAYOUT_STYLE.borderLeftWidth
  || style.align !== DEFAULT_LAYOUT_STYLE.align
  || style.vAlign !== DEFAULT_LAYOUT_STYLE.vAlign;

export const getOrientationStyle = (orientation: LayoutStyle['orientation']): React.CSSProperties => {
  if (orientation === 'vertical') return { writingMode: 'vertical-rl', textOrientation: 'mixed' };
  if (orientation === 'up') return { writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' };
  if (orientation === 'down') return { writingMode: 'vertical-rl', textOrientation: 'mixed' };
  if (orientation === 'angle_up') return { display: 'inline-block', transform: 'rotate(-45deg)', transformOrigin: 'center center' };
  if (orientation === 'angle_down') return { display: 'inline-block', transform: 'rotate(45deg)', transformOrigin: 'center center' };
  return {};
};

export const getOrientationBoxStyle = (orientation: LayoutStyle['orientation'], text: string): React.CSSProperties => {
  if (orientation === 'normal') return {};
  const baseSize = Math.max(46, Math.min(220, (text || '').length * 7));
  if (orientation === 'vertical' || orientation === 'up' || orientation === 'down') {
    return {
      minHeight: `${Math.max(72, baseSize)}px`,
      width: '100%',
      padding: '8px 4px',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      whiteSpace: 'normal',
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
      lineHeight: 1.05
    };
  }
  return {
    minHeight: `${baseSize + 12}px`,
    width: '100%',
    padding: '8px 6px',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    whiteSpace: 'nowrap',
    lineHeight: 1.05
  };
};

export const getCellBorderStyle = (cellStyle: LayoutStyle, fallbackColor = '#cbd5e1'): React.CSSProperties => {
  const color = cellStyle.borderColor || fallbackColor;
  const kind = cellStyle.borderStyle || 'solid';
  const topW = Math.max(1, Number(cellStyle.borderTopWidth ?? cellStyle.borderWidth ?? 1));
  const rightW = Math.max(1, Number(cellStyle.borderRightWidth ?? cellStyle.borderWidth ?? 1));
  const bottomW = Math.max(1, Number(cellStyle.borderBottomWidth ?? cellStyle.borderWidth ?? 1));
  const leftW = Math.max(1, Number(cellStyle.borderLeftWidth ?? cellStyle.borderWidth ?? 1));
  return {
    borderTop: cellStyle.borderTop ? `${topW}px ${kind} ${color}` : 'none',
    borderRight: cellStyle.borderRight ? `${rightW}px ${kind} ${color}` : 'none',
    borderBottom: cellStyle.borderBottom ? `${bottomW}px ${kind} ${color}` : 'none',
    borderLeft: cellStyle.borderLeft ? `${leftW}px ${kind} ${color}` : 'none'
  };
};

export const getVerticalAlignStyle = (vAlign: LayoutVAlign): React.CSSProperties => ({
  verticalAlign: vAlign === 'middle' ? 'middle' : vAlign === 'bottom' ? 'bottom' : 'top'
});

export const AlignIcon: React.FC<{ align: LayoutAlign }> = ({ align }) => {
  const width = align === 'justify' ? 12 : align === 'center' ? 8 : 10;
  const x = align === 'left' ? 2 : align === 'center' ? 4 : align === 'right' ? 6 : 2;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x={2} y={3} width={12} height={1.4} rx={0.7} fill="currentColor" />
      <rect x={x} y={6.5} width={width} height={1.4} rx={0.7} fill="currentColor" />
      <rect x={2} y={10} width={12} height={1.4} rx={0.7} fill="currentColor" />
    </svg>
  );
};

export const FillIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 10.5l4.4-4.4 2.7 2.7-4.4 4.4H3v-2.7z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M8.9 4.6l1.8-1.8 2.7 2.7-1.8 1.8z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <rect x="1.5" y="13.3" width="13" height="1.3" rx="0.6" fill="#facc15" />
  </svg>
);

export const TextColorIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <text x="8" y="11" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">A</text>
    <rect x="2" y="13" width="12" height="1.4" rx="0.7" fill="#ef4444" />
  </svg>
);

export const VAlignMiddleIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3" y="2" width="10" height="1.2" rx="0.6" fill="currentColor" />
    <rect x="3" y="12.8" width="10" height="1.2" rx="0.6" fill="currentColor" />
    <rect x="6.2" y="5" width="3.6" height="6" rx="0.8" fill="currentColor" />
  </svg>
);

interface EditableContentProps {
  value: string;
  className?: string;
  style?: React.CSSProperties;
  onLiveChange?: (value: string) => void;
  onCommit?: (value: string) => void;
}

export const EditableContent: React.FC<EditableContentProps> = ({ value, className, style, onLiveChange, onCommit }) => {
  const ref = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if ((el.innerText || '') !== value) el.innerText = value;
  }, [value]);

  return (
    <div
      ref={ref}
      className={className}
      style={style}
      contentEditable
      suppressContentEditableWarning
      onInput={(e) => onLiveChange?.((e.currentTarget.innerText || '').trim())}
      onBlur={(e) => onCommit?.((e.currentTarget.innerText || '').trim())}
    />
  );
};
