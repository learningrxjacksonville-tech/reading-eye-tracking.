import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const DEFAULT_PASSAGE = `The fox hurried through the forest at sunrise. It stopped near a fallen log and listened for the birds. A bright red leaf drifted past its nose. The fox jumped over a stream, trotted up a hill, and looked across the meadow. In the distance, the trees moved gently in the wind. Soon the fox curled up in a quiet patch of grass and rested in the warm morning light.`;

const CALIBRATION_POINTS = [
  { x: 0.15, y: 0.18, label: 'Top Left' },
  { x: 0.85, y: 0.18, label: 'Top Right' },
  { x: 0.5, y: 0.5, label: 'Center' },
  { x: 0.15, y: 0.82, label: 'Bottom Left' },
  { x: 0.85, y: 0.82, label: 'Bottom Right' },
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function average(points) {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function splitIntoLines(text, maxChars = 42) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function getEyeFeatures(face) {
  const pts = face;
  const leftIris = [pts[468], pts[469], pts[470], pts[471], pts[472]].filter(Boolean);
  const rightIris = [pts[473], pts[474], pts[475], pts[476], pts[477]].filter(Boolean);
  const leftEyeCorners = [pts[33], pts[133]].filter(Boolean);
  const rightEyeCorners = [pts[362], pts[263]].filter(Boolean);
  const leftLids = [pts[159], pts[145]].filter(Boolean);
  const rightLids = [pts[386], pts[374]].filter(Boolean);

  if (
    leftIris.length < 5 ||
    rightIris.length < 5 ||
    leftEyeCorners.length < 2 ||
    rightEyeCorners.length < 2
  ) {
    return null;
  }

  const li = average(leftIris);
  const ri = average(rightIris);
  const lc = average(leftEyeCorners);
  const rc = average(rightEyeCorners);
  const ll = average(leftLids);
  const rl = average(rightLids);

  const leftWidth = distance(leftEyeCorners[0], leftEyeCorners[1]) || 1;
  const rightWidth = distance(rightEyeCorners[0], rightEyeCorners[1]) || 1;
  const leftHeight = distance(leftLids[0], leftLids[1]) || 1;
  const rightHeight = distance(rightLids[0], rightLids[1]) || 1;

  const leftX = (li.x - leftEyeCorners[0].x) / leftWidth;
  const rightX = (ri.x - rightEyeCorners[0].x) / rightWidth;
  const leftY = (li.y - ll.y) / leftHeight;
  const rightY = (ri.y - rl.y) / rightHeight;

  return {
    rawX: (leftX + rightX) / 2,
    rawY: (leftY + rightY) / 2,
    faceX: (lc.x + rc.x) / 2,
    faceY: (lc.y + rc.y) / 2,
    openness: (leftHeight / leftWidth + rightHeight / rightWidth) / 2,
  };
}

function fitLinearMap(samples) {
  if (samples.length < 2) return null;

  const xs = samples.map((s) => s.input);
  const ys = samples.map((s) => s.output);
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length;

  let num = 0;
  let den = 0;

  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }

  const m = den === 0 ? 1 : num / den;
  const b = yMean - m * xMean;
  return { m, b };
}

function applyLinearMap(v, map, fallback = 0.5) {
  if (!map) return fallback;
  return map.m * v + map.b;
}

export default function App() {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const textBoxRef = useRef(null);
  const rafRef = useRef(0);
  const streamRef = useRef(null);
  const faceLandmarkerRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [error, setError] = useState('');
  const [passage, setPassage] = useState(DEFAULT_PASSAGE);
  const [session, setSession] = useState([]);
  const [livePoint, setLivePoint] = useState(null);
  const [playhead, setPlayhead] = useState(0);
  const [calibrationStep, setCalibrationStep] = useState(0);
  const [calibrationSamples, setCalibrationSamples] = useState([]);
  const [maps, setMaps] = useState(null);
  const [status, setStatus] = useState('Load camera and calibrate.');
  const [faceDetected, setFaceDetected] = useState(false);
  const lines = useMemo(() => splitIntoLines(passage), [passage]);
  const replayPoint = session[Math.min(playhead, Math.max(session.length - 1, 0))] || null;
  const point = replaying ? replayPoint : livePoint;
  const canRecord = calibrationStep >= CALIBRATION_POINTS.length && tracking;

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
          },
          outputFaceBlendshapes: false,
          runningMode: 'VIDEO',
          numFaces: 1,
        });

        if (!cancelled) {
          faceLandmarkerRef.current = landmarker;
          setReady(true);
        }
      } catch (e) {
        setError('Could not load eye tracking model. Refresh and try again.');
      }
    }

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!replaying || session.length === 0) return;

    const id = setInterval(() => {
      setPlayhead((p) => {
        const next = p + 1;
        if (next >= session.length) {
          setReplaying(false);
          return session.length - 1;
        }
        return next;
      });
    }, 50);

    return () => clearInterval(id);
  }, [replaying, session.length]);

  async function startCamera() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraOn(true);
      setStatus('Camera ready. Start tracking.');
    } catch (e) {
      setError('Camera permission was denied or unavailable.');
    }
  }

  function stopCamera() {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = null;
    setCameraOn(false);
    setTracking(false);
    setRecording(false);
    setStatus('Camera stopped.');
  }

  function clearOverlay() {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawCalibrationOverlay() {
    const canvas = overlayRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pt = CALIBRATION_POINTS[calibrationStep];
    if (!pt) return;

    const x = pt.x * canvas.width;
    const y = pt.y * canvas.height;

    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(124,58,237,0.92)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'white';
    ctx.stroke();
    ctx.font = '16px sans-serif';
    ctx.fillStyle = 'white';
    ctx.fillText(`Look here: ${pt.label}`, x + 24, y + 6);
  }

  function startTracking() {
    if (!videoRef.current || !faceLandmarkerRef.current) return;

    setTracking(true);
    setStatus(
      calibrationStep < CALIBRATION_POINTS.length
        ? 'Tracking on. Finish calibration.'
        : 'Tracking on.'
    );

    let lastTime = -1;
    let smoothX = 0.5;
    let smoothY = 0.5;

    const loop = () => {
      const video = videoRef.current;
      const landmarker = faceLandmarkerRef.current;

      if (!video || !landmarker || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const now = performance.now();

      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;

        const result = landmarker.detectForVideo(video, now);
        const face = result?.faceLandmarks?.[0];
        setFaceDetected(!!face);
        if (face) {
          const features = getEyeFeatures(face);

          if (features) {
            const rawEstimateX = clamp(features.rawX + features.faceX * 0.15, 0, 1);
const rawEstimateY = clamp(features.rawY + features.faceY * 0.15, 0, 1);

const mappedX = clamp(features.rawX + features.faceX * 0.15, 0, 1);
const mappedY = clamp(features.rawY + features.faceY * 0.15, 0, 1);

            smoothX = lerp(smoothX, mappedX, 0.22);
            smoothY = lerp(smoothY, mappedY, 0.22);

            const textRect = textBoxRef.current?.getBoundingClientRect();
            const xPx = textRect ? smoothX * textRect.width : 0;
            const yPx = textRect ? smoothY * textRect.height : 0;
            const lineHeight = textRect ? textRect.height / Math.max(lines.length, 1) : 1;
            const lineIndex = clamp(
              Math.floor(yPx / lineHeight),
              0,
              Math.max(lines.length - 1, 0)
            );

            const nextPoint = {
              t: now,
              x: smoothX,
              y: smoothY,
              xPx,
              yPx,
              lineIndex,
              blinkish: features.openness < 0.09,
            };

            setLivePoint(nextPoint);

            if (recording && !nextPoint.blinkish) {
              setSession((prev) => [...prev, nextPoint]);
            }

            if (calibrationStep < CALIBRATION_POINTS.length) {
              drawCalibrationOverlay();
            } else {
              clearOverlay();
            }
          }
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }

  function stopTracking() {
    cancelAnimationFrame(rafRef.current);
    setTracking(false);
    setRecording(false);
    clearOverlay();
    setStatus('Tracking paused.');
  }

  function handleCalibrationCapture() {
    if (!livePoint || calibrationStep >= CALIBRATION_POINTS.length) return;

    const target = CALIBRATION_POINTS[calibrationStep];
    const newSample = {
      targetX: target.x,
      targetY: target.y,
      inputX: livePoint.x,
      inputY: livePoint.y,
    };

    const nextSamples = [...calibrationSamples, newSample];
    setCalibrationSamples(nextSamples);

    const next = calibrationStep + 1;
    setCalibrationStep(next);

    if (next >= CALIBRATION_POINTS.length) {
      const xMap = fitLinearMap(nextSamples.map((s) => ({ input: s.inputX, output: s.targetX })));
      const yMap = fitLinearMap(nextSamples.map((s) => ({ input: s.inputY, output: s.targetY })));

      setMaps({ x: xMap, y: yMap });
      setStatus('Calibration complete. You can record.');
      clearOverlay();
    } else {
      setStatus(`Saved calibration point ${next} of ${CALIBRATION_POINTS.length}.`);
    }
  }

  function resetCalibration() {
    setCalibrationStep(0);
    setCalibrationSamples([]);
    setMaps(null);
    setStatus('Calibration reset.');
  }

  function startRecording() {
    setSession([]);
    setRecording(true);
    setReplaying(false);
    setPlayhead(0);
    setStatus('Recording...');
  }

  function stopRecording() {
    setRecording(false);
    setStatus(`Recording stopped. Captured ${session.length} gaze points.`);
  }

  function exportSession() {
    const payload = {
      createdAt: new Date().toISOString(),
      passage,
      session,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'reading-eye-tracking-session.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importSession(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (data.passage) setPassage(data.passage);
        setSession(Array.isArray(data.session) ? data.session : []);
        setPlayhead(0);
        setReplaying(false);
        setStatus('Session imported.');
      } catch (e) {
        setError('That file could not be imported.');
      }
    };

    reader.readAsText(file);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: 20, fontFamily: 'Arial, sans-serif' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ marginBottom: 12 }}>Reading Eye Tracking</h1>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <button onClick={cameraOn ? stopCamera : startCamera}>
            {cameraOn ? 'Stop Camera' : 'Start Camera'}
          </button>
          <button onClick={tracking ? stopTracking : startTracking} disabled={!cameraOn || !ready}>
            {tracking ? 'Pause Tracking' : 'Start Tracking'}
          </button>
          <button
            onClick={handleCalibrationCapture}
            disabled={!tracking || calibrationStep >= CALIBRATION_POINTS.length || !livePoint}
          >
            Save Calibration Point {Math.min(calibrationStep + 1, CALIBRATION_POINTS.length)}
          </button>
          <button onClick={resetCalibration}>Reset Calibration</button>
          <button onClick={recording ? stopRecording : startRecording} disabled={!canRecord}>
            {recording ? 'Stop Recording' : 'Start Recording'}
          </button>
          <button onClick={() => setReplaying((v) => !v)} disabled={session.length === 0}>
            {replaying ? 'Pause Replay' : 'Replay Session'}
          </button>
          <button onClick={exportSession} disabled={session.length === 0}>
            Export Session
          </button>
          <label style={{ border: '1px solid #ccc', padding: '6px 10px', borderRadius: 6, cursor: 'pointer' }}>
            Import Session
            <input type="file" accept="application/json" style={{ display: 'none' }} onChange={importSession} />
          </label>
        </div>

       <div style={{ background: '#f5f3ff', padding: 12, borderRadius: 12, marginBottom: 16, color: '#6b7280' }}>
  <div>Status: {status}</div>
  <div>Tracking: {tracking ? 'ON' : 'OFF'}</div>
  <div>Face Detected: {faceDetected ? 'YES' : 'NO'}</div>
  <div>Live Point: {livePoint ? `${livePoint.x.toFixed(2)}, ${livePoint.y.toFixed(2)}` : 'NONE'}</div>
</div>

        {error ? (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 12, marginBottom: 16 }}>
            {error}
          </div>
        ) : null}

        <div style={{ background: 'white', borderRadius: 16, padding: 16, marginBottom: 18, boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
            Reading Passage
          </label>
          <textarea
            value={passage}
            onChange={(e) => setPassage(e.target.value)}
            rows={5}
            style={{
              width: '100%',
              borderRadius: 12,
              border: '1px solid #d1d5db',
              padding: 12,
              fontSize: 16,
            }}
          />
        </div>

        <div style={{ background: 'white', borderRadius: 16, padding: 16, marginBottom: 18, boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
          <div style={{ position: 'relative', maxWidth: 640, margin: '0 auto' }}>
            <video
              ref={videoRef}
              playsInline
              muted
              style={{
                width: '100%',
                borderRadius: 16,
                background: 'black',
                display: 'block',
              }}
            />
            <canvas
              ref={overlayRef}
              width={1280}
              height={720}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                borderRadius: 16,
              }}
            />
          </div>
        </div>

        <div style={{ background: '#ffffff', borderRadius: 20, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
          <div style={{ marginBottom: 14, fontWeight: 600, fontSize: 18, textAlign: 'center' }}>
            Child Reading View
          </div>

          <div
            ref={textBoxRef}
            style={{
              position: 'relative',
              minHeight: 520,
              maxWidth: 900,
              margin: '0 auto',
              background: '#fef3c7',
              borderRadius: 20,
              padding: 30,
              fontFamily: 'Georgia, serif',
              fontSize: 34,
              lineHeight: '52px',
            }}
          >
            {lines.map((line, idx) => {
              const active = point?.lineIndex === idx;

              return (
                <div
                  key={idx}
                  style={{
                    borderRadius: 12,
                    background: active ? 'rgba(191,219,254,0.7)' : 'transparent',
                    padding: '2px 6px',
                  }}
                >
                  {line}
                </div>
              );
            })}

            {point ? (
              <div
                style={{
                  position: 'absolute',
                  left: `${point.x * 100}%`,
                  top: `${point.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 20,
                  height: 20,
                  borderRadius: '999px',
                  background: '#3b82f6',
                  border: '2px solid white',
                  boxShadow: '0 4px 10px rgba(0,0,0,0.2)',
                  pointerEvents: 'none',
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
