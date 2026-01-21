const { MongoClient, ObjectId } = require('mongodb');

class Database {
  constructor(connectionString) {
    this.connectionString = connectionString || process.env.DATABASE_URL;
    if (!this.connectionString) {
      throw new Error('DATABASE_URL is required');
    }
    this.client = new MongoClient(this.connectionString);
    this.db = null;
  }

  async ensureSchema() {
    await this.client.connect();
    this.db = process.env.MONGODB_DB ? this.client.db(process.env.MONGODB_DB) : this.client.db();
    await Promise.all([
      this.db.collection('ocpp_logs').createIndex({ ts: -1 }),
      this.db.collection('sessions').createIndex({ transaction_id: 1 }),
      this.db.collection('meter_values').createIndex({ session_id: 1, ts: -1 }),
    ]);
  }

  async logOcpp(direction, action, rawJson) {
    const ts = new Date().toISOString();
    await this.db.collection('ocpp_logs').insertOne({
      ts,
      direction,
      action,
      raw_json: JSON.stringify(rawJson),
    });
  }

  async createSession({ transactionId, connectorId, idTag, startTime, meterStart }) {
    const result = await this.db.collection('sessions').insertOne({
      transaction_id: transactionId,
      connector_id: connectorId,
      id_tag: idTag,
      start_time: startTime,
      meter_start: meterStart,
      end_time: null,
      meter_stop: null,
      stop_reason: null,
    });
    return result.insertedId.toString();
  }

  async endSession(sessionId, { endTime, meterStop, stopReason }) {
    await this.db.collection('sessions').updateOne(
      { _id: new ObjectId(sessionId) },
      { $set: { end_time: endTime, meter_stop: meterStop, stop_reason: stopReason } },
    );
  }

  async insertMeterValue(sessionId, valueWh, rawJson) {
    const ts = new Date().toISOString();
    await this.db.collection('meter_values').insertOne({
      session_id: sessionId,
      ts,
      value_wh: valueWh,
      raw_json: JSON.stringify(rawJson),
    });
  }

  async listLogs(limit = 200) {
    const logs = await this.db
      .collection('ocpp_logs')
      .find({})
      .sort({ _id: -1 })
      .limit(limit)
      .toArray();
    return logs.map((log) => ({
      id: log._id.toString(),
      ts: log.ts,
      direction: log.direction,
      action: log.action,
      raw_json: log.raw_json,
    }));
  }

  async close() {
    await this.client.close();
  }
}

module.exports = Database;
