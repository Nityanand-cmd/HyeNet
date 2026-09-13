============================================
 HygieNet - IoT Sanitary Vending Machine
 (Cloud Edition: Arduino UNO R4 WiFi + Vercel + MongoDB Atlas)
 Setup & Run Instructions
============================================

FILES IN THIS PROJECT:
----------------------
1. HygieNet_R4_WiFi/HygieNet_R4_WiFi.ino  -> Upload this to your Arduino UNO R4 WiFi
2. HygieNet_R4_WiFi/config.h              -> WiFi, server, device key, and pin settings
3. backend/api.py (api/index.py)          -> Serverless backend, deployed to Vercel
4. backend/db.py                          -> MongoDB Atlas connection + seeding
5. public/index.html, style.css, app.js   -> Admin dashboard (served by Vercel)
6. vercel.json                            -> Vercel routing config
7. requirements.txt                       -> Python backend dependencies
8. .env                                   -> MONGODB_URI, DEVICE_KEY, MONTHLY_DEFAULT_LIMIT
9. run_cloud_server.bat                   -> Double-click to run backend + dashboard locally

============================================
 STEP-BY-STEP: FIRST TIME SETUP
============================================

STEP 1 - Set up MongoDB Atlas
---------------------------------
1. Create a free M0 cluster at https://cloud.mongodb.com (see docs/MONGODB_SETUP_GUIDE.md)
2. Create a database user with a username/password under "Database Access"
3. Under Network Access, add 0.0.0.0/0 (Allow Access from Anywhere)
   - required because Vercel functions run on dynamic AWS IPs
4. Copy your connection string:
   mongodb+srv://<user>:<password>@cluster0...mongodb.net/
5. Paste it into .env as MONGODB_URI

STEP 2 - Install Python requirements (only once, for local testing)
---------------------------------
Open Command Prompt and run:
   pip install -r requirements.txt

STEP 3 - Configure .env
---------------------------------
Edit .env and set:
   MONGODB_URI=<your Atlas connection string>
   DEVICE_KEY=hygienet_r4_sec_2026_x89
   MONTHLY_DEFAULT_LIMIT=5

STEP 4 - Deploy backend + dashboard to Vercel
---------------------------------
Option A - Vercel CLI:
   1. Install: npm i -g vercel   (or run "vercel" once npx prompts install)
   2. From the project folder, run: vercel
   3. Set environment variables when prompted (or via Vercel dashboard ->
      Project -> Settings -> Environment Variables): MONGODB_URI, DEVICE_KEY
   4. Run: vercel --prod
   5. Note your live URL, e.g. https://your-hygienet.vercel.app

Option B - GitHub:
   1. Push this project to a GitHub repository
   2. Import the repo at https://vercel.com/new
   3. Add MONGODB_URI and DEVICE_KEY as Environment Variables in the
      Vercel project settings
   4. Deploy

See docs/VERCEL_DEPLOYMENT_GUIDE.md for full walkthrough.

STEP 5 - Configure the Arduino firmware
---------------------------------
1. Open HygieNet_R4_WiFi/config.h
2. Set:
   WIFI_SSID       = "your-wifi-name"
   WIFI_PASSWORD   = "your-wifi-password"
   SERVER_HOST     = "your-hygienet.vercel.app"   (no https://, no trailing slash)
   DEVICE_KEY      = "hygienet_r4_sec_2026_x89"   (must match .env DEVICE_KEY)
   DEVICE_ID       = "hygienet-01"
3. Confirm pin definitions match your wiring (OLED, RC522, buttons, servos)

STEP 6 - Upload firmware to Arduino UNO R4 WiFi
---------------------------------
1. Open Arduino IDE
2. Install board support: Tools -> Board -> Boards Manager -> search
   "Arduino UNO R4 Boards" -> Install
3. Open HygieNet_R4_WiFi.ino
4. Connect the UNO R4 WiFi via USB
5. Go to Tools -> Board -> Arduino UNO R4 WiFi
6. Go to Tools -> Port -> select the COM port shown
7. Click Upload
8. Open Serial Monitor at 115200 baud to watch WiFi connect and the
   TLS handshake with Vercel

Make sure these libraries are installed first
(Tools -> Manage Libraries -> search & install each):
   - MFRC522 (by GithubCommunity)
   - Adafruit SSD1306
   - Adafruit GFX Library
   - Servo (usually pre-installed)
   - WiFiS3 (bundled with the UNO R4 board package - no separate install needed)

============================================
 EVERY TIME YOU WANT TO RUN THE SYSTEM
============================================

STEP 1 - Power on the machine
   The UNO R4 WiFi just needs power (USB or external 5V) - no PC connection
   required. It connects to WiFi and to Vercel on its own.

STEP 2 - Open the admin dashboard
   Open any browser and go to your live Vercel URL:
   https://your-hygienet.vercel.app

   (Optional) To test locally instead:
   Double-click run_cloud_server.bat, then open http://localhost:5000

STEP 3 - Use the machine
   - Scan a registered RFID card
   - OLED shows the user's name and remaining pads for the month
   - Use the 3 buttons to select quantity (+ / - / Confirm), clamped to
     the remaining quota
   - Dashboard updates the transaction in real time

STEP 4 - Stop local testing (if using run_cloud_server.bat)
   Click into the black command window and press Ctrl+C,
   or just close the window.
   (The live Vercel deployment keeps running independently of your PC.)

============================================
 REGISTERED TEST CARDS (seeded into MongoDB on first run)
============================================
   C3:27:87:14  -> Sunita Yadav
   E3:A5:AE:02  -> Anita Kumari
   Any other UID -> Unregistered (shows Invalid Card)

Monthly limit per user: 5 pads (MONTHLY_DEFAULT_LIMIT in .env)

============================================
 TROUBLESHOOTING
============================================
- OLED stuck on "Connecting to WiFi...":
    Double-check WIFI_SSID/WIFI_PASSWORD in config.h; confirm your
    network is 2.4GHz (the R4 WiFi module does not support 5GHz-only networks)

- OLED shows "Server Unreachable" / TLS error:
    Check SERVER_HOST in config.h has no "https://" prefix and no
    trailing slash; confirm the Vercel deployment is live by opening
    the URL in a browser

- "Unauthorized" / card always rejected:
    Confirm DEVICE_KEY in config.h exactly matches DEVICE_KEY in
    Vercel's environment variables

- Dashboard shows no data / 500 errors:
    Check MONGODB_URI is correct and that Network Access in Atlas is
    set to 0.0.0.0/0; check Vercel function logs for the exact error

- OLED blank:
    Check wiring to SDA/SCL and that it's on 3.3V or 5V per your OLED's spec

- Buttons not responding / stuck:
    Check A0, A1, A2 wiring - each button's other leg must go to GND,
    make sure no stray wire is touching those pins

- Servo just vibrates / doesn't move:
    Needs external 5V power source (not from the R4's onboard regulator)
    with common GND between the R4 and external supply

============================================
