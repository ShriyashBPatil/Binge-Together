# 🍿 BingeTogether

**BingeTogether** is a lightweight, high-performance college-level watch-party web application built with **Python (FastAPI), SQLite, HTML/CSS/JavaScript, WebSockets, and WebRTC**.

It allows a group of friends to watch YouTube videos or local MP4 files together in real-time with synchronized playback, chunked resumable video uploads, text chat, WebRTC voice/video calls, user profiles, and a complete admin management panel.

> **Zero External Infra:** No Docker, Redis, MySQL, Kafka, or Kubernetes required. Runs directly on a Linux VPS using a local SQLite file database (`data/bingetogether.db`) and local filesystem storage (`uploads/`).

---

## 🌟 Key Features

- 🔐 **Authentication & User Profiles:** Register, sign in with JWT tokens, update email/bio/avatar, and change passwords.
- 🛡️ **Admin Panel (`/api/admin`):**
  - Manage users (edit profiles, change passwords, toggle administrator role, delete accounts).
  - Monitor active watch rooms and live connected participants.
  - Force-close any room on demand.
- 🎬 **Synchronized Watch Parties:**
  - Support for **YouTube videos** (via YouTube IFrame Player API) and **Uploaded MP4 files** (via HTML5 `<video>`).
  - Real-time synchronized **Play, Pause, Seek, and Playback Position** over WebSockets.
  - Host-only control toggle or open room control mode.
  - Room privacy settings with passcode protection and shareable invite links.
- 📤 **Resumable / Chunked MP4 Uploads:**
  - Client-side file slicing into 2MB chunks for fault-tolerant uploads.
  - Stored directly on server hard disk (`uploads/`).
- ⚡ **HTTP Range Video Streaming:**
  - Video endpoint (`/api/media/stream/{file_id}`) supports `206 Partial Content` HTTP Range requests for instant seeking and low RAM footprint.
- 🎙️ **WebRTC Voice & Video Mesh:**
  - Direct peer-to-peer audio/video calling built into watch party rooms with microphone mute and camera toggles.
- 💬 **In-Room Text Chat:**
  - Real-time room messaging with system event notifications (joins, leaves, media changes).

---

## 🚀 Quickstart & Setup Instructions

### 1. Requirements
- **Linux / macOS / Windows**
- **Python 3.9+**

### 2. Installation
Clone or navigate into the project directory and install Python dependencies:
```bash
cd binge-together
pip install -r requirements.txt
```

### 3. Environment Configuration
Create a `.env` file in the root directory (or use `.env.example`):
```env
PORT=6969
SECRET_KEY=bingetogether-college-watchparty-secret-key-2026
DATABASE_URL=sqlite:///./data/bingetogether.db
```

### 4. Running the Application
Launch the server using `run.py`:
```bash
python3 run.py
```
Or directly with Uvicorn:
```bash
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 6969
```

Access the Web Application in your browser:
👉 **`http://localhost:6969`**

---

## 🔑 Default Admin Account

When starting up for the first time on an empty database, BingeTogether automatically seeds a default administrator account:

- **Username:** `admin`
- **Password:** `admin123`

You can sign in with these credentials to access the **🛡️ Admin Panel** in the top navigation bar.

---

## 📁 Project Architecture

```
binge-together/
├── app/
│   ├── auth.py              # Password hashing & JWT dependencies
│   ├── config.py            # Environment configuration & directory paths
│   ├── database.py          # SQLAlchemy SQLite connection engine
│   ├── main.py              # FastAPI app, WebSockets & WebRTC signaling
│   ├── models.py            # SQLite database schema models
│   ├── schemas.py           # Pydantic data schemas
│   ├── ws_manager.py        # WebSocket room connection & signaling manager
│   └── routers/
│       ├── admin.py         # Admin management endpoints
│       ├── auth.py          # Authentication & profile endpoints
│       ├── media.py         # Chunked uploads & HTTP Range streaming
│       └── rooms.py         # Watch party room management
├── data/
│   └── bingetogether.db     # Local SQLite database file (created automatically)
├── static/
│   ├── app.js               # Frontend Single-Page Application logic
│   ├── index.html           # Main HTML structure & modals
│   ├── styles.css           # Vanilla CSS responsive design system
│   └── images/              # Avatars and static assets
├── uploads/                 # Storage for uploaded MP4 files
├── .env                     # Local environment file
├── .env.example             # Example environment file
├── README.md                # Documentation
├── requirements.txt         # Dependencies list
└── run.py                   # Application launcher script
```
