import React from 'react';
import { RegisterConsolidationView } from './registers/RegisterConsolidationView';

export const BimesterRegisterView: React.FC = () => {
  return (
    <RegisterConsolidationView
      mode="bimester"
      title="Registro por Bimestre"
      badge="BIM"
      accentClassName="bg-gradient-to-r from-violet-600 to-fuchsia-500"
      description="Base inicial para consolidar unidades dentro de un bimestre, usando como insumo los resultados de sesion ya guardados y sin tocar el registro por sesion que ya fue validado."
    />
  );
};
