
import express from 'express';
import db from '../db.js';

const router = express.Router();

router.get('/programacion/:id', (req, res) => {
  const { id } = req.params;

  try {
    // Adaptado a better-sqlite3 (síncrono) y al nombre de tabla real 'programacion_anual'
    const sql = `
      SELECT *
      FROM programacion_anual
      WHERE id_programa = ?
    `;

    const row = db.prepare(sql).get(id);
    
    if (!row) {
        return res.status(404).json({ success: false, message: "Programación no encontrada" });
    }

    res.json(row);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
