require('dotenv').config();
// #region agent log
fetch('http://127.0.0.1:7243/ingest/20fc2c36-7f99-43af-85b8-6abf4fc6304b', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'server.js:2', message: 'Node.js version info', data: { nodeVersion: process.version, nodeModuleVersion: process.versions.modules, platform: process.platform, arch: process.arch }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'post-fix', hypothesisId: 'A' }) }).catch(() => { });
// #endregion
const path = require('path');
const express = require('express');
// #region agent log
fetch('http://127.0.0.1:7243/ingest/20fc2c36-7f99-43af-85b8-6abf4fc6304b', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'server.js:6', message: 'Before requiring Database module', data: {}, timestamp: Date.now(), sessionId: 'debug-session', runId: 'post-fix', hypothesisId: 'B' }) }).catch(() => { });
// #endregion
let Database;
try {
  Database = require('./db/Database');
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/20fc2c36-7f99-43af-85b8-6abf4fc6304b', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'server.js:11', message: 'Database module loaded successfully', data: {}, timestamp: Date.now(), sessionId: 'debug-session', runId: 'post-fix', hypothesisId: 'C' }) }).catch(() => { });
  // #endregion
} catch (err) {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/20fc2c36-7f99-43af-85b8-6abf4fc6304b', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'server.js:14', message: 'Error loading Database module', data: { errorMessage: err.message, errorCode: err.code, errorStack: err.stack }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }) }).catch(() => { });
  // #endregion
  throw err;
}
const ChargerState = require('./charger/ChargerState');
const OcppClient = require('./ocpp/OcppClient');

const app = express();
const PORT = process.env.PORT || 3030;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const dbPath = path.join(__dirname, 'ocpp-sim.db');
const db = new Database(dbPath);
const connectorCount = Number(process.env.CONNECTORS || 2);
const chargerState = new ChargerState({ connectorCount, db });

let connectionConfig = {
  ocppUrl: process.env.OCPP_URL || 'ws://localhost:3020/ocpp',
  chargePointId: process.env.CHARGE_POINT_ID || 'ME-001',
  chargePointVendor: process.env.CHARGE_POINT_VENDOR || 'MetroElectric',
  chargePointModel: process.env.CHARGE_POINT_MODEL || 'Virtual-1',
};

let ocppClient = new OcppClient({
  chargePointId: connectionConfig.chargePointId,
  chargePointVendor: connectionConfig.chargePointVendor,
  chargePointModel: connectionConfig.chargePointModel,
  db,
  chargerState,
});
chargerState.setOcppClient(ocppClient);

// API endpoint to get all connectors status
app.get('/api/connectors', (req, res) => {
  const connectors = chargerState.getConnectors().map(conn => ({
    id: conn.id,
    state: conn.state,
    pluggedIn: conn.pluggedIn,
    idTag: conn.idTag,
    transactionId: conn.transactionId,
    meterWh: conn.meterWh,
  }));
  res.json({ connectors });
});

// API endpoint to get specific connector status
app.get('/api/connectors/:connectorId', (req, res) => {
  const connectorId = Number(req.params.connectorId);
  const connectors = chargerState.getConnectors();
  const connector = connectors.find(c => c.id === connectorId);
  
  if (!connector) {
    return res.status(404).json({ error: 'Connector not found' });
  }
  
  res.json({
    id: connector.id,
    state: connector.state,
    pluggedIn: connector.pluggedIn,
    idTag: connector.idTag,
    transactionId: connector.transactionId,
    meterWh: connector.meterWh,
  });
});

app.get('/', (req, res) => {
  res.render('index', {
    ocppUrl: ocppClient.wsUrl || connectionConfig.ocppUrl,
    chargePointId: ocppClient.chargePointId,
    chargePointVendor: ocppClient.chargePointVendor,
    chargePointModel: ocppClient.chargePointModel,
    connected: ocppClient.isConnected(),
    bootAccepted: ocppClient.bootAccepted,
    heartbeatInterval: ocppClient.heartbeatIntervalSec,
    connectors: chargerState.getConnectors(),
    errorMessage: req.query.error || null,
  });
});

app.post('/connect', async (req, res) => {
  const { ocppUrl, chargePointId, chargePointVendor, chargePointModel } = req.body;
  connectionConfig = {
    ocppUrl: ocppUrl || connectionConfig.ocppUrl,
    chargePointId: chargePointId || connectionConfig.chargePointId,
    chargePointVendor: chargePointVendor || connectionConfig.chargePointVendor,
    chargePointModel: chargePointModel || connectionConfig.chargePointModel,
  };
  ocppClient.disconnect();
  ocppClient = new OcppClient({
    chargePointId: connectionConfig.chargePointId,
    chargePointVendor: connectionConfig.chargePointVendor,
    chargePointModel: connectionConfig.chargePointModel,
    db,
    chargerState,
  });
  chargerState.setOcppClient(ocppClient);
  try {
    await ocppClient.connect(connectionConfig.ocppUrl);
    res.redirect('/');
  } catch (err) {
    res.redirect(`/?error=${encodeURIComponent(`Failed to connect: ${err.message}`)}`);
  }
});

app.post('/disconnect', (req, res) => {
  ocppClient.disconnect();
  res.redirect('/');
});

app.post('/reconnect', async (req, res) => {
  try {
    await ocppClient.connect(connectionConfig.ocppUrl);
    res.redirect('/');
  } catch (err) {
    res.redirect(`/?error=${encodeURIComponent(`Failed to reconnect: ${err.message}`)}`);
  }
});

app.post('/actions/:connector/:command', async (req, res) => {
  const connectorId = Number(req.params.connector);
  const command = req.params.command;
  const { idTag } = req.body;

  try {
    let result = { ok: true };
    switch (command) {
      case 'presentToken':
        result = await chargerState.presentToken(connectorId, idTag);
        break;
      case 'plugIn':
        result = await chargerState.plugIn(connectorId);
        break;
      case 'unplug':
        result = await chargerState.unplug(connectorId);
        break;
      case 'startCharging':
        result = await chargerState.startCharging(connectorId, { idTag });
        break;
      case 'stopCharging':
        result = await chargerState.stopCharging(connectorId, 'Local');
        break;
      default:
        return res.redirect(`/?error=${encodeURIComponent('Unknown command')}`);
    }
    if (!result.ok) {
      return res.redirect(`/?error=${encodeURIComponent(result.message || 'Command failed')}`);
    }
    res.redirect('/');
  } catch (err) {
    res.redirect(`/?error=${encodeURIComponent(err.message)}`);
  }
});

app.get('/logs', (req, res) => {
  const logs = db.listLogs(300);
  res.render('logs', { logs });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Unexpected error occurred');
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

app.listen(PORT, () => {
  console.log(`OCPP simulator running on http://localhost:${PORT}`);
});
