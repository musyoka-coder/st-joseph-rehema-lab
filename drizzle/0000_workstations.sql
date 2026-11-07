CREATE TABLE workstation_edits (
  number INTEGER PRIMARY KEY CHECK (number BETWEEN 1 AND 13),
  revision INTEGER NOT NULL CHECK (revision > 0),
  details TEXT NOT NULL,
  notes TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
