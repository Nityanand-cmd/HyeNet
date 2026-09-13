// ============================================================
//  HygieNet Cloud Edition — Arduino UNO R4 WiFi Configuration
// ============================================================

#ifndef CONFIG_H
#define CONFIG_H

// ------------------------------------------------------------
//  WI-FI CREDENTIALS
//  Note: Arduino UNO R4 WiFi connects to standard 2.4GHz Wi-Fi
// ------------------------------------------------------------
#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"

// ------------------------------------------------------------
//  CLOUD SERVER CONFIGURATION
//  Set to your Vercel deployment URL (without "https://" or trailing "/")
//  Example for Vercel: "your-hygienet.vercel.app"
//  Example for local PC testing on same Wi-Fi: "192.168.1.5"
// ------------------------------------------------------------
#define SERVER_HOST     "hye-net.vercel.app"

// Set USE_SSL to true when connecting to Vercel (Port 443 HTTPS)
// Set USE_SSL to false if testing locally with PC IP on Port 5000 HTTP
#define USE_SSL         true
#define SERVER_PORT     443

// ------------------------------------------------------------
//  SECURITY & DEVICE IDENTITY
//  DEVICE_KEY must match DEVICE_KEY in your .env / Vercel Environment Variables
// ------------------------------------------------------------
#define DEVICE_KEY      "hygienet_r4_sec_2026_x89"
#define DEVICE_ID       "hygienet-01"
#define FIRMWARE_VER    "2.0.0-R4"

// ------------------------------------------------------------
//  PIN DEFINITIONS (Matches HygieNet Physical Layout)
// ------------------------------------------------------------

// Push Buttons (Active LOW with internal INPUT_PULLUP)
#define PIN_BTN_INC     A0  // Increment Quantity (+)
#define PIN_BTN_DEC     A1  // Decrement Quantity (-)
#define PIN_BTN_CONF    A2  // Confirm Dispense

// Dual Servo Dispenser
#define PIN_SERVO_ARM   A3  // Dispenser Push Arm
#define PIN_SERVO_GATE  8   // Dispenser Retention Gate

// MFRC522 RFID Module (SPI: SCK=13, MISO=12, MOSI=11)
#define PIN_RFID_SS     10  // Slave Select (SDA)
#define PIN_RFID_RST    9   // Reset

// I2C OLED Display (128x64 SSD1306)
// On UNO R4 WiFi: SDA = A4 or dedicated SDA, SCL = A5 or dedicated SCL
#define OLED_ADDR       0x3C
#define SCREEN_WIDTH    128
#define SCREEN_HEIGHT   64

#endif // CONFIG_H
