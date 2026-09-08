import { useMemo, useState, type ReactNode } from "react";
import { Prism, defaultPolicies, TOKEN_PATTERN, type Match } from "../../src/index";

const SAMPLE = `Subject: Project estimate follow-up

Hi Team,

I'm Priya Sharma from Chennai. Reach me at priya.sharma@example.com or +91 98765 43210.
PAN: ABCDE1234F · Aadhaar: 2345 6789 0123
Card on file: 4111 1111 1111 1111
Deploy key: sk-abcdefghijklmnopqrstuvwxyz123456`;

const AI_LINES: Record<string, (tok: string) => string> = {
  email: (t) => `I've logged your contact ${t} for follow-up.`,
  phone_in: (t) => `SMS updates will go to ${t}.`,
  aadhaar: (t) => `Verification via ${t} is accepted.`,
  pan: (t) => `PAN ${t} is linked to your account.`,
  card: (t) => `We'll charge ${t} after approval — no copy stored.`,
  api_key: (t) => `Your key ${t} is encrypted and never logged.`,
  bearer: (t) => `Session ${t} confirmed.`,
  url_secret: (t) => `Secret query param ${t} ignored for safety.`,
  ipv4: (t) => `Request origin ${t} noted.`,
};

function buildAIReply(report: Match[]): string {
  if (report.length === 0) {
    return "No sensitive data detected — your prompt went through as-is. Nothing was redacted.";
  }
  const parts = report.map((m) => {
    const line = AI_LINES[m.policy];
    return line ? line(m.token) : `Received ${m.token} — handled securely.`;
  });
  return `Received. Here's what I captured:\n\n${parts.join("\n")}\n\n— PrismBot (simulated AI)`;
}

function Logo() {
  return (
    <span className="logo" aria-hidden>
      <svg viewBox="0 0 48 48" fill="none">
        <defs>
          <linearGradient id="pg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2dd4a7" />
            <stop offset="1" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        <path d="M24 4 44 40H4L24 4Z" stroke="url(#pg)" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M24 18 32.5 34H15.5L24 18Z" fill="url(#pg)" opacity="0.85" />
        <line x1="24" y1="4" x2="24" y2="18" stroke="url(#pg)" strokeWidth="1.6" strokeDasharray="2 3" />
      </svg>
    </span>
  );
}

export default function App() {
  const [text, setText] = useState(SAMPLE);
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(defaultPolicies.map((p) => p.id))
  );
  const [phase, setPhase] = useState<"idle" | "thinking" | "done">("idle");
  const [rawResponse, setRawResponse] = useState("");
  const [restoreOn, setRestoreOn] = useState(true);
  const [lastReport, setLastReport] = useState<Match[]>([]);
  const [showVault, setShowVault] = useState(false);

  const activePolicies = useMemo(
    () => defaultPolicies.filter((p) => enabled.has(p.id)),
    [enabled]
  );
  const prism = useMemo(() => new Prism({ policies: activePolicies }), [activePolicies]);

  const protectedResult = useMemo(() => prism.protect(text), [text, prism]);

  const togglePolicy = (id: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPhase("idle");
  };

  const handleSend = () => {
    setPhase("thinking");
    setTimeout(() => {
      const result = prism.protect(text);
      setLastReport(result.report);
      setRawResponse(buildAIReply(result.report));
      setRestoreOn(true);
      setPhase("done");
    }, 900);
  };

  const displayedResponse = restoreOn ? prism.restore(rawResponse) : rawResponse;
  const renderText = (s: string) => {
    const parts = s.split(TOKEN_PATTERN);
    const tokens = s.match(TOKEN_PATTERN) ?? [];
    const out: ReactNode[] = [];
    parts.forEach((part, i) => {
      if (part) out.push(part);
      if (i < tokens.length) {
        out.push(
          <code key={`t${i}`} className="tok" title={restoreOn ? undefined : "placeholder"}>
            {tokens[i]}
          </code>
        );
      }
    });
    return out;
  };

  const byPolicy = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of lastReport) map.set(m.policy, (map.get(m.policy) ?? 0) + 1);
    return map;
  }, [lastReport]);

  return (
    <div className="app">
      <header className="topbar">
        <Logo />
        <div>
          <h1>
            PRISM <span className="sdk">SDK</span>
          </h1>
          <p className="tagline">
            <b>AI Privacy Layer.</b> What the model sees is what you allow.
          </p>
        </div>
        <span className="badge">v0.1.0 · zero-dep core</span>
      </header>

      <div className="grid">
        {/* ---------- input side ---------- */}
        <section className="panel">
          <div className="panel-head">
            <span>
              <span className="dot live" />
              Incoming data
            </span>
            <span>client-side · never sent</span>
          </div>
          <div className="panel-body">
            <textarea
              rows={9}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setPhase("idle");
              }}
              placeholder="Paste anything with emails, phones, cards, keys…"
            />
            <div className="row">
              <button className="btn" onClick={() => { setText(SAMPLE); setPhase("idle"); }}>
                ↺ Load sample
              </button>
              <button className="btn" onClick={() => { setText(""); setPhase("idle"); }}>
                ✕ Clear
              </button>
            </div>

            <div className="chips">
              {defaultPolicies.map((p) => (
                <button
                  key={p.id}
                  className={`chip ${enabled.has(p.id) ? "on" : ""}`}
                  onClick={() => togglePolicy(p.id)}
                  title={p.label}
                >
                  {enabled.has(p.id) ? "✓ " : "○ "}
                  {p.id}
                </button>
              ))}
            </div>
            <p className="note">toggling policies re-creates the engine and resets the vault</p>

            <div className="preview">
              <p className="preview-label">
                what the AI would receive ·{" "}
                <span className="count">
                  {protectedResult.count} secret{protectedResult.count === 1 ? "" : "s"} redacted
                </span>
              </p>
              <p className="preview-text">
                {protectedResult.count > 0
                  ? renderText(protectedResult.text)
                  : "— nothing to redact —"}
              </p>
            </div>
          </div>
        </section>

        {/* ---------- AI side ---------- */}
        <section className="panel console">
          <div className="panel-head">
            <span>
              <span className={`dot ${phase === "done" ? "live" : "idle"}`} />
              PrismBot console
            </span>
            <span>simulated AI</span>
          </div>
          <div className="panel-body">
            <div className="send-area">
              <button
                className="btn primary"
                onClick={handleSend}
                disabled={phase === "thinking" || text.trim() === ""}
              >
                {phase === "thinking" ? "… routing protected prompt" : "Send to AI →"}
              </button>
            </div>

            {phase === "thinking" && <p className="thinking">compiling protected prompt… (AI only sees placeholders)</p>}

            {phase === "done" && (
              <div className="response-box">
                <div className="head">
                  <span className="preview-label" style={{ margin: 0 }}>
                    AI response
                  </span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={restoreOn}
                      onChange={(e) => setRestoreOn(e.target.checked)}
                    />
                    <span className="track" />
                    restore secrets
                  </label>
                </div>
                <p className="ai-text">{renderText(displayedResponse)}</p>

                <div className="secrets">
                  <p className="s-title">what the AI never saw ({lastReport.length})</p>
                  <ul>
                    {lastReport.map((m, i) => (
                      <li key={i}>
                        <span className="label">{m.label}</span>
                        <span>{m.value}</span>
                        <span style={{ marginLeft: "auto", color: "var(--faint)", fontSize: 10 }}>
                          {m.display}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {byPolicy.size > 0 && (
                  <div className="report-list">
                    {[...byPolicy.entries()].map(([id, n]) => (
                      <span key={id} className="report-item">
                        <span className="n">{n}×</span> {id}
                      </span>
                    ))}
                  </div>
                )}

                <div className="row" style={{ marginTop: 14 }}>
                  <button className="btn" onClick={() => setShowVault((v) => !v)}>
                    {showVault ? "Hide vault" : "Inspect vault"}
                  </button>
                  <button className="btn" onClick={() => { prism.purge(); setPhase("idle"); }}>
                    Clear vault
                  </button>
                </div>

                {showVault && (
                  <table className="vault-table">
                    <thead>
                      <tr>
                        <th>placeholder</th>
                        <th>original</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lastReport.length === 0 ? (
                        <tr>
                          <td colSpan={2} className="empty">
                            vault is empty
                          </td>
                        </tr>
                      ) : (
                        lastReport.map((m, i) => (
                          <tr key={i}>
                            <td className="tok" style={{ border: "none", background: "none", padding: "7px 10px" }}>
                              {m.token}
                            </td>
                            <td className="secret">{m.value}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {phase === "idle" && (
              <p className="empty">
                Type something with personal data on the left, then hit “Send to AI”.
                Watch the model receive placeholders — and nothing else.
              </p>
            )}
          </div>
        </section>
      </div>

      <div className="pipeline">
        <span className="step">input</span>
        <span className="arrow">→</span>
        <span className="step protected">protect ({protectedResult.count} redacted)</span>
        <span className="arrow">→</span>
        <span className="step">vault</span>
        <span className="arrow">→</span>
        <span className="step">AI sees placeholders only</span>
        <span className="arrow">→</span>
        <span className="step clean">restore response</span>
      </div>

      <p className="foot">
        prism-sdk · zero dependencies · swap the simulated transport for your own LLM call
      </p>
    </div>
  );
}