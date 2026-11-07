CREATE TABLE lab_equipment (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('monitor', 'system-unit')),
  asset_tag TEXT NOT NULL CHECK (length(trim(asset_tag)) BETWEEN 1 AND 100),
  details TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX lab_equipment_asset_tag ON lab_equipment (lower(asset_tag));
--> statement-breakpoint
ALTER TABLE workstation_edits ADD COLUMN monitor_id TEXT REFERENCES lab_equipment (id);
--> statement-breakpoint
ALTER TABLE workstation_edits ADD COLUMN system_unit_id TEXT REFERENCES lab_equipment (id);
--> statement-breakpoint
CREATE UNIQUE INDEX station_monitor_once ON workstation_edits (monitor_id);
--> statement-breakpoint
CREATE UNIQUE INDEX station_system_unit_once ON workstation_edits (system_unit_id);
--> statement-breakpoint
CREATE TRIGGER station_equipment_kind_insert
BEFORE INSERT ON workstation_edits FOR EACH ROW
WHEN (NEW.monitor_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM lab_equipment WHERE id = NEW.monitor_id AND kind = 'monitor'
)) OR (NEW.system_unit_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM lab_equipment WHERE id = NEW.system_unit_id AND kind = 'system-unit'
))
BEGIN
  SELECT RAISE(ABORT, 'invalid workstation equipment type');
END;
--> statement-breakpoint
CREATE TRIGGER station_equipment_kind_update
BEFORE UPDATE OF monitor_id, system_unit_id ON workstation_edits FOR EACH ROW
WHEN (NEW.monitor_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM lab_equipment WHERE id = NEW.monitor_id AND kind = 'monitor'
)) OR (NEW.system_unit_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM lab_equipment WHERE id = NEW.system_unit_id AND kind = 'system-unit'
))
BEGIN
  SELECT RAISE(ABORT, 'invalid workstation equipment type');
END;
