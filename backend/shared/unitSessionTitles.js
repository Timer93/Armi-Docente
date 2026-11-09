// Validate the whole response before applying any generated session fields.
export const validateGeneratedUnitSessionTitles = (response, sessionCount) => {
  const sessions = Array.isArray(response?.sesiones) ? response.sesiones : [];
  const missing = Array.from({ length: sessionCount }, (_, index) => index + 1)
    .filter((number) => typeof sessions[number - 1]?.title !== 'string' || !sessions[number - 1].title.trim());
  if (sessions.length !== sessionCount || missing.length) {
    throw new Error(`La IA no completó los títulos de las sesiones${missing.length ? ` ${missing.join(', ')}` : ''}. Intenta generar nuevamente; la respuesta incompleta no se aplicó.`);
  }
  return sessions.map((session) => ({ ...session, title: session.title.trim() }));
};
