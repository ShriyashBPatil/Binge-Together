import random
import string
import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.auth import (
    hash_password, verify_password, create_access_token,
    get_current_user
)
from app.models import User, PasswordResetToken
from app.schemas import (
    UserCreate, UserLogin, UserResponse, TokenResponse, UserProfileUpdate,
    ForgotUsernameRequest, ForgotPasswordRequest, VerifyResetTokenRequest, ResetPasswordRequest
)
from app.email_service import (
    send_welcome_email, send_forgot_username_email, send_password_reset_email
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.post("/register", response_model=TokenResponse)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    # Check existing user
    if db.query(User).filter(User.username == user_in.username).first():
        raise HTTPException(status_code=400, detail="Username is already taken")
    if db.query(User).filter(User.email == user_in.email).first():
        raise HTTPException(status_code=400, detail="Email is already registered")

    # If first user in system, automatically promote to admin
    is_first_user = db.query(User).count() == 0

    hashed = hash_password(user_in.password)
    user = User(
        username=user_in.username,
        email=user_in.email,
        password_hash=hashed,
        avatar_url=user_in.avatar_url or f"https://api.dicebear.com/7.x/bottts/svg?seed={user_in.username}",
        bio=user_in.bio,
        is_admin=is_first_user
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Dispatch welcome email asynchronously
    try:
        send_welcome_email(user, db)
    except Exception as e:
        print("Welcome email notice:", e)

    token = create_access_token(data={"sub": user.username})
    return TokenResponse(access_token=token, user=UserResponse.model_validate(user))

@router.post("/login", response_model=TokenResponse)
def login(user_in: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == user_in.username).first()
    if not user or not verify_password(user_in.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = create_access_token(data={"sub": user.username})
    return TokenResponse(access_token=token, user=UserResponse.model_validate(user))

@router.post("/forgot-username")
def forgot_username(req: ForgotUsernameRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email.strip().lower()).first()
    if user:
        try:
            send_forgot_username_email(user, db)
        except Exception as e:
            print("Forgot username email notice:", e)

    return {
        "status": "success",
        "message": "If an account exists with this email address, your username has been sent to your inbox."
    }

@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest, db: Session = Depends(get_db)):
    target = req.email_or_username.strip()
    user = db.query(User).filter((User.email == target.lower()) | (User.username == target)).first()

    if user:
        # Invalidate existing unused tokens for this user
        db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used == False
        ).update({"used": True})

        # Generate 6-digit numeric PIN and secure token string
        pin_code = ''.join(random.choices(string.digits, k=6))
        expires_at = datetime.datetime.utcnow() + datetime.timedelta(hours=1)

        reset_record = PasswordResetToken(
            user_id=user.id,
            token=pin_code,
            expires_at=expires_at,
            used=False
        )
        db.add(reset_record)
        db.commit()

        try:
            send_password_reset_email(user, pin_code, pin_code, db)
        except Exception as e:
            print("Password reset email notice:", e)

    return {
        "status": "success",
        "message": "If an account is associated with this username or email, a password reset code has been sent to your inbox."
    }

@router.post("/verify-reset-token")
def verify_reset_token(req: VerifyResetTokenRequest, db: Session = Depends(get_db)):
    token_str = req.token.strip()
    record = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == token_str,
        PasswordResetToken.used == False
    ).first()

    if not record or record.expires_at < datetime.datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired reset code. Please request a new one.")

    return {
        "status": "valid",
        "username": record.user.username,
        "email": record.user.email
    }

@router.post("/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    token_str = req.token.strip()
    record = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == token_str,
        PasswordResetToken.used == False
    ).first()

    if not record or record.expires_at < datetime.datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired reset code. Please request a new one.")

    if len(req.new_password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters long")

    user = record.user
    user.password_hash = hash_password(req.new_password)
    record.used = True
    db.commit()

    return {
        "status": "success",
        "message": "Your password has been successfully reset! You can now log in."
    }

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)

@router.put("/profile", response_model=UserResponse)
def update_profile(
    profile_in: UserProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if profile_in.email and profile_in.email != current_user.email:
        if db.query(User).filter(User.email == profile_in.email).first():
            raise HTTPException(status_code=400, detail="Email already in use")
        current_user.email = profile_in.email

    if profile_in.avatar_url is not None:
        current_user.avatar_url = profile_in.avatar_url

    if profile_in.bio is not None:
        current_user.bio = profile_in.bio

    if profile_in.new_password:
        if not profile_in.current_password:
            raise HTTPException(status_code=400, detail="Current password required to change password")
        if not verify_password(profile_in.current_password, current_user.password_hash):
            raise HTTPException(status_code=400, detail="Incorrect current password")
        current_user.password_hash = hash_password(profile_in.new_password)

    db.commit()
    db.refresh(current_user)
    return UserResponse.model_validate(current_user)
