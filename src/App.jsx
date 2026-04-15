import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Eye, Play, Pause, RotateCcw, Download, Upload, AlertCircle, FileDown, Save, TrendingUp } from 'lucide-react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const BRAND = {
  primary: '#7C3AED',
  primaryDark: '#5B21B6',
  soft: '#F5F3FF',
  ink: '#1F2937',
  muted: '#6B7280',
};

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

  if (leftIris.length < 5 || rightIris.length < 5 || leftEyeCorners.length < 2 || rightEyeCorners.length < 2) {
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

function computeSessionMetrics(sourceSession) {
  const s = sourceSession || [];
  const regressions = s.length > 1 ? s.slice(1).filter((p, i) => p.x < s[i].x - 0.08).length : 0;
  const lineSkips = s.length > 1 ? s.slice(1).filter((p, i) => Math.abs(p.lineIndex - s[i].lineIndex) > 1).length : 0;
  const yTravel = s.length > 1 ? s.slice(1).reduce((acc, p, i) => acc + Math.abs(p.y - s[i].y), 0) / s.length : 0;
  const steadiness = s.length > 1 ? Math.max(0, 100 - Math.round(yTravel * 500)) : 0;
  return { regressions, lineSkips, steadiness, totalPoints: s.length };
}

function metricDeltaLabel(before, after, lowerIsBetter = true, suffix = '') {
  const delta = after - before;
  if (delta === 0) return `No change${suffix}`;
  if (lowerIsBetter) return delta < 0 ? `Improved ${Math.abs(delta)}${suffix}` : `Increased ${Math.abs(delta)}${suffix}`;
  return delta > 0 ? `Improved ${Math.abs(delta)}${suffix}` : `Decreased ${Math.abs(delta)}${suffix}`;
}

function Badge({ children }) {
  return <span className="badge">{children}</span>;
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
  const [status, setStatus] = useState('Load webcam and calibrate.');
  const [lineStats, setLineStats] = useState([]);
  const [studentName, setStudentName] = useState('');
  const [trainerName, setTrainerName] = useState('');
  const [parentSummary, setParentSummary] = useState('During this reading sample, the replay suggests that the student may be working hard to keep their place on the page. This can help explain why reading may feel effortful. The goal is to strengthen the underlying skills that support smoother, more efficient reading.');
  const [trainerObservations, setTrainerObservations] = useState('');
  const [nextSteps, setNextSteps] = useState('We will focus on strengthening the core cognitive and visual tracking skills that support smoother, more efficient reading.');
  const [baselineSession, setBaselineSession] = useState(null);
  const [followupSession, setFollowupSession] = useState(null);

  const lines = useMemo(() => splitIntoLines(passage), [passage]);
  const replayPoint = session[Math.min(playhead, Math.max(session.length - 1, 0))] || null;
  const currentMetrics = useMemo(() => computeSessionMetrics(session), [session]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm');
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
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
        setError('Could not load eye tracking model. Try refreshing the page.');
      }
    }
    init();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
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

  useEffect(() => {
    if (!textBoxRef.current || session.length === 0) return;
    const counts = Array.from({ length: lines.length }, () => 0);
    for (const point of session) {
      if (typeof point.lineIndex === 'number' && point.lineIndex >= 0 && point.lineIndex < counts.length) {
        counts[point.lineIndex] += 1;
      }
    }
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    setLineStats(counts.map((c, i) => ({ line: i + 1, pct: Math.round((c / total) * 100) })));
  }, [session, lines.length]);

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
      setStatus('Camera ready. Click Start Tracking.');
    } catch (e) {
      setError('Camera permission was denied or unavailable.');
    }
  }

  function stopCamera() {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
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

  function drawLiveOverlay(point) {
    const canvas = overlayRef.current;
    if (!canvas || !textBoxRef.current) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const rect = textBoxRef.current.getBoundingClientRect();
    const parent = canvas.getBoundingClientRect();
    const x = rect.left - parent.left + point.x * rect.width;
    const y = rect.top - parent.top + point.y * rect.height;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(124,58,237,0.85)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke();
  }

  function startTracking() {
    if (!videoRef.current || !faceLandmarkerRef.current) return;
    setTracking(true);
    setStatus(calibrationStep < CALIBRATION_POINTS.length ? 'Tracking on. Finish calibration.' : 'Tracking on.');
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
        if (face) {
          const features = getEyeFeatures(face);
          if (features) {
            const mappedX = clamp(applyLinearMap(features.rawX + features.faceX * 0.15, maps?.x, 0.5), 0, 1);
            const mappedY = clamp(applyLinearMap(features.rawY + features.faceY * 0.15, maps?.y, 0.5), 0, 1);
            smoothX = lerp(smoothX, mappedX, 0.22);
            smoothY = lerp(smoothY, mappedY, 0.22);
            const textRect = textBoxRef.current?.getBoundingClientRect();
            const xPx = textRect ? smoothX * textRect.width : 0;
            const yPx = textRect ? smoothY * textRect.height : 0;
            const lineHeight = textRect ? textRect.height / Math.max(lines.length, 1) : 1;
            const lineIndex = clamp(Math.floor(yPx / lineHeight), 0, Math.max(lines.length - 1, 0));
            const point = { t: now, x: smoothX, y: smoothY, xPx, yPx, lineIndex, blinkish: features.openness < 0.09 };
            setLivePoint(point);
            if (recording && !point.blinkish) setSession((prev) => [...prev, point]);
            if (calibrationStep < CALIBRATION_POINTS.length) drawCalibrationOverlay();
            else drawLiveOverlay(point);
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
    setCalibrationSamples((prev) => [...prev, { targetX: target.x, targetY: target.y, inputX: livePoint.x, inputY: livePoint.y }]);
    const next = calibrationStep + 1;
    setCalibrationStep(next);
    if (next >= CALIBRATION_POINTS.length) {
      const samples = [...calibrationSamples, { targetX: target.x, targetY: target.y, inputX: livePoint.x, inputY: livePoint.y }];
      const xMap = fitLinearMap(samples.map((s) => ({ input: s.inputX, output: s.targetX })));
      const yMap = fitLinearMap(samples.map((s) => ({ input: s.inputY, output: s.targetY })));
      setMaps({ x: xMap, y: yMap });
      setStatus('Calibration complete. You can start recording.');
      clearOverlay();
    } else {
      setStatus(`Saved calibration point ${next} of ${CALIBRATION_POINTS.length}.`);
    }
  }

  function resetCalibration() {
    setCalibrationStep(0);
    setCalibrationSamples([]);
    setMaps(null);
    setStatus('Calibration reset. Start again.');
  }

  function startRecording() {
    setSession([]);
    setRecording(true);
    setReplaying(false);
    setPlayhead(0);
    setStatus('Recording reading session...');
  }

  function stopRecording() {
    setRecording(false);
    setStatus(`Recording stopped. Captured ${session.length} gaze points.`);
  }

  function resetSession() {
    setSession([]);
    setPlayhead(0);
    setReplaying(false);
    setLineStats([]);
    setStatus('Session cleared.');
  }

  function exportSession() {
    const payload = { createdAt: new Date().toISOString(), passage, session, lineStats, studentName, trainerName, parentSummary, trainerObservations, nextSteps };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
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
        if (data.studentName) setStudentName(data.studentName);
        if (data.trainerName) setTrainerName(data.trainerName);
        if (data.parentSummary) setParentSummary(data.parentSummary);
        if (data.trainerObservations) setTrainerObservations(data.trainerObservations);
        if (data.nextSteps) setNextSteps(data.nextSteps);
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

  function saveAsBaseline() {
    if (!session.length) return;
    setBaselineSession({ createdAt: new Date().toLocaleDateString(), metrics: computeSessionMetrics(session) });
    setStatus('Current session saved as BEFORE baseline.');
  }

  function saveAsFollowup() {
    if (!session.length) return;
    setFollowupSession({ createdAt: new Date().toLocaleDateString(), metrics: computeSessionMetrics(session) });
    setStatus('Current session saved as AFTER follow-up.');
  }

  function exportParentReportPdf() {
    const metrics = computeSessionMetrics(session);
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const dateStr = new Date().toLocaleDateString();
    doc.setFillColor(124, 58, 237);
    doc.rect(0, 0, 612, 58, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text('Parent Replay Report', 40, 36);
    doc.setTextColor(31, 41, 55);
    doc.setFontSize(11);
    doc.text(`Student: ${studentName || '________________'}`, 40, 86);
    doc.text(`Trainer: ${trainerName || '________________'}`, 235, 86);
    doc.text(`Date: ${dateStr}`, 465, 86);
    autoTable(doc, {
      startY: 100,
      theme: 'grid',
      head: [['Metric', 'Observation']],
      body: [
        ['Estimated Regressions', String(metrics.regressions)],
        ['Estimated Line Skips', String(metrics.lineSkips)],
        ['Tracking Steadiness', `${metrics.steadiness}%`],
        ['Total Gaze Points', String(metrics.totalPoints)],
      ],
      headStyles: { fillColor: [124, 58, 237] },
      bodyStyles: { textColor: [31, 41, 55] },
      styles: { fontSize: 10 },
      margin: { left: 40, right: 40 },
    });
    let y = doc.lastAutoTable.finalY + 24;
    doc.setFontSize(13);
    doc.setTextColor(91, 33, 182);
    doc.text('Parent-Friendly Summary', 40, y);
    y += 10;
    doc.setDrawColor(221, 214, 254);
    doc.setFillColor(245, 243, 255);
    doc.roundedRect(40, y, 532, 78, 10, 10, 'FD');
    doc.setTextColor(31, 41, 55);
    doc.setFontSize(10);
    doc.text(doc.splitTextToSize(parentSummary, 500), 56, y + 20);
    y += 102;
    doc.setFontSize(13);
    doc.setTextColor(91, 33, 182);
    doc.text('Trainer Observations', 40, y);
    y += 10;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(40, y, 532, 74, 10, 10, 'FD');
    doc.setTextColor(31, 41, 55);
    doc.setFontSize(10);
    doc.text(doc.splitTextToSize(trainerObservations || 'No additional notes entered.', 500), 56, y + 20);
    y += 98;
    doc.setFontSize(13);
    doc.setTextColor(91, 33, 182);
    doc.text('Next Steps', 40, y);
    y += 10;
    doc.setFillColor(245, 243, 255);
    doc.roundedRect(40, y, 532, 60, 10, 10, 'FD');
    doc.setTextColor(31, 41, 55);
    doc.setFontSize(10);
    doc.text(doc.splitTextToSize(nextSteps, 500), 56, y + 20);
    doc.save(`${(studentName || 'student').replace(/\s+/g, '_')}_parent_replay_report.pdf`);
  }

  function exportProgressPdf() {
    if (!baselineSession || !followupSession) return;
    const before = baselineSession.metrics;
    const after = followupSession.metrics;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    doc.setFillColor(124, 58, 237);
    doc.rect(0, 0, 612, 58, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text('Before / After Progress Report', 40, 36);
    doc.setTextColor(31, 41, 55);
    doc.setFontSize(11);
    doc.text(`Student: ${studentName || '________________'}`, 40, 86);
    doc.text(`Trainer: ${trainerName || '________________'}`, 235, 86);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 465, 86);
    autoTable(doc, {
      startY: 100,
      theme: 'grid',
      head: [['Measure', 'Before', 'After', 'Change']],
      body: [
        ['Estimated Regressions', String(before.regressions), String(after.regressions), metricDeltaLabel(before.regressions, after.regressions, true)],
        ['Estimated Line Skips', String(before.lineSkips), String(after.lineSkips), metricDeltaLabel(before.lineSkips, after.lineSkips, true)],
        ['Tracking Steadiness', `${before.steadiness}%`, `${after.steadiness}%`, metricDeltaLabel(before.steadiness, after.steadiness, false, '%')],
        ['Total Gaze Points', String(before.totalPoints), String(after.totalPoints), String(after.totalPoints - before.totalPoints)],
      ],
      headStyles: { fillColor: [124, 58, 237] },
      bodyStyles: { textColor: [31, 41, 55] },
      styles: { fontSize: 10 },
      margin: { left: 40, right: 40 },
    });
    let y = doc.lastAutoTable.finalY + 24;
    doc.setFontSize(13);
    doc.setTextColor(91, 33, 182);
    doc.text('Progress Summary', 40, y);
    y += 10;
    doc.setFillColor(245, 243, 255);
    doc.roundedRect(40, y, 532, 90, 10, 10, 'FD');
    doc.setTextColor(31, 41, 55);
    doc.setFontSize(10);
    const progressText = 'This comparison gives a visual snapshot of reading-related eye movement patterns over time. Lower regressions and line skips, along with improved steadiness, may suggest more efficient tracking and less effort while reading. Use this as a parent-friendly progress conversation tool rather than a diagnostic score.';
    doc.text(doc.splitTextToSize(progressText, 500), 56, y + 20);
    y += 116;
    doc.setFontSize(13);
    doc.setTextColor(91, 33, 182);
    doc.text('Saved Sessions', 40, y);
    y += 10;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(40, y, 532, 62, 10, 10, 'FD');
    doc.setTextColor(31, 41, 55);
    doc.setFontSize(10);
    doc.text(`Before saved: ${baselineSession.createdAt}`, 56, y + 22);
    doc.text(`After saved: ${followupSession.createdAt}`, 56, y + 42);
    doc.save(`${(studentName || 'student').replace(/\s+/g, '_')}_before_after_progress_report.pdf`);
  }

  const canRecord = calibrationStep >= CALIBRATION_POINTS.length && tracking;

  return (
    <div className="app-shell">
      <div className="layout">
        <div className="two-col">
          <section className="card">
            <div className="card-header soft">
              <div className="title-row"><Eye color={BRAND.primaryDark} /><div className="h2" style={{ color: BRAND.primaryDark }}>Reading Eye Tracking + Replay</div></div>
            </div>
            <div className="card-body">
              <div className="alert"><AlertCircle size={18} color={BRAND.primaryDark} /><div>Webcam-based prototype for showing approximate eye movement while a child reads. Best used on a laptop or desktop with a front camera. Works on some iPads with modern Safari, but accuracy varies.</div></div>
              <div style={{ height: 14 }} />
              <div className="grid-2">
                <div><label className="label">Student Name</label><input className="input" value={studentName} onChange={(e) => setStudentName(e.target.value)} /></div>
                <div><label className="label">Trainer Name</label><input className="input" value={trainerName} onChange={(e) => setTrainerName(e.target.value)} /></div>
              </div>
              <div style={{ height: 14 }} />
              <div className="row-wrap">
                <button className="btn" onClick={cameraOn ? stopCamera : startCamera}><Camera size={16} />{cameraOn ? 'Stop Camera' : 'Start Camera'}</button>
                <button className="btn secondary" onClick={tracking ? stopTracking : startTracking} disabled={!cameraOn || !ready}>{tracking ? <Pause size={16} /> : <Play size={16} />}{tracking ? 'Pause Tracking' : 'Start Tracking'}</button>
              </div>
              <div style={{ height: 10 }} />
              <div className="row-wrap">
                <button className="btn" onClick={handleCalibrationCapture} disabled={!tracking || calibrationStep >= CALIBRATION_POINTS.length || !livePoint}>Save Calibration Point {Math.min(calibrationStep + 1, CALIBRATION_POINTS.length)}</button>
                <button className="btn secondary" onClick={resetCalibration}><RotateCcw size={16} />Reset Calibration</button>
              </div>
              <div style={{ height: 10 }} />
              <div className="row-wrap">
                <button className="btn" onClick={recording ? stopRecording : startRecording} disabled={!canRecord}>{recording ? <Pause size={16} /> : <Play size={16} />}{recording ? 'Stop Recording' : 'Start Recording'}</button>
                <button className="btn secondary" onClick={resetSession}>Clear Session</button>
              </div>
              <div style={{ height: 10 }} />
              <div className="row-wrap">
                <button className="btn secondary" onClick={() => setReplaying((v) => !v)} disabled={session.length === 0}>{replaying ? <Pause size={16} /> : <Play size={16} />}{replaying ? 'Pause Replay' : 'Replay Session'}</button>
                <button className="btn secondary" onClick={exportSession} disabled={session.length === 0}><Download size={16} />Export Session</button>
                <label className="btn secondary file-label"><Upload size={16} />Import Session<input type="file" accept="application/json" onChange={importSession} /></label>
              </div>
              <div style={{ height: 14 }} />
              <div className="range-row"><label className="label" style={{ marginBottom: 0 }}>Replay Position</label><Badge>{session.length ? `${playhead + 1} / ${session.length}` : 'No session'}</Badge></div>
              <input className="slider" type="range" min="0" max={Math.max(session.length - 1, 0)} step="1" value={playhead} onChange={(e) => setPlayhead(Number(e.target.value))} disabled={session.length === 0} />
              <div style={{ height: 14 }} />
              <label className="label">Reading Passage</label>
              <textarea className="textarea" rows="8" value={passage} onChange={(e) => setPassage(e.target.value)} />
              <div style={{ height: 14 }} />
              <div className="status"><strong>Status</strong><span className="muted">{status}</span></div>
              {error && <div style={{ marginTop: 12, color: '#b91c1c', fontSize: 14 }}>{error}</div>}
            </div>
          </section>

          <section className="card">
            <div className="card-header soft"><div className="h2" style={{ color: BRAND.primaryDark }}>Live View + Parent Replay View</div></div>
            <div className="card-body">
              <div className="preview-grid">
                <div>
                  <div className="video-box"><video ref={videoRef} playsInline muted /><canvas ref={overlayRef} width={1280} height={720} /></div>
                  <div style={{ height: 10 }} />
                  <div className="badges"><Badge>Model: webcam estimate</Badge><Badge>Calibration: {Math.min(calibrationStep, CALIBRATION_POINTS.length)} / {CALIBRATION_POINTS.length}</Badge><Badge>Session points: {session.length}</Badge></div>
                  <div style={{ height: 10 }} />
                  <div className="help-box">During replay, use the purple dot on the reading passage to show where the child's eyes were likely focused. This is especially useful for showing line skipping, regressions, and losing place.</div>
                </div>

                <div>
                  <div className="reading-panel">
                    <div className="range-row"><div className="label" style={{ marginBottom: 0 }}>Reading Passage Overlay</div><Badge>{replaying ? 'Replay Active' : recording ? 'Recording' : 'Idle'}</Badge></div>
                    <div ref={textBoxRef} className="passage-wrap">
                      {lines.map((line, idx) => {
                        const point = replaying ? replayPoint : livePoint;
                        const active = point?.lineIndex === idx;
                        return <div key={idx} className={active ? 'active-line' : ''}>{line}</div>;
                      })}
                      {((replaying && replayPoint) || (!replaying && livePoint)) && (
                        <div className="dot" style={{ left: `${(replaying ? replayPoint : livePoint).x * 100}%`, top: `${(replaying ? replayPoint : livePoint).y * 100}%` }} />
                      )}
                    </div>
                  </div>

                  <div style={{ height: 16 }} />
                  <div className="small-grid">
                    <div className="white-card">
                      <div className="h3">Quick Parent Summary</div>
                      <p>Use this screen to point out whether the gaze dot stays on one line, jumps backward, skips down too early, or wanders off the text.</p>
                      <div className="help-box" style={{ background: BRAND.soft }}><strong>What to look for</strong><ul className="list"><li>Frequent backward jumps = possible regressions</li><li>Large vertical jumps = possible line skipping</li><li>Inconsistent path = may be losing place while reading</li><li>Very short fixations everywhere = scanning instead of tracking</li></ul></div>
                    </div>
                    <div className="white-card">
                      <div className="h3">Line Attention Snapshot</div>
                      {!lineStats.length ? <p className="muted">Record a session to generate line-level attention percentages.</p> : lineStats.map((item) => <div key={item.line} style={{ marginBottom: 10 }}><div className="progress-row"><span>Line {item.line}</span><span>{item.pct}%</span></div><div className="bar"><span style={{ width: `${item.pct}%` }} /></div></div>)}
                    </div>
                  </div>

                  <div style={{ height: 16 }} />
                  <div className="card report-card">
                    <div className="card-header"><div className="h2" style={{ color: BRAND.primaryDark }}>Parent Replay Report</div></div>
                    <div className="card-body split-report">
                      <div>
                        <div className="metrics-grid">
                          <div className="mini-card"><div className="stat-label">Estimated regressions</div><div className="stat-value">{currentMetrics.regressions}</div><div className="small-note">Backward jumps while reading</div></div>
                          <div className="mini-card"><div className="stat-label">Estimated line skips</div><div className="stat-value">{currentMetrics.lineSkips}</div><div className="small-note">Jumps across multiple lines</div></div>
                          <div className="mini-card"><div className="stat-label">Tracking steadiness</div><div className="stat-value">{currentMetrics.steadiness}%</div><div className="small-note">Higher usually looks more stable</div></div>
                        </div>
                        <div style={{ height: 14 }} />
                        <div className="white-card"><div className="h3">Trainer Talking Points</div><p>This replay gives us a visual of how the child’s eyes appear to move across the page during reading.</p><p>We are looking for patterns like jumping backward, skipping lines, losing place, or inconsistent left-to-right tracking.</p><p>This is a demonstration tool, not a diagnostic medical device, but it can be very helpful for showing what reading effort may look like in real time.</p></div>
                        <div style={{ height: 14 }} />
                        <div className="white-card"><div className="h3">Suggested Parent-Friendly Summary</div><textarea className="textarea" rows="5" value={parentSummary} onChange={(e) => setParentSummary(e.target.value)} /></div>
                      </div>
                      <div>
                        <div className="white-card"><div className="h3">Report Actions</div><div className="export-actions"><button className="btn" onClick={exportParentReportPdf} disabled={!session.length}><FileDown size={16} />Export Auto-Filled Parent PDF</button><button className="btn secondary" onClick={saveAsBaseline} disabled={!session.length}><Save size={16} />Save Current Session as Before</button><button className="btn secondary" onClick={saveAsFollowup} disabled={!session.length}><TrendingUp size={16} />Save Current Session as After</button><button className="btn" style={{ background: '#a78bfa', color: '#1f2937' }} onClick={exportProgressPdf} disabled={!baselineSession || !followupSession}><FileDown size={16} />Export Before / After PDF</button></div></div>
                        <div style={{ height: 14 }} />
                        <div className="white-card"><div className="h3">Session Details</div><div className="progress-row"><span>Total gaze points</span><span>{session.length}</span></div><div className="progress-row"><span>Replay status</span><span>{replaying ? 'Playing' : 'Paused'}</span></div><div className="progress-row"><span>Calibration</span><span>{calibrationStep >= CALIBRATION_POINTS.length ? 'Complete' : 'Not complete'}</span></div><div className="progress-row"><span>Passage lines</span><span>{lines.length}</span></div></div>
                        <div style={{ height: 14 }} />
                        <div className="white-card"><div className="h3">Trainer Observations</div><textarea className="textarea" rows="4" value={trainerObservations} onChange={(e) => setTrainerObservations(e.target.value)} placeholder="Add specific notes you want on the report..." /></div>
                        <div style={{ height: 14 }} />
                        <div className="white-card"><div className="h3">Next Step</div><textarea className="textarea" rows="4" value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} /></div>
                        <div style={{ height: 14 }} />
                        <div className="white-card"><div className="h3">Before / After Snapshot</div>{!baselineSession || !followupSession ? <p className="muted">Save one session as Before and one session as After to unlock the progress report.</p> : <><div className="progress-row"><span>Regressions</span><span>{baselineSession.metrics.regressions} → {followupSession.metrics.regressions}</span></div><div className="progress-row"><span>Line Skips</span><span>{baselineSession.metrics.lineSkips} → {followupSession.metrics.lineSkips}</span></div><div className="progress-row"><span>Tracking Steadiness</span><span>{baselineSession.metrics.steadiness}% → {followupSession.metrics.steadiness}%</span></div><div style={{ marginTop: 10, fontSize: 14, color: BRAND.muted }}>Summary: {metricDeltaLabel(baselineSession.metrics.regressions, followupSession.metrics.regressions, true)}, {metricDeltaLabel(baselineSession.metrics.lineSkips, followupSession.metrics.lineSkips, true)}, {metricDeltaLabel(baselineSession.metrics.steadiness, followupSession.metrics.steadiness, false, '%')}.</div></>}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
