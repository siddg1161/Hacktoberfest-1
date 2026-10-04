import cv2
import time
import threading
from model import navigation_agent
from ultralytics import YOLO

# Load the lightweight, ultra-low-latency edge model
model = YOLO("yolov8n.pt") 

def get_yolo_data(frame):
    results = model(frame, verbose=False)
    boxes = results[0].boxes
    
    height, width, _ = frame.shape
    corridor_left = width * 0.30
    corridor_right = width * 0.70
    
    detected_objects = []
    hazard_detected = False
    
    for box in boxes:
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        class_id = int(box.cls[0].item())
        class_name = model.names[class_id]
        
        box_area = (x2 - x1) * (y2 - y1)
        image_area = height * width
        relative_size = box_area / image_area
        
        box_center_x = (x1 + x2) / 2
        in_path = corridor_left < box_center_x < corridor_right
        
        if box_center_x < width * 0.35:
            position_label = "on your left"
        elif box_center_x > width * 0.65:
            position_label = "on your right"
        else:
            position_label = "in center path"

        if in_path: 
            hazard_detected = True
            
        detected_objects.append({
            "label": class_name,
            "position": position_label,
            "relative_size": round(relative_size, 3),
            "in_path": in_path,
            "coordinates": [int(x1), int(y1), int(x2), int(y2)]
        })
        
    return detected_objects, hazard_detected

def trigger_agent_background(frame_bytes, objects):
    """Runs the LLM and Audio completely in the background."""
    print(f"Background thread started for {len(objects)} objects.")
    navigation_agent.invoke({
        "current_frame": frame_bytes, 
        "detected_objects": objects,
        "hazard_detected": True,
        "messages": [] 
    })

def run_vision_loop():
    cap = cv2.VideoCapture(0)
    
    # Track the last alert time to prevent overlapping audio spam
    last_alert_time = 0
    COOLDOWN_SECONDS = 5
    
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
            
        objects, is_hazard = get_yolo_data(frame)
        
        for obj in objects:
            x1, y1, x2, y2 = obj["coordinates"]
            color = (0, 0, 255) if obj["in_path"] else (0, 255, 0)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(frame, obj["label"], (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
            
        cv2.imshow("Navigation Edge Vision", frame)
        
        current_time = time.time()
        
        # Trigger ONLY if there is an obstacle AND the cooldown has passed
        if len(objects) > 0 and (current_time - last_alert_time > COOLDOWN_SECONDS):
            last_alert_time = current_time # Reset the timer
            
            _, buffer = cv2.imencode('.jpg', frame)
            frame_bytes = buffer.tobytes()
            
            # Spawn a background thread to handle the API and Audio
            # This ensures cv2.imshow keeps updating instantly
            threading.Thread(
                target=trigger_agent_background, 
                args=(frame_bytes, objects),
                daemon=True
            ).start()
            
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break
            
    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    run_vision_loop()