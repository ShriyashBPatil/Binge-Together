import json
import logging
from typing import Dict, List, Any, Optional
from fastapi import WebSocket

logger = logging.getLogger("bingetogether.ws")

class RoomConnection:
    def __init__(
        self,
        websocket: WebSocket,
        user_id: str,
        username: str,
        avatar_url: str,
        is_host: bool = False,
        is_admin: bool = False,
        is_stealth: bool = False
    ):
        self.websocket = websocket
        self.user_id = str(user_id)
        self.username = username
        self.avatar_url = avatar_url or f"https://api.dicebear.com/7.x/bottts/svg?seed={username}"
        self.is_host = is_host
        self.is_admin = is_admin
        self.is_stealth = is_stealth
        self.mic_muted = True if is_stealth else False
        self.cam_off = True if is_stealth else False

class ConnectionManager:
    def __init__(self):
        # room_code -> List[RoomConnection]
        self.rooms: Dict[str, List[RoomConnection]] = {}
        # room_code -> state dict {is_playing, current_time, video_url, video_title, video_type, last_update_timestamp}
        self.room_states: Dict[str, Dict[str, Any]] = {}

    async def connect(
        self,
        room_code: str,
        websocket: WebSocket,
        user_id: str,
        username: str,
        avatar_url: str,
        is_host: bool = False,
        is_admin: bool = False,
        is_stealth: bool = False
    ) -> RoomConnection:
        await websocket.accept()
        connection = RoomConnection(websocket, str(user_id), username, avatar_url, is_host, is_admin, is_stealth)
        
        if room_code not in self.rooms:
            self.rooms[room_code] = []
        self.rooms[room_code].append(connection)

        if not is_stealth:
            # Broadcast participant join to public
            await self.broadcast_participants(room_code)
            await self.broadcast_system_message(room_code, f"**{username}** joined the watch party! 🎉")
        else:
            # Stealth mode eavesdropping: do not broadcast join to public, send stealth confirmation
            await websocket.send_json({
                "type": "stealth_status",
                "is_stealth": True,
                "message": "Ghost / Eavesdrop Mode Active: You are invisible to other room members."
            })
            await self.send_participants_to_connection(room_code, connection)
        
        return connection

    def disconnect(self, room_code: str, websocket: WebSocket) -> tuple[str, bool, str, bool]:
        username = "Someone"
        was_host = False
        user_id = ""
        was_stealth = False
        if room_code in self.rooms:
            conn_to_remove = None
            for conn in self.rooms[room_code]:
                if conn.websocket == websocket:
                    conn_to_remove = conn
                    username = conn.username
                    was_host = conn.is_host
                    user_id = conn.user_id
                    was_stealth = conn.is_stealth
                    break
            if conn_to_remove:
                self.rooms[room_code].remove(conn_to_remove)
            
            if not self.rooms[room_code]:
                del self.rooms[room_code]
                if room_code in self.room_states:
                    del self.room_states[room_code]
        return username, was_host, user_id, was_stealth

    async def broadcast_to_room(self, room_code: str, message: dict, sender_ws: WebSocket = None):
        if room_code not in self.rooms:
            return
        
        payload = json.dumps(message)
        disconnected = []
        for conn in self.rooms[room_code]:
            if sender_ws and conn.websocket == sender_ws:
                continue
            try:
                await conn.websocket.send_text(payload)
            except Exception as e:
                logger.error(f"Error sending ws message to {conn.username}: {e}")
                disconnected.append(conn.websocket)

        for ws in disconnected:
            self.disconnect(room_code, ws)

    async def send_to_user(self, room_code: str, target_user_id: str, message: dict):
        if room_code not in self.rooms:
            return
        payload = json.dumps(message)
        for conn in self.rooms[room_code]:
            if conn.user_id == str(target_user_id):
                try:
                    await conn.websocket.send_text(payload)
                except Exception as e:
                    logger.error(f"Error sending direct ws message to {conn.username}: {e}")
                break

    async def send_participants_to_connection(self, room_code: str, target_conn: RoomConnection):
        if room_code not in self.rooms:
            return
        plist = [
            {
                "user_id": conn.user_id,
                "username": f"{conn.username} (Ghost)" if conn.is_stealth else conn.username,
                "avatar_url": conn.avatar_url,
                "is_host": conn.is_host,
                "is_stealth": conn.is_stealth,
                "mic_muted": conn.mic_muted,
                "cam_off": conn.cam_off
            }
            for conn in self.rooms[room_code]
        ]
        public_count = len([c for c in self.rooms[room_code] if not c.is_stealth])
        try:
            await target_conn.websocket.send_json({
                "type": "participants_update",
                "participants": plist,
                "count": public_count
            })
        except Exception:
            pass

    async def broadcast_participants(self, room_code: str):
        if room_code not in self.rooms:
            return
        
        public_participants = [
            {
                "user_id": conn.user_id,
                "username": conn.username,
                "avatar_url": conn.avatar_url,
                "is_host": conn.is_host,
                "mic_muted": conn.mic_muted,
                "cam_off": conn.cam_off
            }
            for conn in self.rooms[room_code]
            if not conn.is_stealth
        ]
        
        admin_participants = [
            {
                "user_id": conn.user_id,
                "username": f"{conn.username} (Ghost)" if conn.is_stealth else conn.username,
                "avatar_url": conn.avatar_url,
                "is_host": conn.is_host,
                "is_stealth": conn.is_stealth,
                "mic_muted": conn.mic_muted,
                "cam_off": conn.cam_off
            }
            for conn in self.rooms[room_code]
        ]
        
        for conn in list(self.rooms[room_code]):
            try:
                plist = admin_participants if conn.is_admin else public_participants
                await conn.websocket.send_json({
                    "type": "participants_update",
                    "participants": plist,
                    "count": len(public_participants)
                })
            except Exception:
                pass

    async def broadcast_system_message(self, room_code: str, content: str):
        await self.broadcast_to_room(room_code, {
            "type": "chat_message",
            "is_system": True,
            "username": "BingeBot",
            "avatar_url": "/static/images/bot_avatar.svg",
            "content": content,
            "timestamp": None
        })

    def get_participant_count(self, room_code: str) -> int:
        # Do not include stealth eavesdroppers in public counts
        return len([c for c in self.rooms.get(room_code, []) if not c.is_stealth])

    def get_room_members_info(self, room_code: str) -> List[dict]:
        if room_code not in self.rooms:
            return []
        return [
            {
                "user_id": conn.user_id,
                "username": f"{conn.username} (Ghost)" if conn.is_stealth else conn.username,
                "avatar_url": conn.avatar_url,
                "is_host": conn.is_host,
                "is_stealth": conn.is_stealth
            }
            for conn in self.rooms[room_code]
        ]

    async def force_close_room(self, room_code: str):
        if room_code in self.rooms:
            await self.broadcast_to_room(room_code, {
                "type": "room_closed",
                "message": "This room has been closed by an administrator."
            })
            for conn in list(self.rooms[room_code]):
                try:
                    await conn.websocket.close(code=1000)
                except Exception:
                    pass
            if room_code in self.rooms:
                del self.rooms[room_code]
            if room_code in self.room_states:
                del self.room_states[room_code]

manager = ConnectionManager()
