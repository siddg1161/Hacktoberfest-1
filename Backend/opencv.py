import cv2
from model import navigation_agent
from ultralytics import YOLO

# Load the lightweight, ultra-low-latency edge model
model = YOLO("yolov8n.pt") 

def get_yolo_data(frame):
    """
    Processes a single frame to extract bounding boxes, 
    evaluates proximity via box area, and flags hazards.
    """
    # Run YOLOv8 inference
    results = model(frame, verbose=False)
    boxes = results[0].boxes
    
    # Define the "Safe Corridor" (middle 40% of the screen)
    height, width, _ = frame.shape
    corridor_left = width * 0.30
    corridor_right = width * 0.70
    
    detected_objects = []
    hazard_detected = False
    
    for box in boxes:
        # Extract raw coordinates (x1, y1 = top-left; x2, y2 = bottom-right)
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        
        # Extract classification
        class_id = int(box.cls[0].item())
        class_name = model.names[class_id]
        
        # 1. Depth Heuristic: Calculate relative bounding box size
        box_area = (x2 - x1) * (y2 - y1)
        image_area = height * width
        relative_size = box_area / image_area
        
        # 2. Trajectory Logic: Is the object directly in front of the user?
        box_center_x = (x1 + x2) / 2
        in_path = corridor_left < box_center_x < corridor_right
        
        # 3. The Decision Trigger: Close (large area) + In Path
        if in_path and relative_size > 0.15: # Object occupies > 15% of the frame
            hazard_detected = True
            
        detected_objects.append({
            "label": class_name,
           "relative_size": round(relative_size, 3),
            "in_path": in_path,
            "coordinates": [int(x1), int(y1), int(x2), int(y2)]
        })
        
    return detected_objects, hazard_detected

def run_vision_loop():
    """Main capture loop running continuously on the edge hardware."""
    cap = cv2.VideoCapture(0)
    
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
            
        # Run perception logic
        objects, is_hazard = get_yolo_data(frame)
        
        # Draw bounding boxes for visual debugging (Green = Safe, Red = Hazard)
        for obj in objects:
            x1, y1, x2, y2 = obj["coordinates"]
            color = (0, 0, 255) if obj["in_path"] and obj["relative_size"] > 0.15 else (0, 255, 0)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(frame, obj["label"], (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
            
        cv2.imshow("Navigation Edge Vision", frame)
        
        # If the local decision logic flags a threat, trigger the Agent
        if is_hazard:
            # Compress the frame for the API
            _, buffer = cv2.imencode('.jpg', frame)
            frame_bytes = buffer.tobytes()
            
            print(f"HAZARD DETECTED! Awakening Agent with {len(objects)} objects.")
            
            result = navigation_agent.invoke({
                "current_frame": frame_bytes, 
                "detected_objects": objects,
                "hazard_detected": True,
                "messages": [] # LangGraph will handle appending to the memory automatically
            })
            
            # Temporarily pause loop to prevent spamming the LLM
            cv2.waitKey(3000) 
            
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break
            
    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    run_vision_loop()