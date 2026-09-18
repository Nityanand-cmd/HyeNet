// ============================================================
//  HygieNet Cloud Edition — Arduino UNO R4 WiFi Firmware
//  Project: HygieNet – Smart Sanitary Pad Dispenser
//  Controller: Arduino UNO R4 WiFi (Renesas RA4M1 + ESP32-S3)
//  Cloud: Vercel Serverless (HTTPS) + MongoDB Atlas
//
//  LOCKED PINOUT (100% IDENTICAL TO WORKING UNO R3):
//  - RC522 RFID:   SDA=D10, RST=D9, MOSI=D11, MISO=D12, SCK=D13, 3.3V, GND
//  - OLED Display: SDA=A4, SCL=A5, VCC=5V, GND, Addr=0x3C
//  - Push Buttons: INC=A0, DEC=A1, CNF=A2 (INPUT_PULLUP to GND)
//  - Servos:       MG90S(ARM)=D5, SG90(GATE)=D8 (Powered by CA-2596 @ 4.8V, Common GND)
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
const char* FIRMWARE_VER    = "2.2.0-R4";

// ------------------------------------------------------------
//  2. LOCKED PIN DEFINITIONS
// ------------------------------------------------------------
// RC522 RFID Module (Hardware SPI)
#define SS_PIN              10
#define RST_PIN             9

// Push Buttons (Active LOW with internal INPUT_PULLUP)
#define INC_BTN             A0  // Increment Quantity (+)
#define DEC_BTN             A1  // Decrement Quantity (-)
#define CNF_BTN             A2  // Confirm Dispense

// Dual Servos (Signals from Arduino, Power from CA-2596 4.8V)
#define ARM_SERVO           5   // MG90S Arm Servo (Digital Pin 5)
#define GATE_SERVO          8   // SG90 Gate Servo (Digital Pin 8)

// 0.96-inch I2C OLED Display (SSD1306)
#define SCREEN_WIDTH        128
#define SCREEN_HEIGHT       64
#define OLED_ADDR           0x3C

// Servo Angles & Timings (Baseline Test Angles)
const int ARM_REST          = 0;
const int ARM_FORWARD       = 90;
const int GATE_REST         = 0;
const int GATE_OPEN         = 90;
const int SERVO_DELAY_MS    = 700;

// ------------------------------------------------------------
//  3. GLOBAL OBJECTS & VARIABLES
// ------------------------------------------------------------
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
MFRC522 rfid(SS_PIN, RST_PIN);

Servo armServo;
Servo gateServo;

WiFiSSLClient sslClient;
WiFiClient    tcpClient;

unsigned long lastPingTime = 0;
const unsigned long PING_INTERVAL = 60000;

unsigned long lastWiFiRetry = 0;
const unsigned long WIFI_RETRY_INTERVAL = 30000;

int pads = 1;
int maxSelectable = 5;

// Function declarations
void drawBorder();
void showWelcome();
void showScan();
void showCardDetected();
void showPads(int currentPads, int maxLimit);
void showDispensing(int number);
void showThankYou(int remaining);
void showVerifying();
void showAccessDenied(const String& reason);
void showConfirmed(int currentPads);
void showWiFiStatus(const String& line2, const String& line3);

void connectWiFi();
void sendHeartbeat();
bool verifyCardWithCloud(const String& uid, String& outName, int& outRemaining, int& outMaxSelectable, String& outErrorMsg);
bool confirmDispenseWithCloud(const String& uid, int quantity, int& outRemaining);
void runDispenserSequence(int quantity);
String readHttpResponse(Client& client);
String extractJsonValue(const String& json, const String& key);
void printSerialHelp();

// ------------------------------------------------------------
//  4. OLED UI SCREENS (MATCHING WORKING BASELINE)
// ------------------------------------------------------------

void drawBorder() {
  display.drawRect(0, 0, 127, 63, SSD1306_WHITE);
}

void showWelcome() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  drawBorder();

  display.setTextSize(2);
  display.setCursor(18, 12);
  display.print("HYGIENET");

  display.setTextSize(1);
  display.setCursor(42, 40);
  display.print("WELCOME");

  display.display();
}

void showScan() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  drawBorder();

  display.setTextSize(1);
  display.setCursor(43, 7);
  display.print("HYGIENET");

  display.setTextSize(2);
  display.setCursor(40, 22);
  display.print("SCAN");

  display.setTextSize(1);
  display.setCursor(45, 46);
  display.print("A CARD");

  display.display();
}

void showCardDetected() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  drawBorder();

  display.setTextSize(1);
  display.setCursor(32, 15);
  display.print("CARD DETECTED");

  display.setCursor(28, 35);
  display.print("CHECKING CLOUD");

  display.display();
}

void showVerifying() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  drawBorder();

  display.setTextSize(1);
  display.setCursor(35, 12);
  display.print("CONNECTING");

  display.setTextSize(2);
  display.setCursor(20, 26);
  display.print("VERIFYING");

  display.setTextSize(1);
  display.setCursor(30, 48);
  display.print("PLEASE WAIT");

  display.display();
}

void showPads(int currentPads, int maxLimit) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  drawBorder();

  display.setTextSize(1);
  display.setCursor(38, 7);
  display.print("SELECT PADS");

  display.setTextSize(3);
  if (currentPads < 10) {
    display.setCursor(58, 25);
  } else {
    display.setCursor(49, 25);
  }
  display.print(currentPads);

  display.setTextSize(1);
  display.setCursor(20, 52);
  display.print("+  -  CONFIRM");

  display.display();
}

void showConfirmed(int currentPads) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  drawBorder();

  display.setTextSize(1);
  display.setCursor(40, 16);
  display.print("CONFIRMED");

  display.setTextSize(2);
  if (currentPads < 10) {
    display.setCursor(58, 36);
  } else {
    display.setCursor(52, 36);
  }
  display.print(currentPads);

  display.display();
}

void showDispensing(int number) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  drawBorder();

  display.setTextSize(1);
  display.setCursor(38, 10);
  display.print("DISPENSING");

  display.setTextSize(2);
  if (number < 10) {
    display.setCursor(49, 31);
  } else {
    display.setCursor(43, 31);
  }
  display.print("PAD ");
  display.print(number);

  display.display();
}

void showThankYou(int remaining) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  drawBorder();

  display.setTextSize(2);
  display.setCursor(35, 12);
  display.print("THANK");
  display.setCursor(45, 30);
  display.print("YOU");

  display.setTextSize(1);
  display.setCursor(20, 50);
  display.print("LEFT THIS MO: ");
  display.print(remaining);

  display.display();
}

void showAccessDenied(const String& reason) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  drawBorder();

  display.setTextSize(1);
  display.setCursor(25, 14);
  display.print("ACCESS DENIED");

  display.setTextSize(1);
  display.setCursor(18, 32);
  if (reason == "LIMIT REACHED") {
    display.print("0 PADS REMAINING");
  } else if (reason == "INVALID CARD") {
    display.print("UNREGISTERED CARD");
  } else {
    display.print(reason);
  }

  display.setCursor(35, 48);
  display.print("TRY AGAIN");

  display.display();
}

void showWiFiStatus(const String& line2, const String& line3) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  drawBorder();

  display.setTextSize(1);
  display.setCursor(32, 10);
  display.print("HYGIENET R4");

  display.setTextSize(1);
  display.setCursor(20, 28);
  display.print(line2);

  display.setCursor(15, 46);
  display.print(line3);

  display.display();
}

// ------------------------------------------------------------
//  5. SETUP
// ------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n============================================");
  Serial.println("  HygieNet Cloud Edition - UNO R4 WiFi");
  Serial.println("  Firmware Version: " + String(FIRMWARE_VER));
  Serial.println("============================================");

  // 1. Push Buttons (Active LOW with internal INPUT_PULLUP)
  pinMode(INC_BTN, INPUT_PULLUP);
  pinMode(DEC_BTN, INPUT_PULLUP);
  pinMode(CNF_BTN, INPUT_PULLUP);

  // 2. I2C OLED Display Init (A4=SDA, A5=SCL)
  Wire.begin();
  Serial.println("Starting OLED...");
  if (display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("OLED OK");
    showWelcome();
    delay(1500);
  } else {
    Serial.println("OLED ERROR! (Check 0x3C I2C wiring on A4/A5)");
  }

  // 3. Dual Servos Init (D5 MG90S Arm, D8 SG90 Gate)
  Serial.println("Starting servos...");
  armServo.attach(ARM_SERVO);
  gateServo.attach(GATE_SERVO);
  armServo.write(ARM_REST);
  gateServo.write(GATE_REST);
  Serial.println("Servos attached: MG90S on D5, SG90 on D8 (Rest = 0 deg).");

  // 4. MFRC522 RFID Init (D10 SS, D9 RST, SPI D11/D12/D13)
  Serial.println("Starting RFID...");
  SPI.begin();
  rfid.PCD_Init();
  delay(100);

  byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.print("RFID VERSION: 0x");
  Serial.println(version, HEX);

  // 5. Connect to Wi-Fi Hotspot
  connectWiFi();

  // 6. Print Serial Simulator Controls
  printSerialHelp();

  // Ready State
  showScan();
}

void printSerialHelp() {
  Serial.println("\n--- [SERIAL SIMULATOR CONTROLS] ---");
  Serial.println(" Type '1'  -> Tap Sunita Yadav (C3:27:87:14)");
  Serial.println(" Type '2'  -> Tap Anita Kumari (E3:A5:AE:02)");
  Serial.println(" Type '3'  -> Tap Invalid Card (D7:EE:26:03)");
  Serial.println(" Type '+'  -> Increment quantity");
  Serial.println(" Type '-'  -> Decrement quantity");
  Serial.println(" Type 'OK' -> Confirm dispense");
  Serial.println("-----------------------------------\n");
}

// ------------------------------------------------------------
//  6. MAIN LOOP
// ------------------------------------------------------------

void loop() {
  // Non-blocking Wi-Fi reconnect check
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWiFiRetry > WIFI_RETRY_INTERVAL) {
      lastWiFiRetry = millis();
      connectWiFi();
    }
  }

  // Periodic heartbeat ping to Vercel
  if (millis() - lastPingTime > PING_INTERVAL) {
    lastPingTime = millis();
    sendHeartbeat();
  }

  String uid = "";

  // 1. Read Physical RFID Card
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

  // 2. Read Serial Monitor Test Input (Optional)
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

  // Visual feedback: Card Detected
  showCardDetected();
  delay(600);
  showVerifying();

  // Cloud Authorization Call (Vercel API + MongoDB Atlas)
  String userName = "";
  int remainingPads = 0;
  int allowedSelectable = 0;
  String errorMsg = "";

  bool isAuth = verifyCardWithCloud(uid, userName, remainingPads, allowedSelectable, errorMsg);

  if (!isAuth) {
    Serial.println("[Cloud Auth] Denied: " + errorMsg);
    showAccessDenied(errorMsg);
    delay(2800);
    showScan();
    printSerialHelp();
    return;
  }

  Serial.println("[Cloud Auth] Authorized for: " + userName + " | Remaining: " + String(remainingPads));

  // User pad selection mode (Bounded by user's remaining cloud quota)
  pads = 1;
  maxSelectable = allowedSelectable > 0 ? allowedSelectable : 1;
  showPads(pads, maxSelectable);

  bool confirmed = false;
  unsigned long selectTimeout = millis() + 45000; // 45s timeout

  while (!confirmed && millis() < selectTimeout) {
    bool inc = (digitalRead(INC_BTN) == LOW);
    bool dec = (digitalRead(DEC_BTN) == LOW);
    bool conf = (digitalRead(CNF_BTN) == LOW);

    // Read virtual serial buttons
    if (Serial.available()) {
      String scmd = Serial.readStringUntil('\n');
      scmd.trim();
      scmd.toUpperCase();
      if (scmd == "+" || scmd == "INC") inc = true;
      else if (scmd == "-" || scmd == "DEC") dec = true;
      else if (scmd == "OK" || scmd == "CONF" || scmd == "CONFIRM") conf = true;
    }

    // Increment (+)
    if (inc) {
      if (pads < maxSelectable) {
        pads++;
        Serial.print("PADS = ");
        Serial.println(pads);
        showPads(pads, maxSelectable);
        while (digitalRead(INC_BTN) == LOW);
        delay(150);
      } else {
        Serial.println("[Limit Reached]: Maximum selectable pads for this month reached!");
        delay(150);
      }
    }

    // Decrement (-)
    if (dec) {
      if (pads > 1) {
        pads--;
        Serial.print("PADS = ");
        Serial.println(pads);
        showPads(pads, maxSelectable);
        while (digitalRead(DEC_BTN) == LOW);
        delay(150);
      }
    }

    // Confirm
    if (conf) {
      confirmed = true;
      Serial.print("CONFIRMED = ");
      Serial.println(pads);
      showConfirmed(pads);
      while (digitalRead(CNF_BTN) == LOW);
      delay(800);
      break;
    }
  }

  if (!confirmed) {
    Serial.println("[Selection] Timed out.");
    showScan();
    printSerialHelp();
    return;
  }

  // Commit transaction to Vercel API
  showVerifying();
  int newRemaining = 0;
  bool commitOk = confirmDispenseWithCloud(uid, pads, newRemaining);

  if (!commitOk) {
    Serial.println("[Cloud Error] Dispense commit failed on server.");
    showAccessDenied("SERVER ERROR");
    delay(2500);
    showScan();
    printSerialHelp();
    return;
  }

  // Physical dual-servo dispensing cycle (700 ms delays)
  Serial.println("[Dispense Approved!] Running Servos now...");
  for (int i = 1; i <= pads; i++) {
    Serial.print("PAD ");
    Serial.println(i);
    showDispensing(i);
    delay(500);

    // ARM FORWARD (Pin 5)
    armServo.write(ARM_FORWARD);
    delay(SERVO_DELAY_MS);

    // GATE OPEN (Pin 8)
    gateServo.write(GATE_OPEN);
    delay(SERVO_DELAY_MS);

    // ARM BACK
    armServo.write(ARM_REST);
    delay(SERVO_DELAY_MS);

    // GATE CLOSE
    gateServo.write(GATE_REST);
    delay(SERVO_DELAY_MS);
  }

  // Transaction Complete
  Serial.println("TRANSACTION COMPLETE");
  showThankYou(newRemaining);
  delay(2500);
  showScan();
  printSerialHelp();

  // Reset RFID reader
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  delay(500);
}

// ------------------------------------------------------------
//  7. WI-FI & CLOUD HTTPS IMPLEMENTATION
// ------------------------------------------------------------

void connectWiFi() {
  Serial.print("[WiFi] Connecting to: ");
  Serial.println(WIFI_SSID);
  showWiFiStatus("CONNECTING WIFI", String(WIFI_SSID));

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected! IP: " + WiFi.localIP().toString());
    showWiFiStatus("WIFI CONNECTED", WiFi.localIP().toString());
    delay(1200);
  } else {
    Serial.println("\n[WiFi] Connection failed! Will retry in background.");
    showWiFiStatus("WIFI FAILED", "OFFLINE MODE");
    delay(1500);
  }
}

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
