// ============================================================
//  HygieNet Cloud Edition — Arduino UNO R4 WiFi Firmware
//  ALL-IN-ONE STANDALONE SKETCH (No separate config.h needed!)
// ============================================================

#include <WiFiS3.h>
#include <Wire.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Servo.h>

// ------------------------------------------------------------
//  1. WI-FI & CLOUD CONFIGURATION
// ------------------------------------------------------------
const char* WIFI_SSID       = "redmi 12";
const char* WIFI_PASSWORD   = "12345678";

const char* SERVER_HOST     = "hye-net.vercel.app";
const int   SERVER_PORT     = 443;
const bool  USE_SSL         = true;

const char* DEVICE_KEY      = "hygienet_r4_sec_2026_x89";
const char* DEVICE_ID       = "hygienet-01";
const char* FIRMWARE_VER    = "2.0.0-R4";

// ------------------------------------------------------------
//  2. PIN DEFINITIONS
// ------------------------------------------------------------
#define PIN_BTN_INC         A0  // Increment Button (+)
#define PIN_BTN_DEC         A1  // Decrement Button (-)
#define PIN_BTN_CONF        A2  // Confirm Button

#define PIN_SERVO_ARM       A3  // Push Arm Servo
#define PIN_SERVO_GATE      8   // Retention Gate Servo

#define PIN_RFID_SS         10  // RC522 SDA/SS
#define PIN_RFID_RST        9   // RC522 RST

#define OLED_ADDR           0x3C
#define SCREEN_WIDTH        128
#define SCREEN_HEIGHT       64

// ------------------------------------------------------------
//  3. GLOBAL HARDWARE OBJECTS
// ------------------------------------------------------------
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
MFRC522 rfid(PIN_RFID_SS, PIN_RFID_RST);
Servo armServo;
Servo gateServo;

WiFiSSLClient sslClient;
WiFiClient    tcpClient;

unsigned long lastPingTime = 0;
const unsigned long PING_INTERVAL = 60000;

// Function declarations
void showOled(const String& line1, const String& line2, const String& line3, int size2 = 2);
void connectWiFi();
void sendHeartbeat();
bool verifyCardWithCloud(const String& uid, String& outName, int& outRemaining, int& outMaxSelectable, String& outErrorMsg);
bool confirmDispenseWithCloud(const String& uid, int quantity, int& outRemaining);
void runDispenserSequence(int quantity);
String readHttpResponse(Client& client);
String extractJsonValue(const String& json, const String& key);

// ------------------------------------------------------------
//  SETUP
// ------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n============================================");
  Serial.println("  HygieNet Cloud Edition - UNO R4 WiFi");
  Serial.println("  Firmware Version: " + String(FIRMWARE_VER));
  Serial.println("============================================");

  // 1. OLED Display Init
  Wire.begin();
  if (display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    showOled("HYGIENET", "STARTING", "CONNECTING...");
    Serial.println("[OLED] Initialized OK");
  } else {
    Serial.println("[OLED] Warning: SSD1306 not found on 0x3C");
  }

  // 2. Buttons Init (Active-LOW with Internal Pullups)
  pinMode(PIN_BTN_INC, INPUT_PULLUP);
  pinMode(PIN_BTN_DEC, INPUT_PULLUP);
  pinMode(PIN_BTN_CONF, INPUT_PULLUP);
  Serial.println("[Buttons] Pins A0, A1, A2 set to INPUT_PULLUP");

  // 3. Servos Init
  armServo.attach(PIN_SERVO_ARM);
  gateServo.attach(PIN_SERVO_GATE);
  armServo.write(0);
  gateServo.write(0);
  Serial.println("[Servos] Attached and homed to 0 deg");

  // 4. MFRC522 RFID Init
  SPI.begin();
  rfid.PCD_Init();
  delay(50);
  Serial.println("[RFID] PCD Initialized");

  // 5. Connect to Wi-Fi Hotspot
  connectWiFi();

  // 6. Ready State
  showOled("HYGIENET", "READY", "SCAN RFID CARD");
}

// ------------------------------------------------------------
//  MAIN LOOP
// ------------------------------------------------------------
void loop() {
  // Auto-reconnect Wi-Fi if dropped
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // Periodic heartbeat telemetry
  if (millis() - lastPingTime > PING_INTERVAL) {
    lastPingTime = millis();
    sendHeartbeat();
  }

  // Check for RFID Card
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
    return;
  }

  // Extract UID (format: C3:27:87:14)
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
    if (i < rfid.uid.size - 1) uid += ":";
  }
  uid.toUpperCase();

  Serial.println("\n[RFID] Card Detected: " + uid);
  showOled("VERIFYING", "PLEASE WAIT", "CHECKING CLOUD...", 1);

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  // Verify Card with Vercel Cloud
  String userName = "";
  int remainingPads = 0;
  int maxSelectable = 0;
  String errorMsg = "";

  bool isAuth = verifyCardWithCloud(uid, userName, remainingPads, maxSelectable, errorMsg);

  if (!isAuth) {
    Serial.println("[Cloud Auth] Denied: " + errorMsg);
    showOled("ACCESS DENIED", errorMsg, "TRY AGAIN", 1);
    delay(3000);
    showOled("HYGIENET", "READY", "SCAN RFID CARD");
    return;
  }

  // Authorized: Enter Pad Selection Mode
  Serial.println("[Cloud Auth] User: " + userName + " | Remaining: " + String(remainingPads));

  int selectedQty = 1;
  bool confirmed = false;
  unsigned long selectTimeout = millis() + 30000; // 30s timeout

  showOled(userName, "PADS: 1", "USE +/- & CONFIRM");

  while (!confirmed && millis() < selectTimeout) {
    // Increment Button (+)
    if (digitalRead(PIN_BTN_INC) == LOW) {
      delay(60);
      if (digitalRead(PIN_BTN_INC) == LOW) {
        if (selectedQty < maxSelectable) {
          selectedQty++;
          Serial.println("[Selection] Qty: " + String(selectedQty));
          showOled(userName, "PADS: " + String(selectedQty), "REMAINING: " + String(remainingPads));
        }
        while (digitalRead(PIN_BTN_INC) == LOW);
        delay(50);
      }
    }

    // Decrement Button (-)
    if (digitalRead(PIN_BTN_DEC) == LOW) {
      delay(60);
      if (digitalRead(PIN_BTN_DEC) == LOW) {
        if (selectedQty > 1) {
          selectedQty--;
          Serial.println("[Selection] Qty: " + String(selectedQty));
          showOled(userName, "PADS: " + String(selectedQty), "REMAINING: " + String(remainingPads));
        }
        while (digitalRead(PIN_BTN_DEC) == LOW);
        delay(50);
      }
    }

    // Confirm Button
    if (digitalRead(PIN_BTN_CONF) == LOW) {
      delay(60);
      if (digitalRead(PIN_BTN_CONF) == LOW) {
        confirmed = true;
        Serial.println("[Selection] Confirmed: " + String(selectedQty) + " pads");
        while (digitalRead(PIN_BTN_CONF) == LOW);
        delay(50);
      }
    }
  }

  if (!confirmed) {
    Serial.println("[Selection] Timed out.");
    showOled("TIMEOUT", "CANCELLED", "SCAN AGAIN");
    delay(2000);
    showOled("HYGIENET", "READY", "SCAN RFID CARD");
    return;
  }

  // Commit transaction to Vercel
  showOled("COMMITTING", "SAVING DATA", "PLEASE WAIT...", 1);
  int newRemaining = 0;
  bool commitOk = confirmDispenseWithCloud(uid, selectedQty, newRemaining);

  if (!commitOk) {
    Serial.println("[Dispense Commit] Server transaction failed");
    showOled("ERROR", "DISPENSE CANCEL", "PLEASE RETRY", 1);
    delay(3000);
    showOled("HYGIENET", "READY", "SCAN RFID CARD");
    return;
  }

  // Actuate Dual Servo Dispenser
  showOled("DISPENSING", "PADS: " + String(selectedQty), "PLEASE COLLECT", 1);
  runDispenserSequence(selectedQty);

  // Thank You Screen
  showOled("THANK YOU", "COLLECT PADS", "REMAINING: " + String(newRemaining), 1);
  delay(3500);

  // Return to ready
  showOled("HYGIENET", "READY", "SCAN RFID CARD");
}

// ------------------------------------------------------------
//  WI-FI CONNECTIVITY
// ------------------------------------------------------------
void connectWiFi() {
  Serial.print("[WiFi] Connecting to hotspot: ");
  Serial.println(WIFI_SSID);
  showOled("WIFI SETUP", "CONNECTING", String(WIFI_SSID), 1);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 25) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[WiFi] Connection failed! Retrying in background.");
    showOled("WIFI ERROR", "CHECK HOTSPOT", "OFFLINE", 1);
    delay(2000);
  }
}

// ------------------------------------------------------------
//  CLOUD HTTPS API CALLS
// ------------------------------------------------------------
Client& getClient() {
  if (USE_SSL) return sslClient;
  return tcpClient;
}

bool verifyCardWithCloud(const String& uid, String& outName, int& outRemaining, int& outMaxSelectable, String& outErrorMsg) {
  Client& client = getClient();
  Serial.print("[HTTPS] Connecting to ");
  Serial.print(SERVER_HOST);
  Serial.print(":");
  Serial.println(SERVER_PORT);

  if (!client.connect(SERVER_HOST, SERVER_PORT)) {
    Serial.println("[HTTPS] Connection failed!");
    outErrorMsg = "SERVER OFFLINE";
    return false;
  }

  String payload = "{\"uid\":\"" + uid + "\",\"device_id\":\"" + String(DEVICE_ID) + "\"}";

  client.println("POST /api/card/verify HTTP/1.1");
  client.println("Host: " + String(SERVER_HOST));
  client.println("User-Agent: Arduino-UNO-R4");
  client.println("X-Device-Key: " + String(DEVICE_KEY));
  client.println("Content-Type: application/json");
  client.println("Connection: close");
  client.print("Content-Length: ");
  client.println(payload.length());
  client.println();
  client.println(payload);

  String response = readHttpResponse(client);
  client.stop();

  Serial.println("[HTTPS Response] " + response);

  if (extractJsonValue(response, "authorized") == "true") {
    outName = extractJsonValue(response, "name");
    outRemaining = extractJsonValue(response, "remaining").toInt();
    outMaxSelectable = extractJsonValue(response, "max_selectable").toInt();
    if (outMaxSelectable <= 0) outMaxSelectable = outRemaining;
    return true;
  } else {
    String reason = extractJsonValue(response, "reason");
    if (reason == "LIMIT_REACHED") outErrorMsg = "LIMIT REACHED";
    else if (reason == "CARD_NOT_FOUND") outErrorMsg = "INVALID CARD";
    else outErrorMsg = "DENIED";
    return false;
  }
}

bool confirmDispenseWithCloud(const String& uid, int quantity, int& outRemaining) {
  Client& client = getClient();
  if (!client.connect(SERVER_HOST, SERVER_PORT)) {
    Serial.println("[HTTPS] Dispense complete connection failed!");
    return false;
  }

  String payload = "{\"uid\":\"" + uid + "\",\"device_id\":\"" + String(DEVICE_ID) + "\",\"quantity\":" + String(quantity) + "}";

  client.println("POST /api/dispense/complete HTTP/1.1");
  client.println("Host: " + String(SERVER_HOST));
  client.println("User-Agent: Arduino-UNO-R4");
  client.println("X-Device-Key: " + String(DEVICE_KEY));
  client.println("Content-Type: application/json");
  client.println("Connection: close");
  client.print("Content-Length: ");
  client.println(payload.length());
  client.println();
  client.println(payload);

  String response = readHttpResponse(client);
  client.stop();

  if (extractJsonValue(response, "success") == "true") {
    outRemaining = extractJsonValue(response, "remaining").toInt();
    return true;
  }
  return false;
}

void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  Client& client = getClient();
  if (client.connect(SERVER_HOST, SERVER_PORT)) {
    String payload = "{\"device_id\":\"" + String(DEVICE_ID) + "\",\"firmware\":\"" + String(FIRMWARE_VER) + "\",\"rssi\":" + String(WiFi.RSSI()) + "}";
    client.println("POST /api/device/ping HTTP/1.1");
    client.println("Host: " + String(SERVER_HOST));
    client.println("Content-Type: application/json");
    client.println("Connection: close");
    client.print("Content-Length: ");
    client.println(payload.length());
    client.println();
    client.println(payload);
    client.stop();
  }
}

// ------------------------------------------------------------
//  SERVO DISPENSER SEQUENCE
// ------------------------------------------------------------
void runDispenserSequence(int quantity) {
  for (int i = 1; i <= quantity; i++) {
    Serial.println("[Dispenser] Dispensing Pad " + String(i) + " of " + String(quantity));
    armServo.write(90);
    delay(1000);
    gateServo.write(90);
    delay(1000);
    armServo.write(0);
    delay(1000);
    gateServo.write(0);
    delay(1000);
  }
}

// ------------------------------------------------------------
//  PARSING & OLED HELPERS
// ------------------------------------------------------------
String readHttpResponse(Client& client) {
  String response = "";
  unsigned long timeout = millis() + 6000;
  while (millis() < timeout) {
    while (client.available()) {
      char c = client.read();
      response += c;
    }
    if (!client.connected() && !client.available()) break;
  }
  return response;
}

String extractJsonValue(const String& json, const String& key) {
  String searchKey = "\"" + key + "\"";
  int keyIndex = json.indexOf(searchKey);
  if (keyIndex == -1) return "";

  int colonIndex = json.indexOf(':', keyIndex);
  if (colonIndex == -1) return "";

  int valStart = colonIndex + 1;
  while (valStart < json.length() && (json[valStart] == ' ' || json[valStart] == '\t')) valStart++;

  if (json[valStart] == '\"') {
    int valEnd = json.indexOf('\"', valStart + 1);
    if (valEnd != -1) return json.substring(valStart + 1, valEnd);
  } else {
    int valEnd = valStart;
    while (valEnd < json.length() && json[valEnd] != ',' && json[valEnd] != '}' && json[valEnd] != '\r' && json[valEnd] != '\n') valEnd++;
    return json.substring(valStart, valEnd);
  }
  return "";
}

void showOled(const String& line1, const String& line2, const String& line3, int size2) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 4);
  display.println(line1);
  display.drawLine(0, 15, 128, 15, SSD1306_WHITE);

  display.setTextSize(size2);
  display.setCursor(0, 24);
  display.println(line2);

  display.setTextSize(1);
  display.setCursor(0, 52);
  display.println(line3);
  display.display();
}
