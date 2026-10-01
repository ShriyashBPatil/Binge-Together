import os
import smtplib
import threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import make_msgid, formatdate, formataddr
from typing import Tuple, Dict, Any, Optional
from sqlalchemy.orm import Session

from app.models import SystemSetting, User

# Default Fallback Settings
DEFAULT_SETTINGS = {
    "smtp_host": os.getenv("SMTP_HOST", ""),
    "smtp_port": os.getenv("SMTP_PORT", "587"),
    "smtp_user": os.getenv("SMTP_USER", ""),
    "smtp_password": os.getenv("SMTP_PASSWORD", ""),
    "smtp_from_email": os.getenv("SMTP_FROM_EMAIL", ""),
    "smtp_from_name": os.getenv("SMTP_FROM_NAME", "BingeTogether"),
    "smtp_use_tls": os.getenv("SMTP_USE_TLS", "true"),
    "smtp_use_ssl": os.getenv("SMTP_USE_SSL", "false"),
    "welcome_email_enabled": os.getenv("WELCOME_EMAIL_ENABLED", "true"),
    "app_url": os.getenv("APP_URL", "https://localhost:6969")
}

def get_system_setting(key: str, db: Optional[Session] = None, default: str = "") -> str:
    """Retrieve a setting from database system_settings table, falling back to defaults."""
    if db:
        try:
            setting = db.query(SystemSetting).filter(SystemSetting.key == key).first()
            if setting and setting.value is not None:
                return setting.value
        except Exception as e:
            print(f"Error reading system setting {key}: {e}")
    return DEFAULT_SETTINGS.get(key, default)

def get_all_smtp_settings(db: Optional[Session] = None) -> Dict[str, Any]:
    """Load all SMTP configuration items as a dictionary."""
    result = {}
    for k, default_val in DEFAULT_SETTINGS.items():
        result[k] = get_system_setting(k, db, default_val)
    return result

def save_smtp_settings(settings_dict: Dict[str, Any], db: Session) -> None:
    """Save SMTP configuration items into system_settings table."""
    for k, v in settings_dict.items():
        if k in DEFAULT_SETTINGS:
            val_str = str(v) if v is not None else ""
            setting = db.query(SystemSetting).filter(SystemSetting.key == k).first()
            if not setting:
                setting = SystemSetting(key=k, value=val_str)
                db.add(setting)
            else:
                # Do not overwrite password with masked placeholder
                if k == "smtp_password" and val_str == "********":
                    continue
                setting.value = val_str
    db.commit()

def _send_mail_sync(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: str,
    smtp_config: Dict[str, Any]
) -> Tuple[bool, str]:
    """Synchronous SMTP email dispatcher compliant with RFC 5322, Gmail, and Yahoo requirements."""
    host = smtp_config.get("smtp_host", "").strip()
    port_str = smtp_config.get("smtp_port", "587").strip()
    user = smtp_config.get("smtp_user", "").strip()
    password = smtp_config.get("smtp_password", "")
    from_email = smtp_config.get("smtp_from_email", "").strip() or user
    from_name = smtp_config.get("smtp_from_name", "BingeTogether").strip()
    use_tls = str(smtp_config.get("smtp_use_tls", "true")).lower() in ("true", "1", "yes")
    use_ssl = str(smtp_config.get("smtp_use_ssl", "false")).lower() in ("true", "1", "yes")

    if not host:
        return False, "SMTP Host is not configured in Admin Settings"

    try:
        port = int(port_str)
    except ValueError:
        port = 465 if use_ssl else 587

    # Extract sender domain for RFC 5322 Message-ID compliance
    sender_domain = None
    if "@" in from_email:
        sender_domain = from_email.split("@")[-1].strip()

    app_url = smtp_config.get("app_url", "").strip().rstrip("/")
    is_real_domain = app_url and not app_url.startswith("https://localhost") and not app_url.startswith("http://localhost")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = formataddr((from_name, from_email))
    msg["To"] = to_email
    msg["Reply-To"] = from_email
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=sender_domain)
    msg["MIME-Version"] = "1.0"
    # Precedence: "transactional" signals to ESPs this is automated but not bulk marketing
    msg["Precedence"] = "transactional"
    # List-Unsubscribe is required by Gmail/Yahoo for bulk senders (Feb 2024 policy)
    # and reduces spam score significantly even for transactional mail
    if is_real_domain:
        msg["List-Unsubscribe"] = f"<mailto:{from_email}?subject=unsubscribe>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

    part1 = MIMEText(text_content, "plain", "utf-8")
    part2 = MIMEText(html_content, "html", "utf-8")
    msg.attach(part1)
    msg.attach(part2)

    try:
        if use_ssl:
            server = smtplib.SMTP_SSL(host, port, timeout=15)
        else:
            server = smtplib.SMTP(host, port, timeout=15)

        server.ehlo()
        if use_tls and not use_ssl:
            server.starttls()
            server.ehlo()

        if user and password:
            server.login(user, password)

        envelope_from = user if user and "@" in user else from_email
        server.sendmail(envelope_from, [to_email], msg.as_string())
        server.quit()
        print(f"[Email Service] SUCCESS: Mail delivered to {to_email} (Subject: '{subject}', Envelope: {envelope_from})")
        return True, "Email sent successfully"
    except smtplib.SMTPAuthenticationError as e:
        err_msg = f"SMTP Authentication Error: {e.smtp_error.decode() if isinstance(e.smtp_error, bytes) else str(e)}"
        print(f"[Email Service] AUTH ERROR to {to_email}: {err_msg}")
        return False, err_msg
    except smtplib.SMTPConnectError as e:
        err_msg = f"SMTP Connection Error: Failed to connect to {host}:{port}"
        print(f"[Email Service] CONNECT ERROR to {to_email}: {err_msg}")
        return False, err_msg
    except Exception as e:
        err_msg = f"Email delivery failed: {str(e)}"
        print(f"[Email Service] ERROR to {to_email}: {err_msg}")
        return False, err_msg

def send_email_async(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: str,
    db: Optional[Session] = None
) -> None:
    """Dispatches email in a background thread without blocking the web request."""
    config = get_all_smtp_settings(db)
    if not config.get("smtp_host"):
        print(f"[Email Service Notice] SMTP host not configured. Email to '{to_email}' skipped.")
        return
    print(f"[Email Service] Dispatching background email to '{to_email}' (Subject: '{subject}')")
    thread = threading.Thread(
        target=_send_mail_sync,
        args=(to_email, subject, html_content, text_content, config)
    )
    thread.daemon = True
    thread.start()

def _get_neo_email_wrapper(title: str, content_html: str, app_url: str) -> str:
    """Returns HTML template with clean Neo-Brutalist styling."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
</head>
<body style="margin: 0; padding: 24px; background-color: #fafaf9; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #121212; line-height: 1.6;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border: 3px solid #121212; box-shadow: 6px 6px 0px #121212; border-radius: 6px; overflow: hidden;">
    <!-- Header -->
    <tr>
      <td style="background-color: #ffd5dc; padding: 18px 24px; border-bottom: 3px solid #121212;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td>
              <h1 style="margin: 0; font-size: 20px; font-weight: 900; letter-spacing: -0.5px; color: #121212;">
                &#9654; BINGE TOGETHER
              </h1>
              <span style="font-size: 11px; font-weight: 700; color: #121212; text-transform: uppercase; letter-spacing: 0.5px;">
                Watch Videos &amp; Movies in Sync
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    
    <!-- Body Content -->
    <tr>
      <td style="padding: 28px 24px;">
        {content_html}
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background-color: #f3f4f6; padding: 16px 24px; border-top: 3px solid #121212; font-size: 12px; color: #555555; text-align: center;">
        <p style="margin: 0 0 6px 0;">
          Sent from <a href="{app_url}" style="color: #121212; font-weight: 700; text-decoration: underline;">BingeTogether</a>.
        </p>
        <p style="margin: 0; font-size: 11px; color: #888888;">
          This is a transactional email related to your BingeTogether account.
          To stop receiving these emails, reply with "unsubscribe" in the subject.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>"""

def send_welcome_email(user: User, db: Session) -> None:
    """Send welcome email to newly registered users."""
    welcome_enabled = get_system_setting("welcome_email_enabled", db, "true").lower() in ("true", "1", "yes")
    if not welcome_enabled:
        return

    app_url = get_system_setting("app_url", db, "https://localhost:6969").rstrip("/")
    subject = f"Welcome to BingeTogether, {user.username}"

    body_html = f"""
      <h2 style="margin-top: 0; font-size: 22px; font-weight: 800; color: #121212;">Welcome aboard, {user.username}! 🎉</h2>
      <p style="font-size: 15px; margin-bottom: 18px;">
        Your BingeTogether account is active and ready to use. You can now host watch parties, stream YouTube &amp; local video files with friends, and chat in real-time.
      </p>

      <div style="background-color: #fef08a; border: 2.5px solid #121212; border-radius: 6px; padding: 16px; margin: 20px 0; box-shadow: 3px 3px 0px #121212;">
        <p style="margin: 0 0 6px 0; font-weight: 800; font-size: 14px;">YOUR ACCOUNT DETAILS:</p>
        <p style="margin: 0 0 4px 0; font-size: 14px;"><strong>Username:</strong> {user.username}</p>
        <p style="margin: 0; font-size: 14px;"><strong>Registered Email:</strong> {user.email}</p>
      </div>

      <div style="text-align: center; margin: 28px 0 16px 0;">
        <a href="{app_url}" style="display: inline-block; background-color: #bbf7d0; color: #121212; border: 2.5px solid #121212; padding: 12px 28px; font-size: 15px; font-weight: 800; text-decoration: none; border-radius: 6px; box-shadow: 4px 4px 0px #121212; text-transform: uppercase;">
          START WATCHING NOW &rarr;
        </a>
      </div>
    """

    body_text = f"""Welcome to BingeTogether, {user.username}!

Your account is now ready:
- Username: {user.username}
- Email: {user.email}

Access BingeTogether: {app_url}
"""
    full_html = _get_neo_email_wrapper("Welcome to BingeTogether", body_html, app_url)
    send_email_async(user.email, subject, full_html, body_text, db)

def send_forgot_username_email(user: User, db: Session) -> None:
    """Sends registered username to the user's email."""
    app_url = get_system_setting("app_url", db, "https://localhost:6969").rstrip("/")
    subject = "BingeTogether: Your Username Reminder"

    body_html = f"""
      <h2 style="margin-top: 0; font-size: 20px; font-weight: 800; color: #121212;">Username Reminder 🔍</h2>
      <p style="font-size: 15px; margin-bottom: 16px;">
        We received a request to retrieve the username associated with your email address (<strong>{user.email}</strong>).
      </p>

      <div style="background-color: #b6e3f4; border: 2.5px solid #121212; border-radius: 6px; padding: 18px; margin: 20px 0; box-shadow: 3px 3px 0px #121212; text-align: center;">
        <span style="display: block; font-size: 12px; font-weight: 800; text-transform: uppercase; color: #121212; margin-bottom: 4px;">YOUR USERNAME IS</span>
        <strong style="font-size: 24px; font-family: monospace; letter-spacing: 1px; color: #121212;">{user.username}</strong>
      </div>

      <p style="font-size: 14px; color: #555555;">
        You can now sign in using your username and password at <a href="{app_url}" style="color: #121212; font-weight: 700;">{app_url}</a>.
      </p>
    """

    body_text = f"""BingeTogether Username Reminder

We found the following username associated with your email ({user.email}):
Username: {user.username}

Login: {app_url}
"""
    full_html = _get_neo_email_wrapper("Username Reminder", body_html, app_url)
    send_email_async(user.email, subject, full_html, body_text, db)

def send_password_reset_email(user: User, token: str, pin_code: str, db: Session) -> None:
    """Sends password reset PIN code and link to the user's email."""
    app_url = get_system_setting("app_url", db, "https://localhost:6969").rstrip("/")
    reset_url = f"{app_url}/?reset_token={token}"
    subject = "BingeTogether: Password Reset Request"

    body_html = f"""
      <h2 style="margin-top: 0; font-size: 20px; font-weight: 800; color: #121212;">Reset Your Password 🔐</h2>
      <p style="font-size: 15px; margin-bottom: 16px;">
        Hi <strong>{user.username}</strong>, we received a request to reset your BingeTogether password.
      </p>

      <div style="background-color: #fef08a; border: 2.5px solid #121212; border-radius: 6px; padding: 18px; margin: 20px 0; box-shadow: 3px 3px 0px #121212; text-align: center;">
        <span style="display: block; font-size: 12px; font-weight: 800; text-transform: uppercase; color: #121212; margin-bottom: 4px;">YOUR 6-DIGIT RESET CODE</span>
        <strong style="font-size: 28px; font-family: monospace; letter-spacing: 4px; color: #121212;">{pin_code}</strong>
        <span style="display: block; font-size: 11px; color: #555555; margin-top: 4px;">Valid for 60 minutes</span>
      </div>

      <div style="text-align: center; margin: 24px 0 16px 0;">
        <a href="{reset_url}" style="display: inline-block; background-color: #ffd5dc; color: #121212; border: 2.5px solid #121212; padding: 12px 28px; font-size: 15px; font-weight: 800; text-decoration: none; border-radius: 6px; box-shadow: 4px 4px 0px #121212; text-transform: uppercase;">
          RESET PASSWORD LINK &rarr;
        </a>
      </div>

      <p style="font-size: 12px; color: #777777; margin-top: 24px;">
        If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
      </p>
    """

    body_text = f"""BingeTogether Password Reset

Hi {user.username},

Your 6-Digit Password Reset PIN: {pin_code}
Or click this link to reset your password: {reset_url}

This code is valid for 60 minutes.
"""
    full_html = _get_neo_email_wrapper("Password Reset", body_html, app_url)
    send_email_async(user.email, subject, full_html, body_text, db)

def test_smtp_connection(to_email: str, db: Session) -> Tuple[bool, str]:
    """Test SMTP connection and deliver a test email immediately."""
    config = get_all_smtp_settings(db)
    app_url = config.get("app_url", "https://localhost:6969").rstrip("/")
    subject = "BingeTogether: SMTP Test Email ✅"

    body_html = f"""
      <h2 style="margin-top: 0; font-size: 20px; font-weight: 800; color: #121212;">SMTP Configuration Verified! ✅</h2>
      <p style="font-size: 15px; margin-bottom: 16px;">
        Your SMTP settings in BingeTogether are working properly!
      </p>
      <div style="background-color: #bbf7d0; border: 2.5px solid #121212; border-radius: 6px; padding: 14px; margin: 16px 0; box-shadow: 3px 3px 0px #121212;">
        <p style="margin: 0 0 4px 0; font-size: 13px;"><strong>SMTP Server:</strong> {config.get('smtp_host')}:{config.get('smtp_port')}</p>
        <p style="margin: 0 0 4px 0; font-size: 13px;"><strong>From Email:</strong> {config.get('smtp_from_email')}</p>
        <p style="margin: 0 0 4px 0; font-size: 13px;"><strong>TLS Active:</strong> {config.get('smtp_use_tls')}</p>
      </div>
    """
    body_text = "BingeTogether: Your SMTP settings are working properly!"
    full_html = _get_neo_email_wrapper("SMTP Verification", body_html, app_url)

    return _send_mail_sync(to_email, subject, full_html, body_text, config)

def send_room_invite_email(
    to_emails: list,
    room_name: str,
    room_code: str,
    passcode: Optional[str],
    inviter_name: str,
    custom_message: Optional[str],
    db: Session
) -> int:
    """Send watch party invitation emails to multiple recipients."""
    app_url = get_system_setting("app_url", db, "https://localhost:6969").rstrip("/")
    # Ensure URL always starts with https://
    if app_url.startswith("http://"):
        app_url = "https://" + app_url[7:]
    elif not app_url.startswith("https://"):
        app_url = "https://" + app_url
    room_url = f"{app_url}/?room={room_code}"
    subject = f"{inviter_name} invited you to watch together on BingeTogether"

    custom_note_html = ""
    if custom_message and custom_message.strip():
        custom_note_html = f"""
        <div style="background-color: #faf5ff; border-left: 4px solid #a855f7; padding: 12px 16px; margin: 16px 0; font-style: italic; color: #121212; border-radius: 0 4px 4px 0;">
          &ldquo;{custom_message.strip()}&rdquo;
        </div>
        """

    passcode_html = ""
    if passcode:
        passcode_html = f"""
        <div style="background-color: #ffd5dc; border: 2px solid #121212; border-radius: 4px; padding: 8px 12px; display: inline-block; margin-top: 6px;">
          <strong style="font-size: 13px;">Passcode:</strong> <code style="font-family: monospace; font-size: 14px; font-weight: bold;">{passcode}</code>
        </div>
        """

    body_html = f"""
      <h2 style="margin-top: 0; font-size: 22px; font-weight: 800; color: #121212;">You're Invited to a Watch Party! 🍿</h2>
      <p style="font-size: 15px; margin-bottom: 16px;">
        <strong>{inviter_name}</strong> has invited you to join their synchronized watch room on BingeTogether.
      </p>

      {custom_note_html}

      <!-- Room Card in Email -->
      <div style="background-color: #fef08a; border: 2.5px solid #121212; border-radius: 6px; padding: 18px; margin: 20px 0; box-shadow: 4px 4px 0px #121212;">
        <span style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #555555; display: block; margin-bottom: 4px;">WATCH ROOM</span>
        <h3 style="margin: 0 0 10px 0; font-size: 20px; font-weight: 900; color: #121212;">{room_name}</h3>
        <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>Room Code:</strong> <span style="font-family: monospace; background: #ffffff; padding: 2px 8px; border: 1.5px solid #121212; border-radius: 3px;">{room_code}</span></p>
        {passcode_html}
      </div>

      <div style="text-align: center; margin: 28px 0 20px 0;">
        <a href="{room_url}" style="display: inline-block; background-color: #bbf7d0; color: #121212; border: 2.5px solid #121212; padding: 14px 32px; font-size: 16px; font-weight: 800; text-decoration: none; border-radius: 6px; box-shadow: 4px 4px 0px #121212; text-transform: uppercase;">
          JOIN WATCH PARTY &rarr;
        </a>
      </div>

      <p style="font-size: 13px; color: #666666; text-align: center; margin: 0;">
        Or paste this link into your browser: <br>
        <a href="{room_url}" style="color: #121212; font-weight: 600; word-break: break-all;">{room_url}</a>
      </p>
    """

    body_text = f"""You're Invited to a Watch Party on BingeTogether!

{inviter_name} has invited you to join their watch party: "{room_name}"

Join Link: {room_url}
Room Code: {room_code}
{f"Passcode: {passcode}" if passcode else ""}
{f"Message: {custom_message}" if custom_message else ""}
"""
    full_html = _get_neo_email_wrapper("Watch Party Invitation", body_html, app_url)

    sent_count = 0
    for em in to_emails:
        clean_email = str(em).strip()
        if clean_email and "@" in clean_email:
            send_email_async(clean_email, subject, full_html, body_text, db)
            sent_count += 1

    return sent_count
