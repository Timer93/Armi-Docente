export type InstrumentType = 'rubrica' | 'lista_cotejo' | 'escala_valoracion' | 'guia_observacion';
export type LayoutAlign = 'left' | 'center' | 'right' | 'justify';
export type LayoutVAlign = 'top' | 'middle' | 'bottom';

export interface LayoutStyle {
  bg: string;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  orientation: 'normal' | 'angle_up' | 'angle_down' | 'vertical' | 'up' | 'down';
  borderTop: boolean;
  borderRight: boolean;
  borderBottom: boolean;
  borderLeft: boolean;
  borderColor: string;
  borderStyle: 'solid' | 'dashed' | 'dotted' | 'double';
  borderWidth: number;
  borderTopWidth: number;
  borderRightWidth: number;
  borderBottomWidth: number;
  borderLeftWidth: number;
  align: LayoutAlign;
  vAlign: LayoutVAlign;
}

export interface LayoutMerge {
  sr: number;
  sc: number;
  er: number;
  ec: number;
}

export interface LayoutRange {
  sr: number;
  sc: number;
  er: number;
  ec: number;
}

export interface InstrumentLayout {
  rows: number;
  cols: number;
  texts: Record<string, string>;
  styles: Record<string, LayoutStyle>;
  merges: LayoutMerge[];
}

export interface InstrumentRecord {
  id?: number;
  year: string;
  areaId: string;
  grade: string;
  section: string;
  type: InstrumentType;
  name: string;
  structure: any;
  version: number;
}

export interface TemplateDef {
  type: InstrumentType;
  label: string;
  icon: string;
  structure: any;
}

export interface ChecklistVisualRow {
  kind: 'comp' | 'cap' | 'crit';
  comp: number;
  cap: number;
  text: string;
  itemIndex?: number;
  competencyIndex?: number;
  capacityIndex?: number;
  criterionIndex?: number;
}

export interface ScaleBodyRow {
  kind: 'comp' | 'cap' | 'crit';
  comp: number;
  cap: number;
  text: string;
  competencyIndex?: number;
  capacityIndex?: number;
  criterionIndex?: number;
}
