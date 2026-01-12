# OCPP 1.6J Charge Point Simulator

Node.js single-app simulator for an OCPP 1.6J charge point. Runs Express + EJS server-side UI, a WebSocket OCPP client, a charger state machine, and PostgreSQL persistence (sessions, meter values, OCPP logs). No frontend frameworks required.

## Features
- OCPP 1.6J CALL/CALLRESULT/CALLERROR framing using native `ws` client.
- BootNotification retry, heartbeat interval from CSMS, status/meter updates while charging.
- Supports RemoteStartTransaction / RemoteStopTransaction / ChangeConfiguration / GetConfiguration.
- Charger state machine (Available, Preparing, Charging, SuspendedEV, Finishing, Faulted) with simulated meter increments.
- PostgreSQL via pg for sessions, meter values, and OCPP message logs.
- Server-rendered UI (EJS) to control connector: present token, plug/unplug, local start/stop, view logs.
- Dockerfile for containerized runs.

## Prerequisites
- Node.js 18+ (Node 20 recommended) and npm, or Docker.
- PostgreSQL database (local or remote).
- No network install needed at runtime if node_modules are present; otherwise run `npm install`.

## Quick Start (Local)
```bash
npm install          # if node_modules not present
npm start            # starts on PORT (default 3030)
```
Visit http://localhost:3030.

## Configuration
Environment variables (via `.env` or inline):
- `PORT` (default `3030`)
- `CSMS_SERVER_BASE_URL` (default `http://localhost:3020`) - HTTP base URL for CSMS server
- `CSMS_WEBSOCKET_BASE_URL` (default `ws://localhost:3020`) - WebSocket base URL for CSMS server
- `OCPP_URL` (optional, constructed from `CSMS_WEBSOCKET_BASE_URL/ocpp` if not set) - Full WebSocket URL for OCPP connection. Can be explicitly set for backward compatibility or custom configurations.
- `CHARGE_POINT_ID` (default `ME-001`)
- `CHARGE_POINT_VENDOR` (default `MetroElectric`)
- `CHARGE_POINT_MODEL` (default `Virtual-1`)
- `CONNECTORS` (default `2`; set to `1` to force single connector)
- `DATABASE_URL` (required) - PostgreSQL connection string, e.g., `postgresql://user:password@host:port/database`

### URL Configuration Examples

**Using base URLs (recommended):**
```bash
CSMS_SERVER_BASE_URL=http://localhost:3020
CSMS_WEBSOCKET_BASE_URL=ws://localhost:3020
```
This will automatically construct the OCPP URL as `ws://localhost:3020/ocpp` (chargePointId will be appended by the client if needed).

**Using explicit OCPP_URL (backward compatible):**
```bash
OCPP_URL=ws://localhost:3020/ocpp/ME-001
```
If `OCPP_URL` is explicitly set, it takes precedence over the base URL configuration.

PostgreSQL database: Tables are auto-created with schema from `src/db/schema.sql` on first run. Ensure your `DATABASE_URL` points to a valid PostgreSQL database.

## Running in Docker
Build and run:
```bash
docker build -t ev-charger-sim .
docker run -p 3030:3030 \
  -e CSMS_SERVER_BASE_URL=http://host.docker.internal:3020 \
  -e CSMS_WEBSOCKET_BASE_URL=ws://host.docker.internal:3020 \
  -e CHARGE_POINT_ID=ME-001 \
  -e DATABASE_URL=postgresql://user:password@host:port/database \
  ev-charger-sim
```

Or using the explicit OCPP_URL (backward compatible):
```bash
docker run -p 3030:3030 \
  -e OCPP_URL=ws://host.docker.internal:3020/ocpp \
  -e CHARGE_POINT_ID=ME-001 \
  -e DATABASE_URL=postgresql://user:password@host:port/database \
  ev-charger-sim
```
Ensure your PostgreSQL database is accessible from the container.

## Usage
1) Open the dashboard.
2) Enter CSMS OCPP URL and CP identity; click Connect. Status dots show WebSocket and BootNotification state; heartbeat interval displays from CSMS response.
3) For the connector:
   - Present Token: set `idTag` to use for authorization.
   - Plug In / Unplug EV: toggles plugged state; status notifications follow.
   - Local Start: runs Authorize + StartTransaction, begins meter increments, sends MeterValues.
   - Local Stop: sends StopTransaction, ends session, resets state.
4) Logs page shows OCPP frames with direction and JSON payload.

Incoming CSMS commands supported:
- `RemoteStartTransaction` → triggers start with provided `idTag`/connectorId.
- `RemoteStopTransaction` → stops active transaction by id.
- `ChangeConfiguration` → updates HeartbeatInterval if provided.
- `GetConfiguration` → returns stored config keys (HeartbeatInterval).

## Project Structure
```
src/
  ocpp/
    OcppClient.js       # OCPP WebSocket client + handlers
    OcppMessages.js     # Payload builders
  charger/
    ChargerState.js     # State machine, meter simulation
  db/
    schema.sql          # PostgreSQL schema
    Database.js         # DB helper (sessions, meter_values, ocpp_logs)
  public/
    styles.css          # UI styles
  views/
    layout.ejs
    index.ejs           # Dashboard
    logs.ejs            # Log viewer
server.js               # Express app wiring routes/UI/OCPP/DB
Dockerfile
.dockerignore
package.json
README.md
```

## Notes
- Errors surface on the dashboard as modals instead of blank error pages.
- If OCPP is disconnected, commands return graceful error messages; simulator keeps running.
- Heartbeat interval updates when CSMS accepts BootNotification with an interval value.

## Troubleshooting
- Cannot connect: verify `CSMS_WEBSOCKET_BASE_URL` (or `OCPP_URL`) is reachable and includes the `/ocpp` path. The chargePointId will be automatically appended by the OCPP client if needed.
- BootNotification not accepted: check charge point identity values; some CSMS validate vendor/model.
- Meter values not appearing: ensure charging is active and heartbeat/status are accepted; check logs page for outgoing `MeterValues`.
