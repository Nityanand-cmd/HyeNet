#include <Wire.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Servo.h>

// =================================================
// OLED
// =================================================

Adafruit_SSD1306 display(128, 64, &Wire, -1);

// =================================================
// RFID
// =================================================

MFRC522 rfid(10, 9);

// =================================================
// SERVOS
// =================================================

Servo arm;
Servo gate;

// =================================================
// PINS
// =================================================

#define INC A0
#define DEC A1
#define CONF A2

#define ARM_PIN A3
#define GATE_PIN 8


// =================================================
// SETUP
// =================================================

void setup() {

  Serial.begin(9600);

  // -----------------------------------------------
  // OLED — EXACT SAME INITIALIZATION AS WORKING TEST
  // -----------------------------------------------

  Wire.begin();

  Serial.println("Starting OLED...");

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {

    Serial.println("OLED ERROR!");
    
    // DON'T STOP HERE
    // Continue so we can see what else initializes
  }
  else {

    Serial.println("OLED OK");

    display.clearDisplay();

    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(2);

    display.setCursor(20, 20);
    display.println("HY GNET");

    display.display();
  }

  delay(1000);


  // -----------------------------------------------
  // BUTTONS
  // -----------------------------------------------

  pinMode(INC, INPUT_PULLUP);
  pinMode(DEC, INPUT_PULLUP);
  pinMode(CONF, INPUT_PULLUP);

  Serial.println("BUTTONS OK");


  // -----------------------------------------------
  // RFID
  // -----------------------------------------------

  Serial.println("Starting RFID...");

  SPI.begin();

  rfid.PCD_Init();

  delay(100);

  Serial.print("RFID VERSION: 0x");

  Serial.println(
    rfid.PCD_ReadRegister(MFRC522::VersionReg),
    HEX
  );


  // -----------------------------------------------
  // SERVOS
  // -----------------------------------------------

  Serial.println("Starting servos...");

  arm.attach(A3);
  gate.attach(8);

  arm.write(0);
  gate.write(0);

  Serial.println("ALL INITIALIZED");


  // -----------------------------------------------
  // FINAL SCREEN
  // -----------------------------------------------

  display.clearDisplay();

  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(2);
  display.setCursor(15, 10);
  display.println("READY");

  display.setTextSize(1);
  display.setCursor(20, 40);
  display.println("SCAN RFID");

  display.display();
}


// =================================================
// LOOP
// =================================================

void loop() {

  // -----------------------------------------------
  // RFID
  // -----------------------------------------------

  if (rfid.PICC_IsNewCardPresent()) {

    if (rfid.PICC_ReadCardSerial()) {

      Serial.println("CARD DETECTED");

      // ---- Added: send UID to Flask server (logic unchanged below) ----
      String uid = "";
      for (byte i = 0; i < rfid.uid.size; i++) {
        if (rfid.uid.uidByte[i] < 0x10) uid += "0";
        uid += String(rfid.uid.uidByte[i], HEX);
        if (i < rfid.uid.size - 1) uid += ":";
      }
      uid.toUpperCase();
      Serial.println("UID:" + uid);
      // -------------------------------------------------------------

      display.clearDisplay();

      display.setTextSize(2);
      display.setCursor(20, 10);
      display.println("CARD");

      display.setTextSize(1);
      display.setCursor(20, 40);
      display.println("DETECTED");

      display.display();

      delay(1500);

      rfid.PICC_HaltA();
      rfid.PCD_StopCrypto1();


      // -------------------------------------------
      // QUANTITY TEST
      // -------------------------------------------

      int pads = 1;

      display.clearDisplay();

      display.setTextSize(2);
      display.setCursor(20, 10);
      display.println("PADS");

      display.setTextSize(2);
      display.setCursor(55, 35);
      display.println(pads);

      display.display();


      bool confirmed = false;


      while (!confirmed) {

        // INCREMENT
        if (digitalRead(INC) == LOW) {

          delay(50);

          if (digitalRead(INC) == LOW) {

            pads++;

            if (pads > 10)
              pads = 10;

            Serial.print("PADS = ");
            Serial.println(pads);

            display.clearDisplay();

            display.setTextSize(2);
            display.setCursor(20, 10);
            display.println("PADS");

            display.setCursor(55, 35);
            display.println(pads);

            display.display();

            while (digitalRead(INC) == LOW);
          }
        }


        // DECREMENT
        if (digitalRead(DEC) == LOW) {

          delay(50);

          if (digitalRead(DEC) == LOW) {

            pads--;

            if (pads < 1)
              pads = 1;

            Serial.print("PADS = ");
            Serial.println(pads);

            display.clearDisplay();

            display.setTextSize(2);
            display.setCursor(20, 10);
            display.println("PADS");

            display.setCursor(55, 35);
            display.println(pads);

            display.display();

            while (digitalRead(DEC) == LOW);
          }
        }


        // CONFIRM
        if (digitalRead(CONF) == LOW) {

          delay(50);

          if (digitalRead(CONF) == LOW) {

            confirmed = true;

            Serial.print("CONFIRMED = ");
            Serial.println(pads);

            // ---- Added: send QTY to Flask server (logic unchanged below) ----
            Serial.println("QTY:" + String(pads));
            // -------------------------------------------------------------

            while (digitalRead(CONF) == LOW);
          }
        }
      }


      // -------------------------------------------
      // SERVO TEST
      // -------------------------------------------

      for (int i = 1; i <= pads; i++) {

        Serial.print("PAD ");
        Serial.println(i);


        // ARM
        arm.write(90);
        delay(1000);


        // GATE
        gate.write(90);
        delay(1000);


        // ARM HOME
        arm.write(0);
        delay(1000);


        // GATE HOME
        gate.write(0);
        delay(1000);
      }


      // -------------------------------------------
      // THANK YOU
      // -------------------------------------------

      display.clearDisplay();

      display.setTextSize(2);
      display.setCursor(5, 20);
      display.println("THANK YOU");

      display.display();

      Serial.println("TRANSACTION COMPLETE");

      delay(3000);


      // -------------------------------------------
      // READY
      // -------------------------------------------

      display.clearDisplay();

      display.setTextSize(2);
      display.setCursor(15, 10);
      display.println("HY GNET");

      display.setTextSize(1);
      display.setCursor(20, 40);
      display.println("SCAN RFID");

      display.display();
    }
  }
}
