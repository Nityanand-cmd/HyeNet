// ============================================================
//  HygieNet Cloud Edition — Arduino UNO R4 WiFi Firmware
//  Includes Built-in SERIAL MONITOR SIMULATOR:
//  - Type '1' for Sunita Yadav (C3:27:87:14)
//  - Type '2' for Anita Kumari (E3:A5:AE:02)
//  - Type '3' for Invalid Card (D7:EE:26:03)
//  - Type 'SCAN <UID>' for custom card
//  - Type '+' to increment, '-' to decrement, 'OK' to confirm!
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
void printSerialHelp();

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

  // 2. Buttons Init
  pinMode(PIN_BTN_INC, INPUT_PULLUP);
  pinMode(PIN_BTN_DEC, INPUT_PULLUP);
  pinMode(PIN_BTN_CONF, INPUT_PULLUP);

  // 3. Servos Init
  armServo.attach(PIN_SERVO_ARM);
  gateServo.attach(PIN_SERVO_GATE);
  armServo.write(0);
  gateServo.write(0);

  // 4. MFRC522 RFID Init
  SPI.begin();
  rfid.PCD_Init();

  // 5. Connect to Wi-Fi Hotspot
  connectWiFi();

  // Print Serial Simulator Help Instructions
  printSerialHelp();

  // 6. Ready State
  showOled("HYGIENET", "READY", "SCAN RFID CARD");
}

void printSerialHelp() {
  Serial.println("\n--- [SERIAL SIMULATOR CONTROLS] ---");
  Serial.println(" Type '1'  -> Tap Sunita Yadav (C3:27:87:14)");
  Serial.println(" Type '2'  -> Tap Anita Kumari (E3:A5:AE:02)");
  Serial.println(" Type '3'  -> Tap Invalid Card (D7:EE:26:03)");
  Serial.println(" Type '+'  -> Increment quantity");
  Serial.println(" Type '-'  -> Decrement quantity");
  Serial.println(" Type 'OK' -> Confirm and dispense pads");
  Serial.println("-----------------------------------\n");
}

// ------------------------------------------------------------
//  MAIN LOOP
// ------------------------------------------------------------
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (millis() - lastPingTime > PING_INTERVAL) {
    lastPingTime = millis();
    sendHeartbeat();
  }

  String uid = "";

  // 1. Check Physical RFID Card
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    for (byte i = 0; i < rfid.uid.size; i++) {
      if (rfid.uid.uidByte[i] < 0x10) uid += "0";
      uid += String(rfid.uid.uidByte[i], HEX);
      if (i < rfid.uid.size - 1) uid += ":";
    }
    uid.toUpperCase();
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    Serial.println("\n[Physical RFID] Card Scanned: " + uid);
  }

  // 2. Check Serial Monitor Simulator Input
  if (uid == "" && Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    cmd.toUpperCase();

    if (cmd == "1" || cmd == "SUNITA") {
      uid = "C3:27:87:14";
      Serial.println("\n[Serial Simulator] Tapped Card: Sunita Yadav (C3:27:87:14)");
    } else if (cmd == "2" || cmd == "ANITA") {
      uid = "E3:A5:AE:02";
      Serial.println("\n[Serial Simulator] Tapped Card: Anita Kumari (E3:A5:AE:02)");
    } else if (cmd == "3" || cmd == "INVALID") {
      uid = "D7:EE:26:03";
      Serial.println("\n[Serial Simulator] Tapped Card: Unregistered (D7:EE:26:03)");
    } else if (cmd.startsWith("SCAN ")) {
      uid = cmd.substring(5);
      uid.trim();
      Serial.println("\n[Serial Simulator] Custom Card Scanned: " + uid);
    }
  }

  if (uid == "") return;

  showOled("VERIFYING", "PLEASE WAIT", "CHECKING CLOUD...", 1);

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
    printSerialHelp();
    return;
  }

  Serial.println("[Cloud Auth] Authorized for: " + userName + " | Remaining: " + String(remainingPads));
  Serial.println("--> Type '+' to increase, '-' to decrease, 'OK' to confirm!");

  int selectedQty = 1;
  bool confirmed = false;
  unsigned long selectTimeout = millis() + 45000; // 45s timeout

  showOled(userName, "PADS: 1", "USE +/- & CONFIRM");

  while (!confirmed && millis() < selectTimeout) {
    bool inc = (digitalRead(PIN_BTN_INC) == LOW);
    bool dec = (digitalRead(PIN_BTN_DEC) == LOW);
    bool conf = (digitalRead(PIN_BTN_CONF) == LOW);

    // Read Serial commands as virtual buttons
    if (Serial.available()) {
      String scmd = Serial.readStringUntil('\n');
      scmd.trim();
      scmd.toUpperCase();
      if (scmd == "+" || scmd == "INC") inc = true;
      else if (scmd == "-" || scmd == "DEC") dec = true;
      else if (scmd == "OK" || scmd == "CONF" || scmd == "CONFIRM") conf = true;
    }

    if (inc) {
      if (selectedQty < maxSelectable) {
        selectedQty++;
        Serial.println("[Selected Pads]: " + String(selectedQty) + " / " + String(remainingPads) + " available");
        showOled(userName, "PADS: " + String(selectedQty), "REMAINING: " + String(remainingPads));
      } else {
        Serial.println("[Limit Alert]: Cannot select more than " + String(maxSelectable) + " pads!");
      }
      delay(200);
    }

    if (dec) {
      if (selectedQty > 1) {
        selectedQty--;
        Serial.println("[Selected Pads]: " + String(selectedQty) + " / " + String(remainingPads) + " available");
        showOled(userName, "PADS: " + String(selectedQty), "REMAINING: " + String(remainingPads));
      }
      delay(200);
    }

    if (conf) {
      confirmed = true;
      Serial.println("\n[Confirmed!]: Dispensing " + String(selectedQty) + " pads for " + userName);
      delay(200);
    }
  }

  if (!confirmed) {
    Serial.println("[Selection] Timed out.");
    showOled("TIMEOUT", "CANCELLED", "SCAN AGAIN");
    delay(2000);
    showOled("HYGIENET", "READY", "SCAN RFID CARD");
    printSerialHelp();
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
    printSerialHelp();
    return;
  }

  Serial.println("[Dispense Approved!] Running Servos now...");
  showOled("DISPENSING", "PADS: " + String(selectedQty), "PLEASE COLLECT", 1);
  runDispenserSequence(selectedQty);

  Serial.println("[Transaction Complete] Remaining pads for " + userName + ": " + String(newRemaining));
  showOled("THANK YOU", "COLLECT PADS", "REMAINING: " + String(newRemaining), 1);
  delay(3500);

  showOled("HYGIENET", "READY", "SCAN RFID CARD");
  printSerialHelp();
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
  Serial.print("[HTTPS] Verifying UID with ");
  Serial.println(SERVER_HOST);

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

void runDispenserSequence(int quantity) {
  for (int i = 1; i <= quantity; i++) {
    Serial.println("  -> Moving ARM servo 90 deg (dispense pad " + String(i) + ")");
    armServo.write(90);
    delay(1000);
    Serial.println("  -> Opening GATE servo 90 deg");
    gateServo.write(90);
    delay(1000);
    Serial.println("  -> Returning ARM to 0 deg");
    armServo.write(0);
    delay(1000);
    Serial.println("  -> Closing GATE to 0 deg");
    gateServo.write(0);
    delay(1000);
  }
}

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
