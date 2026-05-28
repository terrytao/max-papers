// maxpaper homepage. Server component — the search box is a plain
// HTML <form action="/search" method="GET"> that GETs to /search?q=…
// The /search route doesn't exist yet; submitting will 404 until the
// search backend is built. Honest signal that's the next thing.

export default function Home() {
  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "0 20px" }}>
      <nav
        style={{
          borderBottom: "0.5px solid #e8e0c8",
          padding: "12px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 0,
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: "#111",
            letterSpacing: "-.01em",
          }}
        >
          maxpaper
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          <a
            href="/browse"
            style={{ fontSize: 12, color: "#888", textDecoration: "none" }}
          >
            Browse
          </a>
          <a
            href="/researchers"
            style={{ fontSize: 12, color: "#888", textDecoration: "none" }}
          >
            Researchers
          </a>
          <a
            href="/developer"
            style={{ fontSize: 12, color: "#888", textDecoration: "none" }}
          >
            Developer
          </a>
        </div>
      </nav>

      <div
        style={{
          padding: "48px 0 32px",
          textAlign: "center",
          borderBottom: "0.5px solid #e8e0c8",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: "#c8a84b",
            marginBottom: 12,
          }}
        >
          50 million+ research papers
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 500,
            color: "#111",
            letterSpacing: "-.03em",
            marginBottom: 8,
            lineHeight: 1.2,
          }}
        >
          Ask science anything.
          <br />
          Get a real answer.
        </h1>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>
          Search in plain English. Free.
        </p>
        <SearchBox />
      </div>
    </main>
  );
}

function SearchBox() {
  return (
    <form
      action="/search"
      method="GET"
      style={{
        display: "flex",
        maxWidth: 480,
        margin: "0 auto",
        border: "0.5px solid #e8e0c8",
      }}
    >
      <input
        type="text"
        name="q"
        autoComplete="off"
        placeholder="e.g. tactile sensing for humanoid robots"
        style={{
          flex: 1,
          padding: "12px 14px",
          fontSize: 13,
          border: "none",
          outline: "none",
          background: "#fff",
        }}
      />
      <button
        type="submit"
        style={{
          padding: "12px 22px",
          background: "#111",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: ".02em",
        }}
      >
        Search
      </button>
    </form>
  );
}
