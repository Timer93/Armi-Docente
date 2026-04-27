import { TemplateDef, InstrumentType } from './types';
import { DEFAULT_DESIGN, normalizeDesign, normalizeLayout } from './common';
import { normalizeChecklistStructure } from './checklist';
import { normalizeGuideStructure } from './guide';
import { normalizeRubricaStructure } from './rubrica';
import { normalizeScaleStructure } from './scale';

export const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    type: 'rubrica',
    label: 'Rubrica Analitica',
    icon: '📊',
    structure: {
      levels: [
        { id: 'c', label: 'Inicio' },
        { id: 'b', label: 'Proceso' },
        { id: 'a', label: 'Logrado' },
        { id: 'ad', label: 'Destacado' }
      ],
      criteriaCount: 4,
      criteria: [],
      design: DEFAULT_DESIGN
    }
  },
  {
    type: 'lista_cotejo',
    label: 'Lista de Cotejo',
    icon: '✅',
    structure: {
      competenciesCount: 1,
      capacitiesPerCompetency: 2,
      criteriaPerCapacity: 3,
      expectedLabel: 'Si / No',
      competencies: [],
      items: [],
      design: DEFAULT_DESIGN
    }
  },
  {
    type: 'escala_valoracion',
    label: 'Escala de Valoracion',
    icon: '📈',
    structure: {
      scale: {
        min: 1,
        max: 5,
        labels: ['Deficiente', 'Regular', 'Bueno', 'Muy bueno'],
        competenciesCount: 1,
        capacitiesPerCompetency: 2,
        criteriaPerCapacity: 2
      },
      competencies: [],
      criteriaCount: 4,
      criteria: [],
      design: DEFAULT_DESIGN
    }
  },
  {
    type: 'guia_observacion',
    label: 'Guia de Observacion',
    icon: '📝',
    structure: {
      competenciesCount: 1,
      capacitiesPerCompetency: 4,
      criteriaPerCapacity: 4,
      competencies: [],
      design: DEFAULT_DESIGN
    }
  }
];

export const normalizeByType = (type: InstrumentType, raw: any) => {
  const s = raw || {};
  const design = normalizeDesign(s.design);
  const layout = normalizeLayout(s.layout);
  if (type === 'rubrica') {
    return { ...normalizeRubricaStructure(s, layout), design };
  }
  if (type === 'lista_cotejo') {
    const expectedLabel = s.expectedLabel || 'Si / No';
    return { ...normalizeChecklistStructure(s, layout, expectedLabel), expectedLabel, design };
  }
  if (type === 'escala_valoracion') {
    return { ...normalizeScaleStructure(s, layout), design };
  }
  return { ...normalizeGuideStructure(s, layout), design };
};
