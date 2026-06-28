# Phantom Protocol — NIE Campus Deployment Configuration & Protocol

This guide outlines the specifications for installing, configuring, and executing the Phantom Protocol telemetry network on the NIE Mysuru campus network.

---

## 1. Backend Setup on Campus Machine

To run the B2G Safety Infrastructure server on campus:
1. **Find Host Local IP Address**:
   - On Windows (PowerShell/CMD):
     ```cmd
     ipconfig
     ```
   - On Linux/macOS (Terminal):
     ```bash
     ifconfig
     ```
   Look for the wireless adapter IP (e.g., `192.168.105.42`).

2. **Configure Environment Variables**:
   In `backend/.env`, set the database connections and host addresses:
   ```env
   DATABASE_URL="postgresql+asyncpg://phantom:phantom@<local-ip>:5432/phantomdb"
   TIMESCALE_URL="postgresql+asyncpg://phantom:phantom@<local-ip>:5432/phantomdb"
   ```

3. **Spin Up Server Services**:
   Launch the database and backend FastAPI server containers:
   ```bash
   docker-compose up -d --build
   ```

4. **Apply Alembic Schema Migrations**:
   Prepare database schemas and hypertable partitions:
   ```bash
   docker-compose exec backend alembic upgrade head
   ```

5. **Verify Endpoint Health**:
   From another machine on the same WiFi network:
   ```bash
   curl http://<local-ip>:8000/health
   ```

6. **Firewall Access**:
   Ensure inbound connections to port `8000` (FastAPI WebSockets/HTTP) and port `5432` (PostgreSQL) are permitted in the host operating system's firewall configuration.

---

## 2. Mobile App Configuration

Configure client nodes for passive scanning:
1. Open the **Settings Screen** in the `PhantomSensor` mobile app.
2. Update the **Backend Web Address** to point to the server:
   - Value: `ws://<local-ip>:8000`
3. Set the **Default Environment ID** using the naming conventions below.
4. Verify all scanning nodes are connected to the **same wireless subnet** as the server.

---

## 3. Environment Naming Convention

Standardizing workspace namespace labels is critical for cross-referencing telemetry logs:

$$\text{nie}-\{\text{building}\}-\{\text{room-type}\}-\{\text{room-number}\}$$

### Naming Examples:
- **Computer Science Lab 201**: `nie-cs-lab-201`
- **Computer Science Classroom 104**: `nie-cs-classroom-104`
- **Main Canteen**: `nie-canteen-main`
- **Library Reading Area**: `nie-library-reading`
- **Common Room (Hostel Block A)**: `nie-hostel-common-a`

---

## 4. Data Collection Protocol

Adhere to these rules to maintain high quality dataset integrity for paper validation:

- **Baseline Passive Window**: Run passive collection for a minimum of **7 days** per environment before introducing event labeling.
- **Physical Node Placement**:
  - Place scanning phones flat on a stable desk or shelf surface.
  - Leave the screen turned off.
  - Keep the phone continuously connected to a power supply.
  - **Do not move** or handle the device during active telemetry sessions.
- **Node Density**: A minimum of **1 phone per room** is required; **2 or more** are highly preferred to enable spatial triangulation.
- **Moment Labeling**: Trigger the floating `TAG` button on the dashboard dashboard to record events immediately when they happen.
- **Events to Watch**:
  - Fire drills
  - Power cut / generator switches
  - Student crowd surges (class change timings)
  - heavy lab equipment cycles
  - Sudden weather fluctuations (heavy rain, high winds)

---

## 5. Weekly Maintenance Checklist

- [ ] **Device Connection Status**: Check all physical phones on the dashboard; confirm the pulsing green `LIVE` badge is active.
- [ ] **Recalculate Baselines**: Trigger daily re-evaluations:
  ```bash
  curl -X POST http://<local-ip>:8000/api/baseline/nie-cs-lab-201/compute
  ```
- [ ] **Export Training CSV**: Retrieve consolidated ground truth datasets for training:
  ```bash
  curl -O http://<local-ip>:8000/api/labels/export/nie-cs-lab-201
  ```
- [ ] **Database Backups**: Extract complete TimescaleDB backups weekly:
  ```bash
  docker-compose exec timescaledb pg_dump -U phantom phantomdb > backup-$(date +%F).sql
  ```
- [ ] **Tune Thresholds**: Review the alert logs and adapt baseline standard deviation scales if false positive rates drift above tolerance.

---

## 6. Paper Validation Target Metrics

- **Minimum Labeled Events**: 15 real event tags across 3+ distinct environment types.
- **Baseline Telemetry Volume**: Minimum 30 days of continuous baseline telemetry per environment.
- **Target False Positive Rate**: Under 5.0% during nominal periods.
- **Early Warning Lead Time**: Average target lead time exceeding **3.0 minutes** between initial signal drift detection and event trigger.
