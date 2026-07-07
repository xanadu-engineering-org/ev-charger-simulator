CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER,
  connector_id INTEGER,
  id_tag TEXT,
  start_time TEXT,
  end_time TEXT,
  meter_start INTEGER,
  meter_stop INTEGER,
  stop_reason TEXT
);

CREATE TABLE IF NOT EXISTS meter_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  ts TEXT,
  value_wh INTEGER,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS ocpp_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT,
  direction TEXT,
  action TEXT,
  raw_json TEXT
);
