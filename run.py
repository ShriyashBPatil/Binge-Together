import os
import uvicorn
from pathlib import Path
from app.config import settings

if __name__ == "__main__":
    cert_path = settings.DB_DIR / "cert.pem"
    key_path = settings.DB_DIR / "key.pem"

    use_ssl = os.getenv("USE_SSL", "true").lower() in ["true", "1", "yes"]
    
    ssl_kwargs = {}
    if use_ssl and cert_path.exists() and key_path.exists():
        ssl_kwargs = {
            "ssl_keyfile": str(key_path),
            "ssl_certfile": str(cert_path)
        }
        print(f"INFO:     HTTPS & WebRTC SSL enabled on https://server.shriyashpatil.in:{settings.PORT}")
    else:
        print(f"INFO:     Running on HTTP http://server.shriyashpatil.in:{settings.PORT}")

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=False,
        **ssl_kwargs
    )
