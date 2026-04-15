:root {
  --primary: #7c3aed;
  --primary-dark: #5b21b6;
  --soft: #f5f3ff;
  --soft-border: #ddd6fe;
  --ink: #1f2937;
  --muted: #6b7280;
  --bg: #f8fafc;
  --card: #ffffff;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--ink);
}
button, input, textarea { font: inherit; }
.app-shell { min-height: 100vh; padding: 16px; }
.layout {
  max-width: 1400px;
  margin: 0 auto;
  display: grid;
  gap: 24px;
}
.two-col {
  display: grid;
  gap: 24px;
  grid-template-columns: 390px 1fr;
}
.card {
  background: var(--card);
  border-radius: 24px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 6px 16px rgba(0,0,0,0.04);
  overflow: hidden;
}
.card-header {
  padding: 18px 22px;
  border-bottom: 1px solid #e5e7eb;
}
.card-header.soft { background: var(--soft); }
.card-body { padding: 22px; }
.title-row { display: flex; gap: 10px; align-items: center; }
.h1 { font-size: 24px; font-weight: 700; color: var(--primary-dark); }
.h2 { font-size: 20px; font-weight: 700; }
.h3 { font-size: 16px; font-weight: 700; }
.alert {
  background: var(--soft);
  border-radius: 18px;
  padding: 14px 16px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.row-wrap { display: flex; gap: 8px; flex-wrap: wrap; }
.btn {
  border: 1px solid transparent;
  border-radius: 18px;
  padding: 10px 14px;
  background: var(--primary);
  color: white;
  cursor: pointer;
  display: inline-flex;
  gap: 8px;
  align-items: center;
  font-weight: 600;
}
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn.secondary {
  background: white;
  color: var(--ink);
  border-color: #d1d5db;
}
.label { font-size: 14px; font-weight: 600; display: block; margin-bottom: 6px; }
.input, .textarea {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 18px;
  padding: 10px 12px;
  background: white;
}
.textarea { resize: vertical; min-height: 120px; }
.status {
  background: var(--soft);
  border-radius: 18px;
  padding: 14px;
  font-size: 14px;
}
.status strong { color: var(--primary-dark); display: block; margin-bottom: 4px; }
.preview-grid { display: grid; gap: 24px; grid-template-columns: 420px 1fr; }
.video-box {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 22px;
  overflow: hidden;
  background: #000;
}
.video-box video, .video-box canvas {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
}
.badges { display: flex; gap: 8px; flex-wrap: wrap; }
.badge {
  border: 1px solid #d1d5db;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--muted);
  background: white;
}
.reading-panel {
  border: 1px solid #e5e7eb;
  border-radius: 22px;
  padding: 20px;
  background: white;
}
.passage-wrap {
  position: relative;
  min-height: 420px;
  border-radius: 22px;
  background: #fff7ed;
  padding: 24px;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 28px;
  line-height: 2.1rem;
}
.active-line {
  background: #ede9fe;
  border-radius: 12px;
}
.dot {
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--primary);
  border: 2px solid white;
  box-shadow: 0 4px 12px rgba(0,0,0,0.18);
  transform: translate(-50%, -50%);
}
.report-card {
  border: 2px solid var(--soft-border);
  background: linear-gradient(135deg, white 0%, var(--soft) 100%);
}
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.mini-card, .white-card {
  border: 1px solid #e5e7eb;
  border-radius: 20px;
  background: white;
  padding: 16px;
}
.stat-label { color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.stat-value { font-size: 30px; font-weight: 700; margin-top: 8px; }
.small-note { font-size: 12px; color: #6b7280; margin-top: 4px; }
.split-report { display: grid; grid-template-columns: 1.2fr .8fr; gap: 16px; }
.small-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.progress-row { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; padding: 4px 0; }
.bar {
  height: 8px;
  background: #e5e7eb;
  border-radius: 999px;
  overflow: hidden;
}
.bar > span { display: block; height: 100%; background: var(--primary); }
.range-row { display: flex; justify-content: space-between; align-items: center; font-size: 14px; margin-bottom: 6px; }
.slider { width: 100%; }
.help-box { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 20px; padding: 14px; font-size: 14px; color: var(--muted); }
.muted { color: var(--muted); }
.file-label { position: relative; overflow: hidden; }
.file-label input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.export-actions { display: grid; gap: 8px; }
.list { margin: 8px 0 0 0; padding-left: 18px; }
.list li { margin-bottom: 6px; }
@media (max-width: 1100px) {
  .two-col, .preview-grid, .split-report { grid-template-columns: 1fr; }
}
@media (max-width: 800px) {
  .grid-2, .small-grid, .metrics-grid { grid-template-columns: 1fr; }
  .app-shell { padding: 12px; }
  .passage-wrap { font-size: 22px; line-height: 1.8rem; }
}
