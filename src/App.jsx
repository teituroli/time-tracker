import { useState, useEffect } from "react";

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const USE_SUPABASE = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

// ─── LOCAL STORAGE FALLBACK ───────────────────────────────────────────────────
const LS = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)) ?? []; } catch { return []; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  getVal: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setVal: (k, v) => localStorage.setItem(k, v),
};

// ─── SUPABASE MINI-CLIENT ─────────────────────────────────────────────────────
async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer ?? "return=representation",
    },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// ─── DATA LAYER ───────────────────────────────────────────────────────────────
const DB = {
  // Org password
  async getOrgPassword() {
    if (!USE_SUPABASE) return LS.getVal("tt_org_password");
    const rows = await sbFetch("settings?key=eq.org_password&select=value");
    return rows[0]?.value ?? null;
  },
  async setOrgPassword(password) {
    if (!USE_SUPABASE) { LS.setVal("tt_org_password", password); return; }
    await sbFetch("settings", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: JSON.stringify({ key: "org_password", value: password }),
    });
  },

  // Users — filter out soft-deleted
  async getUsers() {
    if (!USE_SUPABASE) return LS.get("tt_users").filter(u => !u.deleted_at);
    return sbFetch("users?select=*&deleted_at=is.null&order=name.asc");
  },
  async createUser(name) {
    const user = { id: crypto.randomUUID(), name, created_at: new Date().toISOString(), deleted_at: null };
    if (!USE_SUPABASE) { const u = LS.get("tt_users"); u.push(user); LS.set("tt_users", u); return user; }
    const res = await sbFetch("users", { method: "POST", body: JSON.stringify({ name }) });
    return res[0];
  },

  // Projects — filter out soft-deleted
  async getProjects() {
    if (!USE_SUPABASE) return LS.get("tt_projects").filter(p => !p.deleted_at);
    return sbFetch("projects?select=*,project_members(user_id)&deleted_at=is.null&order=name.asc");
  },
  async createProject(name, color, collaboratorIds) {
    if (!USE_SUPABASE) {
      const p = { id: crypto.randomUUID(), name, color, collaborator_ids: collaboratorIds, archived: false, deleted_at: null, created_at: new Date().toISOString() };
      const ps = LS.get("tt_projects"); ps.push(p); LS.set("tt_projects", ps); return p;
    }
    const [proj] = await sbFetch("projects", { method: "POST", body: JSON.stringify({ name, color, archived: false }) });
    if (collaboratorIds.length) {
      await sbFetch("project_members", { method: "POST", body: JSON.stringify(collaboratorIds.map(uid => ({ project_id: proj.id, user_id: uid }))) });
    }
    proj.collaborator_ids = collaboratorIds;
    return proj;
  },
  async archiveProject(id) {
    if (!USE_SUPABASE) {
      const ps = LS.get("tt_projects").map(p => p.id === id ? { ...p, archived: true } : p);
      LS.set("tt_projects", ps); return;
    }
    await sbFetch(`projects?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
  },
  async unarchiveProject(id) {
    if (!USE_SUPABASE) {
      const ps = LS.get("tt_projects").map(p => p.id === id ? { ...p, archived: false } : p);
      LS.set("tt_projects", ps); return;
    }
    await sbFetch(`projects?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ archived: false }) });
  },
  async updateCollaborators(projectId, collaboratorIds) {
    if (!USE_SUPABASE) {
      const ps = LS.get("tt_projects").map(p => p.id === projectId ? { ...p, collaborator_ids: collaboratorIds } : p);
      LS.set("tt_projects", ps); return;
    }
    await sbFetch(`project_members?project_id=eq.${projectId}`, { method: "DELETE", prefer: "return=minimal" });
    if (collaboratorIds.length) {
      await sbFetch("project_members", { method: "POST", body: JSON.stringify(collaboratorIds.map(uid => ({ project_id: projectId, user_id: uid }))) });
    }
  },

  // Time Entries — soft delete only, filter out deleted
  async getEntries() {
    if (!USE_SUPABASE) return LS.get("tt_entries").filter(e => !e.deleted_at);
    return sbFetch("time_entries?select=*&deleted_at=is.null&order=date.desc,created_at.desc");
  },
  async logEntry(entry) {
    const e = { ...entry, id: crypto.randomUUID(), created_at: new Date().toISOString(), deleted_at: null };
    if (!USE_SUPABASE) { const es = LS.get("tt_entries"); es.push(e); LS.set("tt_entries", es); return e; }
    const res = await sbFetch("time_entries", { method: "POST", body: JSON.stringify(entry) });
    return res[0];
  },
  async softDeleteEntry(id) {
    const now = new Date().toISOString();
    if (!USE_SUPABASE) {
      LS.set("tt_entries", LS.get("tt_entries").map(e => e.id === id ? { ...e, deleted_at: now } : e));
      return;
    }
    await sbFetch(`time_entries?id=eq.${id}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ deleted_at: now }),
    });
  },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmtHours = (h) => {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins ? `${whole}h ${mins}m` : `${whole}h`;
};

const getWeekRange = (offset = 0) => {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7) + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
};

const PROJECT_COLORS = [
  "#e07b39","#4a9eff","#50c87a","#e05c6b","#b07df0","#f0c040","#40c0c0","#ff80ab"
];
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function exportCSV(entries, users, projects) {
  const rows = [["Date","User","Project","Hours","Notes"]];
  entries.forEach(e => {
    const user = users.find(u => u.id === e.user_id)?.name ?? e.user_id;
    const project = projects.find(p => p.id === e.project_id)?.name ?? e.project_id;
    rows.push([e.date, user, project, e.hours, e.notes ?? ""]);
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `time-export-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0f1117;
    --surface: #181c27;
    --surface2: #1e2334;
    --border: #2a3048;
    --amber: #f5a623;
    --text: #e8eaf0;
    --text-muted: #7a8299;
    --danger: #e05c6b;
    --green: #50c87a;
    --radius: 8px;
    --font-display: 'Syne', sans-serif;
    --font-mono: 'DM Mono', monospace;
  }

  body { background: var(--bg); color: var(--text); font-family: var(--font-display); }
  .app { min-height: 100vh; display: flex; flex-direction: column; }

  .header {
    border-bottom: 1px solid var(--border);
    padding: 0 32px; height: 60px;
    display: flex; align-items: center; justify-content: space-between;
    position: sticky; top: 0; z-index: 100;
    background: rgba(15,17,23,0.92); backdrop-filter: blur(12px);
  }
  .logo { font-size: 18px; font-weight: 800; letter-spacing: -0.5px; }
  .logo span { color: var(--amber); }
  .nav { display: flex; gap: 4px; }
  .nav-btn {
    background: none; border: none; color: var(--text-muted); cursor: pointer;
    font-family: var(--font-display); font-size: 13px; font-weight: 600;
    padding: 6px 14px; border-radius: var(--radius); transition: all 0.15s;
  }
  .nav-btn:hover { color: var(--text); background: var(--surface); }
  .nav-btn.active { color: var(--amber); background: var(--surface); }

  .user-bar { display: flex; align-items: center; gap: 10px; }
  .user-chip {
    display: flex; align-items: center; gap: 8px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 20px; padding: 5px 14px 5px 10px;
    font-size: 13px; cursor: pointer; transition: border-color 0.15s;
  }
  .user-chip:hover { border-color: var(--amber); }
  .avatar {
    width: 24px; height: 24px; border-radius: 50%;
    background: var(--amber); color: #000;
    font-size: 11px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }

  .main { flex: 1; padding: 32px; max-width: 1100px; width: 100%; margin: 0 auto; }
  .page-title { font-size: 26px; font-weight: 800; margin-bottom: 24px; }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; }
  .card + .card { margin-top: 16px; }
  .card-title { font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 16px; }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }

  .form-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
  .field { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 120px; }
  .field label { font-size: 11px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; color: var(--text-muted); }
  .field input, .field select, .field textarea {
    background: var(--surface2); border: 1px solid var(--border);
    color: var(--text); border-radius: var(--radius);
    padding: 9px 12px; font-family: var(--font-display); font-size: 14px;
    outline: none; transition: border-color 0.15s; width: 100%;
  }
  .field input:focus, .field select:focus, .field textarea:focus { border-color: var(--amber); }
  .field select option { background: var(--surface2); }
  .field.error input, .field.error select { border-color: var(--danger); }
  .field-error { font-size: 11px; color: var(--danger); font-weight: 600; margin-top: 2px; }

  .btn {
    padding: 9px 20px; border-radius: var(--radius); border: none; cursor: pointer;
    font-family: var(--font-display); font-size: 14px; font-weight: 700;
    transition: all 0.15s; white-space: nowrap;
  }
  .btn-primary { background: var(--amber); color: #000; }
  .btn-primary:hover { background: #ffc04a; }
  .btn-ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
  .btn-ghost:hover { color: var(--text); border-color: var(--text-muted); }
  .btn-danger { background: transparent; color: var(--danger); border: 1px solid transparent; padding: 4px 8px; font-size: 12px; }
  .btn-danger:hover { border-color: var(--danger); }
  .btn-sm { padding: 5px 12px; font-size: 12px; }

  .entry-list { display: flex; flex-direction: column; }
  .entry-row {
    display: grid; grid-template-columns: 100px 1fr 1fr 70px 1fr 36px;
    align-items: center; gap: 12px;
    padding: 12px 0; border-bottom: 1px solid var(--border); font-size: 13px;
  }
  .entry-row:last-child { border-bottom: none; }
  .entry-row.header-row { color: var(--text-muted); font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; padding-bottom: 8px; }
  .hours-badge { font-family: var(--font-mono); font-size: 13px; font-weight: 500; color: var(--amber); }
  .project-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }

  .stat-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 20px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .stat-value { font-family: var(--font-mono); font-size: 28px; font-weight: 500; color: var(--amber); }
  .stat-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700; }

  .week-bar { display: flex; gap: 6px; align-items: flex-end; height: 80px; }
  .day-col { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
  .day-bar-wrap { flex: 1; width: 100%; display: flex; align-items: flex-end; }
  .day-bar { width: 100%; border-radius: 4px 4px 0 0; background: var(--amber); opacity: 0.85; min-height: 2px; }
  .day-label { font-size: 10px; color: var(--text-muted); font-weight: 700; }

  .project-card {
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 16px;
    display: flex; flex-direction: column; gap: 8px;
    cursor: pointer; transition: border-color 0.15s, background 0.15s;
  }
  .project-card:hover { border-color: var(--amber); background: #1a2030; }
  .project-card.static { cursor: default; }
  .project-card.static:hover { border-color: var(--border); background: var(--surface2); }
  .project-header { display: flex; align-items: center; gap: 10px; }
  .project-name { font-weight: 700; font-size: 15px; }
  .project-meta { font-size: 11px; color: var(--text-muted); }
  .color-swatch { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
  .collab-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .collab-chip { font-size: 10px; background: var(--border); border-radius: 10px; padding: 2px 8px; color: var(--text-muted); font-weight: 600; }

  .color-picker { display: flex; gap: 8px; flex-wrap: wrap; }
  .color-btn { width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; transition: transform 0.15s, border-color 0.15s; }
  .color-btn:hover { transform: scale(1.15); }
  .color-btn.selected { border-color: white; transform: scale(1.15); }

  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 200; backdrop-filter: blur(4px); animation: fadeIn 0.15s;
  }
  .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 28px; width: 100%; max-width: 460px; animation: slideUp 0.2s; }
  .modal-title { font-size: 18px; font-weight: 800; margin-bottom: 20px; }

  .check-list { display: flex; flex-direction: column; gap: 8px; max-height: 160px; overflow-y: auto; }
  .check-item { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
  .check-item input[type=checkbox] { accent-color: var(--amber); width: 15px; height: 15px; }

  .centered-screen {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    flex-direction: column; gap: 24px; padding: 32px;
  }
  .screen-title { font-size: 36px; font-weight: 800; }
  .screen-title span { color: var(--amber); }
  .screen-subtitle { color: var(--text-muted); font-size: 14px; }

  .auth-box {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 32px; width: 100%; max-width: 360px;
    display: flex; flex-direction: column; gap: 16px;
  }
  .auth-box-title { font-size: 15px; font-weight: 700; }
  .auth-error { color: var(--danger); font-size: 12px; font-weight: 600; }

  .user-grid { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; max-width: 520px; }
  .user-select-btn {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 16px 24px; cursor: pointer;
    font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--text);
    display: flex; align-items: center; gap: 10px; transition: all 0.15s;
  }
  .user-select-btn:hover { border-color: var(--amber); background: var(--surface2); }
  .avatar-lg { width: 36px; height: 36px; border-radius: 50%; background: var(--amber); color: #000; font-size: 14px; font-weight: 800; display: flex; align-items: center; justify-content: center; }

  .week-nav { display: flex; align-items: center; gap: 12px; }
  .week-nav span { font-size: 13px; font-weight: 600; color: var(--text-muted); min-width: 180px; text-align: center; }

  .empty { text-align: center; color: var(--text-muted); padding: 40px; font-size: 14px; }

  .tab {
    background: none; border: none; color: var(--text-muted); cursor: pointer;
    font-family: var(--font-display); font-size: 13px; font-weight: 700;
    padding: 8px 16px; border-bottom: 2px solid transparent;
    transition: all 0.15s; margin-bottom: -1px;
  }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--amber); border-bottom-color: var(--amber); }

  .toast {
    position: fixed; bottom: 24px; right: 24px; background: var(--green);
    color: #000; padding: 10px 18px; border-radius: var(--radius);
    font-weight: 700; font-size: 13px; z-index: 999; animation: slideUp 0.2s;
  }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
`;

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("checking");
  const [input, setInput] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    DB.getOrgPassword().then(pw => setMode(pw ? "login" : "setup"));
  }, []);

  const handleLogin = async () => {
    setLoading(true); setError("");
    const stored = await DB.getOrgPassword();
    if (input === stored) { onAuth(); }
    else { setError("Wrong password. Try again."); }
    setLoading(false);
  };

  const handleSetup = async () => {
    if (!input.trim()) { setError("Password cannot be empty."); return; }
    if (input !== confirm) { setError("Passwords don't match."); return; }
    setLoading(true);
    await DB.setOrgPassword(input);
    onAuth();
    setLoading(false);
  };

  if (mode === "checking") return (
    <>
      <style>{styles}</style>
      <div className="centered-screen">
        <div className="screen-title">time<span>.</span>track</div>
      </div>
    </>
  );

  return (
    <>
      <style>{styles}</style>
      <div className="centered-screen">
        <div style={{ textAlign: "center" }}>
          <div className="screen-title">time<span>.</span>track</div>
          <div className="screen-subtitle" style={{ marginTop: 8 }}>
            {mode === "setup" ? "First time setup" : "Welcome back"}
          </div>
        </div>
        <div className="auth-box">
          <div className="auth-box-title">
            {mode === "setup" ? "Create organisation password" : "Organisation password"}
          </div>
          {mode === "setup" && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
              One shared password for your whole team. Share it with your coworkers — anyone with it can access the app.
            </div>
          )}
          <div className="field">
            <label>{mode === "setup" ? "New password" : "Password"}</label>
            <input
              type="password" value={input} autoFocus
              onChange={e => { setInput(e.target.value); setError(""); }}
              onKeyDown={e => e.key === "Enter" && (mode === "login" ? handleLogin() : null)}
              placeholder="••••••••"
            />
          </div>
          {mode === "setup" && (
            <div className="field">
              <label>Confirm password</label>
              <input
                type="password" value={confirm}
                onChange={e => { setConfirm(e.target.value); setError(""); }}
                onKeyDown={e => e.key === "Enter" && handleSetup()}
                placeholder="••••••••"
              />
            </div>
          )}
          {error && <div className="auth-error">{error}</div>}
          <button
            className="btn btn-primary" style={{ width: "100%" }}
            disabled={loading}
            onClick={mode === "login" ? handleLogin : handleSetup}
          >
            {loading ? "…" : mode === "login" ? "Enter" : "Set Password & Continue"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── USER SELECT SCREEN ───────────────────────────────────────────────────────
function UserSelectScreen({ users, onSelect, onCreate, onLogout }) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const u = await onCreate(newName.trim());
    onSelect(u);
  };

  return (
    <div className="centered-screen">
      <div style={{ textAlign: "center" }}>
        <div className="screen-title">time<span>.</span>track</div>
        <div className="screen-subtitle" style={{ marginTop: 8 }}>Who's working today?</div>
      </div>
      <div className="user-grid">
        {users.map(u => (
          <button key={u.id} className="user-select-btn" onClick={() => onSelect(u)}>
            <div className="avatar-lg">{u.name[0].toUpperCase()}</div>
            {u.name}
          </button>
        ))}
      </div>
      {!creating ? (
        <button className="btn btn-ghost" onClick={() => setCreating(true)}>+ New user</button>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: "var(--radius)", padding: "9px 12px", fontFamily: "var(--font-display)", fontSize: 14, outline: "none" }}
            placeholder="Your name" value={newName} autoFocus
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCreate()}
          />
          <button className="btn btn-primary" onClick={handleCreate}>Create</button>
          <button className="btn btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
        </div>
      )}
      <button className="btn btn-ghost btn-sm" style={{ color: "var(--text-muted)", fontSize: 12 }} onClick={onLogout}>
        ← Sign out of organisation
      </button>
    </div>
  );
}

// ─── LOG PAGE (project-first) ─────────────────────────────────────────────────
function LogPage({ users, projects, entries, currentUser, onSave, onDelete, onExport }) {
  const [selectedProject, setSelectedProject] = useState(null);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ date: today, hours: "", notes: "" });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: null })); };

  const getCollabIds = (p) => p.collaborator_ids ?? p.project_members?.map(m => m.user_id) ?? [];
  const activeProjects = projects.filter(p => !p.archived && !p.deleted_at && getCollabIds(p).includes(currentUser.id));

  const validate = () => {
    const e = {};
    if (!form.date) e.date = "Required";
    if (!form.hours || parseFloat(form.hours) <= 0) e.hours = "Enter a valid number";
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    await onSave({ user_id: currentUser.id, project_id: selectedProject.id, date: form.date, hours: parseFloat(form.hours), notes: form.notes });
    setForm({ date: today, hours: "", notes: "" });
    setErrors({});
    setSaving(false);
  };

  const projectEntries = selectedProject
    ? entries.filter(e => e.project_id === selectedProject.id)
    : [];

  const [entryFilter, setEntryFilter] = useState("all");
  const visibleEntries = entryFilter === "all" ? projectEntries : projectEntries.filter(e => e.user_id === entryFilter);

  // Back to project list
  if (!selectedProject) return (
    <div>
      <div className="page-title">Log Time</div>
      {activeProjects.length === 0
        ? <div className="empty">You're not added as a collaborator on any active projects yet. Ask someone to add you, or go to Projects to create one.</div>
        : (
          <div className="grid-3">
            {activeProjects.map(p => {
              const myHoursThisWeek = (() => {
                const { start, end } = getWeekRange(0);
                return entries
                  .filter(e => e.project_id === p.id && e.user_id === currentUser.id && new Date(e.date) >= start && new Date(e.date) <= end)
                  .reduce((s, e) => s + e.hours, 0);
              })();
              return (
                <div key={p.id} className="project-card" onClick={() => setSelectedProject(p)}>
                  <div className="project-header">
                    <div className="color-swatch" style={{ background: p.color }} />
                    <div className="project-name">{p.name}</div>
                  </div>
                  {myHoursThisWeek > 0 && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      You: <span style={{ color: "var(--amber)", fontFamily: "var(--font-mono)" }}>{fmtHours(myHoursThisWeek)}</span> this week
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Click to log time →</div>
                </div>
              );
            })}
          </div>
        )
      }
    </div>
  );

  // Inside a project
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setSelectedProject(null)}>← Back</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="color-swatch" style={{ background: selectedProject.color, width: 14, height: 14 }} />
          <div className="page-title" style={{ margin: 0 }}>{selectedProject.name}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Log hours as {currentUser.name}</div>
        <div className="form-row">
          <div className={`field ${errors.date ? "error" : ""}`} style={{ maxWidth: 160 }}>
            <label>Date</label>
            <input type="date" value={form.date} onChange={e => set("date", e.target.value)} />
            {errors.date && <div className="field-error">{errors.date}</div>}
          </div>
          <div className={`field ${errors.hours ? "error" : ""}`} style={{ maxWidth: 110 }}>
            <label>Hours</label>
            <input type="number" step="0.25" min="0.25" max="24" placeholder="0.0" value={form.hours} onChange={e => set("hours", e.target.value)} onKeyDown={e => e.key === "Enter" && handleSave()} />
            {errors.hours && <div className="field-error">{errors.hours}</div>}
          </div>
          <div className="field">
            <label>Notes (optional)</label>
            <input type="text" placeholder="What did you work on?" value={form.notes} onChange={e => set("notes", e.target.value)} onKeyDown={e => e.key === "Enter" && handleSave()} />
          </div>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? "…" : "Log"}</button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Entries</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: "var(--radius)", padding: "5px 10px", fontFamily: "var(--font-display)", fontSize: 12, outline: "none", minWidth: 120 }}
              value={entryFilter} onChange={e => setEntryFilter(e.target.value)}
            >
              <option value="all">All team</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={() => onExport(visibleEntries)}>↓ CSV</button>
          </div>
        </div>
        <EntriesTable entries={visibleEntries.slice(0, 50)} users={users} projects={projects} onDelete={onDelete} currentUser={currentUser} hideProject />
      </div>
    </div>
  );
}

// ─── ENTRIES TABLE ────────────────────────────────────────────────────────────
function EntriesTable({ entries, users, projects, onDelete, currentUser, hideProject }) {
  const getName = (id, arr) => arr.find(x => x.id === id)?.name ?? "—";
  const getColor = (id) => projects.find(p => p.id === id)?.color ?? "#888";

  if (!entries.length) return <div className="empty">No entries yet.</div>;

  const cols = hideProject
    ? "100px 1fr 70px 1fr 36px"
    : "100px 1fr 1fr 70px 1fr 36px";

  return (
    <div className="entry-list">
      <div className="entry-row header-row" style={{ gridTemplateColumns: cols }}>
        <span>Date</span><span>User</span>
        {!hideProject && <span>Project</span>}
        <span>Hours</span><span>Notes</span><span></span>
      </div>
      {entries.map(e => {
        const isOwn = e.user_id === currentUser.id;
        return (
          <div key={e.id} className="entry-row" style={{ gridTemplateColumns: cols }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{e.date}</span>
            <span style={{ fontWeight: isOwn ? 700 : 400 }}>{getName(e.user_id, users)}</span>
            {!hideProject && (
              <span>
                <span className="project-dot" style={{ background: getColor(e.project_id) }} />
                {getName(e.project_id, projects)}
              </span>
            )}
            <span className="hours-badge">{fmtHours(e.hours)}</span>
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{e.notes || "—"}</span>
            {isOwn
              ? <button className="btn btn-danger" title="Remove entry" onClick={() => onDelete(e.id)}>✕</button>
              : <span style={{ width: 36 }} />
            }
          </div>
        );
      })}
    </div>
  );
}

// ─── WEEKLY DASHBOARD ─────────────────────────────────────────────────────────
function WeeklyDashboard({ entries, users, projects }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [filterUser, setFilterUser] = useState("all");
  const { start, end } = getWeekRange(weekOffset);

  const weekEntries = entries.filter(e => {
    const d = new Date(e.date);
    return d >= start && d <= end && (filterUser === "all" || e.user_id === filterUser);
  });

  const totalHours = weekEntries.reduce((s, e) => s + e.hours, 0);
  const perProject = {};
  weekEntries.forEach(e => { perProject[e.project_id] = (perProject[e.project_id] || 0) + e.hours; });
  const perUser = {};
  weekEntries.forEach(e => { perUser[e.user_id] = (perUser[e.user_id] || 0) + e.hours; });
  const perDay = Array(7).fill(0);
  weekEntries.forEach(e => { const d = new Date(e.date); perDay[(d.getDay() + 6) % 7] += e.hours; });
  const maxDay = Math.max(...perDay, 1);
  const fmtDate = d => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div className="week-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => setWeekOffset(o => o - 1)}>← Prev</button>
          <span>{fmtDate(start)} — {fmtDate(end)}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setWeekOffset(o => Math.min(0, o + 1))} disabled={weekOffset === 0}>Next →</button>
        </div>
        <div className="field" style={{ minWidth: 0, maxWidth: 160 }}>
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)}>
            <option value="all">All users</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-value">{fmtHours(totalHours)}</div><div className="stat-label">Total this week</div></div>
        <div className="stat-card"><div className="stat-value">{weekEntries.length}</div><div className="stat-label">Log entries</div></div>
        <div className="stat-card"><div className="stat-value">{Object.keys(perProject).length}</div><div className="stat-label">Projects active</div></div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-title">Hours by Day</div>
          <div className="week-bar">
            {DAYS.map((d, i) => (
              <div key={d} className="day-col">
                <div className="day-bar-wrap">
                  <div className="day-bar" style={{ height: `${(perDay[i] / maxDay) * 100}%` }} title={fmtHours(perDay[i])} />
                </div>
                <div className="day-label">{d}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-title">Hours by Project</div>
          {Object.keys(perProject).length === 0
            ? <div className="empty" style={{ padding: 16 }}>No data</div>
            : Object.entries(perProject).sort((a, b) => b[1] - a[1]).map(([pid, h]) => {
              const proj = projects.find(p => p.id === pid);
              return (
                <div key={pid} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span><span className="project-dot" style={{ background: proj?.color ?? "#888" }} />{proj?.name ?? pid}</span>
                    <span className="hours-badge">{fmtHours(h)}</span>
                  </div>
                  <div style={{ background: "var(--border)", borderRadius: 4, height: 5 }}>
                    <div style={{ background: proj?.color ?? "var(--amber)", width: `${(h / totalHours) * 100}%`, height: "100%", borderRadius: 4 }} />
                  </div>
                </div>
              );
            })
          }
        </div>
      </div>

      {filterUser === "all" && Object.keys(perUser).length > 0 && (
        <div className="card">
          <div className="card-title">Hours by Team Member</div>
          <div style={{ display: "flex", gap: 16 }}>
            {Object.entries(perUser).sort((a, b) => b[1] - a[1]).map(([uid, h]) => {
              const user = users.find(u => u.id === uid);
              return (
                <div key={uid} className="stat-card" style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <div className="avatar">{user?.name?.[0]?.toUpperCase() ?? "?"}</div>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{user?.name ?? uid}</span>
                  </div>
                  <div className="stat-value" style={{ fontSize: 22 }}>{fmtHours(h)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PROJECTS PAGE ────────────────────────────────────────────────────────────
function CollaboratorModal({ title, users, initial, onSave, onClose }) {
  const [selected, setSelected] = useState(initial);
  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">{title}</div>
        <div className="field" style={{ marginBottom: 20 }}>
          <label>Collaborators</label>
          <div className="check-list">
            {users.map(u => (
              <label key={u.id} className="check-item">
                <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
                {u.name}
              </label>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(selected)}>Save</button>
        </div>
      </div>
    </div>
  );
}

function ProjectsPage({ users, projects, onCreateProject, onArchiveProject, onUnarchiveProject, onUpdateCollaborators }) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", color: PROJECT_COLORS[0], collaborators: [] });
  const [showArchived, setShowArchived] = useState(false);
  const [editingCollab, setEditingCollab] = useState(null); // project being edited
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleCollab = (id) => setForm(f => ({
    ...f, collaborators: f.collaborators.includes(id)
      ? f.collaborators.filter(x => x !== id)
      : [...f.collaborators, id]
  }));
  const handleCreate = async () => {
    if (!form.name.trim()) return;
    await onCreateProject(form.name.trim(), form.color, form.collaborators);
    setForm({ name: "", color: PROJECT_COLORS[0], collaborators: [] });
    setShowCreate(false);
  };
  const handleUpdateCollaborators = async (collaboratorIds) => {
    await onUpdateCollaborators(editingCollab.id, collaboratorIds);
    setEditingCollab(null);
  };
  const visible = projects.filter(p => !p.deleted_at && (showArchived ? p.archived : !p.archived));
  const getCollabIds = (p) => p.collaborator_ids ?? p.project_members?.map(m => m.user_id) ?? [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)" }}>
          <button className={`tab ${!showArchived ? "active" : ""}`} onClick={() => setShowArchived(false)}>Active</button>
          <button className={`tab ${showArchived ? "active" : ""}`} onClick={() => setShowArchived(true)}>Archived</button>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Project</button>
      </div>

      {visible.length === 0
        ? <div className="empty">No projects here. Create your first one!</div>
        : (
          <div className="grid-3">
            {visible.map(p => {
              const collabIds = getCollabIds(p);
              return (
                <div key={p.id} className="project-card static">
                  <div className="project-header">
                    <div className="color-swatch" style={{ background: p.color }} />
                    <div className="project-name">{p.name}</div>
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <div className="project-meta">Team</div>
                      {!p.archived && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11, padding: "2px 8px" }}
                          onClick={() => setEditingCollab(p)}
                        >Edit</button>
                      )}
                    </div>
                    <div className="collab-chips">
                      {collabIds.length === 0
                        ? <span style={{ fontSize: 11, color: "var(--text-muted)" }}>No collaborators yet</span>
                        : collabIds.map(uid => {
                          const u = users.find(x => x.id === uid);
                          return u ? <span key={uid} className="collab-chip">{u.name}</span> : null;
                        })
                      }
                    </div>
                  </div>
                  <button
                    className={p.archived ? "btn btn-ghost btn-sm" : "btn btn-danger"}
                    style={{ alignSelf: "flex-start", marginTop: 4, fontSize: 12 }}
                    onClick={() => p.archived ? onUnarchiveProject(p.id) : onArchiveProject(p.id)}
                  >{p.archived ? "Unarchive" : "Archive"}</button>
                </div>
              );
            })}
          </div>
        )
      }

      {showCreate && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="modal">
            <div className="modal-title">New Project</div>
            <div className="field" style={{ marginBottom: 16 }}>
              <label>Project Name</label>
              <input autoFocus value={form.name} onChange={e => set("name", e.target.value)} onKeyDown={e => e.key === "Enter" && handleCreate()} placeholder="e.g. Website Redesign" />
            </div>
            <div className="field" style={{ marginBottom: 16 }}>
              <label>Color</label>
              <div className="color-picker">
                {PROJECT_COLORS.map(c => (
                  <button key={c} className={`color-btn ${form.color === c ? "selected" : ""}`} style={{ background: c }} onClick={() => set("color", c)} />
                ))}
              </div>
            </div>
            <div className="field" style={{ marginBottom: 20 }}>
              <label>Collaborators</label>
              <div className="check-list">
                {users.map(u => (
                  <label key={u.id} className="check-item">
                    <input type="checkbox" checked={form.collaborators.includes(u.id)} onChange={() => toggleCollab(u.id)} />
                    {u.name}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate}>Create Project</button>
            </div>
          </div>
        </div>
      )}

      {editingCollab && (
        <CollaboratorModal
          title={`Team — ${editingCollab.name}`}
          users={users}
          initial={getCollabIds(editingCollab)}
          onSave={handleUpdateCollaborators}
          onClose={() => setEditingCollab(null)}
        />
      )}
    </div>
  );
}

function Toast({ msg }) {
  return msg ? <div className="toast">{msg}</div> : null;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [entries, setEntries] = useState([]);
  const [page, setPage] = useState("log");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [u, p, e] = await Promise.all([DB.getUsers(), DB.getProjects(), DB.getEntries()]);
      if (!cancelled) { setUsers(u); setProjects(p); setEntries(e); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [authed]);

  const handleCreateUser = async (name) => { const u = await DB.createUser(name); setUsers(us => [...us, u]); return u; };
  const handleCreateProject = async (name, color, collaborators) => {
    const p = await DB.createProject(name, color, collaborators);
    setProjects(ps => [...ps, p]);
    showToast("Project created!");
  };
  const handleArchiveProject = async (id) => {
    await DB.archiveProject(id);
    setProjects(ps => ps.map(p => p.id === id ? { ...p, archived: true } : p));
    showToast("Project archived.");
  };
  const handleUnarchiveProject = async (id) => {
    await DB.unarchiveProject(id);
    setProjects(ps => ps.map(p => p.id === id ? { ...p, archived: false } : p));
    showToast("Project restored.");
  };
  const handleLogEntry = async (entry) => {
    const e = await DB.logEntry(entry);
    setEntries(es => [e, ...es]);
    showToast("Time logged ✓");
  };
  const handleUpdateCollaborators = async (projectId, collaboratorIds) => {
    await DB.updateCollaborators(projectId, collaboratorIds);
    setProjects(ps => ps.map(p => p.id === projectId ? { ...p, collaborator_ids: collaboratorIds, project_members: collaboratorIds.map(uid => ({ user_id: uid })) } : p));
    showToast("Team updated.");
  };
  const handleDeleteEntry = async (id) => {
    await DB.softDeleteEntry(id);
    setEntries(es => es.filter(e => e.id !== id));
    showToast("Entry removed.");
  };

  if (!authed) return <><style>{styles}</style><AuthScreen onAuth={() => setAuthed(true)} /></>;

  if (!currentUser) return (
    <>
      <style>{styles}</style>
      {loading
        ? <div className="centered-screen"><div className="screen-title">time<span style={{ color: "var(--amber)" }}>.</span>track</div></div>
        : <UserSelectScreen users={users} onSelect={setCurrentUser} onCreate={handleCreateUser} onLogout={() => setAuthed(false)} />
      }
    </>
  );

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <header className="header">
          <div className="logo">time<span>.</span>track</div>
          <nav className="nav">
            <button className={`nav-btn ${page === "log" ? "active" : ""}`} onClick={() => setPage("log")}>Log Time</button>
            <button className={`nav-btn ${page === "dashboard" ? "active" : ""}`} onClick={() => setPage("dashboard")}>Dashboard</button>
            <button className={`nav-btn ${page === "projects" ? "active" : ""}`} onClick={() => setPage("projects")}>Projects</button>
          </nav>
          <div className="user-bar">
            <div className="user-chip" onClick={() => setCurrentUser(null)} title="Switch user">
              <div className="avatar">{currentUser.name[0].toUpperCase()}</div>
              {currentUser.name}
            </div>
          </div>
        </header>

        <main className="main">
          {page === "log" && (
            <LogPage
              users={users}
              projects={projects}
              entries={entries}
              currentUser={currentUser}
              onSave={handleLogEntry}
              onDelete={handleDeleteEntry}
              onExport={(entriesToExport) => exportCSV(entriesToExport, users, projects)}
            />
          )}
          {page === "dashboard" && (
            <>
              <div className="page-title">Weekly Dashboard</div>
              <WeeklyDashboard entries={entries} users={users} projects={projects} />
            </>
          )}
          {page === "projects" && (
            <>
              <div className="page-title">Projects</div>
              <ProjectsPage users={users} projects={projects} onCreateProject={handleCreateProject} onArchiveProject={handleArchiveProject} onUnarchiveProject={handleUnarchiveProject} onUpdateCollaborators={handleUpdateCollaborators} />
            </>
          )}
        </main>
      </div>
      <Toast msg={toast} />
    </>
  );
}