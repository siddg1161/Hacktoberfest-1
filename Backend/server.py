import base64
import json
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import cv2
import numpy as np

from model import navigation_agent
from opencv import get_yolo_data

app = FastAPI(title="AURA Vision Assistive Navigation Server")

# Enable CORS for React Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "active", "system": "AURA Vision Edge AI"}

@app.websocket("/ws/vision")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("⚡ Frontend WebSocket Client Connected!")
    
    try:
        while True:
            # 1. Receive JSON message from frontend
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get("type") == "frame":
                # 2. Decode base64 frame from frontend
                base64_str = message["frame"].split(",")[-1]
                img_bytes = base64.b64decode(base64_str)
                np_arr = np.frombuffer(img_bytes, np.uint8)
                frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
                
                if frame is not None:
                    # 3. Run instant YOLOv8 detection (~15ms)
                    objects, is_hazard = get_yolo_data(frame)
                    
                    # 4. Generate real-time directional speech alert with exact object positions
                    if len(objects) > 0:
                        descriptions = []
                        center_objs = [o for o in objects if o.get("in_path") or o.get("position") == "in center path"]
                        side_objs = [o for o in objects if o not in center_objs]
                        
                        if center_objs:
                            center_names = ", ".join([o['label'] for o in center_objs])
                            descriptions.append(f"Caution! {center_names.capitalize()} in center path.")
                        else:
                            descriptions.append("Path clear ahead.")

                        for obj in side_objs[:2]: # Top 2 side obstacles
                            descriptions.append(f"{obj['label'].capitalize()} {obj['position']}.")

                        alert_text = " ".join(descriptions)
                    else:
                        alert_text = "Path clear ahead. Continue straight."
                    
                    # 5. Send structured JSON response back to frontend immediately
                    await websocket.send_json({
                        "type": "navigation_update",
                        "hazard": is_hazard,
                        "command": alert_text,
                        "objects": objects
                    })
                    
    except WebSocketDisconnect:
        print("Frontend client disconnected.")
    except Exception as err:
        print(f"WebSocket Error: {err}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
