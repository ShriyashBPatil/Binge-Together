from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.auth import get_admin_user, hash_password
from app.models import User, Room, UploadedVideo
from app.schemas import (
    UserResponse, AdminUserUpdate, AdminRoomDetailResponse, AdminRoomMemberInfo
)
from app.ws_manager import manager

router = APIRouter(prefix="/api/admin", tags=["admin"])

@router.get("/users", response_model=List[UserResponse])
def get_all_users(
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    users = db.query(User).order_by(User.id.desc()).all()
    return [UserResponse.model_validate(u) for u in users]

@router.put("/users/{user_id}", response_model=UserResponse)
def update_user_as_admin(
    user_id: int,
    user_in: AdminUserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user_in.username:
        existing = db.query(User).filter(User.username == user_in.username, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already in use")
        user.username = user_in.username

    if user_in.email:
        existing = db.query(User).filter(User.email == user_in.email, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")
        user.email = user_in.email

    if user_in.avatar_url is not None:
        user.avatar_url = user_in.avatar_url

    if user_in.bio is not None:
        user.bio = user_in.bio

    if user_in.is_admin is not None:
        # Prevent demoting self if sole admin
        if user.id == admin.id and not user_in.is_admin:
            admin_count = db.query(User).filter(User.is_admin == True).count()
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot demote the only administrator")
        user.is_admin = user_in.is_admin

    if user_in.new_password:
        user.password_hash = hash_password(user_in.new_password)

    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)

@router.delete("/users/{user_id}")
def delete_user_as_admin(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    db.delete(user)
    db.commit()
    return {"status": "success", "message": f"User {user.username} deleted"}

@router.get("/rooms/active", response_model=List[AdminRoomDetailResponse])
def monitor_active_rooms(
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    all_rooms = db.query(Room).order_by(Room.created_at.desc()).all()
    results = []
    
    for r in all_rooms:
        members_data = manager.get_room_members_info(r.room_code)
        members = [
            AdminRoomMemberInfo(
                user_id=m["user_id"],
                username=m["username"],
                avatar_url=m["avatar_url"],
                is_host=m["is_host"]
            ) for m in members_data
        ]
        
        results.append(AdminRoomDetailResponse(
            id=r.id,
            room_code=r.room_code,
            name=r.name,
            is_private=r.is_private,
            host_id=r.host_id,
            host_username=r.host.username if r.host else "Unknown",
            active_video_title=r.active_video_title,
            participant_count=len(members),
            members=members,
            created_at=r.created_at
        ))
        
    return results

@router.delete("/rooms/{room_code}")
async def force_close_room(
    room_code: str,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    room = db.query(Room).filter(Room.room_code == room_code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    # Notify WebSocket participants and disconnect them
    await manager.force_close_room(room_code)

    db.delete(room)
    db.commit()

    return {"status": "success", "message": f"Room {room_code} closed and removed"}

@router.get("/videos")
def list_all_uploaded_videos_admin(
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    videos = db.query(UploadedVideo).order_by(UploadedVideo.created_at.desc()).all()
    return [
        {
            "id": v.id,
            "file_id": v.file_id,
            "filename": v.filename,
            "original_name": v.original_name,
            "file_size": v.file_size,
            "uploaded_size": v.uploaded_size,
            "is_complete": v.is_complete,
            "uploader_username": v.uploader.username if v.uploader else "Unknown",
            "stream_url": f"/api/media/stream/{v.file_id}",
            "created_at": v.created_at
        }
        for v in videos
    ]

@router.delete("/videos")
def delete_all_uploaded_videos_admin(
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    from pathlib import Path
    from app.config import settings

    videos = db.query(UploadedVideo).all()
    count = 0
    for video in videos:
        file_path = settings.UPLOAD_DIR / video.filename
        if file_path.exists():
            try:
                file_path.unlink()
            except Exception as e:
                print(f"Error removing file {file_path}: {e}")
        db.delete(video)
        count += 1

    db.commit()
    return {"status": "success", "message": f"Successfully deleted all {count} uploaded video(s)", "deleted_count": count}

@router.delete("/videos/{video_id}")
def delete_uploaded_video_admin(
    video_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    from pathlib import Path
    from app.config import settings

    video = db.query(UploadedVideo).filter(UploadedVideo.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    # Delete physical file from disk
    file_path = settings.UPLOAD_DIR / video.filename
    if file_path.exists():
        try:
            file_path.unlink()
        except Exception as e:
            print(f"Error removing file {file_path}: {e}")

    # Remove database record
    original_name = video.original_name
    db.delete(video)
    db.commit()

    return {"status": "success", "message": f"Video '{original_name}' deleted successfully"}

# --- System & SMTP Settings Endpoints ---

@router.get("/settings")
def get_system_settings_admin(
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    from app.email_service import get_all_smtp_settings
    settings_dict = get_all_smtp_settings(db)
    # Mask password for security
    if settings_dict.get("smtp_password"):
        settings_dict["smtp_password_is_set"] = True
        settings_dict["smtp_password"] = "********"
    else:
        settings_dict["smtp_password_is_set"] = False
    return settings_dict

@router.put("/settings")
def save_system_settings_admin(
    settings_in: dict,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    from app.email_service import save_smtp_settings
    save_smtp_settings(settings_in, db)
    return {"status": "success", "message": "SMTP & System Settings saved successfully"}

@router.post("/settings/test-smtp")
def test_smtp_admin(
    req: dict,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    from app.email_service import test_smtp_connection
    to_email = req.get("to_email", "").strip()
    if not to_email:
        raise HTTPException(status_code=400, detail="Please provide a valid recipient email address for testing")

    success, msg = test_smtp_connection(to_email, db)
    if not success:
        raise HTTPException(status_code=400, detail=msg)

    return {"status": "success", "message": f"Test email successfully sent to {to_email}!"}

@router.post("/rooms/{room_code}/broadcast")
async def broadcast_admin_message(
    room_code: str,
    req: dict,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    message_text = req.get("message", "").strip()
    if not message_text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    room = db.query(Room).filter(Room.room_code == room_code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    await manager.broadcast_to_room(room_code, {
        "type": "chat_message",
        "username": "📢 [SYSTEM ADMIN]",
        "user_id": admin.id,
        "avatar_url": admin.avatar_url,
        "message": message_text,
        "is_system": True,
        "created_at": "Just now"
    })

    return {"status": "success", "message": f"Announcement broadcast to room {room_code}"}


