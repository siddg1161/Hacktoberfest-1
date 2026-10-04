import base64
import os
from dotenv import load_dotenv
import pyttsx3
from typing import Annotated, TypedDict
from pydantic import BaseModel, Field
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.messages import HumanMessage, AIMessage
from langchain_google_genai import ChatGoogleGenerativeAI


load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")

class HazardAlert(BaseModel):
    severity: int = Field(description="Severity of the hazard from 1 (low) to 5 (critical)")
    audio_command: str = Field(description="Strict 2-4 word spoken command. E.g., 'Stop, stairs down', 'Car on left'")
    is_safe_to_proceed: bool = Field(description="Whether the physical path is currently clear")

# Initialize the generative API via LangChain
llm = ChatGoogleGenerativeAI(
    google_api_key=api_key or "YOUR_API_KEY_HERE",
    model="gemma-4-26b-a4b-it", 
    temperature=0.2, 
    max_retries=2
)
structured_llm = llm.with_structured_output(HazardAlert)


# Initialize the offline text-to-speech engine
engine = pyttsx3.init()
engine.setProperty('rate', 180) # Slightly faster for urgent alerts

# 1. Define the State Schema
class AgentState(TypedDict):
    # Memory: Accumulates conversation history automatically via add_messages reducer
    messages: Annotated[list, add_messages]
    
    # Real-time Edge Data: Passed in on every invocation from OpenCV
    current_frame: bytes 
    detected_objects: list[dict]
    
    # Safety Logic: The trigger flag calculated by the local Python script
    hazard_detected: bool

# 2. Define the Nodes
def edge_perception_node(state: AgentState):
    """
    Acts as the data-ingestion point in the graph.
    Since the OpenCV loop calculates the hazard before invoking the graph, 
    this node simply passes the state forward to the router.
    """
    return state

def gemma_reasoning_node(state: AgentState):
    """
    Triggered ONLY when a hazard is detected.
    Passes the frame and YOLOv8 metadata to the multimodal API for deep reasoning.
    """
    image_bytes = state["current_frame"]
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    
    prompt_text = (
        f"You are an assistive navigation AI for a visually impaired user. "
        f"A collision hazard was triggered. Real-time edge data: {state['detected_objects']}. "
        f"Analyze the image and provide a maximum 10-word urgent, spatial audio warning. Output only the warning."
    )
    
    message = HumanMessage(
        content=[
            {"type": "text", "text": prompt_text},
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}
            },
        ]
    )
    
    # Call the multimodal LLM for context analysis
    try:
        response = structured_llm.invoke([message])
        alert_text = response.audio_command
    except Exception as err:
        alert_text = "Hazard detected in path"
        print(f"⚠️ Gemini API Key notice: {err}")
        print("🔊 Using offline local audio alert fallback.")
    
    # Generate the offline audio alert instantly
    print(f"🔊 AUDIO ALERT: {alert_text}")
    engine.say(alert_text)
    engine.runAndWait()
    
    # Return the response wrapped as AIMessage to append to conversational memory
    return {"messages": [AIMessage(content=alert_text)]}

# 3. Define Conditional Routing
def route_hazard(state: AgentState):
    """Routes the graph based on the fast edge logic flag."""
    if state.get("hazard_detected"):
        return "reasoning"
    
    # If no hazard is detected, the graph quietly terminates to save resources
    return END

# 4. Build and Compile the Graph
def build_navigation_agent():
    builder = StateGraph(AgentState)

    # Register Nodes
    builder.add_node("perception", edge_perception_node)
    builder.add_node("reasoning", gemma_reasoning_node)

    # Wire Edges
    builder.add_edge(START, "perception")
    builder.add_conditional_edges(
        "perception", 
        route_hazard, 
        {"reasoning": "reasoning", END: END}
    )
    builder.add_edge("reasoning", END)

    # Compile into an executable agent application
    return builder.compile()

# Export the compiled agent so it can be imported by your main OpenCV capture loop
navigation_agent = build_navigation_agent()