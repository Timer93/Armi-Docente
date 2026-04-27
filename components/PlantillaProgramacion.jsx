const cargarProgramacion = async (id) => {
  const res = await fetch(`http://localhost:3000/api/programacion/${id}`);
  const data = await res.json();

  const documento = `
INSTITUCIÓN: ${data.institucion}
ÁREA: ${data.area}
GRADO: ${data.grado}
DOCENTE: ${data.docente}
HORAS: ${data.horas_semanales}
`;

  console.log(documento); // luego esto va a Word o PDF
};
