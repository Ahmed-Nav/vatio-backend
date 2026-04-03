import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion
import json
import time
import random

# Based on vatio.ino TOPIC_DATA 
MQTT_BROKER = "localhost" 
MQTT_TOPIC = "vatio/devices/DEV-001/telemetry"

client = mqtt.Client(callback_api_version=CallbackAPIVersion.VERSION2, client_id="Simulator_Node")
client.connect(MQTT_BROKER, 1883)

while True:
    # Mimicking the sendDat() structure from vatio.ino 
    payload = {
        "deviceId": "DEV-001",
        "metrics": {
            "Import_kWh": round(random.uniform(100, 500), 2),
            "V_L1N": round(random.uniform(220, 240), 2),
            "I_L1": round(random.uniform(1, 10), 2),
            "Total_kW": round(random.uniform(0.5, 5.0), 2),
            "Frequency": round(random.uniform(49.5, 50.5), 2)
        }
    }
    
    client.publish(MQTT_TOPIC, json.dumps(payload))
    print(f"Published to {MQTT_TOPIC}: {payload}")
    time.sleep(5) # Simulate the polling delay in the loop()