# ============================================================
#  HygieNet: IoT Enabled Rural Women's Sanitary Solution
#  PC Flask Server - Reads Arduino Serial + Hosts Admin Website
#  Run: python eSaheli_server.py
#  Open: http://localhost:5000
# ============================================================

from flask import Flask, render_template_string, jsonify, redirect
import serial
import serial.tools.list_ports
import threading
import time
from datetime import datetime

app = Flask(__name__)

# ---- Config ----
BAUD_RATE     = 9600
MONTHLY_LIMIT = 5

def find_arduino():
    ports = serial.tools.list_ports.comports()
    for p in ports:
        if any(k in p.description for k in ["Arduino", "CH340", "CH341", "USB Serial", "ttyUSB", "ttyACM"]):
            print(f"[Serial] Auto-detected Arduino on {p.device}")
            return p.device
    if ports:
        print(f"[Serial] Arduino not found by name, trying {ports[0].device}")
        return ports[0].device
    return None

# ---- User Database ----
users = {
    "C3:27:87:14": {"name": "Sunita Yadav",  "used": 0},
    "E3:A5:AE:02": {"name": "Anita Kumari",  "used": 0},
}

# ---- State ----
transactions = []
pending_uid  = None
total_dispensed = 0
serial_status = "Connecting..."

# ============================================================
#  SERIAL READER THREAD
# ============================================================

def read_serial():
    global pending_uid, total_dispensed, serial_status

    while True:
        try:
            port = find_arduino()
            if not port:
                serial_status = "Arduino not found — check USB"
                print("[Serial] No port found, retrying in 3s")
                time.sleep(3)
                continue

            ser = serial.Serial(port, BAUD_RATE, timeout=1)
            serial_status = f"Connected on {port}"
            print(f"[Serial] Connected on {port}")

            while True:
                if ser.in_waiting:
                    line = ser.readline().decode("utf-8", errors="ignore").strip()
                    if not line:
                        continue

                    print(f"[Serial] Received: {line}")

                    if line.startswith("UID:"):
                        pending_uid = line[4:]

                    elif line.startswith("QTY:") and pending_uid:
                        qty = int(line[4:])
                        uid = pending_uid
                        pending_uid = None

                        if uid in users:
                            name = users[uid]["name"]
                            users[uid]["used"] += qty
                            status = "Dispensed"
                        else:
                            name = "Unknown"
                            status = "Invalid Card"

                        total_dispensed += qty

                        transactions.insert(0, {
                            "uid":    uid,
                            "name":   name,
                            "qty":    qty,
                            "status": status,
                            "time":   datetime.now().strftime("%H:%M:%S")
                        })

                        # Keep only last 50 transactions
                        if len(transactions) > 50:
                            transactions.pop()

                        print(f"[TX] {name} took {qty} pads — total {total_dispensed}")

        except serial.SerialException as e:
            serial_status = f"Serial error: {e}"
            print(f"[Serial] Error: {e} — retrying in 3s")
            time.sleep(3)

        except Exception as e:
            serial_status = f"Error: {e}"
            print(f"[Error] {e}")
            time.sleep(3)

# ============================================================
#  HTML TEMPLATE
# ============================================================

BASE_STYLE = """
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; background: #f0f4f8; color: #333; }
.header { background: #2e7d32; color: white; padding: 16px 24px; }
.header h1 { font-size: 22px; }
.header p { font-size: 13px; opacity: 0.85; margin-top: 2px; }
.container { padding: 20px; max-width: 960px; margin: auto; }
.nav { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
.nav a { text-decoration: none; padding: 8px 16px; background: white; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; color: #333; }
.nav a:hover { background: #e8f5e9; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
.card { background: white; border-radius: 8px; padding: 16px; border: 1px solid #ddd; }
.card .label { font-size: 12px; color: #888; margin-bottom: 6px; }
.card .value { font-size: 28px; font-weight: bold; color: #2e7d32; }
.card .sub { font-size: 12px; color: #aaa; margin-top: 4px; }
.section { background: white; border-radius: 8px; padding: 16px; margin-bottom: 20px; border: 1px solid #ddd; }
.section h2 { font-size: 15px; margin-bottom: 12px; color: #444; border-bottom: 1px solid #eee; padding-bottom: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; padding: 8px; background: #f5f5f5; color: #555; font-weight: 600; }
td { padding: 8px; border-bottom: 1px solid #f0f0f0; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; }
.badge-ok { background: #e8f5e9; color: #2e7d32; }
.badge-warn { background: #fff3e0; color: #e65100; }
.badge-err { background: #ffebee; color: #c62828; }
.bar-wrap { background: #eee; border-radius: 4px; height: 8px; width: 100%; }
.bar { background: #2e7d32; border-radius: 4px; height: 8px; }
.status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.dot-green { background: #2e7d32; }
.dot-red { background: #c62828; }
.refresh { font-size: 12px; color: #aaa; text-align: right; margin-bottom: 8px; }
"""

# ============================================================
#  ROUTES
# ============================================================

@app.route("/")
def dashboard():
    rows = ""
    for uid, u in users.items():
        used = u["used"]
        remaining = MONTHLY_LIMIT - used
        pct = min((used * 100) // MONTHLY_LIMIT, 100)
        badge = "<span class='badge badge-ok'>Active</span>" if remaining > 0 else "<span class='badge badge-warn'>Limit reached</span>"
        rows += f"""
        <tr>
          <td>{u['name']}</td>
          <td style='font-family:monospace'>{uid}</td>
          <td>{used} / {MONTHLY_LIMIT}</td>
          <td>{remaining} pads</td>
          <td>{badge}</td>
          <td><div class='bar-wrap'><div class='bar' style='width:{pct}%'></div></div></td>
        </tr>"""

    recent = ""
    for t in transactions[:5]:
        badge_class = "badge-ok" if t["status"] == "Dispensed" else "badge-err"
        recent += f"""
        <tr>
          <td>{t['name']}</td>
          <td style='font-family:monospace'>{t['uid']}</td>
          <td>{t['qty']}</td>
          <td><span class='badge {badge_class}'>{t['status']}</span></td>
          <td>{t['time']}</td>
        </tr>"""

    dot = "dot-green" if "Connected" in serial_status else "dot-red"

    html = f"""<!DOCTYPE html><html><head>
    <meta charset='UTF-8'>
    <meta name='viewport' content='width=device-width,initial-scale=1'>
    <title>HygieNet Admin</title>
    <style>{BASE_STYLE}</style>
    <script>setTimeout(() => location.reload(), 5000);</script>
    </head><body>
    <div class='header'>
      <h1>HygieNet Admin Dashboard</h1>
      <p>IoT Sanitary Vending Machine — MMMUT Gorakhpur</p>
    </div>
    <div class='container'>
      <div class='nav'>
        <a href='/'>Dashboard</a>
        <a href='/log'>Transaction Log</a>
        <a href='/users'>Users</a>
        <a href='/reset'>Reset Monthly</a>
      </div>
      <p class='refresh'><span class='status-dot {dot}'></span>{serial_status} — auto refreshes every 5s</p>
      <div class='cards'>
        <div class='card'><div class='label'>Total Dispensed</div><div class='value'>{total_dispensed}</div><div class='sub'>pads this session</div></div>
        <div class='card'><div class='label'>Transactions</div><div class='value'>{len(transactions)}</div><div class='sub'>total scans</div></div>
        <div class='card'><div class='label'>Registered Users</div><div class='value'>{len(users)}</div><div class='sub'>active cards</div></div>
        <div class='card'><div class='label'>Monthly Limit</div><div class='value'>{MONTHLY_LIMIT}</div><div class='sub'>pads per user</div></div>
      </div>
      <div class='section'>
        <h2>User Monthly Usage</h2>
        <table>
          <tr><th>Name</th><th>UID</th><th>Used</th><th>Remaining</th><th>Status</th><th>Usage</th></tr>
          {rows}
        </table>
      </div>
      <div class='section'>
        <h2>Recent Transactions</h2>
        <table>
          <tr><th>Name</th><th>UID</th><th>Qty</th><th>Status</th><th>Time</th></tr>
          {recent if recent else "<tr><td colspan='5' style='color:#aaa;text-align:center;padding:20px'>No transactions yet — scan a card!</td></tr>"}
        </table>
      </div>
    </div></body></html>"""

    return html


@app.route("/log")
def log():
    rows = ""
    for i, t in enumerate(transactions):
        badge_class = "badge-ok" if t["status"] == "Dispensed" else "badge-err"
        rows += f"<tr><td>{i+1}</td><td>{t['name']}</td><td style='font-family:monospace'>{t['uid']}</td><td>{t['qty']}</td><td><span class='badge {badge_class}'>{t['status']}</span></td><td>{t['time']}</td></tr>"

    html = f"""<!DOCTYPE html><html><head>
    <meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
    <title>Transaction Log</title><style>{BASE_STYLE}</style>
    <script>setTimeout(() => location.reload(), 5000);</script>
    </head><body>
    <div class='header'><h1>Transaction Log</h1><p>HygieNet — MMMUT Gorakhpur</p></div>
    <div class='container'>
      <div class='nav'><a href='/'>Dashboard</a><a href='/log'>Log</a><a href='/users'>Users</a><a href='/reset'>Reset</a></div>
      <div class='section'>
        <table><tr><th>#</th><th>Name</th><th>UID</th><th>Qty</th><th>Status</th><th>Time</th></tr>
        {rows if rows else "<tr><td colspan='6' style='color:#aaa;text-align:center;padding:20px'>No transactions yet</td></tr>"}
        </table>
      </div>
    </div></body></html>"""
    return html


@app.route("/users")
def user_list():
    rows = ""
    for uid, u in users.items():
        remaining = MONTHLY_LIMIT - u["used"]
        status = "<span class='badge badge-ok'>Active</span>" if remaining > 0 else "<span class='badge badge-warn'>Limit reached</span>"
        rows += f"<tr><td>{u['name']}</td><td style='font-family:monospace'>{uid}</td><td>{u['used']}</td><td>{MONTHLY_LIMIT}</td><td>{remaining}</td><td>{status}</td></tr>"

    html = f"""<!DOCTYPE html><html><head>
    <meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
    <title>Users</title><style>{BASE_STYLE}</style>
    </head><body>
    <div class='header'><h1>Registered Users</h1><p>HygieNet — MMMUT Gorakhpur</p></div>
    <div class='container'>
      <div class='nav'><a href='/'>Dashboard</a><a href='/log'>Log</a><a href='/users'>Users</a><a href='/reset'>Reset</a></div>
      <div class='section'>
        <table><tr><th>Name</th><th>UID</th><th>Used</th><th>Limit</th><th>Remaining</th><th>Status</th></tr>
        {rows}
        </table>
      </div>
    </div></body></html>"""
    return html


@app.route("/reset")
def reset():
    global total_dispensed
    for uid in users:
        users[uid]["used"] = 0
    total_dispensed = 0
    transactions.clear()
    return redirect("/")


# ============================================================
#  MAIN
# ============================================================

if __name__ == "__main__":
    t = threading.Thread(target=read_serial, daemon=True)
    t.start()
    print("=" * 50)
    print("  HygieNet Admin Server running!")
    print("  Open: http://localhost:5000")
    print("=" * 50)
    app.run(host="0.0.0.0", port=5000, debug=False)
