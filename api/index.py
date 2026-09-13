# ============================================================
#  HygieNet Cloud Serverless API & Web Host (Vercel + Local)
# ============================================================

import os
import sys
from pathlib import Path

# Add project root to sys.path so backend module can be imported
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv
import backend.db as db

load_dotenv(dotenv_path=BASE_DIR / ".env")

app = Flask(__name__, static_folder=None)

DEVICE_KEY = os.getenv("DEVICE_KEY", "hygienet_r4_sec_2026_x89")
DEFAULT_MONTHLY_LIMIT = int(os.getenv("MONTHLY_DEFAULT_LIMIT", "5"))

def verify_device_key(req):
    """
    Validates the X-Device-Key header to prevent unauthorized API calls.
    Web browser requests with 'X-Client: Web' or local simulator calls are allowed.
    """
    header_key = req.headers.get("X-Device-Key", "")
    client_type = req.headers.get("X-Client", "")
    if client_type == "WebSimulator":
        return True
    return header_key == DEVICE_KEY

# ------------------------------------------------------------
#  FRONTEND STATIC ROUTES
# ------------------------------------------------------------

def get_public_dir():
    candidates = [
        Path(__file__).resolve().parent / "public",
        BASE_DIR / "public",
        Path.cwd() / "public",
        Path.cwd() / "api" / "public",
        Path("/var/task/public"),
        Path("/var/task/api/public"),
    ]
    for c in candidates:
        if c.exists() and (c / "index.html").exists():
            return c
    return BASE_DIR / "public"

@app.route("/")
def index():
    pub = get_public_dir()
    return send_from_directory(str(pub), "index.html")


# ------------------------------------------------------------
#  ARDUINO UNO R4 WIFI API ENDPOINTS
# ------------------------------------------------------------

@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "online",
        "service": "HygieNet Cloud API",
        "database": db.get_connection_status()
    })

@app.route("/api/device/ping", methods=["POST"])
def device_ping():
    data = request.get_json(silent=True) or {}
    device_id = data.get("device_id", "hygienet-01")
    firmware = data.get("firmware", "2.0.0-R4")
    rssi = data.get("rssi", 0)

    db.update_device_ping(device_id, firmware, rssi)
    return jsonify({
        "status": "ack",
        "device_id": device_id,
        "server_time": db.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })

@app.route("/api/card/verify", methods=["POST"])
def verify_card():
    """
    Called by UNO R4 WiFi when an RFID card is tapped.
    Validates authorization, calculates remaining pads for the month,
    and instructs the R4 OLED on what to display.
    """
    if not verify_device_key(request):
        return jsonify({"authorized": False, "reason": "UNAUTHORIZED_DEVICE", "message": "Invalid Device Key"}), 401

    data = request.get_json(silent=True) or {}
    uid = data.get("uid", "").strip().upper()
    device_id = data.get("device_id", "hygienet-01")

    if not uid:
        return jsonify({"authorized": False, "reason": "NO_UID", "message": "UID missing"}), 400

    user = db.get_user_by_uid(uid)

    if not user:
        # Log invalid card attempt
        db.log_transaction(uid, "Unknown", device_id, 0, "INVALID_CARD", 0)
        return jsonify({
            "authorized": False,
            "reason": "CARD_NOT_FOUND",
            "message": "Unregistered card. Contact admin.",
            "uid": uid
        })

    monthly_limit = user.get("monthly_limit", DEFAULT_MONTHLY_LIMIT)
    used_pads = user.get("used_pads", 0)
    remaining = max(0, monthly_limit - used_pads)

    if remaining <= 0:
        db.log_transaction(uid, user.get("name", "Unknown"), device_id, 0, "DENIED_LIMIT_REACHED", 0)
        return jsonify({
            "authorized": False,
            "reason": "LIMIT_REACHED",
            "name": user.get("name", "User"),
            "used_pads": used_pads,
            "monthly_limit": monthly_limit,
            "remaining": 0,
            "message": "Monthly pad quota exhausted."
        })

    # Return authorization and allowable pad range
    return jsonify({
        "authorized": True,
        "name": user.get("name", "User"),
        "monthly_limit": monthly_limit,
        "used_pads": used_pads,
        "remaining": remaining,
        "max_selectable": min(remaining, 5) # Safe limit per transaction
    })

@app.route("/api/dispense/complete", methods=["POST"])
def dispense_complete():
    """
    Called by UNO R4 WiFi after user presses CONFIRM button.
    Server deducts remaining pads atomically and commits transaction.
    """
    if not verify_device_key(request):
        return jsonify({"success": False, "reason": "UNAUTHORIZED_DEVICE"}), 401

    data = request.get_json(silent=True) or {}
    uid = data.get("uid", "").strip().upper()
    device_id = data.get("device_id", "hygienet-01")
    quantity = int(data.get("quantity", 1))

    if not uid or quantity <= 0:
        return jsonify({"success": False, "reason": "INVALID_PARAMS"}), 400

    result = db.record_dispense(uid, device_id, quantity)
    if result.get("success"):
        return jsonify(result), 200
    else:
        return jsonify(result), 400

# ------------------------------------------------------------
#  DASHBOARD & MANAGEMENT APIS
# ------------------------------------------------------------

@app.route("/api/dashboard/stats", methods=["GET"])
def dashboard_stats():
    stats = db.get_dashboard_summary()
    return jsonify(stats)

@app.route("/api/users", methods=["GET"])
def list_users():
    users = db.get_all_users()
    return jsonify(users)

@app.route("/api/users", methods=["POST"])
def save_user():
    data = request.get_json(silent=True) or {}
    uid = data.get("rfid_uid", "").strip().upper()
    name = data.get("name", "").strip()
    limit = int(data.get("monthly_limit", DEFAULT_MONTHLY_LIMIT))

    if not uid or not name:
        return jsonify({"success": False, "message": "UID and Name are required."}), 400

    db.upsert_user(uid, name, limit)
    return jsonify({"success": True, "message": f"User {name} saved successfully."})

@app.route("/api/users/reset", methods=["POST"])
def reset_users():
    data = request.get_json(silent=True) or {}
    uid = data.get("rfid_uid")

    if uid:
        db.reset_user_monthly(uid)
        return jsonify({"success": True, "message": f"Reset limit for card {uid}"})
    else:
        db.reset_all_monthly()
        return jsonify({"success": True, "message": "All monthly limits reset to 0."})

@app.route("/api/transactions", methods=["GET"])
def list_transactions():
    limit = int(request.args.get("limit", 50))
    txs = db.get_recent_transactions(limit)
    return jsonify(txs)

# ------------------------------------------------------------
#  STATIC ASSET CATCH-ALL ROUTE
# ------------------------------------------------------------

@app.route("/<path:path>")
def static_proxy(path):
    pub = get_public_dir()
    file_path = pub / path
    if file_path.exists() and file_path.is_file():
        return send_from_directory(str(pub), path)
    return send_from_directory(str(pub), "index.html")

# ------------------------------------------------------------
#  LOCAL LAUNCHER
# ------------------------------------------------------------


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    print("=" * 60)
    print("  HygieNet Cloud Server Running!")
    print(f"  Local URL: http://localhost:{port}")
    print("  Vercel Serverless Ready")
    print("=" * 60)
    app.run(host="0.0.0.0", port=port, debug=False)
