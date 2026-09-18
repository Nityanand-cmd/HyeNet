// ============================================================
//  HygieNet — IoT Sanitary Vending Machine (UNO R3 Firmware)
//  Hardware: Arduino UNO R3 + MFRC522 + SSD1306 OLED + 2x Servos + 3x Push Buttons
// ============================================================

#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Servo.h>

// ================= PINOUT =================

// RFID Module (MFRC522: SPI SCK=13, MISO=12, MOSI=11)
#define SS_PIN 10
#define RST_PIN 9

// Push Buttons (Active LOW with internal INPUT_PULLUP)
#define INC_BTN A0  // Increment Quantity (+)
#define DEC_BTN A1  // Decrement Quantity (-)
#define CNF_BTN A2  // Confirm Dispense

// Dual Servos
#define ARM_SERVO 5   // Dispenser Push Arm Servo (Digital Pin 5)
#define GATE_SERVO 8  // Dispenser Retention Gate Servo (Digital Pin 8)

// I2C OLED Display (128x64 SSD1306 on SDA=A4, SCL=A5)
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_ADDR 0x3C


// ================= OBJECTS =================

MFRC522 rfid(SS_PIN, RST_PIN);

Adafruit_SSD1306 display(
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  &Wire,
  -1
);

Servo armServo;
Servo gateServo;


// ================= VARIABLES =================

int pads = 1;

// Arm servo angles
const int ARM_REST = 0;
const int ARM_FORWARD = 90;

// Gate servo angles
const int GATE_REST = 0;
const int GATE_OPEN = 90;


// ================= OLED BORDER =================

void drawBorder() {
  display.drawRect(0, 0, 127, 63, SSD1306_WHITE);
}


// ================= WELCOME SCREEN =================

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


// ================= SCAN SCREEN =================

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


// ================= CARD DETECTED =================

void showCardDetected() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  drawBorder();

  display.setTextSize(1);
  display.setCursor(32, 15);
  display.print("CARD DETECTED");

  display.setCursor(35, 35);
  display.print("SELECT PADS");

  display.display();
}


// ================= PAD SELECTION SCREEN =================

void showPads() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  drawBorder();

  display.setTextSize(1);
  display.setCursor(38, 7);
  display.print("SELECT PADS");

  display.setTextSize(3);
  if (pads < 10) {
    display.setCursor(58, 27);
  } else {
    display.setCursor(49, 27);
  }
  display.print(pads);

  display.setTextSize(1);
  display.setCursor(25, 54);
  display.print("+  -  CONFIRM");

  display.display();
}


// ================= DISPENSING SCREEN =================

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


// ================= THANK YOU SCREEN =================

void showThankYou() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  drawBorder();

  display.setTextSize(2);
  display.setCursor(25, 18);
  display.print("THANK");

  display.setCursor(32, 40);
  display.print("YOU");

  display.display();
}


// ================= SETUP =================

void setup() {
  Serial.begin(9600);

  // Push Buttons with internal pullup
  pinMode(INC_BTN, INPUT_PULLUP);
  pinMode(DEC_BTN, INPUT_PULLUP);
  pinMode(CNF_BTN, INPUT_PULLUP);

  // ---------- OLED ----------
  Serial.println("Starting OLED...");
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("OLED ERROR!");
    while (1);
  }
  Serial.println("OLED OK");

  showWelcome();
  delay(2000);
  showScan();

  // ---------- RFID ----------
  Serial.println("Starting RFID...");
  SPI.begin();
  rfid.PCD_Init();
  delay(100);

  byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.print("RFID VERSION: 0x");
  Serial.println(version, HEX);

  // ---------- SERVOS ----------
  Serial.println("Starting servos...");
  armServo.attach(ARM_SERVO);
  gateServo.attach(GATE_SERVO);

  armServo.write(ARM_REST);
  gateServo.write(GATE_REST);

  Serial.println("ALL INITIALIZED");
  delay(1000);
  showScan();
}


// ================= MAIN LOOP =================

void loop() {
  // ------------------------------------------
  // 1. WAIT FOR RFID CARD
  // ------------------------------------------
  if (!rfid.PICC_IsNewCardPresent()) {
    return;
  }

  if (!rfid.PICC_ReadCardSerial()) {
    return;
  }

  Serial.println("CARD DETECTED");
  showCardDetected();
  delay(1000);

  // ------------------------------------------
  // 2. PAD SELECTION
  // ------------------------------------------
  pads = 1;
  showPads();

  while (true) {
    // ---------- INCREMENT ----------
    if (digitalRead(INC_BTN) == LOW) {
      pads++;
      if (pads > 10) {
        pads = 10;
      }
      Serial.print("PADS = ");
      Serial.println(pads);
      showPads();
      while (digitalRead(INC_BTN) == LOW);
      delay(150);
    }

    // ---------- DECREMENT ----------
    if (digitalRead(DEC_BTN) == LOW) {
      pads--;
      if (pads < 1) {
        pads = 1;
      }
      Serial.print("PADS = ");
      Serial.println(pads);
      showPads();
      while (digitalRead(DEC_BTN) == LOW);
      delay(150);
    }

    // ---------- CONFIRM ----------
    if (digitalRead(CNF_BTN) == LOW) {
      Serial.print("CONFIRMED = ");
      Serial.println(pads);

      display.clearDisplay();
      drawBorder();
      display.setTextSize(1);
      display.setCursor(43, 20);
      display.print("CONFIRMED");

      display.setTextSize(2);
      if (pads < 10) {
        display.setCursor(58, 40);
      } else {
        display.setCursor(53, 40);
      }
      display.print(pads);
      display.display();

      while (digitalRead(CNF_BTN) == LOW);
      delay(1000);
      break;
    }
  }

  // ------------------------------------------
  // 3. DISPENSING
  // ------------------------------------------
  for (int i = 1; i <= pads; i++) {
    Serial.print("PAD ");
    Serial.println(i);
    showDispensing(i);
    delay(500);

    // ARM FORWARD
    armServo.write(ARM_FORWARD);
    delay(700);

    // GATE OPEN
    gateServo.write(GATE_OPEN);
    delay(700);

    // ARM BACK
    armServo.write(ARM_REST);
    delay(700);

    // GATE CLOSE
    gateServo.write(GATE_REST);
    delay(700);
  }

  // ------------------------------------------
  // 4. TRANSACTION COMPLETE
  // ------------------------------------------
  Serial.println("TRANSACTION COMPLETE");
  showThankYou();
  delay(2500);
  showScan();

  // RFID reset
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  delay(500);
}
