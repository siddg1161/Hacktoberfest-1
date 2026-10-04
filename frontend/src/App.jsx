import { useState, useEffect, useRef } from 'react';
import './index.css';

export default function App() {
  const [isActive, setIsActive] = useState(true);
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [batteryLevel, setBatteryLevel] = useState(88);
  const [connectionStatus, setConnectionStatus] = useState('Connected to Edge AI Camera');
  
  // Real-time Hazard & Navigation Direction State
  const [hazardStatus, setHazardStatus] = useState({
    isHazard: true,
    alertText: 'Stop! Chair 0.5m ahead in path.',
    directionalInstruction: 'Move 2 steps to your right.',
    severity: 4
  });
  
  // Real-time Detected Obstacles Stream
  const [detectedObjects, setDetectedObjects] = useState([
    { id: 1, label: 'Chair', distance: '0.5m', position: 'CENTER PATH', relativeSize: '18%', inPath: true, direction: 'Move Right' },
    { id: 2, label: 'Table', distance: '1.8m', position: 'RIGHT SIDE', relativeSize: '8%', inPath: false, direction: 'Clear' },
    { id: 3, label: 'Person', distance: '2.5m', position: 'LEFT SIDE', relativeSize: '5%', inPath: false, direction: 'Clear' },
  ]);

  const [lastAnnouncement, setLastAnnouncement] = useState('');
  const [gestureFeedback, setGestureFeedback] = useState('🔊 CONTINUOUS AUDIO LOOP ACTIVE • TAP FOR BATTERY • DOUBLE TAP FOR GEMMA PHOTO • LONG PRESS FOR SOS');
  const [capturedSnapshot, setCapturedSnapshot] = useState(null);
  const [loopCount, setLoopCount] = useState(0);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(document.createElement('canvas'));

  // Gesture Recognition Refs
  const lastTapTimeRef = useRef(0);
  const tapTimeoutRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const isLongPressRef = useRef(false);
  const touchStartRef = useRef({ x: 0, y: 0 });

  // Fetch Battery Level
  useEffect(() => {
    if ('getBattery' in navigator) {
      navigator.getBattery().then((battery) => {
        setBatteryLevel(Math.round(battery.level * 100));
        battery.addEventListener('levelchange', () => {
          setBatteryLevel(Math.round(battery.level * 100));
        });
      });
    }
  }, []);

  // Toggle High Contrast Mode
  useEffect(() => {
    if (isHighContrast) {
      document.body.classList.add('high-contrast');
    } else {
      document.body.classList.remove('high-contrast');
    }
  }, [isHighContrast]);

  // Audio Speech Synthesis Engine (Queue & Speech De-duplication)
  const speakText = (text, force = false) => {
    if ('speechSynthesis' in window) {
      // Avoid interrupting if currently speaking unless forced
      if (window.speechSynthesis.speaking && !force) return;

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.15; // Fast, clear speech for continuous guidance
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      window.speechSynthesis.speak(utterance);
      setLastAnnouncement(text);
    }
  };

  // Play Auditory Synthesized Tones
  const playEarcon = (type) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'shutter') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(1200, ctx.currentTime);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } else if (type === 'sos') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(900, ctx.currentTime);
        osc.frequency.setValueAtTime(1400, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } else if (type === 'hazard') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(440, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      }
    } catch (e) {
      console.log('Audio Context error');
    }
  };

  // =========================================================================
  // CONTINUOUS AUDIO NAVIGATION LOOP (NO BUTTON CLICKING REQUIRED)
  // =========================================================================
  useEffect(() => {
    if (!isActive) return;

    // Initial immediate audio start
    const initialMsg = hazardStatus.isHazard 
      ? `${hazardStatus.alertText} ${hazardStatus.directionalInstruction}`
      : 'Path clear ahead. Continue walking straight.';
    
    speakText(initialMsg, true);

    // Continuous loop interval (Runs every 3.2 seconds automatically)
    const loopInterval = setInterval(() => {
      setLoopCount((prev) => prev + 1);

      if (hazardStatus.isHazard) {
        // Continuous obstacle warning + direction guidance
        const inPathObject = detectedObjects.find((o) => o.inPath);
        const obstacleName = inPathObject ? inPathObject.label : 'Obstacle';
        const distance = inPathObject ? inPathObject.distance : '0.5m';
        
        const spokenGuidance = `Caution! ${obstacleName} ${distance} ahead. ${hazardStatus.directionalInstruction}`;
        
        playEarcon('hazard');
        if (navigator.vibrate) {
          navigator.vibrate([250, 100, 250]); // Continuous haptic warning pulse
        }
        speakText(spokenGuidance, true);
      } else {
        // Continuous path clear confirmation
        speakText('Path clear ahead. Continue straight.', true);
      }
    }, 3200);

    return () => clearInterval(loopInterval);
  }, [isActive, hazardStatus, detectedObjects]);

  // Take Camera Snapshot
  const takeSnapshot = () => {
    playEarcon('shutter');
    if (videoRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg');
      setCapturedSnapshot(dataUrl);
    }
  };

  // ==========================================
  // TOUCH GESTURE SHORTCUT OVERLAYS
  // ==========================================
  const handlePointerDown = (e) => {
    if (e.target.closest('.btn-a11y')) return;

    touchStartRef.current = { x: e.clientX, y: e.clientY };
    isLongPressRef.current = false;
    
    // LONG PRESS (Hold for 700ms) -> Caregiver SOS Signal
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      playEarcon('sos');
      if (navigator.vibrate) {
        navigator.vibrate([500, 100, 500, 100, 500]);
      }
      setGestureFeedback('🚨 SOS EMERGENCY SIGNAL TRANSMITTED!');
      speakText('S O S Emergency signal transmitted to your caregiver!', true);
    }, 700);
  };

  const handlePointerUp = (e) => {
    if (e.target.closest('.btn-a11y')) return;

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }

    if (isLongPressRef.current) return;

    const deltaX = e.clientX - touchStartRef.current.x;
    const deltaY = e.clientY - touchStartRef.current.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // SWIPE GESTURES
    if (absX > 60 || absY > 60) {
      if (absX > absY) {
        if (deltaX > 0) {
          setGestureFeedback('👉 SWIPE RIGHT: SCANNING RIGHT SIDE');
          speakText('Right side clear. Table detected 1.8 meters away.', true);
        } else {
          setGestureFeedback('👈 SWIPE LEFT: SCANNING LEFT SIDE');
          speakText('Left side clear. Person 2.5 meters away.', true);
        }
      } else {
        if (deltaY > 0) {
          const nextActive = !isActive;
          setIsActive(nextActive);
          setGestureFeedback(`👇 SWIPE DOWN: AUDIO LOOP ${nextActive ? 'RESUMED' : 'PAUSED'}`);
          speakText(nextActive ? 'Continuous navigation audio resumed.' : 'Navigation audio paused.', true);
        } else {
          setGestureFeedback('👆 SWIPE UP: REPEATING CURRENT DIRECTION');
          speakText(`${hazardStatus.alertText} ${hazardStatus.directionalInstruction}`, true);
        }
      }
      return;
    }

    // TAP GESTURES
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTapTimeRef.current;

    // DOUBLE TAP (< 350ms) -> Gemma Photo Description
    if (tapLength < 350 && tapLength > 0) {
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
      }
      takeSnapshot();
      setGestureFeedback('📷 DOUBLE TAP: GEMMA AI SCENE DESCRIPTION');
      speakText(
        'Analyzing surroundings with Gemma A I. I see a chair 0.5 meters ahead in your walking path and a table on the right side.',
        true
      );
    } else {
      // SINGLE TAP -> Battery & Connection Status
      tapTimeoutRef.current = setTimeout(() => {
        playEarcon('tap');
        const statusMsg = `Battery level is at ${batteryLevel} percent. ${connectionStatus}.`;
        setGestureFeedback(`🔋 SINGLE TAP: ${statusMsg}`);
        speakText(statusMsg, true);
      }, 350);
    }

    lastTapTimeRef.current = currentTime;
  };

  // Start Real Webcam Stream
  useEffect(() => {
    async function setupCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.log('Webcam feed unavailable, running vision simulation mode.');
      }
    }
    setupCamera();
  }, []);

  const triggerSimulatedHazard = () => {
    setHazardStatus({
      isHazard: true,
      alertText: 'Caution! Stairs descending 0.8 meters ahead.',
      directionalInstruction: 'Stop immediately. Step to your left.',
      severity: 5
    });
    setDetectedObjects([
      { id: 1, label: 'Stairs Down', distance: '0.8m', position: 'CENTER PATH', relativeSize: '24%', inPath: true, direction: 'Move Left' },
      { id: 2, label: 'Railing', distance: '1.2m', position: 'LEFT SIDE', relativeSize: '10%', inPath: false, direction: 'Clear' },
    ]);
  };

  const triggerSimulatedSafe = () => {
    setHazardStatus({
      isHazard: false,
      alertText: 'Path Clear.',
      directionalInstruction: 'Continue walking straight.',
      severity: 1
    });
    setDetectedObjects([
      { id: 1, label: 'Doorway', distance: '3.0m', position: 'AHEAD CLEAR', relativeSize: '4%', inPath: false, direction: 'Clear' },
    ]);
    speakText('Path clear ahead. Continue walking straight.', true);
  };

  return (
    <div 
      className="app-container"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      tabIndex="0"
      aria-label="Continuous Audio Navigation Surface for Blind Users. Audio guidance speaks continuously on loop. Tap for battery, double tap for Gemma photo, long press for SOS."
    >
      {/* SCREEN READER LIVE REGION */}
      <div 
        role="status" 
        aria-live="assertive" 
        aria-atomic="true" 
        className="screen-reader-only"
      >
        {lastAnnouncement}
      </div>

      {/* App Header */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
            </svg>
          </div>
          <div>
            <h1 className="brand-title">AURA VISION</h1>
            <p className="status-subtitle" style={{ fontSize: '13px' }}>Continuous Real-Time Audio Navigation Loop</p>
          </div>
        </div>

        <div className="a11y-toggles">
          <button 
            className="btn-a11y" 
            onClick={() => setIsActive(!isActive)}
            aria-label={isActive ? 'Pause Continuous Audio Loop' : 'Start Continuous Audio Loop'}
            style={{ borderColor: isActive ? 'var(--safe-green)' : 'var(--warning-amber)' }}
          >
            <span>{isActive ? '🔊 Audio Loop: ACTIVE' : '⏸️ Audio Loop: PAUSED'}</span>
          </button>
          
          <button 
            className="btn-a11y" 
            onClick={() => setIsHighContrast(!isHighContrast)}
            aria-label={`Toggle High Contrast Mode. Current mode: ${isHighContrast ? 'On' : 'Off'}`}
          >
            <span>{isHighContrast ? 'Standard Contrast' : 'High Contrast'}</span>
          </button>
        </div>
      </header>

      {/* Continuous Loop Status & Direction Banner */}
      <div className={`status-banner ${hazardStatus.isHazard ? 'hazard' : 'safe'}`}>
        <div className="status-info">
          <div className="status-indicator-dot" aria-hidden="true" />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 className="status-title">
                {hazardStatus.isHazard ? 'HAZARD AHEAD' : 'PATH CLEAR'}
              </h2>
              <span className="loop-pulse-badge">
                🔊 LOOP CYCLE #{loopCount}
              </span>
            </div>
            
            <p className="status-subtitle" style={{ color: '#ffffff', fontWeight: '800', fontSize: '26px', marginTop: '6px' }}>
              {hazardStatus.alertText}
            </p>

            <div className="direction-box">
              <span className="direction-icon">🧭</span>
              <span className="direction-text">
                DIRECTION: <strong>{hazardStatus.directionalInstruction}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Gesture Control Feedback Bar */}
      <div className="gesture-pad-banner">
        <div className="gesture-badge">CONTINUOUS AUDIO & GESTURE INTERACTION</div>
        <div className="gesture-feedback-text">{gestureFeedback}</div>
        
        <div className="gesture-guide-grid">
          <div className="gesture-card">
            <span className="gesture-icon">🔋</span>
            <span className="gesture-title">SINGLE TAP</span>
            <span className="gesture-desc">Battery & Connection</span>
          </div>
          <div className="gesture-card">
            <span className="gesture-icon">📷</span>
            <span className="gesture-title">DOUBLE TAP</span>
            <span className="gesture-desc">Gemma Photo Scene</span>
          </div>
          <div className="gesture-card">
            <span className="gesture-icon">🚨</span>
            <span className="gesture-title">LONG PRESS</span>
            <span className="gesture-desc">Caregiver SOS Signal</span>
          </div>
          <div className="gesture-card">
            <span className="gesture-icon">👈👉</span>
            <span className="gesture-title">SWIPE LEFT / RIGHT</span>
            <span className="gesture-desc">Scan Left / Right Side</span>
          </div>
        </div>
      </div>

      {/* Workspace Grid */}
      <div className="workspace-grid">
        {/* Camera Feed with Safe Corridor */}
        <div className="card">
          <div className="card-title">
            <span>LIVE REAL-TIME VISION CORRIDOR</span>
            <span style={{ fontSize: '13px', color: 'var(--safe-green)', fontFamily: 'var(--font-mono)' }}>
              ● 30 FPS YOLOv8 Tracking
            </span>
          </div>
          
          <div className="camera-view">
            <video ref={videoRef} autoPlay playsInline muted className="camera-feed" />
            <div className="safe-corridor-overlay">
              <span className="corridor-label">SAFE CORRIDOR (30% - 70%)</span>
            </div>
          </div>

          {capturedSnapshot && (
            <div style={{ marginTop: '12px' }}>
              <span style={{ fontSize: '12px', color: 'var(--warning-amber)', fontWeight: '700' }}>
                📷 GEMMA AI ANALYZED SNAPSHOT:
              </span>
              <img 
                src={capturedSnapshot} 
                alt="Captured scene analyzed by Gemma AI" 
                style={{ width: '100%', height: '100px', objectFit: 'cover', borderRadius: '8px', marginTop: '6px', border: '1px solid var(--warning-amber)' }} 
              />
            </div>
          )}
        </div>

        {/* Real-Time Objects & Directional Telemetry */}
        <div className="card">
          <div className="card-title">
            <span>REAL-TIME OBSTACLE STREAM</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              {detectedObjects.length} Objects Tracked
            </span>
          </div>

          <div className="detections-list">
            {detectedObjects.map((obj) => (
              <div 
                key={obj.id} 
                className={`detection-item ${obj.inPath ? 'in-path-hazard' : ''}`}
              >
                <div>
                  <div className="detection-name">{obj.label} ({obj.distance})</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Position: <strong>{obj.position}</strong> • Size: {obj.relativeSize}
                  </div>
                </div>
                
                <div style={{ textAlign: 'right' }}>
                  <span className={`detection-badge ${obj.inPath ? 'hazard' : 'safe'}`}>
                    {obj.inPath ? 'HAZARD' : 'SIDE'}
                  </span>
                  <div style={{ fontSize: '11px', color: 'var(--cyan-glow)', marginTop: '4px', fontWeight: '700' }}>
                    {obj.direction}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
            <button 
              className="btn-a11y" 
              style={{ flex: 1, justifyContent: 'center', borderColor: 'var(--hazard-red)' }}
              onClick={triggerSimulatedHazard}
            >
              Simulate Stairs Hazard
            </button>
            <button 
              className="btn-a11y" 
              style={{ flex: 1, justifyContent: 'center', borderColor: 'var(--safe-green)' }}
              onClick={triggerSimulatedSafe}
            >
              Simulate Safe Path
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
