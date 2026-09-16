# ============================================================
#  HygieNet Cloud Serverless API & Web Host (Vercel + Local)
# ============================================================

import os
import sys
from pathlib import Path

# Add project root to sys.path so backend module can be imported
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from flask import Flask, request, jsonify, send_from_directory, Response
from dotenv import load_dotenv
import backend.db as db

try:
    import api.static_content as static_content
except ImportError:
    try:
        import static_content
    except ImportError:
        static_content = None

load_dotenv(dotenv_path=BASE_DIR / ".env")

app = Flask(__name__, static_folder=None)

DEVICE_KEY = os.getenv("DEVICE_KEY", "hygienet_r4_sec_2026_x89")
DEFAULT_MONTHLY_LIMIT = int(os.getenv("MONTHLY_DEFAULT_LIMIT", "5"))
ADMIN_ID = os.getenv("ADMIN_ID", "admin").strip()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123").strip()

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
#  FRONTEND STATIC ROUTES (IN-MEMORY ZERO-404 BUNDLE)
# ------------------------------------------------------------

@app.route("/")
def index():
    pub_file = BASE_DIR / "public" / "index.html"
    if pub_file.exists():
        return send_from_directory(str(BASE_DIR / "public"), "index.html")
    if static_content and hasattr(static_content, "INDEX_HTML"):
        return Response(static_content.INDEX_HTML, mimetype="text/html")
    return "Not found", 404

@app.route("/style.css")
def style_css():
    pub_file = BASE_DIR / "public" / "style.css"
    if pub_file.exists():
        return send_from_directory(str(BASE_DIR / "public"), "style.css")
    if static_content and hasattr(static_content, "STYLE_CSS"):
        return Response(static_content.STYLE_CSS, mimetype="text/css")
    return send_from_directory(str(BASE_DIR / "public"), "style.css")

@app.route("/app.js")
def app_js():
    pub_file = BASE_DIR / "public" / "app.js"
    if pub_file.exists():
        return send_from_directory(str(BASE_DIR / "public"), "app.js")
    if static_content and hasattr(static_content, "APP_JS"):
        return Response(static_content.APP_JS, mimetype="application/javascript")
    return send_from_directory(str(BASE_DIR / "public"), "app.js")



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
#  AUTHENTICATION & ROLE-BASED ACCESS
# ------------------------------------------------------------

@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json(silent=True) or {}
    role = data.get("role", "").strip().lower()
    
    # Admin login check
    if role == "admin":
        admin_id = str(data.get("id", "")).strip()
        admin_pass = str(data.get("password", "")).strip()
        if admin_id == ADMIN_ID and admin_pass == ADMIN_PASSWORD:
            return jsonify({
                "success": True,
                "role": "admin",
                "name": "Administrator",
                "message": "Welcome, Administrator."
            })
        return jsonify({
            "success": False,
            "message": "Invalid Admin ID or Password."
        }), 401
    
    # Beneficiary / User login check
    user_uid = str(data.get("uid") or data.get("id", "")).strip().upper()
    if not user_uid:
        return jsonify({"success": False, "message": "Please enter a valid RFID Card UID."}), 400
    
    user = db.get_user_by_uid(user_uid)
    if not user:
        return jsonify({"success": False, "message": f"Beneficiary card '{user_uid}' is not registered."}), 404
    
    limit = user.get("monthly_limit", DEFAULT_MONTHLY_LIMIT)
    used = user.get("used_pads", 0)
    remaining = max(0, limit - used)
    
    return jsonify({
        "success": True,
        "role": "user",
        "user": {
            "name": user.get("name", "Beneficiary"),
            "rfid_uid": user_uid,
            "monthly_limit": limit,
            "used_pads": used,
            "remaining": remaining,
            "active": user.get("active", True),
            "last_dispensed_at": str(user.get("last_dispensed_at", ""))
        },
        "message": f"Welcome back, {user.get('name', 'Beneficiary')}."
    })

@app.route("/api/user/<uid>", methods=["GET"])
def get_user_profile(uid):
    uid = uid.strip().upper()
    user = db.get_user_by_uid(uid)
    if not user:
        return jsonify({"success": False, "message": "Beneficiary not found"}), 404
    
    limit = user.get("monthly_limit", DEFAULT_MONTHLY_LIMIT)
    used = user.get("used_pads", 0)
    remaining = max(0, limit - used)
    return jsonify({
        "success": True,
        "user": {
            "name": user.get("name", "Beneficiary"),
            "rfid_uid": uid,
            "monthly_limit": limit,
            "used_pads": used,
            "remaining": remaining,
            "active": user.get("active", True),
            "last_dispensed_at": str(user.get("last_dispensed_at", ""))
        }
    })

@app.route("/api/user/<uid>/transactions", methods=["GET"])
def get_user_transactions(uid):
    uid = uid.strip().upper()
    limit = int(request.args.get("limit", 20))
    txs = db.get_user_transactions(uid, limit)
    return jsonify(txs)

@app.route("/api/users/<uid>", methods=["PUT"])
def update_user_details(uid):
    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    limit = int(data.get("monthly_limit", DEFAULT_MONTHLY_LIMIT))
    
    if not name:
        return jsonify({"success": False, "message": "Name cannot be empty."}), 400
        
    ok = db.update_user(uid, name, limit)
    if ok:
        return jsonify({"success": True, "message": f"Beneficiary {name} updated successfully."})
    return jsonify({"success": False, "message": "Failed to update beneficiary."}), 400

@app.route("/api/users/<uid>", methods=["DELETE"])
def delete_user_record(uid):
    ok = db.delete_user(uid)
    if ok:
        return jsonify({"success": True, "message": f"Beneficiary card {uid} deleted successfully."})
    return jsonify({"success": False, "message": "Beneficiary not found or could not be deleted."}), 404


# ------------------------------------------------------------
#  STATIC ASSET CATCH-ALL ROUTE
# ------------------------------------------------------------

@app.route("/<path:path>")
def static_proxy(path):
    if path == "style.css":
        return style_css()
    if path == "app.js":
        return app_js()
    return index()

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
