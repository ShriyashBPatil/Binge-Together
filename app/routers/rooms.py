import random
import string
import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.auth import get_current_user, get_current_user_optional
from app.models import User, Room, QueueItem, WatchHistory, Favorite
from app.schemas import (
    RoomCreate, RoomUpdate, RoomResponse, QueueItemCreate, QueueItemUpdate, QueueItemResponse,
    FavoriteCreate, FavoriteResponse, WatchHistoryResponse,
    RoomInviteEmailRequest, RoomInviteEmailResponse
)
from app.email_service import send_room_invite_email
from app.ws_manager import manager

router = APIRouter(prefix="/api/rooms", tags=["rooms"])

def generate_room_code() -> str:
    chars = string.ascii_uppercase + string.digits
    part1 = ''.join(random.choices(chars, k=4))
    part2 = ''.join(random.choices(chars, k=4))
    return f"{part1}-{part2}"

@router.post("", response_model=RoomResponse)
def create_room(
    room_in: RoomCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    code = generate_room_code()
    while db.query(Room).filter(Room.room_code == code).first():
        code = generate_room_code()

    db_room = Room(
        room_code=code,
        name=room_in.name,
        description=room_in.description,
        is_private=room_in.is_private,
        passcode=room_in.passcode if room_in.is_private else None,
        host_id=current_user.id,
        active_video_url=room_in.video_url or "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        active_video_title=room_in.video_title or "Big Buck Bunny / Rick Roll",
        active_video_type=room_in.video_type or "youtube",
        host_only_control=room_in.host_only_control
    )
    db.add(db_room)
    db.commit()
    db.refresh(db_room)

    # Record history
    history = WatchHistory(
        user_id=current_user.id,
        room_code=db_room.room_code,
        room_name=db_room.name
    )
    db.add(history)
    db.commit()

    resp = RoomResponse.model_validate(db_room)
    resp.host_username = current_user.username
    resp.participant_count = 1
    return resp

@router.get("", response_model=List[RoomResponse])
def list_rooms(db: Session = Depends(get_db)):
    # List public rooms or active rooms
    rooms = db.query(Room).order_by(Room.created_at.desc()).all()
    results = []
    for r in rooms:
        resp = RoomResponse.model_validate(r)
        resp.host_username = r.host.username if r.host else "Unknown"
        resp.participant_count = manager.get_participant_count(r.room_code)
        results.append(resp)
    return results

@router.get("/{room_code}", response_model=RoomResponse)
def get_room(
    room_code: str,
    passcode: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    room = db.query(Room).filter(Room.room_code == room_code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    if room.is_private:
        if room.passcode and passcode != room.passcode:
            # If user is host or admin, allow bypass
            if not current_user or (current_user.id != room.host_id and not current_user.is_admin):
                raise HTTPException(status_code=403, detail="Passcode required for private room")

    if current_user:
        # Update watch history
        history = db.query(WatchHistory).filter(
            WatchHistory.user_id == current_user.id,
            WatchHistory.room_code == room.room_code
        ).first()
        if history:
            history.last_watched_at = datetime.datetime.utcnow()
        else:
            history = WatchHistory(
                user_id=current_user.id,
                room_code=room.room_code,
                room_name=room.name
            )
            db.add(history)
        db.commit()

    resp = RoomResponse.model_validate(room)
    resp.host_username = room.host.username if room.host else "Unknown"
    resp.participant_count = manager.get_participant_count(room.room_code)
    return resp

@router.put("/{room_code}", response_model=RoomResponse)
async def update_room(
    room_code: str,
    update_in: RoomUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    room = db.query(Room).filter(Room.room_code == room_code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    if room.host_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only host or admin can modify room settings")

    if update_in.name is not None:
        room.name = update_in.name
    if update_in.description is not None:
        room.description = update_in.description
    if update_in.is_private is not None:
        room.is_private = update_in.is_private
    if update_in.passcode is not None:
        room.passcode = update_in.passcode
    if update_in.active_video_url is not None:
        room.active_video_url = update_in.active_video_url
    if update_in.active_video_title is not None:
        room.active_video_title = update_in.active_video_title
    if update_in.active_video_type is not None:
        room.active_video_type = update_in.active_video_type
    if update_in.current_time is not None:
        room.current_time = update_in.current_time
    if update_in.is_playing is not None:
        room.is_playing = update_in.is_playing
    if update_in.host_only_control is not None:
        room.host_only_control = update_in.host_only_control

    db.commit()
    db.refresh(room)

    # Broadcast room settings update to WebSocket clients
    await manager.broadcast_to_room(room.room_code, {
        "type": "room_settings_updated",
        "is_private": room.is_private,
        "name": room.name
    })

    resp = RoomResponse.model_validate(room)
    resp.host_username = room.host.username if room.host else "Unknown"
    resp.participant_count = manager.get_participant_count(room.room_code)
    return resp

@router.post("/{room_code}/queue", response_model=QueueItemResponse)
def add_to_queue(
    room_code: str,
    item_in: QueueItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    room = db.query(Room).filter(Room.room_code == room_code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    count = db.query(QueueItem).filter(QueueItem.room_id == room.id).count()

    q_item = QueueItem(
        room_id=room.id,
        title=item_in.title,
        video_url=item_in.video_url,
        video_type=item_in.video_type or "youtube",
        added_by_name=current_user.username,
        status=item_in.status or "queued",
        progress=item_in.progress or 0,
        start_time=item_in.start_time or 0.0,
        end_time=item_in.end_time or 0.0,
        order_index=count
    )
    db.add(q_item)
    db.commit()
    db.refresh(q_item)

    return QueueItemResponse.model_validate(q_item)

@router.put("/{room_code}/queue/{item_id}", response_model=QueueItemResponse)
def update_queue_item(
    room_code: str,
    item_id: int,
    item_in: QueueItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    room = db.query(Room).filter(Room.room_code == room_code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    q_item = db.query(QueueItem).filter(QueueItem.id == item_id, QueueItem.room_id == room.id).first()
    if not q_item:
        raise HTTPException(status_code=404, detail="Queue item not found")

    if item_in.status is not None:
        q_item.status = item_in.status
    if item_in.progress is not None:
        q_item.progress = item_in.progress
    if item_in.title:
        q_item.title = item_in.title
    if item_in.video_url:
        q_item.video_url = item_in.video_url
    if item_in.start_time is not None:
        q_item.start_time = item_in.start_time
    if item_in.end_time is not None:
        q_item.end_time = item_in.end_time

    db.commit()
    db.refresh(q_item)
    return QueueItemResponse.model_validate(q_item)

@router.delete("/{room_code}/queue")
def clear_room_queue(
    room_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    room = db.query(Room).filter(Room.room_code == room_code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    if room.host_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only host or admin can clear the queue")

    db.query(QueueItem).filter(QueueItem.room_id == room.id).delete()
    db.commit()
    return {"status": "success", "message": "Queue cleared"}

@router.delete("/{room_code}/queue/{item_id}")
def remove_from_queue(
    room_code: str,
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    room = db.query(Room).filter(Room.room_code == room_code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    q_item = db.query(QueueItem).filter(QueueItem.id == item_id, QueueItem.room_id == room.id).first()
    if not q_item:
        raise HTTPException(status_code=404, detail="Queue item not found")

    db.delete(q_item)
    db.commit()
    return {"status": "success", "message": "Item removed from queue"}

@router.post("/{room_code}/invite-email", response_model=RoomInviteEmailResponse)
def invite_friends_email(
    room_code: str,
    invite_data: RoomInviteEmailRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    room = db.query(Room).filter(Room.room_code == room_code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    if not invite_data.emails or len(invite_data.emails) == 0:
        raise HTTPException(status_code=400, detail="Please provide at least one recipient email address")

    # Determine inviter name
    inviter_name = "A friend"
    if current_user and current_user.username:
        inviter_name = current_user.username
    elif invite_data.inviter_name:
        inviter_name = invite_data.inviter_name.strip()
    elif room.host and room.host.username:
        inviter_name = room.host.username

    passcode = room.passcode if room.is_private else None

    sent_count = send_room_invite_email(
        to_emails=invite_data.emails,
        room_name=room.name,
        room_code=room.room_code,
        passcode=passcode,
        inviter_name=inviter_name,
        custom_message=invite_data.custom_message,
        db=db
    )

    if sent_count == 0:
        raise HTTPException(status_code=400, detail="No valid recipient email addresses found")

    return RoomInviteEmailResponse(
        success=True,
        sent_count=sent_count,
        message=f"Invitation sent to {sent_count} recipient{'s' if sent_count != 1 else ''}!"
    )
