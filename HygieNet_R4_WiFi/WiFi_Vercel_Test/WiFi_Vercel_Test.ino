// ============================================================
//  HygieNet — UNO R4 WiFi to Vercel Connectivity Test
//  Purpose: Verifies Wi-Fi connection and HTTPS handshake with Vercel
//  NO sensors, buttons, or servos required for this test!
// ============================================================

#include <WiFiS3.h>

// 1. Enter your Wi-Fi Credentials here (2.4GHz network):
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// 2. Your live Vercel Cloud Server:
const char* SERVER_HOST   = "hye-net.vercel.app";
const int   SERVER_PORT   = 443; // Standard HTTPS port

WiFiSSLClient client;

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000); // Wait for serial monitor

  Serial.println("\n============================================");
  Serial.println("  UNO R4 WiFi -> Vercel HTTPS Test");
  Serial.println("============================================");

  // STEP 1: Connect to Wi-Fi
  Serial.print("\n[1/3] Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\n[ERROR] Wi-Fi connection failed!");
    Serial.println("Check SSID/Password and ensure your Wi-Fi is 2.4GHz.");
    return;
  }

  Serial.println("\n[SUCCESS] Wi-Fi Connected!");
  Serial.print("   -> IP Address: ");
  Serial.println(WiFi.localIP());
  Serial.print("   -> Signal (RSSI): ");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");

  // STEP 2: HTTPS GET /api/health
  Serial.print("\n[2/3] Connecting to Vercel HTTPS: ");
  Serial.print(SERVER_HOST);
  Serial.println(":443 ...");

  unsigned long startTime = millis();
  if (client.connect(SERVER_HOST, SERVER_PORT)) {
    unsigned long handshakeTime = millis() - startTime;
    Serial.print("[SUCCESS] TLS Handshake complete in ");
    Serial.print(handshakeTime);
    Serial.println(" ms!");

    // Send HTTP GET request
    client.println("GET /api/health HTTP/1.1");
    client.println("Host: " + String(SERVER_HOST));
    client.println("User-Agent: UNO-R4-WiFi-Tester");
    client.println("Connection: close");
    client.println();

    // Read Response
    Serial.println("\n--- Vercel Response ---");
    while (client.connected() || client.available()) {
      if (client.available()) {
        char c = client.read();
        Serial.print(c);
      }
    }
    client.stop();
    Serial.println("\n-----------------------");
  } else {
    Serial.println("[ERROR] Failed to connect to Vercel via HTTPS!");
    return;
  }

  // STEP 3: Send Heartbeat POST to update your live dashboard
  Serial.println("\n[3/3] Sending Ping to update live dashboard at https://hye-net.vercel.app ...");

  if (client.connect(SERVER_HOST, SERVER_PORT)) {
    String payload = "{\"device_id\":\"hygienet-01\",\"firmware\":\"2.0.0-TEST\",\"rssi\":" + String(WiFi.RSSI()) + "}";

    client.println("POST /api/device/ping HTTP/1.1");
    client.println("Host: " + String(SERVER_HOST));
    client.println("Content-Type: application/json");
    client.println("Connection: close");
    client.print("Content-Length: ");
    client.println(payload.length());
    client.println();
    client.println(payload);

    delay(500);
    while (client.available()) {
      char c = client.read();
      Serial.print(c);
    }
    client.stop();

    Serial.println("\n\n============================================");
    Serial.println("  TEST PASSED! R4 IS CONNECTED TO VERCEL!");
    Serial.println("  Check https://hye-net.vercel.app -> status shows 'hygienet-01: Online'");
    Serial.println("============================================");
  }
}

void loop() {
  // Test runs once in setup
}
