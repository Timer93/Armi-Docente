import json
import sqlite3
from html import escape
from pathlib import Path


DB_PATH = Path(r"c:\Users\arnol\Desktop\Armi Docente\database\armi.db")


CONFIG = {
    ("2do", "A y B"): {
        "upper": [
            "Guía de entrevista o ficha de observación con registro de hallazgos, necesidades priorizadas y formulación del POV del usuario.",
            "Prototipo físico o digital (boceto, maqueta o logotipo) acompañado de una ficha de validación o cuadro comparativo de selección de la propuesta de valor.",
            "Lean Canvas o plan de acción (Diagrama de Gantt) con actividades, recursos, cronograma y riesgos del emprendimiento.",
            "Producto final o reporte del servicio con evidencias fotográficas del proceso, aplicación de normas de seguridad y control de calidad.",
            "Acta de constitución del equipo, distribución de roles y bitácora de trabajo colaborativo.",
            "Presupuesto o cuadro de costos con cálculo básico del punto de equilibrio para sustentar la viabilidad del emprendimiento.",
            "Informe final del proyecto con resultados de marketing o impacto, coevaluación y propuestas de mejora.",
        ],
        "sessions": {
            1: ["Guía de entrevista o ficha de observación con registro de hallazgos, necesidades priorizadas y formulación del POV del usuario."],
            2: ["Prototipo físico o digital (boceto o maqueta) acompañado de un cuadro comparativo para seleccionar la propuesta de valor."],
            3: ["Acta de constitución del equipo con roles definidos y bitácora de acuerdos del trabajo colaborativo."],
            4: ["Ficha de validación del prototipo con malla receptora de información y mejoras incorporadas a la propuesta de valor."],
            5: ["Lean Canvas inicial con los bloques de problema, segmento, solución y propuesta de valor única."],
            6: ["Propuesta de identidad visual del emprendimiento (logotipo, tipografía y paleta de color) elaborada con herramienta digital."],
            7: ["Plan de acción o Diagrama de Gantt con actividades, recursos, responsables y riesgos previstos."],
            8: ["Presupuesto básico y cuadro de costos con cálculo del punto de equilibrio del emprendimiento."],
            9: ["Pieza publicitaria digital o plan breve de marketing con aplicación de la estrategia AIDA para captar clientes."],
            10: ["Registro del proceso productivo con diagrama de operaciones, control de calidad y normas de seguridad aplicadas."],
            11: ["Informe de coevaluación del equipo con lecciones aprendidas, indicadores revisados y propuestas de mejora."],
        },
    },
    ("3ro", "U"): {
        "upper": [
            "Informe de diagnóstico situacional con necesidades identificadas, guiones de entrevista, observaciones y formulación del POV.",
            "Prototipo físico o digital (maqueta o storyboard) con ficha de validación tipo malla receptora e iteraciones realizadas.",
            "Lean Canvas con definición de segmento de clientes, problema, propuesta de valor, solución y canales.",
            "Plan de acción o cronograma del proyecto con responsables, recursos y cuadro de gestión de riesgos.",
            "Bitácora de trabajo en equipo, tablero de seguimiento o registro de coevaluación del desempeño grupal.",
            "Balance económico y piezas de identidad o marketing para sustentar la estrategia comercial del emprendimiento.",
            "Producto final o servicio ejecutado con reporte de control de calidad, impacto social-ambiental y propuesta de mejora o pitch.",
        ],
        "sessions": {
            1: ["Informe de diagnóstico situacional con necesidades identificadas, guiones de entrevista, observaciones y formulación del POV."],
            2: ["Prototipo físico o digital (maqueta o storyboard) con criterios de funcionalidad y presentación de la solución propuesta."],
            3: ["Bitácora de trabajo en equipo con asignación de roles, acuerdos y evidencias de coordinación colaborativa."],
            4: ["Ficha de validación del prototipo con malla receptora de información e iteraciones realizadas a partir del feedback."],
            5: ["Lean Canvas con los bloques de segmento de clientes, problema, propuesta de valor, solución y canales."],
            6: ["Cuadro de costos, precio de venta y cálculo del punto de equilibrio para sustentar la viabilidad económica."],
            7: ["Tablero Kanban o cronograma colaborativo con tareas, responsables y seguimiento del cumplimiento de metas."],
            8: ["Reporte de impacto social y ambiental con indicadores de sostenibilidad y valoración integral del proyecto."],
            9: ["Manual breve de identidad visual de la marca con logotipo, paleta de color, eslogan y narrativa de la propuesta."],
            10: ["Pieza o campaña de marketing digital con definición del canal de distribución y estrategia de atención al cliente."],
            11: ["Guion y presentación breve tipo Elevator Pitch con propuesta de valor, beneficios y llamado a la acción."],
        },
    },
    ("4to", "U"): {
        "upper": [
            "Guion de entrevista u organizador visual (árbol de problemas o POV) con las conclusiones del diagnóstico del usuario.",
            "Prototipo físico o digital con malla receptora de información, ficha técnica y mejoras incorporadas a la propuesta de valor.",
            "Acta de acuerdos del equipo, distribución de roles y registro de negociación o convivencia para el trabajo colaborativo.",
            "Lean Canvas o plan comercial de difusión con propuesta de valor, segmentos, canales y acciones de captación.",
            "Plan de acción, presupuesto o diagrama de procesos (DOP) con cronograma, costos, control de calidad y gestión de riesgos.",
            "Producto final o informe de cierre con resultados, sostenibilidad, costo-beneficio y presentación final del proyecto.",
        ],
        "sessions": {
            1: ["Guion de entrevista u organizador visual con el diagnóstico del problema, causas y formulación del POV."],
            2: ["Prototipo físico o digital con ficha técnica básica y criterios de uso seguro de materiales y herramientas."],
            3: ["Acta de acuerdos del equipo con roles asignados y compromisos para el trabajo colaborativo."],
            4: ["Ficha de validación del prototipo con malla receptora de información y ajustes a la propuesta de valor."],
            5: ["Lean Canvas con problema, segmento de clientes, propuesta de valor única, solución y early adopters."],
            6: ["Plan comercial de difusión con acciones de marketing mix, canales y estrategias de captación y retención."],
            7: ["Registro de resolución de conflictos con acuerdos de negociación y decisiones tomadas por el equipo."],
            8: ["Presupuesto del proyecto con costos fijos, variables y cálculo del punto de equilibrio o rentabilidad."],
            9: ["Matriz de sostenibilidad o ficha de mejora de la propuesta de valor con enfoque social y ambiental."],
            10: ["Diagrama de operaciones del proceso con puntos de control de calidad, seguridad y mejora continua."],
            11: ["Presentación final tipo Elevator Pitch o pitch comercial con beneficios, diferenciación y llamado a la acción."],
        },
    },
    ("5to", "A y B"): {
        "upper": [
            "Mapa de empatía, clusterización o registro de entrevistas con patrones identificados y formulación del POV.",
            "Prototipo físico o digital (MVP) acompañado de la malla receptora de información del proceso de validación.",
            "Actas de reunión de equipo, backlog o tablero ágil con distribución de roles y seguimiento colaborativo.",
            "Lean Canvas y estrategia comercial o digital con canales, propuesta de valor, aliados y acciones de networking o e-commerce.",
            "Plan de acción, Diagrama de Gantt o cuadro financiero con costos, punto de equilibrio, riesgos e indicadores de sostenibilidad.",
            "Producto final o informe de cierre con evidencia del proceso, impacto, pitch deck y propuestas de mejora.",
        ],
        "sessions": {
            1: ["Mapa de empatía o cuadro de clusterización con patrones identificados y formulación del POV del usuario."],
            2: ["Prototipo físico o digital tipo MVP con criterios funcionales y representación clara de la idea de negocio."],
            3: ["Acta de reunión del equipo con backlog inicial, roles definidos y acuerdos de trabajo ágil."],
            4: ["Ficha de validación del prototipo con malla receptora de información y decisiones de mejora."],
            5: ["Lean Canvas con segmento de clientes, propuesta de valor única, canales y ventaja especial del proyecto."],
            6: ["Plan de contenidos o pieza de branding digital para posicionar la marca en redes sociales."],
            7: ["Registro de resolución de conflictos y acuerdos de mejora para fortalecer la cohesión del equipo."],
            8: ["Cuadro financiero con costos, margen de contribución, punto de equilibrio y flujo de caja proyectado."],
            9: ["Reporte de triple impacto con indicadores económicos, sociales y ambientales del emprendimiento."],
            10: ["Ficha del canal de venta digital o propuesta de e-commerce con logística básica y atención al cliente."],
            11: ["Mapa de stakeholders o propuesta de alianza con actores clave para potenciar el emprendimiento."],
            12: ["Pitch Deck final con métricas, propuesta de valor, ventajas competitivas y solicitud de apoyo o inversión."],
        },
    },
}


def bullet_text(lines: list[str]) -> str:
    return "\n".join(f"• {line}" for line in lines)


def evidence_items(lines: list[str]) -> list[dict[str, str]]:
    return [{"text": f"• {line}", "color": "text-black"} for line in lines]


def bullet_html(lines: list[str]) -> str:
    return "".join(
        f'<p><span style="color: rgb(0, 0, 0);">&bull;&nbsp;{escape(line).replace(" ", "&nbsp;")}</span></p>'
        for line in lines
    )


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    for (grade, section), payload in CONFIG.items():
        row = cur.execute(
            """
            SELECT evidencias, sesiones
            FROM unidades_didacticas
            WHERE unit_number='3' AND grade=? AND section=?
            """,
            (grade, section),
        ).fetchone()
        if not row:
            continue

        _, sesiones_raw = row
        evidencias_obj = {str(i): text for i, text in enumerate(payload["upper"])}
        sesiones = json.loads(sesiones_raw) if sesiones_raw else []

        for idx, ses in enumerate(sesiones, 1):
            lines = payload["sessions"].get(idx)
            if not lines:
                continue
            ses["evi"] = bullet_text(lines)
            ses["evidenceItems"] = evidence_items(lines)

        cur.execute(
            """
            UPDATE unidades_didacticas
            SET evidencias=?, sesiones=?, updated_at=CURRENT_TIMESTAMP
            WHERE unit_number='3' AND grade=? AND section=?
            """,
            (
                json.dumps(evidencias_obj, ensure_ascii=False),
                json.dumps(sesiones, ensure_ascii=False),
                grade,
                section,
            ),
        )

        session_rows = cur.execute(
            """
            SELECT id, session_number, session_data
            FROM sesiones
            WHERE unit_number='3' AND grade=? AND section=?
            """,
            (grade, section),
        ).fetchall()

        for session_id, session_number, session_data_raw in session_rows:
            try:
                num = int(session_number)
            except (TypeError, ValueError):
                continue
            lines = payload["sessions"].get(num)
            if not lines:
                continue

            session_data = json.loads(session_data_raw) if session_data_raw else {}
            competencia_prio = session_data.get("competenciaPrio") or {}
            competencia_prio["evidence"] = bullet_html(lines)
            session_data["competenciaPrio"] = competencia_prio

            cur.execute(
                """
                UPDATE sesiones
                SET producto_de_sesion=?, session_data=?, updated_at=CURRENT_TIMESTAMP
                WHERE id=?
                """,
                (
                    bullet_text(lines),
                    json.dumps(session_data, ensure_ascii=False),
                    session_id,
                ),
            )

    conn.commit()
    conn.close()
    print("Unit 3 evidence text rewritten with UTF-8-safe content.")


if __name__ == "__main__":
    main()
