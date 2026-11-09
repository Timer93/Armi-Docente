// Match complete words, including common spellings and spacing/leet variants.
// Criticism without these expressions remains publishable and can be reported.
const WORDS = ['idiota', 'idiotas', 'imbecil', 'imbeciles', 'estupido', 'estupida', 'estupidos', 'estupidas', 'mierda', 'puto', 'puta', 'putos', 'putas', 'cabron', 'cabrona', 'cabrones', 'huevon', 'huevona', 'huevones', 'webon', 'webona', 'weon', 'weona', 'pendejo', 'pendeja', 'pendejos', 'pendejas', 'conchatumadre', 'ctm', 'gilipollas', 'maricon', 'maricones', 'baboso', 'babosa', 'inutil', 'inutiles'];
const patterns = WORDS.map((word) => ({ word, pattern: new RegExp(`(?:^|[^a-z0-9])${[...word].join('[^a-z0-9]*')}(?=$|[^a-z0-9])`, 'i') }));
export function detectForumLanguage(value) {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[@034157$]/g, (letter) => ({ '@': 'a', '0': 'o', '3': 'e', '4': 'a', '1': 'i', '5': 's', '7': 't', '$': 's' }[letter]));
  return patterns.filter(({ pattern }) => pattern.test(normalized)).map(({ word }) => word);
}

export function migrateForumSchema(db) {
  const columns = {
    student_forum_posts: { unit_number: "TEXT NOT NULL DEFAULT ''", comments_reopened: 'INTEGER NOT NULL DEFAULT 0', reviewed_at: "TEXT NOT NULL DEFAULT ''", session_id: "TEXT NOT NULL DEFAULT ''", moderation_status: "TEXT NOT NULL DEFAULT 'approved'", moderation_matches: "TEXT NOT NULL DEFAULT '[]'" },
    student_forum_attachments: { deleted: 'INTEGER NOT NULL DEFAULT 0', updated_at: "TEXT NOT NULL DEFAULT ''" },
    student_forum_comments: { reviewed_at: "TEXT NOT NULL DEFAULT ''", author_type: "TEXT NOT NULL DEFAULT 'student'", author_grade: "TEXT NOT NULL DEFAULT ''", author_section: "TEXT NOT NULL DEFAULT ''", moderation_status: "TEXT NOT NULL DEFAULT 'approved'", moderation_matches: "TEXT NOT NULL DEFAULT '[]'" }
  };
  for (const [table, definitions] of Object.entries(columns)) {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
    for (const [name, definition] of Object.entries(definitions)) if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  db.exec(`
    UPDATE student_forum_attachments SET updated_at=created_at WHERE updated_at='';
    CREATE TABLE IF NOT EXISTS student_forum_scopes (
      id TEXT PRIMARY KEY, year TEXT NOT NULL, scope_type TEXT NOT NULL, scope_value TEXT NOT NULL,
      closed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS student_forum_attachment_removals (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT NOT NULL,
      attachment_ids TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS forum_removals_post ON student_forum_attachment_removals(post_id,actor_type);
    UPDATE student_forum_comments SET
      author_grade=COALESCE((SELECT grado FROM db_estudiantes WHERE CAST(id AS TEXT)=author_id),''),
      author_section=COALESCE((SELECT secc FROM db_estudiantes WHERE CAST(id AS TEXT)=author_id),'')
    WHERE author_type='student' AND author_grade='';
    CREATE TABLE IF NOT EXISTS student_forum_reactions (
      id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
      actor_type TEXT NOT NULL, actor_id TEXT NOT NULL, reaction TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(target_type,target_id,actor_type,actor_id)
    );
    CREATE INDEX IF NOT EXISTS forum_reactions_target ON student_forum_reactions(target_type,target_id);
    CREATE TABLE IF NOT EXISTS student_forum_notifications (
      id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL, post_id TEXT NOT NULL, comment_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL, message TEXT NOT NULL, read_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS forum_notifications_recipient ON student_forum_notifications(recipient_id,read_at,created_at);
    CREATE TABLE IF NOT EXISTS student_forum_drafts (
      id TEXT PRIMARY KEY, author_id TEXT NOT NULL, year TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
    );
  `);
}
