import React, { useState } from "react";

const DEFAULT_PASSAGE = `The fox hurried through the forest at sunrise. It stopped near a fallen log and listened for the birds. A bright red leaf drifted past its nose. The fox jumped over a stream, trotted up a hill, and looked across the meadow.`;

export default function App() {
  const [text, setText] = useState(DEFAULT_PASSAGE);
  const lines = text.split(". ");

  return (
    <div style={{ padding: 20 }}>

      <h2 style={{ marginBottom: 10 }}>Reading Exercise</h2>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        style={{
          width: "100%",
          marginBottom: 20,
          padding: 10,
          fontSize: 16
        }}
      />

      {/* CENTERED READING VIEW */}
      <div
        style={{
          maxWidth: "800px",
          margin: "0 auto",
          background: "#fff7e6",
          padding: 30,
          borderRadius: 15,
          fontSize: 28,
          lineHeight: "42px",
          textAlign: "left"
        }}
      >
        {lines.map((line, i) => (
          <div key={i}>{line.trim()}.</div>
        ))}
      </div>

    </div>
  );
}
