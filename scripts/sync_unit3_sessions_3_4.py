import json
import sqlite3
from pathlib import Path


DB_PATH = Path(r"c:\Users\arnol\Desktop\Armi Docente\database\armi.db")


CONFIG = {
    ("2do", "A y B", "3"): {
        "des": "Trabaja colaborativamente asumiendo roles y acuerdos de equipo para organizar el desarrollo del emprendimiento.",
        "evi": "Acta de constitución del equipo con roles definidos y bitácora de acuerdos del trabajo colaborativo.",
    },
    ("2do", "A y B", "4"): {
        "des": "Valida el prototipo con usuarios mediante retroalimentación estructurada y mejora la propuesta de valor a partir de los resultados.",
        "evi": "Ficha de validación del prototipo con malla receptora de información y mejoras incorporadas a la propuesta de valor.",
    },
    ("3ro", "U", "3"): {
        "des": "Trabaja colaborativamente asumiendo roles y acuerdos para fortalecer la organización del equipo emprendedor.",
        "evi": "Bitácora de trabajo en equipo con asignación de roles, acuerdos y evidencias de coordinación colaborativa.",
    },
    ("3ro", "U", "4"): {
        "des": "Valida el prototipo con la malla receptora de información e incorpora mejoras a partir del feedback del usuario.",
        "evi": "Ficha de validación del prototipo con malla receptora de información e iteraciones realizadas a partir del feedback.",
    },
    ("4to", "U", "3"): {
        "des": "Trabaja colaborativamente asignando roles y compromisos para alcanzar los objetivos del proyecto emprendedor.",
        "evi": "Acta de acuerdos del equipo con roles asignados y compromisos para el trabajo colaborativo.",
    },
    ("4to", "U", "4"): {
        "des": "Valida el prototipo con usuarios reales y mejora la propuesta de valor usando información del testeo.",
        "evi": "Ficha de validación del prototipo con malla receptora de información y ajustes a la propuesta de valor.",
    },
    ("5to", "A y B", "3"): {
        "des": "Gestiona el trabajo colaborativo mediante backlog, roles y acuerdos de metodologías ágiles.",
        "evi": "Acta de reunión del equipo con backlog inicial, roles definidos y acuerdos de trabajo ágil.",
    },
    ("5to", "A y B", "4"): {
        "des": "Valida la propuesta de valor con usuarios y mejora el prototipo con base en la retroalimentación obtenida.",
        "evi": "Ficha de validación del prototipo con malla receptora de información y decisiones de mejora.",
    },
}


def html_bullet(text: str) -> str:
    safe = (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
        .replace(" ", "&nbsp;")
    )
    return f'<p><span style="color: rgb(0, 0, 0);">&bull;&nbsp;{safe}</span></p>'


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    for (grade, section, session_number), payload in CONFIG.items():
        row = cur.execute(
            """
            SELECT id, session_data
            FROM sesiones
            WHERE unit_number='3' AND grade=? AND section=? AND session_number=?
            """,
            (grade, section, session_number),
        ).fetchone()
        if not row:
            continue

        row_id, session_data_raw = row
        session_data = json.loads(session_data_raw or "{}")
        comp = session_data.get("competenciaPrio") or {}
        comp["des"] = html_bullet(payload["des"])
        comp["evidence"] = html_bullet(payload["evi"])
        session_data["competenciaPrio"] = comp

        cur.execute(
            """
            UPDATE sesiones
            SET session_data = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (json.dumps(session_data, ensure_ascii=False), row_id),
        )

    conn.commit()
    conn.close()
    print("Unit 3 session_data for sessions 3 and 4 synced.")


if __name__ == "__main__":
    main()
