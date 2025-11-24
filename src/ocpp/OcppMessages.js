function bootNotificationPayload({ chargePointVendor, chargePointModel, chargePointSerialNumber }) {
  return {
    chargePointVendor,
    chargePointModel,
    chargePointSerialNumber,
  };
}

function heartbeatPayload() {
  return {};
}

function statusNotificationPayload({ connectorId, status, errorCode = 'NoError' }) {
  return {
    connectorId,
    errorCode,
    status,
    timestamp: new Date().toISOString(),
  };
}

function authorizePayload(idTag) {
  return { idTag };
}

function startTransactionPayload({ connectorId, idTag, meterStart, timestamp, reservationId }) {
  return {
    connectorId,
    idTag,
    meterStart,
    timestamp,
    reservationId,
  };
}

function stopTransactionPayload({ transactionId, idTag, meterStop, timestamp, reason }) {
  const payload = {
    transactionId,
    meterStop,
    timestamp,
    reason,
  };
  if (idTag) payload.idTag = idTag;
  return payload;
}

function meterValuesPayload({ connectorId, transactionId, sampledValue }) {
  return {
    connectorId,
    transactionId,
    meterValue: [
      {
        timestamp: new Date().toISOString(),
        sampledValue,
      },
    ],
  };
}

module.exports = {
  bootNotificationPayload,
  heartbeatPayload,
  statusNotificationPayload,
  authorizePayload,
  startTransactionPayload,
  stopTransactionPayload,
  meterValuesPayload,
};
