# ============================================================
#  HygieNet Cloud — Transactional Email & OTP Dispatcher
# ============================================================

import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

def get_smtp_config():
    return {
        "host": os.getenv("SMTP_HOST", "smtp.gmail.com"),
        "port": int(os.getenv("SMTP_PORT", 587)),
        "user": os.getenv("SMTP_USER", "").strip(),
        "password": os.getenv("SMTP_PASS", "").strip(),
        "from_addr": os.getenv("SMTP_FROM", "HygieNet Cloud <no-reply@hygienet.org>").strip()
    }

def send_otp_email(to_email: str, recipient_name: str, otp: str) -> dict:
    """
    Dispatches a branded 6-digit OTP verification email to the beneficiary.
    If SMTP credentials are not configured, logs a clear message and returns
    a graceful diagnostic without throwing or blocking the registration.
    """
    to_email = (to_email or "").strip().lower()
    if not to_email or "@" not in to_email:
        return {"sent": False, "message": "Invalid recipient email address"}

    config = get_smtp_config()
    sender = config["from_addr"]
    if not config["user"]:
        print(f"[HygieNet Mailer] SMTP_USER is not configured in .env. OTP for {to_email}: {otp}")
        return {
            "sent": False,
            "message": f"SMTP not configured in .env. Dispatched in local simulation mode (OTP: {otp}).",
            "simulated": True
        }

    # Subject & HTML Content
    subject = f"HygieNet Verification Code: {otp}"
    name_display = recipient_name.strip() if recipient_name else "Student"

    html_body = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px; color: #1e293b; }}
    .container {{ max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }}
    .header {{ background: linear-gradient(135deg, #059669 0%, #0d9488 100%); padding: 28px 24px; text-align: center; color: #ffffff; }}
    .header h1 {{ margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }}
    .header p {{ margin: 6px 0 0 0; font-size: 13px; opacity: 0.9; }}
    .content {{ padding: 32px 28px; }}
    .greeting {{ font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 12px; }}
    .intro {{ font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 24px; }}
    .otp-box {{ background: #f8fafc; border: 2px dashed #10b981; border-radius: 10px; padding: 20px; text-align: center; margin: 20px 0; }}
    .otp-label {{ font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #059669; margin-bottom: 6px; }}
    .otp-code {{ font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #047857; margin: 0; }}
    .expiry {{ font-size: 12px; color: #64748b; margin-top: 8px; }}
    .security-notice {{ background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 14px; font-size: 12px; color: #92400e; border-radius: 4px; margin-top: 24px; line-height: 1.5; }}
    .footer {{ background: #f8fafc; padding: 18px 24px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>HygieNet Cloud</h1>
      <p>Automated Sanitary Vending Management • MMMUT Gorakhpur</p>
    </div>
    <div class="content">
      <div class="greeting">Hello {name_display},</div>
      <div class="intro">
        You have requested to register your Aadhaar identity for a HygieNet Sanitary RFID Card. Please enter the verification code below to verify your email and queue your card for allotment:
      </div>
      
      <div class="otp-box">
        <div class="otp-label">Your One-Time Password</div>
        <div class="otp-code">{otp}</div>
        <div class="expiry">⏱ Valid for the next 10 minutes</div>
      </div>

      <div class="security-notice">
        <strong>Security Tip:</strong> Never share this OTP with anyone. HygieNet campus staff will never ask for your verification code.
      </div>
    </div>
    <div class="footer">
      &copy; 2026 HygieNet Cloud Solutions • MMMUT Gorakhpur • Automated Notification System
    </div>
  </div>
</body>
</html>
"""

    text_body = f"""Hello {name_display},

Your HygieNet Card Registration OTP is: {otp}

This code is valid for 10 minutes.
If you did not request this verification, please disregard this email.

— HygieNet Cloud Team (MMMUT Gorakhpur)
"""

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = sender
        msg["To"] = to_email

        msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        with smtplib.SMTP(config["host"], config["port"], timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(config["user"], config["password"])
            server.sendmail(sender, [to_email], msg.as_string())

        print(f"[HygieNet Mailer] Successfully dispatched OTP email to {to_email} via {config['host']}")
        return {"sent": True, "message": f"Verification code sent to {to_email}"}
    except Exception as e:
        print(f"[HygieNet Mailer Error] Failed sending OTP email to {to_email}: {e}")
        return {
            "sent": False,
            "message": f"Could not connect to SMTP server: {e}. Check .env credentials.",
            "error": str(e)
        }
