import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

class Settings:
    BASE_DIR: Path = BASE_DIR
    PROJECT_NAME: str = "BingeTogether"
    TAGLINE: str = "Watch Together. Anywhere."
    PORT: int = int(os.getenv("PORT", 6868))
    SECRET_KEY: str = os.getenv("SECRET_KEY", "bingetogether-super-secret-college-key-2026")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7 # 7 days
    
    # SQLite Database configuration
    DB_DIR: Path = BASE_DIR / "data"
    DB_PATH: Path = DB_DIR / "bingetogether.db"
    DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH}")
    
    # Uploads Storage
    UPLOAD_DIR: Path = BASE_DIR / "uploads"
    TEMP_UPLOAD_DIR: Path = BASE_DIR / "uploads" / "temp"

settings = Settings()

# Ensure directories exist
settings.DB_DIR.mkdir(parents=True, exist_ok=True)
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.TEMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

