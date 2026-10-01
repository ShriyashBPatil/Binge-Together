import os
import json
import shutil
import uuid
import math
import subprocess
from typing import Generator
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Header, Request, status
from fastapi.responses import StreamingResponse, JSONResponse
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.auth import get_current_user
from app.models import User, Room, QueueItem, UploadedVideo
from app.schemas import UploadInitRequest, UploadInitResponse, UploadVideoResponse, QueueItemResponse

router = APIRouter(prefix="/api/media", tags=["media"])

CHUNK_SIZE = 2 * 1024 * 1024  # 2MB chunks

MIME_MAP = {
    ".mp4": "video/mp4",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".flv": "video/x-flv",
    ".wmv": "video/x-ms-wmv",
    ".m4v": "video/x-m4v",
    ".3gp": "video/3gpp",
    ".ts": "video/mp2t",
    ".ogv": "video/ogg"
}

def get_mime_type_for_file(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return MIME_MAP.get(ext, "video/mp4")

def ensure_web_audio_and_container(input_path: Path) -> Path:
    if not input_path.exists():
        return input_path
    output_path = input_path.with_name(f"web_{input_path.stem}.mp4")
    try:
        cmd = [
            "ffmpeg", "-y",
            "-i", str(input_path),
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "+faststart",
            str(output_path)
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)
        if result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0:
            input_path.unlink(missing_ok=True)
            return output_path
    except Exception as e:
        print("FFmpeg audio transcode notice:", e)
    return input_path

def create_10min_segments_from_video(input_path: Path, original_name: str, room_code: str, db: Session, uploader_id: int):
    duration_secs = 0.0
    try:
        probe_cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(input_path)
        ]
        res = subprocess.run(probe_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30)
        if res.returncode == 0 and res.stdout.strip():
            duration_secs = float(res.stdout.strip())
    except Exception as e:
        print("ffprobe duration notice:", e)

    if duration_secs <= 0:
        duration_secs = 600.0

    segment_secs = 600.0
    total_parts = max(1, math.ceil(duration_secs / segment_secs))
    created_items = []

    room = db.query(Room).filter(Room.room_code == room_code).first()
    if not room:
        return []

    # Clear previous queue items for clean slate
    db.query(QueueItem).filter(QueueItem.room_id == room.id).delete()
    db.commit()

    for s in range(total_parts):
        start_sec = s * segment_secs
        part_dur = min(segment_secs, duration_secs - start_sec)
        
        part_file_id = str(uuid.uuid4())
        part_filename = f"{part_file_id}.mp4"
        part_file_path = settings.UPLOAD_DIR / part_filename

        # FFmpeg extract exact 10-minute part with copy video & AAC audio
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start_sec),
            "-i", str(input_path),
            "-t", str(part_dur),
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "+faststart",
            str(part_file_path)
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
        
        if not part_file_path.exists() or part_file_path.stat().st_size == 0:
            cmd_fallback = [
                "ffmpeg", "-y",
                "-i", str(input_path),
                "-ss", str(start_sec),
                "-t", str(part_dur),
                "-c:v", "copy",
                "-c:a", "aac",
                "-b:a", "192k",
                "-movflags", "+faststart",
                str(part_file_path)
            ]
            subprocess.run(cmd_fallback, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)

        file_size = part_file_path.stat().st_size if part_file_path.exists() else 0

        db_part_vid = UploadedVideo(
            file_id=part_file_id,
            filename=part_filename,
            original_name=f"{original_name} - Part {s+1}",
            file_size=file_size,
            uploaded_size=file_size,
            is_complete=True,
            mime_type="video/mp4",
            uploader_id=uploader_id
        )
        db.add(db_part_vid)
        db.commit()

        start_min = s * 10
        end_min = int(round((start_sec + part_dur) / 60.0))
        part_title = f"{original_name} - Part {s+1} ({start_min}:00 - {end_min}:00)"
        stream_url = f"/api/media/stream/{part_file_id}"
        status_str = "playing" if s == 0 else "ready"

        q_item = QueueItem(
            room_id=room.id,
            title=part_title,
            video_url=stream_url,
            video_type="mp4",
            added_by_name="FFmpeg Segmenter",
            status=status_str,
            progress=100,
            start_time=0.0,
            end_time=0.0,
            order_index=s
        )
        db.add(q_item)
        db.commit()
        db.refresh(q_item)
        created_items.append(q_item)

    return created_items

@router.post("/upload/segment")
def create_video_segments_route(
    file_id: str = Form(...),
    room_code: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    db_video = db.query(UploadedVideo).filter(UploadedVideo.file_id == file_id).first()
    if not db_video:
        raise HTTPException(status_code=404, detail="Uploaded video record not found")

    input_path = settings.UPLOAD_DIR / db_video.filename
    if not input_path.exists():
        raise HTTPException(status_code=404, detail="Video file missing on server disk")

    items = create_10min_segments_from_video(
        input_path=input_path,
        original_name=db_video.original_name,
        room_code=room_code,
        db=db,
        uploader_id=current_user.id
    )
    return [QueueItemResponse.model_validate(q) for q in items]

router = APIRouter(prefix="/api/media", tags=["media"])

CHUNK_SIZE = 2 * 1024 * 1024  # 2MB chunks

MIME_MAP = {
    ".mp4": "video/mp4",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".flv": "video/x-flv",
    ".wmv": "video/x-ms-wmv",
    ".m4v": "video/x-m4v",
    ".3gp": "video/3gpp",
    ".ts": "video/mp2t",
    ".ogv": "video/ogg"
}

def get_mime_type_for_file(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return MIME_MAP.get(ext, "video/mp4")

@router.post("/upload/init", response_model=UploadInitResponse)
def init_chunked_upload(
    req: UploadInitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    upload_id = str(uuid.uuid4())
    file_id = str(uuid.uuid4())
    
    sanitized_ext = Path(req.filename).suffix.lower()
    if not sanitized_ext:
        sanitized_ext = ".mp4"
    
    target_filename = f"{file_id}{sanitized_ext}"
    final_file_path = settings.UPLOAD_DIR / target_filename
    mime_type = get_mime_type_for_file(req.filename)
    
    # Create target file immediately on disk so stream URL is valid instantly
    with open(final_file_path, "wb") as f:
        pass  # 0-byte file ready for chunk writing

    temp_dir = settings.TEMP_UPLOAD_DIR / upload_id
    temp_dir.mkdir(parents=True, exist_ok=True)
    
    # Save session info
    session_info = {
        "file_id": file_id,
        "filename": target_filename,
        "original_name": req.filename,
        "file_size": req.file_size
    }
    (temp_dir / "session.json").write_text(json.dumps(session_info))

    # Pre-register video record in database
    db_video = UploadedVideo(
        file_id=file_id,
        filename=target_filename,
        original_name=req.filename,
        file_size=req.file_size,
        uploaded_size=0,
        is_complete=False,
        mime_type=mime_type,
        uploader_id=current_user.id
    )
    db.add(db_video)
    db.commit()

    stream_url = f"/api/media/stream/{file_id}"
    return UploadInitResponse(
        upload_id=upload_id,
        file_id=file_id,
        stream_url=stream_url,
        chunk_size=CHUNK_SIZE
    )

@router.post("/upload/chunk")
async def upload_chunk(
    upload_id: str = Form(...),
    chunk_index: int = Form(...),
    chunk_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    temp_dir = settings.TEMP_UPLOAD_DIR / upload_id
    session_file = temp_dir / "session.json"
    if not temp_dir.exists() or not session_file.exists():
        raise HTTPException(status_code=404, detail="Upload session not found or expired")
    
    session_info = json.loads(session_file.read_text())
    file_id = session_info["file_id"]
    target_filename = session_info["filename"]
    final_file_path = settings.UPLOAD_DIR / target_filename
    if not final_file_path.exists():
        final_file_path.touch()

    chunk_content = await chunk_file.read()
    chunk_len = len(chunk_content)

    # Write chunk directly to output file at offset
    offset = chunk_index * CHUNK_SIZE
    with open(final_file_path, "r+b") as f:
        f.seek(offset)
        f.write(chunk_content)

    # Update uploaded size in DB
    db_video = db.query(UploadedVideo).filter(UploadedVideo.file_id == file_id).first()
    if db_video:
        new_size = max(db_video.uploaded_size, offset + chunk_len)
        db_video.uploaded_size = min(db_video.file_size, new_size)
        db.commit()

    return {
        "status": "success",
        "chunk_index": chunk_index,
        "written_bytes": chunk_len,
        "is_playable": True
    }

import subprocess

def ensure_web_audio_and_container(input_path: Path) -> Path:
    if not input_path.exists():
        return input_path
    output_path = input_path.with_name(f"web_{input_path.stem}.mp4")
    try:
        cmd = [
            "ffmpeg", "-y",
            "-i", str(input_path),
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "+faststart",
            str(output_path)
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        if result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0:
            input_path.unlink(missing_ok=True)
            return output_path
    except Exception as e:
        print("FFmpeg audio transcode notice:", e)
    return input_path

@router.post("/upload/complete", response_model=UploadVideoResponse)
def complete_upload(
    upload_id: str = Form(...),
    filename: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    temp_dir = settings.TEMP_UPLOAD_DIR / upload_id
    session_file = temp_dir / "session.json"
    if not temp_dir.exists() or not session_file.exists():
        raise HTTPException(status_code=404, detail="Upload session not found")
    
    session_info = json.loads(session_file.read_text())
    file_id = session_info["file_id"]

    db_video = db.query(UploadedVideo).filter(UploadedVideo.file_id == file_id).first()
    if not db_video:
        raise HTTPException(status_code=404, detail="Video record not found")

    final_file_path = settings.UPLOAD_DIR / db_video.filename
    processed_path = ensure_web_audio_and_container(final_file_path)

    if processed_path.exists():
        db_video.filename = processed_path.name
        db_video.file_size = processed_path.stat().st_size
    db_video.uploaded_size = db_video.file_size
    db_video.mime_type = "video/mp4"
    db_video.is_complete = True
    db.commit()
    db.refresh(db_video)

    # Clean up temp session directory
    shutil.rmtree(temp_dir, ignore_errors=True)

    return UploadVideoResponse(
        id=db_video.id,
        file_id=db_video.file_id,
        filename=db_video.filename,
        original_name=db_video.original_name,
        file_size=db_video.file_size,
        mime_type=db_video.mime_type,
        stream_url=f"/api/media/stream/{db_video.file_id}",
        created_at=db_video.created_at
    )

@router.get("/videos", response_model=list[UploadVideoResponse])
def list_user_videos(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    videos = db.query(UploadedVideo).order_by(UploadedVideo.created_at.desc()).all()
    return [
        UploadVideoResponse(
            id=v.id,
            file_id=v.file_id,
            filename=v.filename,
            original_name=v.original_name,
            file_size=v.file_size,
            mime_type=v.mime_type,
            stream_url=f"/api/media/stream/{v.file_id}",
            created_at=v.created_at
        )
        for v in videos
    ]

# Progressive Range Streaming Helper
def ranged_file_generator(file_path: Path, start: int, end: int, chunk_size: int = 64 * 1024) -> Generator[bytes, None, None]:
    with open(file_path, "rb") as video_file:
        video_file.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            bytes_to_read = min(chunk_size, remaining)
            data = video_file.read(bytes_to_read)
            if not data:
                break
            remaining -= len(data)
            yield data

@router.get("/stream/{file_id}")
def stream_video(
    file_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    db_video = db.query(UploadedVideo).filter(UploadedVideo.file_id == file_id).first()
    if not db_video:
        target_path = None
        for path in settings.UPLOAD_DIR.glob(f"{file_id}.*"):
            target_path = path
            break
        if not target_path:
            temp_path = settings.UPLOAD_DIR / f"temp_{file_id}.part"
            if temp_path.exists():
                target_path = temp_path
        if not target_path or not target_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found")
        file_path = target_path
        total_file_size = file_path.stat().st_size
    else:
        file_path = settings.UPLOAD_DIR / db_video.filename
        total_file_size = db_video.file_size

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File content missing on server disk")

    mime_type = db_video.mime_type if db_video else get_mime_type_for_file(file_path.name)
    current_disk_bytes = file_path.stat().st_size
    range_header = request.headers.get("range", None)

    if not range_header:
        headers = {
            "Content-Length": str(current_disk_bytes),
            "Content-Type": mime_type,
            "Accept-Ranges": "bytes"
        }
        return StreamingResponse(
            ranged_file_generator(file_path, 0, max(0, current_disk_bytes - 1)),
            headers=headers,
            media_type=mime_type
        )

    # Range parsing e.g. "bytes=0-1048575" or "bytes=0-"
    try:
        unit, ranges = range_header.strip().split("=")
        if unit != "bytes":
            raise ValueError()
        
        start_str, end_str = ranges.split("-")
        start = int(start_str) if start_str else 0
        
        if current_disk_bytes <= 0 or start >= current_disk_bytes:
            headers = {
                "Content-Range": f"bytes */{total_file_size}",
                "Accept-Ranges": "bytes",
            }
            return JSONResponse(status_code=416, content={"detail": "Range Not Satisfiable"}, headers=headers)

        max_available = current_disk_bytes - 1
        end = int(end_str) if end_str else max_available
        end = min(end, max_available)

        content_length = max(0, end - start + 1)
        
        headers = {
            "Content-Range": f"bytes {start}-{end}/{total_file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "Content-Type": mime_type,
        }
        
        return StreamingResponse(
            ranged_file_generator(file_path, start, end),
            status_code=206,
            headers=headers,
            media_type=mime_type
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid Range header format")
