const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

class Database {
  constructor(connectionString) {
    this.pool = new Pool({
      connectionString: connectionString || process.env.DATABASE_URL,
    });
  }

  async ensureSchema() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const client = await this.pool.connect();
    try {
      await client.query(schema);
    } finally {
      client.release();
    }
  }

  async logOcpp(direction, action, rawJson) {
    const ts = new Date().toISOString();
    const query = 'INSERT INTO ocpp_logs (ts, direction, action, raw_json) VALUES ($1, $2, $3, $4)';
    await this.pool.query(query, [ts, direction, action, JSON.stringify(rawJson)]);
  }

  async createSession({ transactionId, connectorId, idTag, startTime, meterStart }) {
    const query = `INSERT INTO sessions (transaction_id, connector_id, id_tag, start_time, meter_start) 
                   VALUES ($1, $2, $3, $4, $5) RETURNING id`;
    const result = await this.pool.query(query, [transactionId, connectorId, idTag, startTime, meterStart]);
    return result.rows[0].id;
  }

  async endSession(sessionId, { endTime, meterStop, stopReason }) {
    const query = 'UPDATE sessions SET end_time = $1, meter_stop = $2, stop_reason = $3 WHERE id = $4';
    await this.pool.query(query, [endTime, meterStop, stopReason, sessionId]);
  }

  async insertMeterValue(sessionId, valueWh, rawJson) {
    const ts = new Date().toISOString();
    const query = 'INSERT INTO meter_values (session_id, ts, value_wh, raw_json) VALUES ($1, $2, $3, $4)';
    await this.pool.query(query, [sessionId, ts, valueWh, JSON.stringify(rawJson)]);
  }

  async listLogs(limit = 200) {
    const query = 'SELECT * FROM ocpp_logs ORDER BY id DESC LIMIT $1';
    const result = await this.pool.query(query, [limit]);
    return result.rows;
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = Database;
