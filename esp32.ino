/*
  ESP32 WiFi Probe Request Sniffer with MQTT Reporting
  ----------------------------------------------------
  This project captures WiFi probe requests using ESP32 in promiscuous mode
  and publishes RSSI data to an MQTT broker.
  
  Author: Rüştü Yemenici
  Date: 2025
  GitHub-ready version
*/

#include <WiFi.h>
#include "esp_wifi.h"
#include <PubSubClient.h>

// WiFi credentials
const char* SSID = "ssid";
const char* PASSWORD = "password";

// MQTT configuration
const char* MQTT_SERVER = "serverip";
const int MQTT_PORT = 1883;
const char* MQTT_TOPIC = "esp32/test";
const char* MQTT_USER = "esp32";
const char* MQTT_PASSWORD = "password";
const String CLIENT_ID = "espid";

// RSSI threshold
const int RSSI_THRESHOLD = -100;

// MAC address to ignore
const char* IGNORE_MAC = "36:2C:18:D9:1C:4B";

WiFiClient espClient;
PubSubClient mqttClient(espClient);

// Function to check and reconnect WiFi
void checkWiFi() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi connection lost, reconnecting...");
    WiFi.disconnect();
    WiFi.reconnect();
    int retry = 0;
    while (WiFi.status() != WL_CONNECTED && retry < 10) {
      delay(1000);
      Serial.print(".");
      retry++;
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\nWiFi reconnected!");
    } else {
      Serial.println("\nWiFi connection failed!");
    }
  }
}

// Function to reconnect MQTT
void reconnectMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("Connecting to MQTT...");
    if (mqttClient.connect(CLIENT_ID.c_str(), MQTT_USER, MQTT_PASSWORD)) {
      Serial.println("Connected!");
    } else {
      Serial.print("Connection failed, code: ");
      Serial.println(mqttClient.state());
      Serial.println("Retrying in 5 seconds...");
      delay(5000);
    }
  }
}

// Promiscuous mode callback
void sniffer(void* buf, wifi_promiscuous_pkt_type_t type) {
  wifi_promiscuous_pkt_t *pkt = (wifi_promiscuous_pkt_t*)buf;
  int rssi = pkt->rx_ctrl.rssi;

  if (rssi >= RSSI_THRESHOLD) {
    uint8_t *mac = pkt->payload + 10;
    char macStr[18];
    sprintf(macStr, "%02X:%02X:%02X:%02X:%02X:%02X",
            mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    if (strcmp(macStr, IGNORE_MAC) == 0) {
      Serial.printf("Probe Request MAC: %s | RSSI: %d dBm\n", macStr, rssi);

      if (mqttClient.connected()) {
        char msg[128];
        sprintf(msg, "ESP:esp4|MAC:%s|RSSI:%d", macStr, rssi);
        mqttClient.publish(MQTT_TOPIC, msg);
      }
    }
  }
}

void setup() {
  Serial.begin(115200);

  // Connect to WiFi
  WiFi.begin(SSID, PASSWORD);
  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < 20) {
    delay(1000);
    Serial.print(".");
    retry++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected!");
  } else {
    Serial.println("\nWiFi Connection Failed! Please restart the ESP32.");
    return;
  }

  // Setup MQTT
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  reconnectMQTT();

  // Setup promiscuous mode
  WiFi.mode(WIFI_STA);
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_promiscuous_rx_cb(&sniffer);
}

void loop() {
  checkWiFi();

  if (!mqttClient.connected()) {
    reconnectMQTT();
  }

  mqttClient.loop();
  delay(1000);
}
