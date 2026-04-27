import React from 'react';
import { RegisterConsolidationView } from './registers/RegisterConsolidationView';

export const UnitRegisterView: React.FC = () => {
  return (
    <RegisterConsolidationView
      mode="unit"
      title="Registro por Unidad"
      badge="UNI"
      accentClassName="bg-gradient-to-r from-sky-600 to-cyan-500"
      description="Base inicial para consolidar los resultados de varias sesiones dentro de una misma unidad, reutilizando el nucleo comun de evaluacion ya validado en Sesiones > Calificacion."
    />
  );
};
