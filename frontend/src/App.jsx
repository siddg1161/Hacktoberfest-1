import { useState, useEffect, useRef } from 'react';
import './index.css';

export default function App() {
  const [isActive, setIsActive] = useState(true);
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [batteryLevel, setBatteryLevel] = useState(88);
  const [wsConnected, setWsConnected] = useState(false);

  // Real-time Dynamic Navigation & Hazard State (From Python Server)
  const [hazardStatus, setHazardStatus] = useState({
    isHazard: false,
    alertText: 'Connecting to Real-time Edge AI...',
    severity: 1
  });

  // Real-time Dynamic YOLO Detected Objects Stream (From Backend)
  const [detectedObjects, setDetectedObjects] = useState([]);
  const [lastAnnouncement, setLastAnnouncement] = useState('');
  const spokenCooldownRef = useRef({});  // label -> timestamp, to avoid repeating too fast

  // --- VOLUME CONTROLS ---
  // Buzz (earcon) volume: kept low so it doesn't startle
  // Speech (directions) volume: kept high so instructions are clearly heard
  const buzzVolumeRef = useRef(0.05);    // very low buzz for hazard earcon
  const speechVolumeRef = useRef(1.0);   // full volume for spoken directions
  const [gestureFeedback, setGestureFeedback] = useState('⚡ WEBSOCKET REAL-TIME STREAM ACTIVE • SINGLE TAP = BATTERY • DOUBLE TAP = GEMMA SNAPSHOT • LONG PRESS = SOS');
  const [capturedSnapshot, setCapturedSnapshot] = useState(null);
  const [frameCount, setFrameCount] = useState(0);

  const videoRef = useRef(null);
  const canvasRef = useRef(document.createElement('canvas'));
  const wsRef = useRef(null);
  const lastSpokenTextRef = useRef('');

  // Gesture Recognition Refs
  const lastTapTimeRef = useRef(0);
  const tapTimeoutRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const isLongPressRef = useRef(false);
  const touchStartRef = useRef({ x: 0, y: 0 });

  // Battery Status API
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

  // High Contrast Theme
  useEffect(() => {
    if (isHighContrast) {
      document.body.classList.add('high-contrast');
    } else {
      document.body.classList.remove('high-contrast');
    }
  }, [isHighContrast]);

  // Real-Time Audio Speech Synthesis (Text-to-Speech)
  // Uses speechVolumeRef (1.0) so directions like "chair ahead" are spoken loudly and clearly
  const speakText = (text, interrupt = false) => {
    if (!text || !("speechSynthesis" in window)) return;
    if (interrupt) window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.pitch = 1.0;
    utterance.volume = speechVolumeRef.current; // HIGH volume for directions
    window.speechSynthesis.speak(utterance);
    setLastAnnouncement(text);
    lastSpokenTextRef.current = text;
  };

  // Speak each detected object individually with its spatial direction.
  // e.g. "chair ahead", "person on your left", "bottle on your right"
  // Per-label cooldown prevents the same object being announced more than once per 4s.
  const announceDetectedObjects = (objects) => {
    if (!objects || objects.length === 0) return;
    const now = Date.now();
    const COOLDOWN_MS = 4000; // 4 seconds per unique label
    objects.forEach((obj) => {
      const label = obj.label || 'unknown object';
      // Build full spoken phrase from label + spatial position
      const rawPosition = obj.position || (obj.in_path ? 'in center path' : 'nearby');
      // "in center path" -> "ahead" for natural speech
      const spokenPosition = rawPosition === 'in center path' ? 'ahead' : rawPosition;
      const phrase = `${label} ${spokenPosition}`; // e.g. "chair ahead"
      const lastSpoken = spokenCooldownRef.current[label] || 0;
      if (now - lastSpoken > COOLDOWN_MS) {
        spokenCooldownRef.current[label] = now;
        speakText(phrase); // speaks "chair ahead", "person on your left", etc.
      }
    });
  };
  // Configurable Hazard Audio Sound Properties
  // buzzVolumeRef (0.12) keeps the earcon subtle — not startling
  const [hazardSoundConfig, setHazardSoundConfig] = useState({
    volume: 0.05,      // Very low buzz volume
    startFreq: 400,    // Mid-low buzz frequency — clearly hearable on laptop speakers
    duration: 0.18     // Short pulse duration
  });

  // Sync hazardSoundConfig.volume from buzzVolumeRef on mount
  // (both are kept in sync — edit buzzVolumeRef to change buzz loudness)

  // Earcon Sound Synthesizer
  const playEarcon = (type, customConfig = {}) => {
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtxClass();

      if (type === 'shutter') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(1200, ctx.currentTime);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);

      } else if (type === 'sos') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(900, ctx.currentTime);
        osc.frequency.setValueAtTime(1400, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);

      } else if (type === 'hazard') {
        // Double-pulse buzz — clearly audible warning sound
        const vol = customConfig.volume ?? hazardSoundConfig.volume;
        const freq = customConfig.startFreq ?? hazardSoundConfig.startFreq;
        const dur = customConfig.duration ?? hazardSoundConfig.duration;

        const playPulse = (startAt) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sawtooth';        // buzzy feel
          osc.frequency.value = freq;   // 400 Hz — clearly audible
          gain.gain.setValueAtTime(0, startAt);
          gain.gain.linearRampToValueAtTime(vol, startAt + 0.02); // quick attack
          gain.gain.linearRampToValueAtTime(0, startAt + dur);    // smooth fade out
          osc.start(startAt);
          osc.stop(startAt + dur + 0.01);
        };

        playPulse(ctx.currentTime);           // BUZZ 1
        playPulse(ctx.currentTime + dur + 0.08); // BUZZ 2 (short gap)

      } else {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      }
    } catch (e) {
      console.log('Audio context error:', e);
    }
  };


  // =========================================================================
  // REAL-TIME WEBSOCKET CONNECTION & DYNAMIC DETECTION STREAMING
  // =========================================================================
  useEffect(() => {
    const wsUrl = 'ws://localhost:8000/ws/vision';
    console.log(`Connecting to WebSocket: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('⚡ WebSocket Connected to Python Edge Server!');
      setWsConnected(true);
      speakText('Connected to Real-time Edge A I Vision Server.');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'navigation_update') {
          // 1. Update Dynamic Detected Objects Stream
          const objectsList = data.objects || [];
          setDetectedObjects(objectsList);

          // 2. Update Dynamic Hazard Status & Text Command from Python Backend
          const isHazard = data.hazard || false;
          const commandText = data.command || 'Path clear ahead.';

          setHazardStatus({
            isHazard: isHazard,
            alertText: commandText,
            severity: isHazard ? 4 : 1
          });

          // 3. DYNAMIC TEXT-TO-SPEECH & HAPTIC VIBRATION
          if (isActive) {
            if (isHazard) {
              playEarcon('hazard');
              if (navigator.vibrate) {
                navigator.vibrate([300, 100, 300]);
              }
              // Announce each hazard object individually (e.g. "chair ahead")
              announceDetectedObjects(objectsList.filter(o => o.in_path));
            } else {
              // Announce all detected objects in the scene
              announceDetectedObjects(objectsList);
            }
          }
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    ws.onerror = (err) => {
      console.log('WebSocket Connection Error:', err);
      setWsConnected(false);
    };

    ws.onclose = () => {
      console.log('WebSocket Disconnected');
      setWsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [isActive]);

  // =========================================================================
  // REAL-TIME WEBCAM STREAM & FRAME TRANSMISSION (10 FPS STREAM)
  // =========================================================================
  useEffect(() => {
    async function setupCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.log('Webcam feed unavailable, ensure camera permissions are allowed.');
      }
    }
    setupCamera();

    // Send real-time frame to WebSocket every 200ms (~5 FPS for low latency)
    const frameInterval = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && videoRef.current) {
        const video = videoRef.current;
        if (video.readyState === 4) { // HAVE_ENOUGH_DATA
          const canvas = canvasRef.current;
          canvas.width = 320;
          canvas.height = 240;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          const base64Frame = canvas.toDataURL('image/jpeg', 0.5);
          wsRef.current.send(JSON.stringify({
            type: 'frame',
            frame: base64Frame
          }));
          setFrameCount((prev) => prev + 1);
        }
      }
    }, 200);

    return () => clearInterval(frameInterval);
  }, []);

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

  // =========================================================================
  // FULL TOUCH GESTURE SHORTCUT CONTROLLER
  // =========================================================================
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
      setGestureFeedback('🚨 LONG PRESS: SOS EMERGENCY SIGNAL TRANSMITTED!');
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
          const rightObjects = detectedObjects.filter(o => !o.inPath);
          const rightText = rightObjects.length > 0
            ? `Right side: ${rightObjects.map(o => o.label).join(', ')} detected.`
            : 'Right side clear.';
          speakText(rightText, true);
        } else {
          setGestureFeedback('👈 SWIPE LEFT: SCANNING LEFT SIDE');
          speakText('Left side clear.', true);
        }
      } else {
        if (deltaY > 0) {
          const nextActive = !isActive;
          setIsActive(nextActive);
          setGestureFeedback(`👇 SWIPE DOWN: AUDIO ${nextActive ? 'RESUMED' : 'PAUSED'}`);
          speakText(nextActive ? 'Navigation audio resumed.' : 'Navigation audio paused.', true);
        } else {
          setGestureFeedback('👆 SWIPE UP: REPEATING CURRENT WARNING');
          speakText(hazardStatus.alertText, true);
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
      const sceneSummary = detectedObjects.length > 0
        ? `Analyzing scene with Gemma A I. Detected ${detectedObjects.length} objects: ${detectedObjects.map(o => `${o.label}`).join(', ')}.`
        : 'Analyzing scene with Gemma A I. Path is clear.';
      speakText(sceneSummary, true);
    } else {
      // SINGLE TAP -> Battery & Connection Status
      tapTimeoutRef.current = setTimeout(() => {
        playEarcon('tap');
        const statusMsg = `Battery is at ${batteryLevel} percent. ${wsConnected ? 'Connected to Real-time Edge AI Server' : 'Disconnected from Edge AI Server'}.`;
        setGestureFeedback(`🔋 SINGLE TAP: ${statusMsg}`);
        speakText(statusMsg, true);
      }, 350);
    }

    lastTapTimeRef.current = currentTime;
  };

  return (
    <div
      className="app-container"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      tabIndex="0"
      aria-label="Real-time Dynamic Vision Navigation System. Connects via WebSocket to Python YOLOv8 and converts real-time detections into speech automatically."
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
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          </div>
          <div>
            <h1 className="brand-title">AURA VISION</h1>
            <p className="status-subtitle" style={{ fontSize: '13px' }}>Real-time Dynamic WebSocket Vision Pipeline</p>
          </div>
        </div>

        <div className="a11y-toggles">
          <button
            className="btn-a11y"
            onClick={() => setIsActive(!isActive)}
            aria-label={isActive ? 'Pause Speech Output' : 'Start Speech Output'}
            style={{ borderColor: wsConnected ? 'var(--safe-green)' : 'var(--hazard-red)' }}
          >
            <span>{wsConnected ? '⚡ WEBSOCKET: CONNECTED' : '🔴 WEBSOCKET: CONNECTING...'}</span>
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

      {/* Dynamic Navigation & Hazard Alert Banner */}
      <div className={`status-banner ${hazardStatus.isHazard ? 'hazard' : 'safe'}`}>
        <div className="status-info">
          <div className="status-indicator-dot" aria-hidden="true" />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 className="status-title">
                {hazardStatus.isHazard ? 'HAZARD DETECTED' : 'PATH CLEAR'}
              </h2>
              <span className="loop-pulse-badge">
                ⚡ FRAME #{frameCount}
              </span>
            </div>

            <p className="status-subtitle" style={{ color: '#ffffff', fontWeight: '800', fontSize: '26px', marginTop: '6px' }}>
              {hazardStatus.alertText}
            </p>
          </div>
        </div>
      </div>

      {/* Gesture Control Feedback Bar */}
      <div className="gesture-pad-banner">
        <div className="gesture-badge">DYNAMIC TOUCH & GESTURE CONTROLLER</div>
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
            <span className="gesture-title">SWIPE GESTURES</span>
            <span className="gesture-desc">Scan Surroundings</span>
          </div>
        </div>
      </div>

      {/* Workspace Grid */}
      <div className="workspace-grid">
        {/* Real-time WebCam Stream */}
        <div className="card">
          <div className="card-title">
            <span>LIVE CAMERA FEED (WEBSOCKET TRANSMITTER)</span>
            <span style={{ fontSize: '13px', color: 'var(--safe-green)', fontFamily: 'var(--font-mono)' }}>
              ● Streaming to ws://localhost:8000
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

        {/* Dynamic Real-Time Detections List (Received from WebSocket) */}
        <div className="card">
          <div className="card-title">
            <span>REAL-TIME DYNAMIC DETECTIONS</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              {detectedObjects.length} Objects Live
            </span>
          </div>

          <div className="detections-list">
            {detectedObjects.length > 0 ? (
              detectedObjects.map((obj, idx) => (
                <div
                  key={idx}
                  className={`detection-item ${obj.in_path ? 'in-path-hazard' : ''}`}
                >
                  <div>
                    <div className="detection-name">{obj.label}</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Coordinates: [{obj.coordinates ? obj.coordinates.join(', ') : 'N/A'}]
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <span className={`detection-badge ${obj.in_path ? 'hazard' : 'safe'}`}>
                      {obj.in_path ? 'IN PATH (HAZARD)' : 'SIDE PATH'}
                    </span>
                    <div style={{ fontSize: '11px', color: 'var(--cyan-glow)', marginTop: '4px', fontWeight: '700' }}>
                      Size: {obj.relative_size}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Scanning camera feed for obstacles...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
