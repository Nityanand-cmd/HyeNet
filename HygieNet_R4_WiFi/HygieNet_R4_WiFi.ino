// ============================================================
//  HygieNet Cloud Edition — Arduino UNO R4 WiFi Firmware
//  Autonomous IoT Sanitary Vending Machine
//  Hardware: Arduino UNO R4 WiFi (RA4M1 + ESP32-S3)
//  Cloud: Vercel Serverless HTTPS API + MongoDB Atlas
// ============================================================

#include <WiFiS3.h>
#include <Wire.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Servo.h>

#include "config.h"

// ------------------------------------------------------------
//  GLOBAL PERIPHERAL OBJECTS
// ------------------------------------------------------------
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
MFRC522 rfid(PIN_RFID_SS, PIN_RFID_RST);
Servo armServo;
Servo gateServo;

// Network Clients
WiFiSSLClient sslClient;
WiFiClient    tcpClient;

int wifiStatus = WL_IDLE_STATUS;
unsigned long lastPingTime = 0;
const unsigned long PING_INTERVAL = 60000; // Ping server every 60s

// ------------------------------------------------------------
//  FORWARD DECLARATIONS & HELPERS
// ------------------------------------------------------------
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
  Serial.println("  Firmware Version: " FIRMWARE_VER);
  Serial.println("============================================");

  // 1. OLED Display Init
  Wire.begin();
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("[OLED] Warning: SSD1306 not detected on 0x3C");
  } else {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    showOled("HYGIENET", "STARTING", "CONNECTING...");
    Serial.println("[OLED] Display initialized OK");
  }

  // 2. Button Pins Setup (Active-LOW with Internal Pullups)
  pinMode(PIN_BTN_INC, INPUT_PULLUP);
  pinMode(PIN_BTN_DEC, INPUT_PULLUP);
  pinMode(PIN_BTN_CONF, INPUT_PULLUP);
  Serial.println("[Buttons] Pins A0, A1, A2 set to INPUT_PULLUP");

  // 3. Servo Motors Init
  armServo.attach(PIN_SERVO_ARM);
  gateServo.attach(PIN_SERVO_GATE);
  armServo.write(0);
  gateServo.write(0);
  Serial.println("[Servos] Servos attached and homed to 0 deg");

  // 4. MFRC522 RFID Init
  SPI.begin();
  rfid.PCD_Init();
  delay(50);
  byte rfidVer = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.print("[RFID] PCD Version: 0x");
  Serial.println(rfidVer, HEX);

  // 5. Connect to Wi-Fi
  connectWiFi();

  // 6. Ready State
  showOled("HYGIENET", "READY", "SCAN RFID CARD");
}

// ------------------------------------------------------------
//  MAIN LOOP
// ------------------------------------------------------------
void loop() {
  // Check Wi-Fi connection and reconnect if dropped
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // Periodic heartbeat telemetry
  if (millis() - lastPingTime > PING_INTERVAL) {
    lastPingTime = millis();
    sendHeartbeat();
  }

  // Check for RFID Card
  if (!rfid.PICC_IsNewCardPresent()) {
    return;
  }
  if (!rfid.PICC_ReadCardSerial()) {
    return;
  }

  // Extract UID in standard format: C3:27:87:14
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
    if (i < rfid.uid.size - 1) uid += ":";
  }
  uid.toUpperCase();

  Serial.println("\n[RFID] Card Detected: " + uid);
  showOled("VERIFYING", "PLEASE WAIT", "CONNECTING API...", 1);

  // Halt card to allow other taps
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  // Cloud Authorization Call
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

  // Authorized! Enter Quantity Selection
  Serial.println("[Cloud Auth] Authorized for: " + userName + " | Remaining: " + String(remainingPads));

  int selectedQty = 1;
  bool confirmed = false;
  unsigned long selectTimeout = millis() + 30000; // 30s timeout

  showOled(userName, "PADS: 1", "USE +/- & CONFIRM");

  while (!confirmed && millis() < selectTimeout) {
    // Increment Button
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

    // Decrement Button
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
        Serial.println("[Selection] Confirmed Quantity: " + String(selectedQty));
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

  // Commit transaction to cloud
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

  // Run Dual Servo Dispenser
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
  Serial.print("[WiFi] Connecting to SSID: ");
  Serial.println(WIFI_SSID);
  showOled("WIFI SETUP", "CONNECTING", WIFI_SSID, 1);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 25) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected!");
    Serial.print("[WiFi] IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("[WiFi] Signal RSSI: ");
    Serial.println(WiFi.RSSI());
  } else {
    Serial.println("\n[WiFi] Failed to connect! Retrying in background.");
    showOled("WIFI ERROR", "CHECK CONFIG", "OFFLINE MODE", 1);
    delay(2000);
  }
}

// ------------------------------------------------------------
//  CLOUD HTTPS API INTERACTIONS
// ------------------------------------------------------------

Client& getClient() {
  if (USE_SSL) {
    return sslClient;
  }
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

  String payload = "{\"uid\":\"" + uid + "\",\"device_id\":\"" + DEVICE_ID + "\"}";

  client.println("POST /api/card/verify HTTP/1.1");
  client.println("Host: " + String(SERVER_HOST));
  client.println("User-Agent: Arduino-UNO-R4-WiFi");
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

  String authVal = extractJsonValue(response, "authorized");
  if (authVal == "true") {
    outName = extractJsonValue(response, "name");
    outRemaining = extractJsonValue(response, "remaining").toInt();
    outMaxSelectable = extractJsonValue(response, "max_selectable").toInt();
    if (outMaxSelectable <= 0) outMaxSelectable = outRemaining;
    return true;
  } else {
    String reason = extractJsonValue(response, "reason");
    if (reason == "LIMIT_REACHED") {
      outErrorMsg = "LIMIT EXCEEDED";
    } else if (reason == "CARD_NOT_FOUND") {
      outErrorMsg = "INVALID CARD";
    } else {
      outErrorMsg = "UNAUTHORIZED";
    }
    return false;
  }
}

bool confirmDispenseWithCloud(const String& uid, int quantity, int& outRemaining) {
  Client& client = getClient();

  if (!client.connect(SERVER_HOST, SERVER_PORT)) {
    Serial.println("[HTTPS] Dispense complete connection failed!");
    return false;
  }

  String payload = "{\"uid\":\"" + uid + "\",\"device_id\":\"" + DEVICE_ID + "\",\"quantity\":" + String(quantity) + "}";

  client.println("POST /api/dispense/complete HTTP/1.1");
  client.println("Host: " + String(SERVER_HOST));
  client.println("User-Agent: Arduino-UNO-R4-WiFi");
  client.println("X-Device-Key: " + String(DEVICE_KEY));
  client.println("Content-Type: application/json");
  client.println("Connection: close");
  client.print("Content-Length: ");
  client.println(payload.length());
  client.println();
  client.println(payload);

  String response = readHttpResponse(client);
  client.stop();

  String successVal = extractJsonValue(response, "success");
  if (successVal == "true") {
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
//  SERVO DISPENSING SEQUENCE
// ------------------------------------------------------------
void runDispenserSequence(int quantity) {
  for (int i = 1; i <= quantity; i++) {
    Serial.println("[Dispenser] Dispensing Pad " + String(i) + " of " + String(quantity));

    // Step 1: Arm pushes pad into staging chute
    armServo.write(90);
    delay(1000);

    // Step 2: Gate opens to drop pad to collection tray
    gateServo.write(90);
    delay(1000);

    // Step 3: Arm returns home
    armServo.write(0);
    delay(1000);

    // Step 4: Gate returns home
    gateServo.write(0);
    delay(1000);
  }
}

// ------------------------------------------------------------
//  HTTP RESPONSE PARSER & JSON EXTRACTOR
// ------------------------------------------------------------
String readHttpResponse(Client& client) {
  String response = "";
  unsigned long timeout = millis() + 6000;
  bool headerEnded = false;

  while (millis() < timeout) {
    while (client.available()) {
      String line = client.readStringUntil('\n');
      if (line == "\r" || line.length() == 0) {
        headerEnded = true;
        continue;
      }
      if (headerEnded) {
        response += line;
      }
    }
    if (!client.connected() && !client.available()) {
      break;
    }
  }
  return response;
}

String extractJsonValue(const String& json, const String& key) {
  String searchKey = "\"" + key + "\"";
  int keyIndex = json.indexOf(searchKey);
  if (keyIndex == -1) return "";

  int colonIndex = json.indexOf(':', keyIndex);
  if (colonIndex == -1) return "";

  // Skip whitespace
  int valStart = colonIndex + 1;
  while (valStart < json.length() && (json[valStart] == ' ' || json[valStart] == '\t')) {
    valStart++;
  }

  // Check if string or literal
  if (json[valStart] == '\"') {
    int valEnd = json.indexOf('\"', valStart + 1);
    if (valEnd != -1) {
      return json.substring(valStart + 1, valEnd);
    }
  } else {
    // Number, boolean
    int valEnd = valStart;
    while (valEnd < json.length() && json[valEnd] != ',' && json[valEnd] != '}' && json[valEnd] != '\r' && json[valEnd] != '\n') {
      valEnd++;
    }
    return json.substring(valStart, valEnd);
  }
  return "";
}

// ------------------------------------------------------------
//  OLED DISPLAY UTILITY
// ------------------------------------------------------------
void showOled(const String& line1, const String& line2, const String& line3, int size2) {
  display.clearDisplay();

  // Line 1: Header (Small)
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 4);
  display.println(line1);
  display.drawLine(0, 15, 128, 15, SSD1306_WHITE);

  // Line 2: Main Announcement / Name / Status
  display.setTextSize(size2);
  display.setCursor(0, 24);
  display.println(line2);

  // Line 3: Subtext / Instructions
  display.setTextSize(1);
  display.setCursor(0, 52);
  display.println(line3);

  display.display();
}
