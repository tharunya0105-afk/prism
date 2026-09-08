import { useEffect, useState } from "react";
import { defaultPolicies } from "@prism-sdk";
import type { Config, Message, Response, Stats } from "../types";

function send(msg: Message): Promise<Response> {
  return chrome.runtime.sendMessage(msg) as Promise<Response>;
}

function timeAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
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
        <path d="M24 4 44 40H4L24 4Z" stroke="url(#pg)" strokeWidth="3" strokeLinejoin="round" />
        <path d="M24 18 32.5 34H15.5L24 18Z" fill="url(#pg)" opacity="0.85" />
      </svg>
    </span>
  );
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [stats, setStats] = useState<Stats>({ protected: 0, recent: [] });

  useEffect(() => {
    void (async () => {
      const [c, s] = await Promise.all([
        send({ type: "getConfig" }),
        send({ type: "getStats" }),
      ]);
      if (c.ok && "config" in c) setConfig(c.config);
      if (s.ok && "stats" in s) setStats(s.stats);
    })();
  }, []);

  const toggleEnabled = (enabled: boolean) => {
    setConfig((prev) => (prev ? { ...prev, enabled } : prev));
    void send({ type: "setConfig", config: { enabled } });
  };

  const togglePolicy = (id: string) => {
    if (!config) return;
    const policyIds = config.policyIds.includes(id)
      ? config.policyIds.filter((p) => p !== id)
      : [...config.policyIds, id];
    setConfig({ ...config, policyIds });
    void send({ type: "setConfig", config: { policyIds } });
  };

  const purge = () => {
    void send({ type: "purge" }).then(() => setStats({ protected: 0, recent: [] }));
  };

  return (
    <div>
      <header className="head">
        <Logo />
        <h1>
          PRISM <span className="sdk">EXT</span>
        </h1>
        <span className="ver">v0.1.0</span>
      </header>

      <div className="switch-row">
        <span className="label">Protect AI chats</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={config?.enabled ?? true}
            onChange={(e) => toggleEnabled(e.target.checked)}
          />
          <span className="track" />
        </label>
      </div>

      <div className="stats">
        <div className="big">
          {stats.protected} <small>secrets protected this session</small>
        </div>
        {stats.recent.length > 0 ? (
          <div className="recent">
            {stats.recent.slice(0, 5).map((r, i) => (
              <span key={i} className="recent-item" title={r.label}>
                <span className="label">{r.label}</span>
                <span className="display">{r.display}</span>
                <span className="time">{timeAgo(r.at)}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="empty">no redactions yet — type in a supported chat app</p>
        )}
      </div>

      <div className="policies">
        <p className="title">Active policies</p>
        <div className="chips">
          {defaultPolicies.map((p) => (
            <button
              key={p.id}
              className={`chip ${config?.policyIds.includes(p.id) ? "on" : ""}`}
              onClick={() => togglePolicy(p.id)}
              title={p.label}
            >
              {p.id}
            </button>
          ))}
        </div>
      </div>

      <div className="foot">
        <button className="btn" onClick={purge}>
          Clear vault
        </button>
        <span className="note">chatgpt · claude · gemini · copilot · perplexity…</span>
      </div>
    </div>
  );
}