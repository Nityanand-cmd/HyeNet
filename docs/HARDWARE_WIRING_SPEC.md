# HygieNet — Smart Sanitary Pad Dispenser Hardware Specification

## 1. System Overview
- **Microcontroller**: Arduino UNO R4 WiFi (Renesas RA4M1 48 MHz + ESP32-S3)
- **Baseline Testbed**: Arduino UNO R3 (Pin-compatible baseline)
- **Power Architecture**: 12V DC Adapter -> CA-2596 Buck Converter (tuned to 4.8V) -> Servos
- **Common Ground**: Arduino GND and CA-2596 OUT- must be tied together.
- **Dispenser Actuators**: MG90S (Arm Mechanism, D5) + SG90 (Gate Mechanism, D8)
- **User Interface**: 0.96-inch I2C OLED (SSD1306, 0x3C, A4/A5) + 3 Push Buttons (A0, A1, A2)
- **Beneficiary Authentication**: MFRC522 RFID Reader (SPI, 3.3V power, D10 SS, D9 RST)

---

## 2. Locked Pinout Table (DO NOT CHANGE)

| Component | Pin Label | Arduino Pin | Notes |
| :--- | :--- | :--- | :--- |
| **RC522 RFID** | SDA / SS | **D10** | Slave Select / SPI CS |
| | SCK | **D13** | Hardware SPI Clock |
| | MOSI | **D11** | Hardware SPI Master Out |
| | MISO | **D12** | Hardware SPI Master In |
| | RST | **D9** | Reset Pin |
| | 3.3V | **3.3V** | ⚠️ Connect ONLY to Arduino 3.3V |
| | GND | **GND** | Common Ground |
| | IRQ | *Not connected* | Unused |
| **0.96" OLED** | VCC | **5V** | Arduino 5V |
| | GND | **GND** | Common Ground |
| | SDA | **A4** | Hardware I2C Data |
| | SCL | **A5** | Hardware I2C Clock |
| | Address | `0x3C` | Default SSD1306 Address |
| **Push Buttons** | Increment (+) | **A0** | Internal `INPUT_PULLUP` to GND |
| | Decrement (−) | **A1** | Internal `INPUT_PULLUP` to GND |
| | Confirm (OK) | **A2** | Internal `INPUT_PULLUP` to GND |
| **MG90S Servo** | Signal | **D5** | PWM Control Line |
| (ARM) | VCC | CA-2596 OUT+ | 4.8V external power |
| | GND | CA-2596 OUT- | Tied to Arduino GND |
| **SG90 Servo** | Signal | **D8** | Digital Control Line |
| (GATE) | VCC | CA-2596 OUT+ | 4.8V external power |
| | GND | CA-2596 OUT- | Tied to Arduino GND |

---

## 3. Power Supply Architecture

```
                 ┌─────────────────────────────┐
12V DC Adapter ─►│ IN+       CA-2596       OUT+│─────► MG90S Red (VCC)
 (Wall Adapter)  │           Buck              │─────► SG90 Red (VCC)
                 │ IN-     Converter       OUT-│──┬──► MG90S Brown/Black (GND)
                 └─────────────────────────────┘  │──► SG90 Brown/Black (GND)
                                                  │
                                                  ▼
                                            Arduino GND
                                        (Common Ground Tie)
```

> [!CAUTION]
> - Never connect 12V directly to servos or to Arduino 5V/3.3V headers.
> - Never power servos directly from the Arduino 5V regulator rail in the physical build (causes voltage brownout resets).
> - Arduino GND and CA-2596 OUT- **must** be connected together to provide a common reference for servo PWM signals.

---

## 4. Servo Motion Angles & Timings

| Servo | Rest Position | Active Position | Purpose |
| :--- | :--- | :--- | :--- |
| **MG90S (Arm)** | `0°` (Retracted) | `90°` (Extended) | Pushes bottom pad forward from stack |
| **SG90 (Gate)** | `0°` (Closed) | `90°` (Open) | Opens drop flap into collection hopper |

### Dispense Cycle (Per Pad):
1. **Arm Forward**: `armServo.write(90)` -> Delay `700 ms`
2. **Gate Open**: `gateServo.write(90)` -> Delay `700 ms`
3. **Arm Return**: `armServo.write(0)` -> Delay `700 ms`
4. **Gate Close**: `gateServo.write(0)` -> Delay `700 ms`
*(Total cycle time: 2.8s per pad)*

---

## 5. Physical Pad & Mechanical Dispenser Parameters

- **Single Pad Dimensions**: ~100 mm (Length) × ~88 mm (Breadth)
- **Stack Height (6 pads)**: ~45 mm
- **Single Pad Thickness**: ~7.5 mm (`45 mm / 6`)
- **Cartridge Capacity**: 9–10 pads vertically stacked
- **Alternative Motor Concept (Currently Set Aside)**: J-01 12V 100 RPM geared DC motor + L298N + HW-201 IR sensor (helical spiral coil mechanism).
