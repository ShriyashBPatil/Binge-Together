import datetime
from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, ForeignKey, Text, BigInteger
from sqlalchemy.orm import relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    avatar_url = Column(String(255), nullable=True)
    bio = Column(String(255), nullable=True)
    is_admin = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    rooms = relationship("Room", back_populates="host")
    favorites = relationship("Favorite", back_populates="user", cascade="all, delete-orphan")
    history = relationship("WatchHistory", back_populates="user", cascade="all, delete-orphan")
    uploads = relationship("UploadedVideo", back_populates="uploader", cascade="all, delete-orphan")

class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    room_code = Column(String(12), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(String(255), nullable=True)
    is_private = Column(Boolean, default=False)
    passcode = Column(String(50), nullable=True)
    host_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Active Playback State
    active_video_url = Column(Text, nullable=True)
    active_video_title = Column(String(255), nullable=True)
    active_video_type = Column(String(20), default="youtube") # mp4, youtube
    current_time = Column(Float, default=0.0)
    is_playing = Column(Boolean, default=False)
    playback_rate = Column(Float, default=1.0)
    host_only_control = Column(Boolean, default=False)

    host = relationship("User", back_populates="rooms")
    queue_items = relationship("QueueItem", back_populates="room", cascade="all, delete-orphan", order_by="QueueItem.order_index")

class UploadedVideo(Base):
    __tablename__ = "uploaded_videos"

    id = Column(Integer, primary_key=True, index=True)
    file_id = Column(String(64), unique=True, index=True, nullable=False)
    filename = Column(String(255), nullable=False)
    original_name = Column(String(255), nullable=False)
    file_size = Column(BigInteger, nullable=False)
    uploaded_size = Column(BigInteger, default=0, nullable=False)
    is_complete = Column(Boolean, default=False, nullable=False)
    mime_type = Column(String(50), default="video/mp4")
    uploader_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    uploader = relationship("User", back_populates="uploads")

class QueueItem(Base):
    __tablename__ = "queue_items"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    video_url = Column(Text, nullable=False)
    video_type = Column(String(20), default="youtube")
    added_by_name = Column(String(50), nullable=False)
    status = Column(String(20), default="queued") # playing, ready, uploading, queued
    progress = Column(Integer, default=0)
    start_time = Column(Float, default=0.0)
    end_time = Column(Float, default=0.0)
    order_index = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    room = relationship("Room", back_populates="queue_items")

class Favorite(Base):
    __tablename__ = "favorites"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    video_url = Column(Text, nullable=False)
    video_type = Column(String(20), default="youtube")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="favorites")

class WatchHistory(Base):
    __tablename__ = "watch_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    room_code = Column(String(12), nullable=False)
    room_name = Column(String(100), nullable=False)
    last_watched_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="history")

class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    room_code = Column(String(12), index=True, nullable=False)
    user_id = Column(Integer, nullable=True)
    username = Column(String(50), nullable=False)
    avatar_url = Column(String(255), nullable=True)
    content = Column(Text, nullable=False)
    is_system = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class SystemSetting(Base):
    __tablename__ = "system_settings"

    key = Column(String(100), primary_key=True, index=True)
    value = Column(Text, nullable=True)
    description = Column(String(255), nullable=True)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token = Column(String(128), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User")
