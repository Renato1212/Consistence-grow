"use client";

/**
 * Last-resort boundary (the root layout itself failed). Plain markup and
 * inline styles only: the app's CSS and providers may be what broke.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          background: "#0b0b0c",
          color: "#f4f4f5",
          fontFamily: "system-ui, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          margin: 0,
        }}
      >
        <div role="alert" style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Something failed to load
          </h1>
          <p style={{ color: "#a1a1aa", fontSize: 14 }}>
            Nothing you saved is lost. Check your connection and retry.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#f28c28",
              color: "#0b0b0c",
              border: 0,
              borderRadius: 6,
              padding: "8px 16px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      </body>
    </html>
  );
}
