import json
import sqlite3
from pathlib import Path


DB_PATH = Path(r"c:\Users\arnol\Desktop\Armi Docente\database\armi.db")


def bullet_text(lines: list[str]) -> str:
    return "\n".join(f"• {line}" for line in lines)


def item_list(lines: list[str]) -> list[dict[str, str]]:
    return [{"text": f"• {line}", "color": "text-black"} for line in lines]


CONFIG = {
    ("2do", "A y B"): {
        "upper_criteria": [
            "Identifica necesidades o problemas de los usuarios mediante observación, entrevistas y formulación del punto de vista (POV).",
            "Diseña y valida propuestas de valor a través de prototipos físicos o digitales, incorporando mejoras a partir del feedback.",
            "Estructura y planifica la propuesta de negocio organizando actividades, recursos, cronograma y riesgos del emprendimiento.",
            "Ejecuta procesos productivos con criterios de calidad, seguridad y uso responsable de recursos.",
            "Trabaja colaborativamente asumiendo roles, responsabilidades y acuerdos para alcanzar metas comunes.",
            "Analiza la viabilidad económica del proyecto mediante costos, presupuesto y punto de equilibrio.",
            "Evalúa y comunica resultados del emprendimiento usando evidencias de impacto, difusión y propuestas de mejora.",
        ],
        "upper_evidence": [
            "Guía de entrevista o ficha de observación con registro de hallazgos, necesidades priorizadas y formulación del POV del usuario.",
            "Prototipo físico o digital (boceto, maqueta o logotipo) acompañado de una ficha de validación o cuadro comparativo de selección de la propuesta de valor.",
            "Lean Canvas o plan de acción (Diagrama de Gantt) con actividades, recursos, cronograma y riesgos del emprendimiento.",
            "Producto final o reporte del servicio con evidencias fotográficas del proceso, aplicación de normas de seguridad y control de calidad.",
            "Acta de constitución del equipo, distribución de roles y bitácora de trabajo colaborativo.",
            "Presupuesto o cuadro de costos con cálculo básico del punto de equilibrio para sustentar la viabilidad del emprendimiento.",
            "Informe final del proyecto con resultados de marketing o impacto, coevaluación y propuestas de mejora.",
        ],
        "session_map": {
            1: (0, "Identifica necesidades o problemas de los usuarios mediante observación, entrevistas y formulación del punto de vista (POV)."),
            2: (1, "Diseña y representa un prototipo inicial de la propuesta de valor usando bocetos o maquetas para comunicar la solución planteada."),
            3: (4, "Trabaja colaborativamente asumiendo roles y acuerdos de equipo para organizar el desarrollo del emprendimiento."),
            4: (1, "Valida el prototipo con usuarios mediante retroalimentación estructurada y mejora la propuesta de valor a partir de los resultados."),
            5: (2, "Estructura el Lean Canvas identificando problema, segmento, solución y propuesta de valor única del emprendimiento."),
            6: (1, "Diseña la identidad visual del emprendimiento como parte de la representación de la propuesta de valor."),
            7: (2, "Planifica el proyecto mediante un Diagrama de Gantt organizando actividades, responsables y riesgos previstos."),
            8: (5, "Analiza costos y calcula el punto de equilibrio para sustentar la viabilidad económica del emprendimiento."),
            9: (6, "Diseña estrategias de difusión y marketing digital para comunicar la propuesta de valor a clientes potenciales."),
            10: (3, "Ejecuta y controla procesos productivos aplicando normas de seguridad, calidad y uso responsable de recursos."),
            11: (6, "Evalúa el desempeño del equipo y los resultados del proyecto para proponer mejoras en su gestión."),
        },
    },
    ("3ro", "U"): {
        "upper_criteria": [
            "Identifica y prioriza necesidades o problemas de los usuarios mediante observación, entrevistas y formulación del POV.",
            "Diseña y valida prototipos de la propuesta de valor integrando mejoras a partir de la retroalimentación de los usuarios.",
            "Estructura el modelo de negocio definiendo segmento de clientes, problema, propuesta de valor, solución y canales.",
            "Planifica el proyecto organizando recursos, cronograma, responsables y riesgos para ejecutar la propuesta de valor.",
            "Trabaja colaborativamente gestionando roles, seguimiento de tareas y cumplimiento de metas comunes.",
            "Analiza la viabilidad económica y comercial del emprendimiento mediante costos, identidad visual y estrategias de marketing.",
            "Evalúa y comunica el impacto del proyecto considerando sostenibilidad, resultados finales y presentación persuasiva.",
        ],
        "upper_evidence": [
            "Informe de diagnóstico situacional con necesidades identificadas, guiones de entrevista, observaciones y formulación del POV.",
            "Prototipo físico o digital (maqueta o storyboard) con ficha de validación tipo malla receptora e iteraciones realizadas.",
            "Lean Canvas con definición de segmento de clientes, problema, propuesta de valor, solución y canales.",
            "Plan de acción o cronograma del proyecto con responsables, recursos y cuadro de gestión de riesgos.",
            "Bitácora de trabajo en equipo, tablero de seguimiento o registro de coevaluación del desempeño grupal.",
            "Balance económico y piezas de identidad o marketing para sustentar la estrategia comercial del emprendimiento.",
            "Producto final o servicio ejecutado con reporte de control de calidad, impacto social-ambiental y propuesta de mejora o pitch.",
        ],
        "session_map": {
            1: (0, "Identifica y prioriza necesidades o problemas de los usuarios mediante observación, entrevistas y formulación del POV."),
            2: (1, "Diseña y representa un prototipo inicial de la solución planteada considerando funcionalidad y claridad de la propuesta."),
            3: (4, "Trabaja colaborativamente asumiendo roles y acuerdos para fortalecer la organización del equipo emprendedor."),
            4: (1, "Valida el prototipo con la malla receptora de información e incorpora mejoras a partir del feedback del usuario."),
            5: (2, "Estructura el Lean Canvas definiendo segmento, problema, propuesta de valor, solución y canales del proyecto."),
            6: (5, "Analiza costos, precio de venta y punto de equilibrio para sustentar la viabilidad económica del emprendimiento."),
            7: (4, "Gestiona las actividades del proyecto mediante tableros de seguimiento para cumplir metas colaborativas."),
            8: (6, "Evalúa el impacto social y ambiental del proyecto utilizando indicadores de sostenibilidad y resultados integrales."),
            9: (5, "Diseña la identidad visual de la marca para fortalecer la estrategia comercial de la propuesta de valor."),
            10: (5, "Implementa estrategias de marketing digital y atención al cliente para ampliar el alcance comercial del proyecto."),
            11: (6, "Comunica y sustenta el proyecto mediante un Elevator Pitch claro, persuasivo y orientado a aliados estratégicos."),
        },
    },
    ("4to", "U"): {
        "upper_criteria": [
            "Recopila y organiza información sobre necesidades de los usuarios mediante entrevistas, observación y definición del problema.",
            "Diseña y valida prototipos de la propuesta de valor integrando mejoras con base en la retroalimentación recibida.",
            "Trabaja colaborativamente gestionando roles, acuerdos y resolución de conflictos para el logro de objetivos comunes.",
            "Estructura y difunde la propuesta de negocio mediante Lean Canvas y estrategias de marketing o comunicación comercial.",
            "Planifica y controla la ejecución del proyecto mediante cronograma, presupuesto, procesos y criterios de calidad.",
            "Evalúa y comunica los resultados del proyecto considerando sostenibilidad, costo-beneficio, impacto y presentación final.",
        ],
        "upper_evidence": [
            "Guion de entrevista u organizador visual (árbol de problemas o POV) con las conclusiones del diagnóstico del usuario.",
            "Prototipo físico o digital con malla receptora de información, ficha técnica y mejoras incorporadas a la propuesta de valor.",
            "Acta de acuerdos del equipo, distribución de roles y registro de negociación o convivencia para el trabajo colaborativo.",
            "Lean Canvas o plan comercial de difusión con propuesta de valor, segmentos, canales y acciones de captación.",
            "Plan de acción, presupuesto o diagrama de procesos (DOP) con cronograma, costos, control de calidad y gestión de riesgos.",
            "Producto final o informe de cierre con resultados, sostenibilidad, costo-beneficio y presentación final del proyecto.",
        ],
        "session_map": {
            1: (0, "Recopila y organiza información sobre las necesidades del usuario mediante observación, entrevista y formulación del POV."),
            2: (1, "Diseña y representa un prototipo inicial incorporando criterios técnicos y uso seguro de materiales o herramientas."),
            3: (2, "Trabaja colaborativamente asignando roles y compromisos para alcanzar los objetivos del proyecto emprendedor."),
            4: (1, "Valida el prototipo con usuarios reales y mejora la propuesta de valor usando información del testeo."),
            5: (3, "Estructura el modelo de negocio con Lean Canvas para definir la viabilidad y diferenciación del emprendimiento."),
            6: (3, "Diseña estrategias de marketing y difusión para captar y retener clientes potenciales."),
            7: (2, "Gestiona conflictos internos mediante técnicas de negociación y acuerdos para fortalecer el trabajo cooperativo."),
            8: (4, "Planifica la viabilidad económica del proyecto mediante presupuesto, costos y punto de equilibrio."),
            9: (5, "Evalúa la sostenibilidad social y ambiental de la propuesta de valor para generar impacto positivo en la comunidad."),
            10: (4, "Controla procesos productivos mediante diagramas, normas de calidad y criterios de seguridad."),
            11: (5, "Comunica y sustenta el proyecto mediante una presentación final persuasiva orientada a aliados estratégicos."),
        },
    },
    ("5to", "A y B"): {
        "upper_criteria": [
            "Recoge y organiza información de los usuarios mediante entrevistas, empatía y clusterización para definir oportunidades de negocio.",
            "Diseña y valida prototipos innovadores de la propuesta de valor integrando mejoras a partir de la experiencia del usuario.",
            "Trabaja colaborativamente con metodologías ágiles gestionando roles, backlog, acuerdos y resolución de conflictos.",
            "Estructura la estrategia comercial del emprendimiento definiendo propuesta de valor, canales, aliados y presencia digital.",
            "Planifica la sostenibilidad del proyecto mediante cronograma, análisis financiero, riesgos e indicadores de impacto.",
            "Evalúa y comunica los resultados finales del emprendimiento considerando viabilidad, triple impacto y pitch final.",
        ],
        "upper_evidence": [
            "Mapa de empatía, clusterización o registro de entrevistas con patrones identificados y formulación del POV.",
            "Prototipo físico o digital (MVP) acompañado de la malla receptora de información del proceso de validación.",
            "Actas de reunión de equipo, backlog o tablero ágil con distribución de roles y seguimiento colaborativo.",
            "Lean Canvas y estrategia comercial o digital con canales, propuesta de valor, aliados y acciones de networking o e-commerce.",
            "Plan de acción, Diagrama de Gantt o cuadro financiero con costos, punto de equilibrio, riesgos e indicadores de sostenibilidad.",
            "Producto final o informe de cierre con evidencia del proceso, impacto, pitch deck y propuestas de mejora.",
        ],
        "session_map": {
            1: (0, "Recoge y organiza información sobre necesidades de los usuarios mediante empatía, entrevistas y formulación del POV."),
            2: (1, "Diseña y representa un MVP funcional para comunicar con claridad la idea de negocio innovadora."),
            3: (2, "Gestiona el trabajo colaborativo mediante backlog, roles y acuerdos de metodologías ágiles."),
            4: (1, "Valida la propuesta de valor con usuarios y mejora el prototipo con base en la retroalimentación obtenida."),
            5: (3, "Estructura el modelo de negocio y la estrategia comercial utilizando el Lean Canvas."),
            6: (3, "Diseña acciones de branding y marketing digital para posicionar la marca en el mercado."),
            7: (2, "Resuelve conflictos y fortalece la cohesión del equipo mediante comunicación asertiva y acuerdos democráticos."),
            8: (4, "Analiza la sostenibilidad financiera del proyecto mediante costos, punto de equilibrio y flujo de caja."),
            9: (5, "Evalúa el triple impacto del proyecto para proyectar valor compartido en el entorno."),
            10: (3, "Gestiona canales de venta online y e-commerce para ampliar el alcance comercial del producto o servicio."),
            11: (3, "Establece alianzas estratégicas mediante networking para fortalecer recursos y metas del emprendimiento."),
            12: (5, "Comunica y sustenta el proyecto final mediante un Pitch Deck persuasivo con métricas y resultados clave."),
        },
    },
}


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    for (grade, section), payload in CONFIG.items():
        row = cur.execute(
            "SELECT sesiones FROM unidades_didacticas WHERE unit_number='3' AND grade=? AND section=?",
            (grade, section),
        ).fetchone()
        if not row:
            continue

        sesiones = json.loads(row[0] or "[]")
        criterios = {str(i): text for i, text in enumerate(payload["upper_criteria"])}
        evidencias = {str(i): text for i, text in enumerate(payload["upper_evidence"])}

        for idx, session in enumerate(sesiones, 1):
            mapping = payload["session_map"].get(idx)
            if not mapping:
                continue
            row_idx, criterion_text = mapping
            evidence_text = payload["upper_evidence"][row_idx]
            # Keep the more session-specific evidence if it already exists; otherwise use matrix evidence.
            if session.get("evi"):
                evidence_text = "\n".join(
                    line.strip()[2:] if line.strip().startswith("• ") else line.strip()
                    for line in str(session["evi"]).splitlines()
                    if line.strip()
                ) or evidence_text
                evidence_lines = [line.strip() for line in evidence_text.split("\n") if line.strip()]
            else:
                evidence_lines = [evidence_text]

            session["selectedCriteriaTexts"] = [criterion_text]
            session["des"] = bullet_text([criterion_text])
            session["criteriaItems"] = item_list([criterion_text])
            session["selectedEvidenceIds"] = [f"area-{row_idx}-0"]
            session["evi"] = bullet_text(evidence_lines)
            session["evidenceItems"] = item_list(evidence_lines)

        cur.execute(
            """
            UPDATE unidades_didacticas
            SET criterios=?, evidencias=?, sesiones=?, updated_at=CURRENT_TIMESTAMP
            WHERE unit_number='3' AND grade=? AND section=?
            """,
            (
                json.dumps(criterios, ensure_ascii=False),
                json.dumps(evidencias, ensure_ascii=False),
                json.dumps(sesiones, ensure_ascii=False),
                grade,
                section,
            ),
        )

    conn.commit()
    conn.close()
    print("Unit 3 criteria/evidence anchors repaired.")


if __name__ == "__main__":
    main()
