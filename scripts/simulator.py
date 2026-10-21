import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion
import json
import time
import random

MQTT_BROKER = "127.0.0.1" 
MQTT_TOPIC = "vatio/DEV-001/rs485"

GREEN = "\033[92m"
CYAN = "\033[96m"
YELLOW = "\033[93m"
RESET = "\033[0m"

client = mqtt.Client(callback_api_version=CallbackAPIVersion.VERSION2, client_id="Simulator_Node")
client.connect(MQTT_BROKER, 1883)
print(f"{GREEN}[simulator]{RESET} Connected to broker at {MQTT_BROKER}:1883", flush=True)

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
    print(f"{GREEN}[simulator]{RESET} Published to {CYAN}{MQTT_TOPIC}{RESET}: {YELLOW}{payload}{RESET}", flush=True)
    time.sleep(5) # Simulate the polling delay in the loop()