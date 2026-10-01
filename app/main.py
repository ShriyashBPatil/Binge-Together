import json
import jwt
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Query, HTTPException, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.config import settings
from app.database import engine, Base, SessionLocal, get_db
from app.models import User, Room, ChatMessage
from app.auth import hash_password
from app.ws_manager import manager

from app.routers import auth, rooms, media, admin

# Create tables in SQLite database
Base.metadata.create_all(bind=engine)

def run_sqlite_migrations():
    import sqlite3
    try:
        conn = sqlite3.connect(settings.DB_PATH)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(uploaded_videos);")
        columns = [row[1] for row in cursor.fetchall()]
        if columns:
            if "uploaded_size" not in columns:
                cursor.execute("ALTER TABLE uploaded_videos ADD COLUMN uploaded_size BIGINT DEFAULT 0;")
            if "is_complete" not in columns:
                cursor.execute("ALTER TABLE uploaded_videos ADD COLUMN is_complete BOOLEAN DEFAULT 0;")
            conn.commit()

        cursor.execute("PRAGMA table_info(queue_items);")
        q_cols = [row[1] for row in cursor.fetchall()]
        if q_cols:
            if "status" not in q_cols:
                cursor.execute("ALTER TABLE queue_items ADD COLUMN status VARCHAR(20) DEFAULT 'queued';")
            if "progress" not in q_cols:
                cursor.execute("ALTER TABLE queue_items ADD COLUMN progress INTEGER DEFAULT 0;")
            if "start_time" not in q_cols:
                cursor.execute("ALTER TABLE queue_items ADD COLUMN start_time FLOAT DEFAULT 0.0;")
            if "end_time" not in q_cols:
                cursor.execute("ALTER TABLE queue_items ADD COLUMN end_time FLOAT DEFAULT 0.0;")
            conn.commit()
        conn.close()
    except Exception as e:
        print("Migration notice:", e)

run_sqlite_migrations()

# Seed initial admin user if database is empty
def seed_initial_admin():
    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            admin_user = User(
                username="admin",
                email="admin@bingetogether.local",
                password_hash=hash_password("admin123"),
                avatar_url="https://api.dicebear.com/7.x/bottts/svg?seed=admin",
                bio="BingeTogether System Administrator",
                is_admin=True
            )
            db.add(admin_user)
            db.commit()
            print("INFO:     Default admin account created (Username: admin, Password: admin123)")
    finally:
        db.close()

seed_initial_admin()

app = FastAPI(title=settings.PROJECT_NAME)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(auth.router)
app.include_router(rooms.router)
app.include_router(media.router)
app.include_router(admin.router)

# Mount Static Files
static_path = settings.BASE_DIR / "static"
static_path.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_path)), name="static")

@app.websocket("/ws/room/{room_code}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_code: str,
    token: str = Query(None),
    guest_name: str = Query(None),
    guest_avatar: str = Query(None),
    stealth: bool = Query(False)
):
    db = SessionLocal()
    user_id = f"guest_{id(websocket)}"
    username = guest_name or f"Guest-{user_id[-4:]}"
    avatar_url = guest_avatar or f"https://api.dicebear.com/7.x/bottts/svg?seed={username}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf"
    is_host = False
    is_admin = False
    is_stealth = False

    # Authenticate token if present
    if token:
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            user_sub = payload.get("sub")
            if user_sub:
                user = db.query(User).filter(User.username == user_sub).first()
                if user:
                    user_id = str(user.id)
                    username = user.username
                    avatar_url = user.avatar_url or avatar_url
                    is_admin = bool(user.is_admin)
                    if is_admin and stealth:
                        is_stealth = True
        except Exception:
            pass

    # Check room in database
    db_room = db.query(Room).filter(Room.room_code == room_code).first()
    if not db_room:
        await websocket.close(code=4004, reason="Room not found")
        db.close()
        return

    if str(db_room.host_id) == str(user_id):
        is_host = True

    # Connect WebSocket
    conn = await manager.connect(
        room_code=room_code,
        websocket=websocket,
        user_id=user_id,
        username=username,
        avatar_url=avatar_url,
        is_host=is_host,
        is_admin=is_admin,
        is_stealth=is_stealth
    )

    try:
        # Send initial room state & past chat messages
        past_messages = db.query(ChatMessage).filter(
            ChatMessage.room_code == room_code
        ).order_by(ChatMessage.created_at.asc()).limit(50).all()

        history_payload = [
            {
                "type": "chat_message",
                "id": msg.id,
                "user_id": msg.user_id,
                "username": msg.username,
                "avatar_url": msg.avatar_url,
                "content": msg.content,
                "is_system": msg.is_system,
                "timestamp": msg.created_at.strftime("%H:%M")
            }
            for msg in past_messages
        ]

        queue_payload = [
            {
                "id": q.id,
                "title": q.title,
                "video_url": q.video_url,
                "video_type": q.video_type,
                "added_by_name": q.added_by_name,
                "status": q.status or "queued",
                "progress": q.progress or 0,
                "start_time": q.start_time or 0.0,
                "end_time": q.end_time or 0.0,
                "order_index": q.order_index
            }
            for q in db_room.queue_items
        ]

        # Use live in-memory room state if available, else database
        live_state = manager.room_states.get(room_code)
        init_current_time = live_state.get("current_time", db_room.current_time) if live_state else db_room.current_time
        init_is_playing = live_state.get("is_playing", db_room.is_playing) if live_state else db_room.is_playing
        init_video_url = live_state.get("video_url", db_room.active_video_url) if live_state else db_room.active_video_url
        init_video_title = live_state.get("video_title", db_room.active_video_title) if live_state else db_room.active_video_title
        init_video_type = live_state.get("video_type", db_room.active_video_type) if live_state else db_room.active_video_type

        await websocket.send_json({
            "type": "room_init",
            "room_code": room_code,
            "room_name": db_room.name,
            "user_id": user_id,
            "is_host": is_host,
            "active_video_url": init_video_url,
            "active_video_title": init_video_title,
            "active_video_type": init_video_type,
            "current_time": init_current_time,
            "is_playing": init_is_playing,
            "host_only_control": db_room.host_only_control,
            "chat_history": history_payload,
            "queue_items": queue_payload
        })

        while True:
            data_str = await websocket.receive_text()
            try:
                msg = json.loads(data_str)
            except Exception:
                continue

            msg_type = msg.get("type")

            # --- Queue Broadcasting ---
            if msg_type in ["queue_update", "queue_broadcast"]:
                db.refresh(db_room)
                queue_payload = [
                    {
                        "id": q.id,
                        "title": q.title,
                        "video_url": q.video_url,
                        "video_type": q.video_type,
                        "added_by_name": q.added_by_name,
                        "status": q.status or "queued",
                        "progress": q.progress or 0,
                        "start_time": q.start_time or 0.0,
                        "end_time": q.end_time or 0.0,
                        "order_index": q.order_index
                    }
                    for q in db_room.queue_items
                ]
                await manager.broadcast_to_room(room_code, {
                    "type": "queue_update",
                    "queue_items": queue_payload
                })
                continue

            # --- Synchronized Playback Control ---
            if msg_type == "request_sync":
                # Ask host for live position while sending current known state to requestor
                live_state = manager.room_states.get(room_code)
                cur_t = live_state.get("current_time", db_room.current_time) if live_state else db_room.current_time
                cur_p = live_state.get("is_playing", db_room.is_playing) if live_state else db_room.is_playing
                await manager.broadcast_to_room(room_code, {
                    "type": "request_sync_from_host",
                    "requestor_id": user_id
                }, sender_ws=websocket)
                await websocket.send_json({
                    "type": "host_sync_response",
                    "time": cur_t,
                    "is_playing": cur_p,
                    "sender_id": "system"
                })
                continue

            elif msg_type == "host_sync_broadcast":
                # Host broadcasting current live playback position to room
                event_time = float(msg.get("time", 0.0))
                is_playing = bool(msg.get("is_playing", False))
                manager.room_states[room_code] = {
                    "current_time": event_time,
                    "is_playing": is_playing,
                    "video_url": db_room.active_video_url,
                    "video_title": db_room.active_video_title,
                    "video_type": db_room.active_video_type,
                }
                db_room.current_time = event_time
                db_room.is_playing = is_playing
                db.commit()

                await manager.broadcast_to_room(room_code, {
                    "type": "host_sync_response",
                    "time": event_time,
                    "is_playing": is_playing,
                    "sender_id": user_id
                }, sender_ws=websocket)
                continue

            elif msg_type in ["playback_play", "playback_pause", "playback_seek"]:
                # Check host permissions if host_only_control is enabled
                if db_room.host_only_control and not is_host:
                    await websocket.send_json({
                        "type": "system_error",
                        "message": "Only the host can control playback in this room."
                    })
                    continue

                event_time = float(msg.get("time", 0.0))
                db_room.current_time = event_time
                if msg_type == "playback_play":
                    db_room.is_playing = True
                elif msg_type == "playback_pause":
                    db_room.is_playing = False
                db.commit()

                manager.room_states[room_code] = {
                    "current_time": event_time,
                    "is_playing": db_room.is_playing,
                    "video_url": db_room.active_video_url,
                    "video_title": db_room.active_video_title,
                    "video_type": db_room.active_video_type,
                }

                msg["sender_id"] = user_id
                msg["sender_name"] = username
                await manager.broadcast_to_room(room_code, msg, sender_ws=websocket)

            elif msg_type == "change_video":
                if db_room.host_only_control and not is_host:
                    await websocket.send_json({
                        "type": "system_error",
                        "message": "Only the host can change the video in this room."
                    })
                    continue

                new_url = msg.get("video_url")
                new_title = msg.get("video_title", "Untitled Video")
                new_type = msg.get("video_type", "youtube")

                db_room.active_video_url = new_url
                db_room.active_video_title = new_title
                db_room.active_video_type = new_type
                db_room.current_time = 0.0
                db_room.is_playing = False
                db.commit()

                manager.room_states[room_code] = {
                    "current_time": 0.0,
                    "is_playing": False,
                    "video_url": new_url,
                    "video_title": new_title,
                    "video_type": new_type,
                }

                await manager.broadcast_to_room(room_code, {
                    "type": "change_video",
                    "video_url": new_url,
                    "video_title": new_title,
                    "video_type": new_type,
                    "sender_name": username
                })
                await manager.broadcast_system_message(room_code, f"**{username}** loaded new video: *{new_title}*")

            # --- Chat Messaging ---
            elif msg_type == "chat_message":
                content = msg.get("content", "").strip()
                if content:
                    chat_db = ChatMessage(
                        room_code=room_code,
                        user_id=user.id if token and 'user' in locals() and user else None,
                        username=username,
                        avatar_url=avatar_url,
                        content=content,
                        is_system=False
                    )
                    db.add(chat_db)
                    db.commit()
                    db.refresh(chat_db)

                    await manager.broadcast_to_room(room_code, {
                        "type": "chat_message",
                        "id": chat_db.id,
                        "user_id": user_id,
                        "username": username,
                        "avatar_url": avatar_url,
                        "content": content,
                        "is_system": False,
                        "timestamp": chat_db.created_at.strftime("%H:%M")
                    })

            # --- Peer State Updates (Mic / Cam) ---
            elif msg_type == "peer_state_change":
                conn.mic_muted = bool(msg.get("mic_muted"))
                conn.cam_off = bool(msg.get("cam_off"))
                await manager.broadcast_participants(room_code)

            # --- WebRTC Signaling for P2P Mesh Audio/Video ---
            elif msg_type == "webrtc_request_peers":
                # Send list of all existing participants (except self) so client can initiate connections
                peers = [
                    {"user_id": c.user_id, "username": c.username, "avatar_url": c.avatar_url}
                    for c in manager.rooms.get(room_code, []) if c.user_id != user_id
                ]
                await websocket.send_json({
                    "type": "webrtc_peers_list",
                    "peers": peers
                })

            elif msg_type in ["webrtc_offer", "webrtc_answer", "webrtc_candidate"]:
                target_id = msg.get("target_id")
                if target_id:
                    msg["sender_id"] = user_id
                    msg["sender_name"] = username
                    await manager.send_to_user(room_code, target_id, msg)

    except WebSocketDisconnect:
        left_user, was_host, left_id, was_stealth = manager.disconnect(room_code, websocket)
        if not was_stealth:
            await manager.broadcast_participants(room_code)
            await manager.broadcast_system_message(room_code, f"**{left_user}** left the room.")
            # Broadcast peer disconnected to WebRTC handlers
            await manager.broadcast_to_room(room_code, {
                "type": "webrtc_peer_disconnected",
                "peer_id": left_id
            })
        else:
            await manager.broadcast_participants(room_code)
    finally:
        db.close()

# SPA HTML Route Handler
@app.get("/{full_path:path}")
def serve_spa(full_path: str):
    # Allow API and Static requests to pass through
    if full_path.startswith("api/") or full_path.startswith("static/"):
        raise HTTPException(status_code=404)
    
    index_file = settings.BASE_DIR / "static" / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return HTMLResponse("<h1>BingeTogether Server Running</h1>")
