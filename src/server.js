require('dotenv').config();
const path = require('path');
const express = require('express');
const Database = require('./db/Database');
const ChargerState = require('./charger/ChargerState');
const OcppClient = require('./ocpp/OcppClient');

const app = express();
const PORT = process.env.PORT || 3030;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let db;
let chargerState;
let ocppClient;
let connectionConfig;

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
  // If ocppUrl is provided in form, use it; otherwise keep existing from env/config
  const finalOcppUrl = ocppUrl || connectionConfig.ocppUrl;
  connectionConfig = {
    ocppUrl: finalOcppUrl,
    csmsServerBaseUrl: connectionConfig.csmsServerBaseUrl,
    csmsWebSocketBaseUrl: connectionConfig.csmsWebSocketBaseUrl,
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

app.get('/logs', async (req, res) => {
  const logs = await db.listLogs(300);
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

(async () => {
  try {
    // Initialize database
    db = new Database(process.env.DATABASE_URL);
    await db.ensureSchema();

    const connectorCount = Number(process.env.CONNECTORS || 2);
    chargerState = new ChargerState({ connectorCount, db });

    const CSMS_SERVER_BASE_URL = process.env.CSMS_SERVER_BASE_URL || 'http://localhost:3020';
    const CSMS_WEBSOCKET_BASE_URL = process.env.CSMS_WEBSOCKET_BASE_URL || 'ws://localhost:3020';
    const CHARGE_POINT_ID = process.env.CHARGE_POINT_ID || 'ME-001';

    let ocppUrl;
    if (process.env.OCPP_URL) {
      ocppUrl = process.env.OCPP_URL;
    } else {
      const wsBase = CSMS_WEBSOCKET_BASE_URL.replace(/\/$/, '');
      ocppUrl = `${wsBase}/ocpp`;
    }

    connectionConfig = {
      ocppUrl: ocppUrl,
      csmsServerBaseUrl: CSMS_SERVER_BASE_URL,
      csmsWebSocketBaseUrl: CSMS_WEBSOCKET_BASE_URL,
      chargePointId: CHARGE_POINT_ID,
      chargePointVendor: process.env.CHARGE_POINT_VENDOR || 'MetroElectric',
      chargePointModel: process.env.CHARGE_POINT_MODEL || 'Virtual-1',
    };

    ocppClient = new OcppClient({
      chargePointId: connectionConfig.chargePointId,
      chargePointVendor: connectionConfig.chargePointVendor,
      chargePointModel: connectionConfig.chargePointModel,
      db,
      chargerState,
    });
    chargerState.setOcppClient(ocppClient);

    app.listen(PORT, () => {
      console.log(`OCPP simulator running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to initialize application:', err);
    process.exit(1);
  }
})();
