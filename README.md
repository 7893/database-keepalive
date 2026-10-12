# 🚀 Database Keepalive

[![Go Version](https://img.shields.io/badge/Go-1.27+-00ADD8?style=flat&logo=go)](go.mod)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero%20(Pure%20Go)-success)](go.mod)
[![Build Matrix](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)](.github/workflows/ci.yml)

**Database Keepalive** is a lightweight, zero-dependency, pure Go daemon and CLI tool engineered to prevent free-tier cloud databases from being paused, suspended, or terminated due to inactivity.

It executes natural, randomized check-ins across multiple cloud providers and presents a mobile-first, responsive activity dashboard.

---

## 💡 Why Database Keepalive?

Many cloud providers offer generous **Always Free** database tiers (e.g., Supabase, Oracle Cloud Autonomous Database, MySQL HeatWave), but enforce aggressive inactivity suspension policies (pausing projects after days of idle time).

Traditional workarounds often rely on complex hyperscaler infrastructure (such as GCP Cloud Run + Cloud Scheduler + Artifact Registry + billing cards), introducing billing hazards, vendor lock-in, and maintenance fatigue.

**Database Keepalive solves this cleanly:**
- **Zero Cloud Overhead**: Runs directly as a static binary on any modest VPS, home server, Raspberry Pi, or container (consuming **< 15 MB RAM**).
- **Natural Activity Simulation**: Disperses check-ins with second-level jitter (`HH:MM:SS`) to prevent robotic detection.
- **Set and Forget**: Native systemd integration and automated GitHub Actions deployment. Install once, leave it running stably for years.

---

## 🌟 Key Features

- ⚡ **Pure Go & Zero Runtime Dependencies**: Compiled with `CGO_ENABLED=0`. Single self-contained executable with no external libraries or shared C dependencies.
- 🗄️ **Multi-Cloud Database Matrix**:
  - **Supabase Database**: Uses standard PostgREST API with service tokens.
  - **Oracle Cloud Autonomous Database (ADB)**: Native ORDS REST SQL endpoint integration.
  - **MySQL Database**: Pure Go TCP driver with built-in Cloudflare Access TCP Tunnel support for private subnets.
- 🌐 **Arbitrary Instances & Global Regions**: Manage 1, 4, or 20+ database instances across different cloud accounts and geographical regions simultaneously.
- ⏰ **Natural, Flexible Scheduling**:
  - **Fixed daily count**: e.g. exactly 2 check-ins per day.
  - **Randomized daily range**: e.g. 1–5 check-ins per day (auto-rolled every midnight).
  - Every check-in is randomly scheduled down to the exact **Hour, Minute, and Second**.
  - Local host timezone default or configurable IANA timezone.
- 📱 **Mobile-First Responsive Dashboard**:
  - Embedded zero-dependency HTML/CSS dashboard with native dark mode support.
  - Auto-fit responsive card grid (single column on smartphones, multi-column on desktop).
  - Queries remote database history live upon page request to generate authentic read activity.
  - Interactive **"⚡ Trigger Check-in"** touch button with instant visual feedback.
- 🔒 **Enterprise-Grade Secrets Isolation**:
  - Development and deployment credentials remain strictly separated.
  - Database credentials never enter Git, CI logs, or public repositories.

---

## 🚀 Quick Start (Under 1 Minute)

### 1. Clone and Prepare Config
```bash
git clone https://github.com/7893/database-keepalive.git
cd database-keepalive
cp config.example.yaml config.yaml
```

### 2. Configure Your Databases
Edit `config.yaml` with your database credentials (supports environment variable expansion like `${DB_PASS}`):
```yaml
server:
  listen: ":8080"
  title: "Database Keepalive"

schedule:
  min: 1
  max: 3
  timezone: "Local"

instances:
  - id: supabase_prod
    type: supabase
    name: "Supabase Main"
    region: "🇸🇬 Singapore"
    url: "https://your-project.supabase.co"
    key: "your-supabase-secret-key"

  - id: adb_us
    type: oracle
    name: "Oracle ADB (US)"
    region: "🇺🇸 US Ashburn"
    url: "https://xxx.adb.us-ashburn-1.oraclecloudapps.com/ords/admin"
    user: "ADMIN"
    password: "YourStrongPassword123#"

  - id: mysql_jp
    type: mysql
    name: "MySQL HeatWave"
    region: "🇯🇵 Japan Osaka"
    host: "10.0.1.25"
    port: 3306
    user: "admin"
    password: "YourStrongPassword123#"
    database: "keepalive"
```

### 3. Run
```bash
# Run immediately with Go
go run .

# Or build the static binary
make build
./database-keepalive
```
Open **`http://localhost:8080`** in any desktop or mobile browser.

---

## 📖 Operational Modes

Database Keepalive provides dual execution modes to fit any infrastructure preference:

### Mode 1: Autonomous Daemon (Recommended)
Runs as a persistent daemon with internal scheduling and the interactive web dashboard:
```bash
./database-keepalive daemon
```

### Mode 2: CLI One-Shot Check-in
Executes a single concurrent check-in against all configured databases and exits immediately (ideal for Linux `crontab` or Kubernetes CronJobs):
```bash
./database-keepalive tick
```

### Mode 3: Web Dashboard Only
Launches the HTTP web server for monitoring without initiating scheduled background check-ins:
```bash
./database-keepalive serve --port 8080
```

---

## ⚙️ Configuration Reference

| Section | Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| **`server`** | `listen` | string | `":8080"` | HTTP server listening address |
| | `title` | string | `"Database Keepalive"` | Web dashboard header title |
| **`schedule`** | `count` | int | `0` (disabled) | Fixed daily check-ins (e.g. `2`) |
| | `min` / `max` | int | `1` / `3` | Randomized daily check-in bounds |
| | `timezone` | string | `"Local"` | Host local time or IANA name (e.g. `"UTC"`, `"Asia/Shanghai"`) |
| **`instances`** | `id` | string | required | Unique identifier for the database instance |
| | `type` | string | required | `supabase`, `oracle`, or `mysql` |
| | `name` | string | required | Human-readable label displayed on the dashboard |
| | `region` | string | optional | Location badge displayed on instance cards |
| | `tunnel` | object | optional | Cloudflare Access TCP Tunnel configuration for private subnets |

---

## 🛠️ Production Deployment

### Option 1: Native Systemd Service (Bare VM / VPS)

1. Cross-compile for Linux x86_64:
```bash
make build-amd64
```

2. Deploy directly via the automated deployment script:
```bash
./scripts/deploy.sh <target-host>
```

The script automatically uploads the binary to `/usr/local/bin/database-keepalive`, synchronizes the configuration to `/etc/database-keepalive/config.yaml` (`chmod 600`), and establishes a persistent `systemd` daemon.

### Option 2: Automated Deployment via GitHub Actions

This repository includes two production workflows:
1. **[`.github/workflows/ci.yml`](.github/workflows/ci.yml)**: Tests code and builds cross-platform binaries across Linux (`amd64`/`arm64`), macOS (`arm64`), and Windows (`amd64`). Completely open-source safe with zero credentials required.
2. **[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)**: Securely builds and updates the binary on your remote server via SSH.

#### Required GitHub Secrets for CD:
- `DEPLOY_HOST`: Target server public IP or hostname.
- `DEPLOY_USER`: SSH login username (e.g. `admin`).
- `DEPLOY_SSH_KEY`: Private SSH deployment key.

> **Security Note**: Database passwords reside exclusively in `/etc/database-keepalive/config.yaml` on your target server. GitHub Actions never receives or exposes your database credentials.

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more details.
