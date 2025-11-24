const path = require('path');
const fs = require('fs');
const DatabaseDriver = require('better-sqlite3');

class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = new DatabaseDriver(dbPath);
    this.ensureSchema();
  }

  ensureSchema() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    this.db.exec(schema);
  }

  logOcpp(direction, action, rawJson) {
    const stmt = this.db.prepare(
      'INSERT INTO ocpp_logs (ts, direction, action, raw_json) VALUES (?, ?, ?, ?)' // eslint-disable-line max-len
    );
    const ts = new Date().toISOString();
    stmt.run(ts, direction, action, JSON.stringify(rawJson));
  }

  createSession({ transactionId, connectorId, idTag, startTime, meterStart }) {
    const stmt = this.db.prepare(
      'INSERT INTO sessions (transaction_id, connector_id, id_tag, start_time, meter_start) VALUES (?, ?, ?, ?, ?)' // eslint-disable-line max-len
    );
    const result = stmt.run(transactionId, connectorId, idTag, startTime, meterStart);
    return result.lastInsertRowid;
  }

  endSession(sessionId, { endTime, meterStop, stopReason }) {
    const stmt = this.db.prepare(
      'UPDATE sessions SET end_time = ?, meter_stop = ?, stop_reason = ? WHERE id = ?'
    );
    stmt.run(endTime, meterStop, stopReason, sessionId);
  }

  insertMeterValue(sessionId, valueWh, rawJson) {
    const stmt = this.db.prepare(
      'INSERT INTO meter_values (session_id, ts, value_wh, raw_json) VALUES (?, ?, ?, ?)'
    );
    const ts = new Date().toISOString();
    stmt.run(sessionId, ts, valueWh, JSON.stringify(rawJson));
  }

  listLogs(limit = 200) {
    const stmt = this.db.prepare(
      'SELECT * FROM ocpp_logs ORDER BY id DESC LIMIT ?'
    );
    return stmt.all(limit);
  }
}

module.exports = Database;
