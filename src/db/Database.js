const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const SQLITE_DB_PATH = path.resolve(__dirname, '../../ocpp-sim.db');

class Database {
  constructor() {
    this.databasePath = SQLITE_DB_PATH;
    this.db = null;
  }

  async ensureSchema() {
    this.db = await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(this.databasePath, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(db);
      });
    });

    await this.exec(`
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

      CREATE INDEX IF NOT EXISTS idx_ocpp_logs_ts ON ocpp_logs(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_transaction_id ON sessions(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_meter_values_session_id_ts ON meter_values(session_id, ts DESC);
    `);
  }

  exec(sql) {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function onRun(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  }

  async logOcpp(direction, action, rawJson) {
    const ts = new Date().toISOString();
    await this.run(
      `INSERT INTO ocpp_logs (ts, direction, action, raw_json)
       VALUES (?, ?, ?, ?)`,
      [ts, direction, action, JSON.stringify(rawJson)],
    );
  }

  async createSession({ transactionId, connectorId, idTag, startTime, meterStart }) {
    const result = await this.run(
      `INSERT INTO sessions (
        transaction_id,
        connector_id,
        id_tag,
        start_time,
        meter_start,
        end_time,
        meter_stop,
        stop_reason
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      [transactionId, connectorId, idTag, startTime, meterStart],
    );
    return String(result.lastID);
  }

  async endSession(sessionId, { endTime, meterStop, stopReason }) {
    await this.run(
      `UPDATE sessions
       SET end_time = ?, meter_stop = ?, stop_reason = ?
       WHERE id = ?`,
      [endTime, meterStop, stopReason, Number(sessionId)],
    );
  }

  async insertMeterValue(sessionId, valueWh, rawJson) {
    const ts = new Date().toISOString();
    await this.run(
      `INSERT INTO meter_values (session_id, ts, value_wh, raw_json)
       VALUES (?, ?, ?, ?)`,
      [Number(sessionId), ts, valueWh, JSON.stringify(rawJson)],
    );
  }

  async listLogs(limit = 200) {
    const rows = await this.all(
      `SELECT id, ts, direction, action, raw_json
       FROM ocpp_logs
       ORDER BY id DESC
       LIMIT ?`,
      [limit],
    );

    return rows.map((row) => ({
      id: String(row.id),
      ts: row.ts,
      direction: row.direction,
      action: row.action,
      raw_json: row.raw_json,
    }));
  }

  async close() {
    if (!this.db) {
      return;
    }

    await new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}

module.exports = Database;
