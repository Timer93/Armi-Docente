-- Automatic capture of committed work. Google credentials are never recorded here.
CREATE TABLE IF NOT EXISTS web_sync_setup (version INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS web_sync_outbox (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 teacher_id TEXT NOT NULL REFERENCES teachers(id),
 kind TEXT NOT NULL,
 record_key TEXT NOT NULL,
 before_json TEXT NOT NULL,
 after_json TEXT NOT NULL,
 revision INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(teacher_id,kind,record_key)
);
CREATE INDEX IF NOT EXISTS web_sync_outbox_owner ON web_sync_outbox(teacher_id,id);
CREATE TABLE IF NOT EXISTS web_sync_deliveries (
 teacher_id TEXT PRIMARY KEY REFERENCES teachers(id),
 root_id TEXT NOT NULL,
 folder_id TEXT NOT NULL,
 file_id TEXT,
 packet_id TEXT,
 packet_json TEXT,
 outbox_ids_json TEXT,
 lease_token TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 last_sent_at INTEGER,
 last_error TEXT NOT NULL DEFAULT ''
);
CREATE TRIGGER IF NOT EXISTS sync_academic_edits_insert AFTER INSERT ON academic_edits BEGIN
 INSERT OR REPLACE INTO web_sync_outbox(teacher_id,kind,record_key,before_json,after_json,revision,updated_at)
 VALUES(NEW.teacher_id,NEW.dataset,NEW.record_id,COALESCE((SELECT before_json FROM web_sync_outbox WHERE teacher_id=NEW.teacher_id AND kind=NEW.dataset AND record_key=NEW.record_id),COALESCE((SELECT json_object('deleted',0,'value',json(r.payload_json)) FROM academic_records r JOIN academic_heads h ON h.teacher_id=r.teacher_id AND h.active_import_id=r.import_id WHERE r.teacher_id=NEW.teacher_id AND r.dataset=NEW.dataset AND r.record_id=NEW.record_id),'null')),json_object('deleted',NEW.deleted,'value',json(NEW.payload_json),'context',json('{}')),NEW.revision,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS sync_academic_edits_update AFTER UPDATE ON academic_edits BEGIN
 INSERT OR REPLACE INTO web_sync_outbox(teacher_id,kind,record_key,before_json,after_json,revision,updated_at)
 VALUES(NEW.teacher_id,NEW.dataset,NEW.record_id,COALESCE((SELECT before_json FROM web_sync_outbox WHERE teacher_id=NEW.teacher_id AND kind=NEW.dataset AND record_key=NEW.record_id),json_object('deleted',OLD.deleted,'value',json(OLD.payload_json))),json_object('deleted',NEW.deleted,'value',json(NEW.payload_json),'context',json('{}')),NEW.revision,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS sync_planning_edits_insert AFTER INSERT ON planning_edits BEGIN
 INSERT OR REPLACE INTO web_sync_outbox(teacher_id,kind,record_key,before_json,after_json,revision,updated_at)
 VALUES(NEW.teacher_id,NEW.dataset,NEW.record_id,COALESCE((SELECT before_json FROM web_sync_outbox WHERE teacher_id=NEW.teacher_id AND kind=NEW.dataset AND record_key=NEW.record_id),COALESCE((SELECT json_object('deleted',0,'value',json(r.payload_json)) FROM academic_records r JOIN academic_heads h ON h.teacher_id=r.teacher_id AND h.active_import_id=r.import_id WHERE r.teacher_id=NEW.teacher_id AND r.dataset=NEW.dataset AND r.record_id=NEW.record_id),'null')),json_object('deleted',NEW.deleted,'value',json(NEW.payload_json),'context',json('{}')),NEW.revision,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS sync_planning_edits_update AFTER UPDATE ON planning_edits BEGIN
 INSERT OR REPLACE INTO web_sync_outbox(teacher_id,kind,record_key,before_json,after_json,revision,updated_at)
 VALUES(NEW.teacher_id,NEW.dataset,NEW.record_id,COALESCE((SELECT before_json FROM web_sync_outbox WHERE teacher_id=NEW.teacher_id AND kind=NEW.dataset AND record_key=NEW.record_id),json_object('deleted',OLD.deleted,'value',json(OLD.payload_json))),json_object('deleted',NEW.deleted,'value',json(NEW.payload_json),'context',json('{}')),NEW.revision,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS sync_web_configurations_insert AFTER INSERT ON web_configurations BEGIN
 INSERT OR REPLACE INTO web_sync_outbox(teacher_id,kind,record_key,before_json,after_json,revision,updated_at)
 VALUES(NEW.teacher_id,'configuration','configuration',COALESCE((SELECT before_json FROM web_sync_outbox WHERE teacher_id=NEW.teacher_id AND kind='configuration' AND record_key='configuration'),'null'),json_object('deleted',0,'value',json(NEW.payload_json),'context',json(json_object('removed',json(NEW.removed_json)))),NEW.revision,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS sync_web_configurations_update AFTER UPDATE ON web_configurations BEGIN
 INSERT OR REPLACE INTO web_sync_outbox(teacher_id,kind,record_key,before_json,after_json,revision,updated_at)
 VALUES(NEW.teacher_id,'configuration','configuration',COALESCE((SELECT before_json FROM web_sync_outbox WHERE teacher_id=NEW.teacher_id AND kind='configuration' AND record_key='configuration'),json_object('deleted',0,'value',json(OLD.payload_json))),json_object('deleted',0,'value',json(NEW.payload_json),'context',json(json_object('removed',json(NEW.removed_json)))),NEW.revision,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS sync_web_instruments_insert AFTER INSERT ON web_instruments BEGIN
 INSERT OR REPLACE INTO web_sync_outbox(teacher_id,kind,record_key,before_json,after_json,revision,updated_at)
 VALUES(NEW.teacher_id,'instruments',NEW.id,COALESCE((SELECT before_json FROM web_sync_outbox WHERE teacher_id=NEW.teacher_id AND kind='instruments' AND record_key=NEW.id),'null'),json_object('deleted',NEW.deleted,'value',json(NEW.payload_json),'context',json(json_object('year',NEW.year,'areaId',NEW.area_id,'grade',NEW.grade,'section',NEW.section))),NEW.revision,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS sync_web_instruments_update AFTER UPDATE ON web_instruments BEGIN
 INSERT OR REPLACE INTO web_sync_outbox(teacher_id,kind,record_key,before_json,after_json,revision,updated_at)
 VALUES(NEW.teacher_id,'instruments',NEW.id,COALESCE((SELECT before_json FROM web_sync_outbox WHERE teacher_id=NEW.teacher_id AND kind='instruments' AND record_key=NEW.id),json_object('deleted',OLD.deleted,'value',json(OLD.payload_json))),json_object('deleted',NEW.deleted,'value',json(NEW.payload_json),'context',json(json_object('year',NEW.year,'areaId',NEW.area_id,'grade',NEW.grade,'section',NEW.section))),NEW.revision,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS sync_web_evaluation_insert AFTER INSERT ON web_evaluation BEGIN
 INSERT OR REPLACE INTO web_sync_outbox(teacher_id,kind,record_key,before_json,after_json,revision,updated_at)
 VALUES(NEW.teacher_id,NEW.kind,NEW.scope_id,COALESCE((SELECT before_json FROM web_sync_outbox WHERE teacher_id=NEW.teacher_id AND kind=NEW.kind AND record_key=NEW.scope_id),'null'),json_object('deleted',0,'value',json(NEW.payload_json),'context',json(NEW.scope_json)),NEW.revision,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS sync_web_evaluation_update AFTER UPDATE ON web_evaluation BEGIN
 INSERT OR REPLACE INTO web_sync_outbox(teacher_id,kind,record_key,before_json,after_json,revision,updated_at)
 VALUES(NEW.teacher_id,NEW.kind,NEW.scope_id,COALESCE((SELECT before_json FROM web_sync_outbox WHERE teacher_id=NEW.teacher_id AND kind=NEW.kind AND record_key=NEW.scope_id),json_object('deleted',0,'value',json(OLD.payload_json))),json_object('deleted',0,'value',json(NEW.payload_json),'context',json(NEW.scope_json)),NEW.revision,NEW.updated_at);
END;
INSERT OR IGNORE INTO web_sync_outbox(teacher_id,kind,record_key,before_json,after_json,revision,updated_at) SELECT teacher_id,dataset,record_id,'null',json_object('deleted',deleted,'value',json(payload_json),'context',json('{}')),revision,updated_at FROM academic_edits WHERE NOT EXISTS(SELECT 1 FROM web_sync_setup WHERE version=1);
INSERT OR IGNORE INTO web_sync_outbox(teacher_id,kind,record_key,before_json,after_json,revision,updated_at) SELECT teacher_id,dataset,record_id,'null',json_object('deleted',deleted,'value',json(payload_json),'context',json('{}')),revision,updated_at FROM planning_edits WHERE NOT EXISTS(SELECT 1 FROM web_sync_setup WHERE version=1);
INSERT OR IGNORE INTO web_sync_outbox(teacher_id,kind,record_key,before_json,after_json,revision,updated_at) SELECT teacher_id,'configuration','configuration','null',json_object('deleted',0,'value',json(payload_json),'context',json(json_object('removed',json(removed_json)))),revision,updated_at FROM web_configurations WHERE NOT EXISTS(SELECT 1 FROM web_sync_setup WHERE version=1);
INSERT OR IGNORE INTO web_sync_outbox(teacher_id,kind,record_key,before_json,after_json,revision,updated_at) SELECT teacher_id,'instruments',id,'null',json_object('deleted',deleted,'value',json(payload_json),'context',json(json_object('year',year,'areaId',area_id,'grade',grade,'section',section))),revision,updated_at FROM web_instruments WHERE NOT EXISTS(SELECT 1 FROM web_sync_setup WHERE version=1);
INSERT OR IGNORE INTO web_sync_outbox(teacher_id,kind,record_key,before_json,after_json,revision,updated_at) SELECT teacher_id,kind,scope_id,'null',json_object('deleted',0,'value',json(payload_json),'context',json(scope_json)),revision,updated_at FROM web_evaluation WHERE NOT EXISTS(SELECT 1 FROM web_sync_setup WHERE version=1);
INSERT OR IGNORE INTO web_sync_setup(version) VALUES(1);
