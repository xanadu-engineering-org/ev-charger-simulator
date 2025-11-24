require('dotenv').config();
const path = require('path');
const express = require('express');
const Database = require('./src/db/Database');
const ChargerState = require('./src/charger/ChargerState');
const OcppClient = require('./src/ocpp/OcppClient');

const app = express();
const PORT = process.env.PORT || 3030;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));
app.use('/public', express.static(path.join(__dirname, 'src/public')));
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

// Fallback error handler to keep server alive
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  res.status(500).send('Unexpected error occurred');
});

process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('Uncaught exception:', err);
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`OCPP simulator running on http://localhost:${PORT}`);
});
