const EventEmitter = require('events');
const WebSocket = require('ws');
const {
  bootNotificationPayload,
  heartbeatPayload,
  statusNotificationPayload,
  authorizePayload,
  startTransactionPayload,
  stopTransactionPayload,
  meterValuesPayload,
} = require('./OcppMessages');

class OcppClient extends EventEmitter {
  constructor({ chargePointId, chargePointVendor, chargePointModel, db, chargerState }) {
    super();
    this.chargePointId = chargePointId;
    this.chargePointVendor = chargePointVendor;
    this.chargePointModel = chargePointModel;
    this.db = db;
    this.chargerState = chargerState;

    this.ws = null;
    this.wsUrl = null;
    this.pending = new Map();
    this.heartbeatIntervalSec = 30;
    this.heartbeatTimer = null;
    this.bootAccepted = false;
    this.idCounter = 1;
    this.configMap = {
      HeartbeatInterval: this.heartbeatIntervalSec,
    };
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  isReady() {
    return this.isConnected() && this.bootAccepted;
  }

  nextId() {
    this.idCounter += 1;
    return `${Date.now()}-${this.idCounter}-${Math.random().toString(16).slice(2, 8)}`;
  }

  async connect(url) {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.wsUrl = url.includes(this.chargePointId) ? url : `${url.replace(/\/$/, '')}/${this.chargePointId}`;
    await this.openSocket();
  }

  async openSocket() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl, ['ocpp1.6']);
      this.ws = ws;
      ws.on('open', () => {
        this.emit('connected');
        this.sendBootNotificationWithRetry();
        resolve();
      });
      ws.on('message', (data) => this.handleMessage(data));
      ws.on('close', () => {
        this.emit('disconnected');
        this.bootAccepted = false;
        this.clearHeartbeat();
      });
      ws.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.bootAccepted = false;
    this.clearHeartbeat();
  }

  sendRaw(arrayMessage) {
    if (!this.isConnected()) return;
    const raw = JSON.stringify(arrayMessage);
    this.ws.send(raw);
  }

  sendCall(action, payload) {
    if (!this.isConnected()) {
      return Promise.reject(new Error('WebSocket not connected'));
    }
    const uid = this.nextId();
    const frame = [2, uid, action, payload];
    this.db.logOcpp('->', action, frame);
    this.sendRaw(frame);
    return new Promise((resolve, reject) => {
      this.pending.set(uid, { resolve, reject, action });
      setTimeout(() => {
        if (this.pending.has(uid)) {
          this.pending.delete(uid);
          reject(new Error(`Timeout waiting for ${action}`));
        }
      }, 20000);
    });
  }

  sendCallResult(uid, payload, actionLabel) {
    const frame = [3, uid, payload];
    this.db.logOcpp('->', actionLabel || 'CallResult', frame);
    this.sendRaw(frame);
  }

  sendCallError(uid, errorCode, text, details = {}) {
    const frame = [4, uid, errorCode, text, details];
    this.db.logOcpp('->', 'CallError', frame);
    this.sendRaw(frame);
  }

  async sendBootNotificationWithRetry() {
    const attempt = async () => {
      try {
        const payload = bootNotificationPayload({
          chargePointVendor: this.chargePointVendor,
          chargePointModel: this.chargePointModel,
          chargePointSerialNumber: this.chargePointId,
        });
        const resp = await this.sendCall('BootNotification', payload);
        this.bootAccepted = resp.status === 'Accepted';
        if (this.bootAccepted && resp.interval) {
          this.heartbeatIntervalSec = resp.interval;
          this.configMap.HeartbeatInterval = resp.interval;
          this.startHeartbeat();
        }
        if (!this.bootAccepted) {
          setTimeout(attempt, 10000);
        }
      } catch (err) {
        setTimeout(attempt, 10000);
      }
    };
    attempt();
  }

  startHeartbeat() {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isReady()) {
        this.sendHeartbeat();
      }
    }, this.heartbeatIntervalSec * 1000);
  }

  clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async sendHeartbeat() {
    return this.sendCall('Heartbeat', heartbeatPayload());
  }

  async sendStatusNotification(connectorId, status) {
    return this.sendCall('StatusNotification', statusNotificationPayload({ connectorId, status }));
  }

  async sendAuthorize(idTag) {
    return this.sendCall('Authorize', authorizePayload(idTag));
  }

  async sendStartTransaction(connectorId, idTag, meterStart, timestamp) {
    return this.sendCall('StartTransaction', startTransactionPayload({
      connectorId,
      idTag,
      meterStart,
      timestamp,
    }));
  }

  async sendStopTransaction(connectorId, transactionId, meterStop, timestamp, reason, idTag) {
    return this.sendCall('StopTransaction', stopTransactionPayload({
      transactionId,
      idTag,
      meterStop,
      timestamp,
      reason,
    }));
  }

  async sendMeterValues(connectorId, transactionId, meterValueWh) {
    const sampledValue = [{
      value: String(meterValueWh),
      measurand: 'Energy.Active.Import.Register',
      unit: 'Wh',
    }];
    return this.sendCall('MeterValues', meterValuesPayload({
      connectorId,
      transactionId,
      sampledValue,
    }));
  }

  async handleMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (err) {
      return;
    }
    const [messageTypeId, uid, actionOrPayload, payloadMaybe] = msg;
    if (messageTypeId === 3) {
      // CALLRESULT
      const pending = this.pending.get(uid);
      if (pending) {
        this.pending.delete(uid);
        this.db.logOcpp('<-', pending.action || 'CALLRESULT', msg);
        pending.resolve(actionOrPayload);
      }
      return;
    }
    if (messageTypeId === 4) {
      const pending = this.pending.get(uid);
      if (pending) {
        this.pending.delete(uid);
        this.db.logOcpp('<-', pending.action || 'CALLERROR', msg);
        pending.reject(new Error(`${actionOrPayload}: ${payloadMaybe}`));
      }
      return;
    }
    if (messageTypeId === 2) {
      const action = actionOrPayload;
      const payload = payloadMaybe;
      this.db.logOcpp('<-', action, msg);
      switch (action) {
        case 'RemoteStartTransaction':
          this.handleRemoteStart(uid, payload);
          break;
        case 'RemoteStopTransaction':
          this.handleRemoteStop(uid, payload);
          break;
        case 'ChangeConfiguration':
          this.handleChangeConfiguration(uid, payload);
          break;
        case 'GetConfiguration':
          this.handleGetConfiguration(uid, payload);
          break;
        default:
          this.sendCallError(uid, 'NotSupported', 'Unsupported action');
      }
    }
  }

  async handleRemoteStart(uid, payload) {
    const { connectorId = 1, idTag } = payload;
    const result = await this.chargerState.remoteStart({ connectorId, idTag });
    const status = result.ok ? 'Accepted' : 'Rejected';
    this.sendCallResult(uid, { status }, 'RemoteStartTransaction');
  }

  async handleRemoteStop(uid, payload) {
    const { transactionId } = payload;
    const result = await this.chargerState.remoteStop({ transactionId });
    const status = result.ok ? 'Accepted' : 'Rejected';
    this.sendCallResult(uid, { status }, 'RemoteStopTransaction');
  }

  handleChangeConfiguration(uid, payload) {
    const { key, value } = payload;
    if (key === 'HeartbeatInterval') {
      const newVal = Number(value);
      if (!Number.isNaN(newVal) && newVal > 0) {
        this.heartbeatIntervalSec = newVal;
        this.configMap.HeartbeatInterval = newVal;
        this.startHeartbeat();
      }
    }
    this.sendCallResult(uid, { status: 'Accepted' }, 'ChangeConfiguration');
  }

  handleGetConfiguration(uid, payload) {
    const keys = payload.key || Object.keys(this.configMap);
    const configurationKey = keys.map((key) => ({
      key,
      readonly: false,
      value: this.configMap[key] !== undefined ? String(this.configMap[key]) : '',
    }));
    this.sendCallResult(uid, { configurationKey }, 'GetConfiguration');
  }
}

module.exports = OcppClient;
