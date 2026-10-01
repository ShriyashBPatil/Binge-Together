from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

# User Schemas
class UserCreate(BaseModel):
    username: str
    email: str
    password: str
    avatar_url: Optional[str] = None
    bio: Optional[str] = None

class UserLogin(BaseModel):
    username: str
    password: str

class UserProfileUpdate(BaseModel):
    email: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None

class AdminUserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    is_admin: Optional[bool] = None
    new_password: Optional[str] = None

class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    is_admin: bool = False
    created_at: datetime

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

# Video Upload Schemas
class UploadInitRequest(BaseModel):
    filename: str
    file_size: int

class UploadInitResponse(BaseModel):
    upload_id: str
    file_id: str
    stream_url: str
    chunk_size: int

class UploadVideoResponse(BaseModel):
    id: int
    file_id: str
    filename: str
    original_name: str
    file_size: int
    mime_type: str
    stream_url: str
    created_at: datetime

    class Config:
        from_attributes = True

# Queue Item Schemas
class QueueItemCreate(BaseModel):
    title: str
    video_url: str
    video_type: Optional[str] = "youtube"
    status: Optional[str] = "queued"
    progress: Optional[int] = 0
    start_time: Optional[float] = 0.0
    end_time: Optional[float] = 0.0

class QueueItemUpdate(BaseModel):
    title: Optional[str] = None
    video_url: Optional[str] = None
    video_type: Optional[str] = None
    status: Optional[str] = None
    progress: Optional[int] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None

class QueueItemResponse(BaseModel):
    id: int
    title: str
    video_url: str
    video_type: str
    added_by_name: str
    status: str = "queued"
    progress: int = 0
    start_time: float = 0.0
    end_time: float = 0.0
    order_index: int
    created_at: datetime

    class Config:
        from_attributes = True

# Room Schemas
class RoomCreate(BaseModel):
    name: str
    description: Optional[str] = None
    is_private: bool = False
    passcode: Optional[str] = None
    video_url: Optional[str] = None
    video_title: Optional[str] = None
    video_type: Optional[str] = "youtube"
    host_only_control: bool = False

class RoomUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_private: Optional[bool] = None
    passcode: Optional[str] = None
    active_video_url: Optional[str] = None
    active_video_title: Optional[str] = None
    active_video_type: Optional[str] = None
    current_time: Optional[float] = None
    is_playing: Optional[bool] = None
    host_only_control: Optional[bool] = None

class RoomResponse(BaseModel):
    id: int
    room_code: str
    name: str
    description: Optional[str] = None
    is_private: bool
    host_id: int
    host_username: Optional[str] = None
    active_video_url: Optional[str] = None
    active_video_title: Optional[str] = None
    active_video_type: str = "youtube"
    current_time: float = 0.0
    is_playing: bool = False
    playback_rate: float = 1.0
    host_only_control: bool = False
    created_at: datetime
    participant_count: int = 0
    queue_items: List[QueueItemResponse] = []

    class Config:
        from_attributes = True

class RoomInviteEmailRequest(BaseModel):
    emails: List[str]
    custom_message: Optional[str] = None
    inviter_name: Optional[str] = None

class RoomInviteEmailResponse(BaseModel):
    success: bool
    sent_count: int
    message: str

# Admin Room Response with participant details
class AdminRoomMemberInfo(BaseModel):
    user_id: str
    username: str
    avatar_url: str
    is_host: bool

class AdminRoomDetailResponse(BaseModel):
    id: int
    room_code: str
    name: str
    is_private: bool
    host_id: int
    host_username: Optional[str] = None
    active_video_title: Optional[str] = None
    participant_count: int
    members: List[AdminRoomMemberInfo]
    created_at: datetime

# Favorite Schemas
class FavoriteCreate(BaseModel):
    title: str
    video_url: str
    video_type: Optional[str] = "youtube"

class FavoriteResponse(BaseModel):
    id: int
    user_id: int
    title: str
    video_url: str
    video_type: str
    created_at: datetime

    class Config:
        from_attributes = True

# Watch History Schema
class WatchHistoryResponse(BaseModel):
    id: int
    room_code: str
    room_name: str
    last_watched_at: datetime

    class Config:
        from_attributes = True

# Account Recovery Schemas
class ForgotUsernameRequest(BaseModel):
    email: str

class ForgotPasswordRequest(BaseModel):
    email_or_username: str

class VerifyResetTokenRequest(BaseModel):
    token: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

# System & SMTP Settings Schemas
class SystemSettingsSchema(BaseModel):
    smtp_host: Optional[str] = ""
    smtp_port: Optional[int] = 587
    smtp_user: Optional[str] = ""
    smtp_password: Optional[str] = ""
    smtp_from_email: Optional[str] = ""
    smtp_from_name: Optional[str] = "BingeTogether"
    smtp_use_tls: Optional[bool] = True
    smtp_use_ssl: Optional[bool] = False
    welcome_email_enabled: Optional[bool] = True
    app_url: Optional[str] = "https://localhost:6969"

class TestEmailRequest(BaseModel):
    to_email: str
