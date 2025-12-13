const path = require('path');
const fs = require('fs');
// #region agent log
fetch('http://127.0.0.1:7243/ingest/20fc2c36-7f99-43af-85b8-6abf4fc6304b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Database.js:3',message:'Before requiring better-sqlite3',data:{nodeVersion:process.version,nodeModuleVersion:process.versions.modules},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
// #endregion
let DatabaseDriver;
try {
  DatabaseDriver = require('better-sqlite3');
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/20fc2c36-7f99-43af-85b8-6abf4fc6304b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Database.js:8',message:'better-sqlite3 loaded successfully',data:{nodeVersion:process.version,nodeModuleVersion:process.versions.modules},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
} catch (err) {
  // #region agent log
  const betterSqlite3Path = require.resolve('better-sqlite3');
  const nativeModulePath = require('path').join(require('path').dirname(betterSqlite3Path), '../build/Release/better_sqlite3.node');
  let nativeModuleExists = false;
  let nativeModuleStats = null;
  try {
    nativeModuleStats = fs.statSync(nativeModulePath);
    nativeModuleExists = true;
  } catch (e) {}
  fetch('http://127.0.0.1:7243/ingest/20fc2c36-7f99-43af-85b8-6abf4fc6304b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Database.js:17',message:'Error loading better-sqlite3',data:{errorMessage:err.message,errorCode:err.code,nativeModulePath,nativeModuleExists,nativeModuleStats:nativeModuleStats?{size:nativeModuleStats.size,mtime:nativeModuleStats.mtime}:null,nodeVersion:process.version,nodeModuleVersion:process.versions.modules},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
  // #endregion
  throw err;
}

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
