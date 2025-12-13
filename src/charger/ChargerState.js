const EventEmitter = require('events');

const STATES = {
  AVAILABLE: 'Available',
  PREPARING: 'Preparing',
  CHARGING: 'Charging',
  SUSPENDED_EV: 'SuspendedEV',
  FINISHING: 'Finishing',
  FAULTED: 'Faulted',
};

class ChargerState extends EventEmitter {
  constructor({ connectorCount = 1, db }) {
    super();
    this.db = db;
    this.connectorCount = connectorCount;
    this.ocppClient = null;
    this.connectors = Array.from({ length: connectorCount }, (_, idx) => ({
      id: idx + 1,
      state: STATES.AVAILABLE,
      idTag: '',
      pluggedIn: false,
      meterWh: 0,
      sessionId: null,
      transactionId: null,
      meterTimer: null,
    }));
  }

  setOcppClient(client) {
    this.ocppClient = client;
  }

  getConnectors() {
    return this.connectors;
  }

  setMeterTimer(connector, txId) {
    this.clearMeterTimer(connector);
    connector.meterTimer = setInterval(async () => {
      try {
        connector.meterWh += 50;
        const value = connector.meterWh;
        if (connector.sessionId) {
          this.db.insertMeterValue(connector.sessionId, value, { valueWh: value });
        }
        if (this.ocppClient && this.ocppClient.isReady()) {
          await this.ocppClient.sendMeterValues(connector.id, txId, value);
        }
      } catch (err) {
        // swallow interval errors to keep simulator running
      }
    }, 5000);
  }

  clearMeterTimer(connector) {
    if (connector.meterTimer) {
      clearInterval(connector.meterTimer);
      connector.meterTimer = null;
    }
  }

  async transition(connector, status) {
    connector.state = status;
    try {
      if (this.ocppClient && this.ocppClient.isReady()) {
        await this.ocppClient.sendStatusNotification(connector.id, status);
      }
    } catch (err) {
      // keep simulator running even if OCPP call fails
    }
    this.emit('stateChanged', { connectorId: connector.id, state: status });
  }

  async presentToken(connectorId, idTag) {
    const connector = this.connectors[connectorId - 1];
    connector.idTag = idTag;
    // Don't auto-transition to PREPARING - charging should be explicitly started
    // presentToken just stores the idTag, user must click "Start Charging"
    return { ok: true };
  }

  async plugIn(connectorId) {
    const connector = this.connectors[connectorId - 1];
    connector.pluggedIn = true;
    // Emit pluggedIn event - charging should not start automatically
    this.emit('pluggedIn', { connectorId: connector.id, pluggedIn: true });
    // Transition to PREPARING state when plugged in (this represents "plugged in, ready for charging")
    // This doesn't start charging - charging only starts when startCharging() is explicitly called
    if (connector.state === STATES.AVAILABLE) {
      try {
        if (this.ocppClient && this.ocppClient.isReady()) {
          // Send PREPARING state notification - this correctly indicates plugged in but not charging
          await this.ocppClient.sendStatusNotification(connector.id, STATES.PREPARING);
          // Update local state to PREPARING for consistency
          connector.state = STATES.PREPARING;
        }
      } catch (err) {
        // keep simulator running even if OCPP call fails
      }
    }
    return { ok: true };
  }

  async unplug(connectorId) {
    const connector = this.connectors[connectorId - 1];
    connector.pluggedIn = false;
    // Emit pluggedOut event
    this.emit('pluggedOut', { connectorId: connector.id, pluggedIn: false });
    if (connector.state === STATES.CHARGING) {
      await this.stopCharging(connectorId, 'EVDisconnected');
    }
    await this.transition(connector, STATES.AVAILABLE);
    connector.idTag = '';
    return { ok: true };
  }

  async startCharging(connectorId, options = {}) {
    const connector = this.connectors[connectorId - 1];
    // Check if connector is plugged in
    if (!connector.pluggedIn) {
      return { ok: false, message: 'EV must be plugged in before starting charging' };
    }
    const idTag = (options.idTag || connector.idTag || '').trim();
    if (!idTag) {
      return { ok: false, message: 'idTag required' };
    }
    connector.idTag = idTag;
    if (!this.ocppClient || !this.ocppClient.isReady()) {
      return { ok: false, message: 'OCPP not connected' };
    }

    // Only transition to PREPARING if not already there (e.g., if already in PREPARING from plugIn, skip this)
    if (connector.state !== STATES.PREPARING) {
      await this.transition(connector, STATES.PREPARING);
    }
    let authResp;
    try {
      authResp = await this.ocppClient.sendAuthorize(idTag);
    } catch (err) {
      await this.transition(connector, STATES.AVAILABLE);
      return { ok: false, message: `Authorize failed: ${err.message}` };
    }
    if (authResp.idTagInfo && authResp.idTagInfo.status !== 'Accepted') {
      await this.transition(connector, STATES.AVAILABLE);
      return { ok: false, message: 'Authorize rejected' };
    }

    const meterStart = connector.meterWh;
    const startTime = new Date().toISOString();
    let txResp;
    try {
      txResp = await this.ocppClient.sendStartTransaction(connectorId, idTag, meterStart, startTime);
    } catch (err) {
      await this.transition(connector, STATES.AVAILABLE);
      return { ok: false, message: `StartTransaction failed: ${err.message}` };
    }
    const transactionId = txResp.transactionId;
    connector.transactionId = transactionId;
    connector.sessionId = this.db.createSession({
      transactionId,
      connectorId,
      idTag,
      startTime,
      meterStart,
    });
    await this.transition(connector, STATES.CHARGING);
    this.setMeterTimer(connector, transactionId);
    return { ok: true, transactionId };
  }

  async stopCharging(connectorId, reason = 'Local') {
    const connector = this.connectors[connectorId - 1];
    const txId = connector.transactionId;
    if (!txId) {
      await this.transition(connector, STATES.AVAILABLE);
      return { ok: false, message: 'No active transaction' };
    }

    this.clearMeterTimer(connector);
    const stopTime = new Date().toISOString();
    const meterStop = connector.meterWh;
    try {
      if (this.ocppClient && this.ocppClient.isReady()) {
        await this.ocppClient.sendStopTransaction(connectorId, txId, meterStop, stopTime, reason, connector.idTag);
      }
    } catch (err) {
      // swallow stop errors; still clean up locally
    }
    if (connector.sessionId) {
      this.db.endSession(connector.sessionId, {
        endTime: stopTime,
        meterStop,
        stopReason: reason,
      });
    }
    connector.transactionId = null;
    connector.sessionId = null;
    await this.transition(connector, STATES.AVAILABLE);
    return { ok: true };
  }

  async remoteStart({ connectorId = 1, idTag }) {
    const connector = this.connectors[connectorId - 1];
    connector.idTag = idTag;
    return this.startCharging(connectorId, { idTag });
  }

  async remoteStop({ transactionId }) {
    const connector = this.connectors.find((c) => c.transactionId === transactionId);
    if (!connector) return { ok: false, message: 'Transaction not found' };
    return this.stopCharging(connector.id, 'Remote');
  }
}

ChargerState.STATES = STATES;
module.exports = ChargerState;
