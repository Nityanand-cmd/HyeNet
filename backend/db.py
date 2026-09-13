# ============================================================
#  HygieNet Cloud Edition - MongoDB Atlas Database Layer
# ============================================================

import os
from datetime import datetime, timezone
from dotenv import load_dotenv
import certifi
import pymongo
from pymongo.errors import PyMongoError

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "")
DEFAULT_MONTHLY_LIMIT = int(os.getenv("MONTHLY_DEFAULT_LIMIT", "5"))

_client = None
_db = None
_is_connected = False
_connection_error = None

# Fallback in-memory store in case MongoDB Atlas credentials need updating
_fallback_users = {
    "C3:27:87:14": {"name": "Sunita Yadav", "monthly_limit": 5, "used_pads": 0, "active": True},
    "E3:A5:AE:02": {"name": "Anita Kumari", "monthly_limit": 5, "used_pads": 0, "active": True}
}
_fallback_transactions = []
_fallback_devices = {}

def get_db():
    global _client, _db, _is_connected, _connection_error
    if _db is not None and _is_connected:
        return _db

    if not MONGODB_URI:
        _is_connected = False
        _connection_error = "MONGODB_URI is not configured in .env"
        return None

    try:
        # Strip quotes if present in .env
        clean_uri = MONGODB_URI.strip().strip('"').strip("'")
        
        # Connect to MongoDB Atlas with CA certs and timeout
        _client = pymongo.MongoClient(
            clean_uri,
            tlsCAFile=certifi.where(),
            serverSelectionTimeoutMS=4000
        )
        
        # Test connection ping
        _client.admin.command('ping')
        
        # Use database 'hygienet'
        _db = _client.get_database("hygienet")
        _is_connected = True
        _connection_error = None
        print("[MongoDB] Successfully connected to MongoDB Atlas!")
        
        # Initialize collections & indexes
        _init_database(_db)
        return _db

    except Exception as e:
        _is_connected = False
        _connection_error = str(e)
        print(f"[MongoDB Warning] Connection error: {e}")
        print("[MongoDB] Operating in resilient fallback mode.")
        return None

def _init_database(db):
    try:
        # Ensure unique index on rfid_uid
        db.users.create_index("rfid_uid", unique=True)
        db.transactions.create_index([("timestamp", pymongo.DESCENDING)])
        db.devices.create_index("device_id", unique=True)

        # Seed initial test cards if users collection is empty
        if db.users.count_documents({}) == 0:
            initial_users = [
                {
                    "rfid_uid": "C3:27:87:14",
                    "name": "Sunita Yadav",
                    "monthly_limit": DEFAULT_MONTHLY_LIMIT,
                    "used_pads": 0,
                    "active": True,
                    "created_at": datetime.now(timezone.utc)
                },
                {
                    "rfid_uid": "E3:A5:AE:02",
                    "name": "Anita Kumari",
                    "monthly_limit": DEFAULT_MONTHLY_LIMIT,
                    "used_pads": 0,
                    "active": True,
                    "created_at": datetime.now(timezone.utc)
                }
            ]
            db.users.insert_many(initial_users)
            print("[MongoDB] Seeded default test users into 'users' collection.")
    except Exception as e:
        print(f"[MongoDB] Init warning: {e}")

def get_connection_status():
    get_db()
    return {
        "connected": _is_connected,
        "error": _connection_error,
        "mode": "MongoDB Atlas" if _is_connected else "Fallback Memory Store"
    }

# ------------------------------------------------------------
#  USER OPERATIONS
# ------------------------------------------------------------

def get_user_by_uid(uid: str):
    uid = uid.strip().upper()
    db = get_db()
    if db is not None:
        try:
            return db.users.find_one({"rfid_uid": uid})
        except Exception as e:
            print(f"[MongoDB Error] get_user_by_uid: {e}")

    # Fallback
    if uid in _fallback_users:
        u = _fallback_users[uid].copy()
        u["rfid_uid"] = uid
        return u
    return None

def get_all_users():
    db = get_db()
    if db is not None:
        try:
            cursor = db.users.find().sort("name", pymongo.ASCENDING)
            results = []
            for doc in cursor:
                doc["_id"] = str(doc.get("_id", ""))
                results.append(doc)
            return results
        except Exception as e:
            print(f"[MongoDB Error] get_all_users: {e}")

    # Fallback
    results = []
    for uid, data in _fallback_users.items():
        results.append({
            "rfid_uid": uid,
            "name": data["name"],
            "monthly_limit": data.get("monthly_limit", DEFAULT_MONTHLY_LIMIT),
            "used_pads": data.get("used_pads", 0),
            "active": data.get("active", True)
        })
    return results

def upsert_user(rfid_uid: str, name: str, monthly_limit: int = DEFAULT_MONTHLY_LIMIT):
    rfid_uid = rfid_uid.strip().upper()
    db = get_db()
    if db is not None:
        try:
            result = db.users.update_one(
                {"rfid_uid": rfid_uid},
                {
                    "$set": {
                        "name": name,
                        "monthly_limit": monthly_limit,
                        "active": True,
                        "updated_at": datetime.now(timezone.utc)
                    },
                    "$setOnInsert": {
                        "used_pads": 0,
                        "created_at": datetime.now(timezone.utc)
                    }
                },
                upsert=True
            )
            return True
        except Exception as e:
            print(f"[MongoDB Error] upsert_user: {e}")

    # Fallback
    if rfid_uid in _fallback_users:
        _fallback_users[rfid_uid]["name"] = name
        _fallback_users[rfid_uid]["monthly_limit"] = monthly_limit
    else:
        _fallback_users[rfid_uid] = {
            "name": name,
            "monthly_limit": monthly_limit,
            "used_pads": 0,
            "active": True
        }
    return True

def reset_all_monthly():
    db = get_db()
    if db is not None:
        try:
            db.users.update_many({}, {"$set": {"used_pads": 0}})
            return True
        except Exception as e:
            print(f"[MongoDB Error] reset_all_monthly: {e}")

    for uid in _fallback_users:
        _fallback_users[uid]["used_pads"] = 0
    return True

def reset_user_monthly(uid: str):
    uid = uid.strip().upper()
    db = get_db()
    if db is not None:
        try:
            db.users.update_one({"rfid_uid": uid}, {"$set": {"used_pads": 0}})
            return True
        except Exception as e:
            print(f"[MongoDB Error] reset_user_monthly: {e}")

    if uid in _fallback_users:
        _fallback_users[uid]["used_pads"] = 0
        return True
    return False

# ------------------------------------------------------------
#  DISPENSE & TRANSACTION OPERATIONS
# ------------------------------------------------------------

def record_dispense(uid: str, device_id: str, quantity: int):
    """
    Atomically verifies balance and records the dispense transaction.
    """
    uid = uid.strip().upper()
    db = get_db()
    
    if db is not None:
        try:
            user = db.users.find_one({"rfid_uid": uid})
            if not user:
                return {"success": False, "reason": "CARD_NOT_FOUND", "message": "Card not registered"}

            monthly_limit = user.get("monthly_limit", DEFAULT_MONTHLY_LIMIT)
            current_used = user.get("used_pads", 0)
            remaining = monthly_limit - current_used

            if quantity > remaining:
                log_transaction(uid, user.get("name", "Unknown"), device_id, quantity, "DENIED_LIMIT_REACHED", remaining)
                return {
                    "success": False,
                    "reason": "LIMIT_EXCEEDED",
                    "remaining": remaining,
                    "message": f"Requested {quantity} but only {remaining} pads remaining."
                }

            # Atomic increment in MongoDB
            result = db.users.find_one_and_update(
                {"rfid_uid": uid, "used_pads": {"$lte": monthly_limit - quantity}},
                {"$inc": {"used_pads": quantity}, "$set": {"last_dispensed_at": datetime.now(timezone.utc)}},
                return_document=pymongo.ReturnDocument.AFTER
            )

            if not result:
                return {"success": False, "reason": "CONCURRENCY_ERROR", "message": "Limit check failed"}

            new_remaining = monthly_limit - result["used_pads"]
            
            # Log transaction
            log_transaction(uid, user.get("name", "Unknown"), device_id, quantity, "DISPENSED", new_remaining)

            # Update device statistics
            db.devices.update_one(
                {"device_id": device_id},
                {
                    "$inc": {"total_dispensed": quantity},
                    "$set": {"last_seen": datetime.now(timezone.utc), "status": "ONLINE"}
                },
                upsert=True
            )

            return {
                "success": True,
                "user_name": user.get("name", "Unknown"),
                "dispensed": quantity,
                "used_pads": result["used_pads"],
                "remaining": new_remaining
            }

        except Exception as e:
            print(f"[MongoDB Error] record_dispense: {e}")

    # Resilient Fallback Store
    if uid not in _fallback_users:
        log_transaction(uid, "Unknown", device_id, quantity, "INVALID_CARD", 0)
        return {"success": False, "reason": "CARD_NOT_FOUND", "message": "Card not registered"}

    user = _fallback_users[uid]
    monthly_limit = user.get("monthly_limit", DEFAULT_MONTHLY_LIMIT)
    current_used = user.get("used_pads", 0)
    remaining = monthly_limit - current_used

    if quantity > remaining:
        log_transaction(uid, user["name"], device_id, quantity, "DENIED_LIMIT_REACHED", remaining)
        return {"success": False, "reason": "LIMIT_EXCEEDED", "remaining": remaining}

    user["used_pads"] += quantity
    new_remaining = monthly_limit - user["used_pads"]
    log_transaction(uid, user["name"], device_id, quantity, "DISPENSED", new_remaining)

    return {
        "success": True,
        "user_name": user["name"],
        "dispensed": quantity,
        "used_pads": user["used_pads"],
        "remaining": new_remaining
    }

def log_transaction(uid: str, name: str, device_id: str, quantity: int, status: str, remaining_after: int):
    tx_record = {
        "rfid_uid": uid,
        "user_name": name,
        "device_id": device_id,
        "quantity": quantity,
        "status": status,
        "remaining_after": remaining_after,
        "timestamp": datetime.now(timezone.utc)
    }

    db = get_db()
    if db is not None:
        try:
            db.transactions.insert_one(tx_record)
            return
        except Exception as e:
            print(f"[MongoDB Error] log_transaction: {e}")

    # Fallback
    _fallback_transactions.insert(0, {
        "rfid_uid": uid,
        "user_name": name,
        "device_id": device_id,
        "quantity": quantity,
        "status": status,
        "remaining_after": remaining_after,
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    })
    if len(_fallback_transactions) > 100:
        _fallback_transactions.pop()

def get_recent_transactions(limit: int = 50):
    db = get_db()
    if db is not None:
        try:
            cursor = db.transactions.find().sort("timestamp", pymongo.DESCENDING).limit(limit)
            txs = []
            for doc in cursor:
                doc["_id"] = str(doc.get("_id", ""))
                if isinstance(doc.get("timestamp"), datetime):
                    doc["timestamp"] = doc["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
                txs.append(doc)
            return txs
        except Exception as e:
            print(f"[MongoDB Error] get_recent_transactions: {e}")

    return _fallback_transactions[:limit]

# ------------------------------------------------------------
#  DEVICE HEARTBEAT & STATS
# ------------------------------------------------------------

def update_device_ping(device_id: str, firmware: str = "2.0.0", rssi: int = 0):
    db = get_db()
    if db is not None:
        try:
            db.devices.update_one(
                {"device_id": device_id},
                {
                    "$set": {
                        "last_seen": datetime.now(timezone.utc),
                        "status": "ONLINE",
                        "firmware_version": firmware,
                        "rssi": rssi
                    },
                    "$setOnInsert": {
                        "total_dispensed": 0,
                        "registered_at": datetime.now(timezone.utc)
                    }
                },
                upsert=True
            )
            return True
        except Exception as e:
            print(f"[MongoDB Error] update_device_ping: {e}")

    _fallback_devices[device_id] = {
        "last_seen": datetime.now(timezone.utc).strftime("%H:%M:%S"),
        "status": "ONLINE",
        "firmware": firmware,
        "rssi": rssi
    }
    return True

def get_dashboard_summary():
    db = get_db()
    if db is not None:
        try:
            user_count = db.users.count_documents({})
            
            # Sum total pads dispensed
            pipeline = [
                {"$match": {"status": "DISPENSED"}},
                {"$group": {"_id": None, "total": {"$sum": "$quantity"}}}
            ]
            agg = list(db.transactions.aggregate(pipeline))
            total_dispensed = agg[0]["total"] if agg else 0

            # Today's transactions
            start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            today_tx_count = db.transactions.count_documents({"timestamp": {"$gte": start_of_day}})

            # Devices online status
            devices = list(db.devices.find())
            for d in devices:
                d["_id"] = str(d.get("_id", ""))
                if isinstance(d.get("last_seen"), datetime):
                    d["last_seen_str"] = d["last_seen"].strftime("%H:%M:%S")
                    diff_seconds = (datetime.now(timezone.utc) - d["last_seen"]).total_seconds()
                    d["is_active"] = diff_seconds < 120
                else:
                    d["is_active"] = False

            return {
                "total_dispensed": total_dispensed,
                "today_transactions": today_tx_count,
                "registered_users": user_count,
                "monthly_limit": DEFAULT_MONTHLY_LIMIT,
                "devices": devices,
                "connection": get_connection_status()
            }
        except Exception as e:
            print(f"[MongoDB Error] get_dashboard_summary: {e}")

    # Fallback metrics
    total_disp = sum(u.get("used_pads", 0) for u in _fallback_users.values())
    return {
        "total_dispensed": total_disp,
        "today_transactions": len(_fallback_transactions),
        "registered_users": len(_fallback_users),
        "monthly_limit": DEFAULT_MONTHLY_LIMIT,
        "devices": [{"device_id": k, "status": v["status"], "is_active": True} for k, v in _fallback_devices.items()],
        "connection": get_connection_status()
    }
