# 🚀 Database Keepalive

[![CI](https://github.com/7893/database-keepalive/actions/workflows/ci.yml/badge.svg)](https://github.com/7893/database-keepalive/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A lightweight, zero-dependency Go service for scheduled multi-cloud database keepalive check-ins and an interactive responsive status dashboard.

Designed specifically to prevent idle databases (such as Supabase, Oracle Cloud Free Tier Autonomous Databases, and MySQL) from being paused, suspended, or reclaimed due to inactivity.

---

## 🌟 Key Highlights

- ⚡ **Zero External Dependencies**: Pure Go with `CGO_ENABLED=0` static compilation. Runs seamlessly on any Linux distribution, macOS, Windows, or Docker without external runtime packages.
- 🗄️ **Multi-Cloud Database Matrix**:
  - **Supabase Database** (PostgREST API)
  - **Oracle Cloud Autonomous Database (ADB)** (ORDS REST SQL)
  - **MySQL Database** (Direct TCP or Cloudflare Access TCP Tunnel)
- 🌐 **Arbitrary Instances & Global Regions**: Configure 1, 4, or 20+ instances across any global cloud regions without code changes.
- ⏰ **Smart Natural Scheduling**:
  - Supports **fixed daily counts** (e.g. exactly 2 check-ins per day) or **randomized daily ranges** (e.g. 1–5 check-ins per day).
  - Check-in timestamps feature **randomized Hours, Minutes, and Seconds** (`HH:MM:SS`) distributed across the day to simulate natural human activity.
  - Native timezone support (defaults to system local time).
- 📱 **Mobile-First Responsive Dashboard**:
  - Live activity status, latency, and recent database history logs.
  - Auto-fit responsive grid layout (1 column on mobile phones, 2–4 columns on desktops).
  - Native dark mode support (`prefers-color-scheme`).
  - Interactive "⚡ Trigger Check-in" button with instant feedback.
- 🛠️ **Dual-Mode Operation**:
  - **Daemon mode**: Auto-schedules keepalive check-ins and serves the dashboard.
  - **CLI `tick` mode**: Executes a single-shot check-in and exits, ideal for Linux `crontab` or `systemd.timer`.

---

## 🚀 Quick Start (Under 1 Minute)

### 1. Clone & Setup
```bash
git clone https://github.com/7893/database-keepalive.git
cd database-keepalive
cp config.example.yaml config.yaml
```

### 2. Configure Credentials
Edit `config.yaml` with your database credentials (supports environment variable expansion like `${MY_PASS}`):
```yaml
server:
  listen: ":8080"
  title: "Database Keepalive"

schedule:
  min: 1
  max: 3
  timezone: "Local"

instances:
  - id: supabase
    type: supabase
    name: "Supabase Main"
    region: "🇸🇬 Singapore"
    url: "https://your-project.supabase.co"
    key: "your-api-key"

  - id: adb_us
    type: oracle
    name: "Oracle ADB (US East)"
    region: "🇺🇸 US Ashburn"
    url: "https://xxx.adb.us-ashburn-1.oraclecloudapps.com/ords/admin"
    user: "ADMIN"
    password: "your-password"

  - id: mysql_prod
    type: mysql
    name: "MySQL HeatWave"
    region: "🇯🇵 Japan Osaka"
    host: "10.0.1.25"
    port: 3306
    user: "admin"
    password: "your-password"
    database: "keepalive"
```

### 3. Run
```bash
go run .
# or build single binary:
make build
./database-keepalive
```
Open **`http://localhost:8080`** in your browser or smartphone.

---

## 📖 CLI Usage

```bash
# Daemon mode (built-in autonomous scheduler + web dashboard)
./database-keepalive daemon

# Single-shot check-in (ideal for crontab or CI jobs)
./database-keepalive tick

# Web dashboard only
./database-keepalive serve --port 8080
```

---

## 🛠️ Automated Deployment

### One-Command Deployment to Remote VM
Using the provided cross-compilation deployment script:
```bash
# Cross-compiles linux/amd64 static binary on development machine
# and installs/restarts systemd service on remote host:
./scripts/deploy.sh <target-host>
```

### GitHub Actions CI/CD
This repository includes:
1. `.github/workflows/ci.yml`: Tests code and builds multi-architecture binaries (Linux amd64/arm64, macOS, Windows) without requiring any production secrets.
2. `.github/workflows/deploy.yml`: Securely deploys the latest binary to your remote server via SSH without exposing database credentials to GitHub.

---

## 📄 License

MIT License.
