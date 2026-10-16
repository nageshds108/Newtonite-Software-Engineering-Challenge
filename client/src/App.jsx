import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, AlertCircle, ArrowDown, ArrowUp, ArrowUpRight, Bell, Check, ChevronDown, ChevronLeft, ChevronRight,
  CircleHelp, Clock3, Command, FileText, Filter, Inbox, Layers3, ListFilter, LogOut, Menu,
  MoreHorizontal, Plus, Search, Settings2, ShieldCheck, Sparkles, UserRound, Users, X, Zap
} from "lucide-react";
import { api, clearToken, getToken, json, setToken } from "./api.js";

const types = ["customer", "engineering", "payment", "incident", "compliance", "operations"];
const priorities = ["low", "normal", "high", "urgent"];
const statuses = ["open", "in_progress", "blocked", "resolved"];
const initials = (name = "") => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const dateLabel = (date) => date ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(date)) : "No due date";
const titleCase = (value = "") => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function App() {
  const [user, setUser] = useState(null);
  const [teams, setTeams] = useState([]);
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");

  const refreshTeams = useCallback(async () => {
    const { teams: next } = await api("/teams");
    setTeams(next);
    setTeam((active) => next.find((entry) => entry.id === active?.id) || next[0] || null);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    Promise.all([api("/auth/me"), api("/teams")])
      .then(([profile, result]) => {
        setUser(profile.user);
        setTeams(result.teams);
        setTeam(result.teams[0] || null);
      })
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  async function authenticateUser(event) {
    event.preventDefault();
    setAuthError("");
    const data = new FormData(event.currentTarget);
    const body = { email: data.get("email"), password: data.get("password") };
    if (authMode === "register") body.name = data.get("name");
    try {
      const result = await api(`/auth/${authMode === "register" ? "register" : "login"}`, { method: "POST", body: json(body) });
      setToken(result.token);
      setUser(result.user);
      await refreshTeams();
    } catch (error) {
      setAuthError(error.message);
    }
  }

  function signOut() {
    clearToken();
    setUser(null);
    setTeams([]);
    setTeam(null);
  }

  if (loading) return <div className="loading-screen"><div className="brand-mark"><Layers3 size={19} /></div><span>Getting your workspace ready…</span></div>;
  if (!user) return <AuthScreen mode={authMode} setMode={setAuthMode} onSubmit={authenticateUser} error={authError} />;
  if (!team) return <TeamSetup user={user} onComplete={refreshTeams} onSignOut={signOut} />;
  return <Workspace user={user} team={team} teams={teams} setTeam={setTeam} refreshTeams={refreshTeams} onSignOut={signOut} />;
}

function AuthScreen({ mode, setMode, onSubmit, error }) {
  return (
    <main className="auth-layout">
      <section className="auth-brand-panel">
        <div className="brand"><div className="brand-mark"><Layers3 size={19} /></div><span>opsdesk</span></div>
        <div className="auth-story">
          <span className="eyebrow"><Sparkles size={13} /> YOUR TEAM'S WORK, IN FOCUS</span>
          <h1>Good work<br />deserves a<br /><em>clear path.</em></h1>
          <p>One thoughtful place to track what matters, bring the right people in, and keep every decision moving.</p>
          <div className="story-stats"><div className="avatar-stack"><b>AM</b><b>JK</b><b>RL</b><b>+8</b></div><span>Teams move better, together.</span></div>
        </div>
        <div className="auth-foot"><span>© 2026 OpsDesk</span><span>Built for the work behind the work.</span></div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-top-note"><span>Already have a workspace?</span><button className="link-button" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Create account" : "Sign in"}</button></div>
        <form className="auth-form" onSubmit={onSubmit}>
          <div className="auth-icon"><ShieldCheck size={20} /></div>
          <span className="eyebrow muted">WELCOME TO OPSDESK</span>
          <h2>{mode === "login" ? "Good to have you back." : "Let's get you set up."}</h2>
          <p className="auth-subtitle">{mode === "login" ? "Sign in to pick up where your team left off." : "Create your account to start building a better workflow."}</p>
          {mode === "register" && <label>Your name<input name="name" placeholder="Alex Morgan" autoComplete="name" required minLength="1" maxLength="80" /></label>}
          <label>Work email<input name="email" type="email" placeholder="you@company.com" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" placeholder={mode === "register" ? "At least 10 characters" : "Enter your password"} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? "10" : "1"} required /></label>
          {error && <div className="form-error"><AlertCircle size={16} />{error}</div>}
          <button className="button primary full" type="submit">{mode === "login" ? "Sign in to OpsDesk" : "Create your account"}<ArrowUpRight size={16} /></button>
          <div className="auth-assurance"><ShieldCheck size={14} /> Your workspace is private to your team.</div>
          {mode === "login" && <button className="demo-login" type="button" onClick={(event) => {
            const form = event.currentTarget.closest("form");
            form.elements.email.value = "demo@opsdesk.local";
            form.elements.password.value = "DemoPassword123!";
          }}>Use the seeded demo account <ArrowUpRight size={13} /></button>}
        </form>
      </section>
    </main>
  );
}

function TeamSetup({ user, onComplete, onSignOut }) {
  const [tab, setTab] = useState("create");
  const [error, setError] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [createdInvite, setCreatedInvite] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      if (tab === "create") {
        const { team } = await api("/teams", { method: "POST", body: json({ name: data.get("teamName") }) });
        setCreatedInvite(team.inviteCode);
      } else {
        await api("/teams/join", { method: "POST", body: json({ inviteCode }) });
        await onComplete();
      }
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="setup-page">
      <header className="setup-header"><div className="brand"><div className="brand-mark"><Layers3 size={19} /></div><span>opsdesk</span></div><button className="icon-button" onClick={onSignOut} title="Sign out"><LogOut size={17} /></button></header>
      <section className="setup-card">
        <span className="eyebrow muted">A BETTER WAY TO GET THINGS DONE</span><h1>First, find your people.</h1><p>Every piece of work belongs to a team. Create a new team or join one with an invite code.</p>
        {!createdInvite ? <>
          <div className="setup-tabs"><button className={tab === "create" ? "active" : ""} onClick={() => setTab("create")}>Create a team</button><button className={tab === "join" ? "active" : ""} onClick={() => setTab("join")}>Join a team</button></div>
          <form onSubmit={submit}>
            {tab === "create" ? <label>Team name<input name="teamName" placeholder="e.g. Customer Operations" required minLength="2" maxLength="80" /></label> : <label>Invite code<input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="Paste your team's invite code" required /></label>}
            {error && <div className="form-error"><AlertCircle size={16} />{error}</div>}
            <button className="button primary full" disabled={busy}>{busy ? "One moment…" : tab === "create" ? "Create my team" : "Join team"}<ArrowUpRight size={16} /></button>
          </form>
        </> : <div className="invite-result"><div className="success-icon"><Check size={20} /></div><h3>Your team is ready, {user.name.split(" ")[0]}.</h3><p>Share this invite code with teammates so they can join.</p><code>{createdInvite}</code><button className="button primary full" onClick={onComplete}>Open my workspace<ArrowUpRight size={16} /></button></div>}
        <button className="subtle-link" onClick={onSignOut}>Signed in as {user.email} · Sign out</button>
      </section>
      <footer className="setup-footer"><span>© 2026 OpsDesk</span><span>Make the important work visible.</span></footer>
    </main>
  );
}

function Workspace({ user, team, teams, setTeam, refreshTeams, onSignOut }) {
  const searchInput = useRef(null);
  const searchShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ counts: {}, urgent: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ q: "", status: "all", priority: "all", view: "all" });
  const [cursor, setCursor] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [selected, setSelected] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState("");

  const loadItems = useCallback(async (nextCursor = null) => {
    if (!team) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (filters.q.trim()) params.set("q", filters.q.trim());
      if (filters.status !== "all") params.set("status", filters.status);
      if (filters.priority !== "all") params.set("priority", filters.priority);
      if (filters.view === "mine") params.set("mine", "true");
      if (nextCursor) params.set("cursor", nextCursor);
      let result = await api(`/teams/${team.id}/items?${params.toString()}`);
      setItems((current) => nextCursor ? [...current, ...result.items] : result.items);
      setNextCursor(result.nextCursor);
      const overview = await api(`/teams/${team.id}/summary`);
      setSummary(overview);
      setCursor(nextCursor);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setLoading(false);
    }
  }, [team, filters, user.id]);

  useEffect(() => { setItems([]); setCursor(null); loadItems(); }, [team?.id, filters.q, filters.status, filters.priority, filters.view]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    function focusSearch(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  async function showItem(id) {
    try {
      const result = await api(`/teams/${team.id}/items/${id}`);
      setSelected(result);
    } catch (problem) {
      setToast(problem.message);
    }
  }
  async function createItem(form, idempotencyKey) {
    const data = new FormData(form);
    const payload = {
      title: data.get("title"),
      description: data.get("description"),
      type: data.get("type"),
      priority: data.get("priority"),
      dueAt: data.get("dueAt") ? new Date(`${data.get("dueAt")}T12:00:00`).toISOString() : null
    };
    const { item, replayed } = await api(`/teams/${team.id}/items`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: json(payload)
    });
    setCreateOpen(false);
    setToast(replayed ? "This work item was already created. Opening the existing record." : "Work item created.");
    await loadItems();
    await showItem(item.id);
  }
  async function updateItem(id, patch, expectedVersion) {
    const result = await api(`/teams/${team.id}/items/${id}`, { method: "PATCH", body: json({ ...patch, expectedVersion }) });
    await loadItems();
    await showItem(id);
    return result.item;
  }
  async function addComment(id, message) {
    await api(`/teams/${team.id}/items/${id}/comments`, { method: "POST", body: json({ message }) });
    await showItem(id);
    await loadItems();
  }
  async function joinTeam(event) {
    event.preventDefault();
    try {
      await api("/teams/join", { method: "POST", body: json({ inviteCode }) });
      await refreshTeams();
      setInviteOpen(false);
      setInviteCode("");
      setToast("You joined the team.");
    } catch (problem) {
      setToast(problem.message);
    }
  }
  const unresolved = summary.counts.open + summary.counts.in_progress + summary.counts.blocked;
  const filteredCount = items.length;
  const todayLabel = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()).toUpperCase();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="side-brand"><div className="brand-mark"><Layers3 size={18} /></div><span>opsdesk</span><button className="icon-button mobile-menu"><Menu size={17} /></button></div>
        <div className="workspace-select"><div className="team-avatar">{initials(team.name)}</div><div className="team-current"><strong>{team.name}</strong><span>{team.role === "owner" ? "Workspace owner" : `${titleCase(team.role)} workspace`}</span></div><ChevronDown size={15} /></div>
        {teams.length > 1 && <select className="team-switcher" value={team.id} onChange={(event) => setTeam(teams.find((entry) => entry.id === event.target.value))} aria-label="Switch team">{teams.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select>}
        <div className="side-section-label">WORKSPACE</div>
        <nav className="side-nav">
          <button className="nav-item active" onClick={() => setFilters((old) => ({ ...old, view: "all", status: "all" }))}><Inbox size={17} /><span>All work</span><span className="nav-count">{unresolved || "0"}</span></button>
          <button className={`nav-item ${filters.view === "mine" ? "selected" : ""}`} onClick={() => setFilters((old) => ({ ...old, view: "mine" }))}><UserRound size={17} /><span>Assigned to me</span>{summary.urgent > 0 && <span className="nav-dot" />}</button>
          <button className="nav-item" onClick={() => setFilters((old) => ({ ...old, status: "blocked" }))}><Clock3 size={17} /><span>Needs attention</span><span className="nav-badge">{summary.counts.blocked || 0}</span></button>
        </nav>
        <div className="side-section-label side-label-row">TEAMS <button title="Join a team" onClick={() => setInviteOpen(true)}><Plus size={14} /></button></div>
        <nav className="side-nav team-nav">{teams.map((entry) => <button key={entry.id} className={`nav-item ${entry.id === team.id ? "selected" : ""}`} onClick={() => setTeam(entry)}><span className="team-dot">{initials(entry.name).slice(0, 1)}</span><span>{entry.name}</span></button>)}</nav>
        <button className="invite-team-link" onClick={() => setInviteOpen(true)}><Plus size={15} />Join another team</button>
        <div className="sidebar-bottom">
          <div className="upgrade-card"><div className="upgrade-icon"><Zap size={15} /></div><strong>Make room for clarity.</strong><p>Your team’s important work, all in one place.</p><button onClick={() => setInviteOpen(true)}>Invite a teammate <ArrowUpRight size={13} /></button></div>
          <button className="nav-item"><CircleHelp size={17} /><span>Help & feedback</span></button>
          <div className="profile-row"><div className="person-avatar">{initials(user.name)}</div><div className="profile-info"><strong>{user.name}</strong><span>{user.email}</span></div><button className="icon-button" onClick={onSignOut} title="Sign out"><LogOut size={16} /></button></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{team.name}</strong></div><div className="top-actions"><span className="keyboard-hint">{searchShortcut === "⌘ K" && <Command size={12} />}{searchShortcut === "⌘ K" ? "K" : searchShortcut}</span><div className="top-divider" /><button className="icon-button notification-button" title="Notifications"><Bell size={17} /><i /></button><div className="person-avatar small">{initials(user.name)}</div></div></header>
        <section className="page-content">
          <div className="welcome-row"><div><div className="date-eyebrow">{todayLabel} <span className="live-pulse" /> TEAM WORKSPACE</div><h1>Good morning, {user.name.split(" ")[0]}<span className="wave">✳</span></h1><p className="welcome-sub">Here's what's moving across <strong>{team.name}</strong> today.</p></div><button className="button primary create-button" onClick={() => setCreateOpen(true)}><Plus size={17} />Create work item</button></div>

          <div className="metrics-grid">
            <MetricCard icon={<Layers3 size={17} />} label="Active work" value={unresolved || 0} note={`${summary.counts.resolved || 0} resolved`} tone="violet" />
            <MetricCard icon={<Zap size={17} />} label="Urgent priority" value={summary.urgent || 0} note={summary.urgent ? "Needs a close look" : "All clear for now"} tone="orange" />
            <MetricCard icon={<Clock3 size={17} />} label="Blocked items" value={summary.counts.blocked || 0} note="Waiting on a next step" tone="blue" />
            <MetricCard icon={<Check size={17} />} label="Resolved" value={summary.counts.resolved || 0} note="Nicely done, team" tone="green" />
          </div>

          <section className="work-section">
            <div className="section-heading"><div><div className="section-title-row"><h2>{filters.view === "mine" ? "Your work" : "Work overview"}</h2><span className="count-pill">{filteredCount}</span></div><p>Keep the next important thing moving.</p></div><button className="text-action" onClick={() => { setFilters({ q: "", status: "all", priority: "all", view: "all" }); }}>View all work <ArrowUpRight size={14} /></button></div>
            <div className="filter-bar">
              <div className="search-box"><Search size={16} /><input ref={searchInput} placeholder="Search work items…" value={filters.q} onChange={(event) => setFilters((old) => ({ ...old, q: event.target.value }))} /><kbd>{searchShortcut}</kbd></div>
              <div className="filter-select"><ListFilter size={15} /><select value={filters.status} onChange={(event) => setFilters((old) => ({ ...old, status: event.target.value }))}><option value="all">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}</select><ChevronDown size={13} /></div>
              <div className="filter-select priority-filter"><Filter size={14} /><select value={filters.priority} onChange={(event) => setFilters((old) => ({ ...old, priority: event.target.value }))}><option value="all">All priorities</option>{priorities.map((priority) => <option key={priority} value={priority}>{titleCase(priority)}</option>)}</select><ChevronDown size={13} /></div>
              <button className="icon-button more-filter" title="More filters"><MoreHorizontal size={18} /></button>
            </div>
            {error && <div className="inline-error"><AlertCircle size={16} />{error}<button onClick={() => loadItems()}>Retry</button></div>}
            <div className="work-table">
              <div className="table-header"><span>WORK ITEM</span><span>STATUS</span><span>PRIORITY</span><span>ASSIGNEE</span><span>DUE DATE</span><span /></div>
              {loading && items.length === 0 ? <div className="empty-state"><div className="loading-spinner" /><span>Finding your team's work…</span></div> : items.length === 0 ? <div className="empty-state"><div className="empty-icon"><Inbox size={21} /></div><strong>{filters.q || filters.status !== "all" ? "No work matches those filters" : "A clear desk to start with"}</strong><span>{filters.q || filters.status !== "all" ? "Try widening your search, or clear a filter." : "Create a work item to give your team a clear next step."}</span>{!filters.q && filters.status === "all" && <button className="button secondary" onClick={() => setCreateOpen(true)}><Plus size={15} />Create your first item</button>}</div> : items.map((item) => <WorkRow key={item.id} item={item} onClick={() => showItem(item.id)} />)}
            </div>
            <div className="table-footer"><span>{items.length ? `Showing ${items.length} work item${items.length === 1 ? "" : "s"}` : "Your work, always up to date"}</span><div className="pagination">{cursor && <button onClick={() => { setCursor(null); loadItems(); }}><ChevronLeft size={15} /> First page</button>}<button disabled={!nextCursor || loading} onClick={() => loadItems(nextCursor)}>Load more <ChevronRight size={15} /></button></div></div>
          </section>
          <div className="bottom-note"><div><Sparkles size={15} /><span>One clear next step is better than a hundred messages.</span></div><button onClick={() => setInviteOpen(true)}><Users size={14} />Invite your team</button></div>
        </section>
      </main>
      {selected && <ItemDrawer key={selected.item.id} data={selected} user={user} team={team} onClose={() => setSelected(null)} onUpdate={updateItem} onComment={addComment} onConflict={async () => { await showItem(selected.item.id); setToast("This item changed elsewhere. The latest version is loaded."); }} />}
      {createOpen && <CreateModal onClose={() => setCreateOpen(false)} onSubmit={createItem} />}
      {inviteOpen && <Modal title="Bring your team together" onClose={() => setInviteOpen(false)}><p className="modal-copy">Join another workspace with the invite code shared by a team owner.</p><form onSubmit={joinTeam}><label>Team invite code<input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="Paste invite code" required /></label><button className="button primary full">Join workspace<ArrowUpRight size={16} /></button></form><div className="invite-note"><ShieldCheck size={15} />You’ll join as a team member with standard access.</div></Modal>}
      {toast && <div className="toast"><Check size={15} />{toast}<button className="icon-button" onClick={() => setToast("")}><X size={14} /></button></div>}
    </div>
  );
}

function MetricCard({ icon, label, value, note, tone }) {
  return <div className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><span className="metric-label">{label}</span><div className="metric-value">{value}</div><span className="metric-note">{note}</span><ArrowUpRight className="metric-arrow" size={14} /></div>;
}

function WorkRow({ item, onClick }) {
  return (
    <button className="work-row" onClick={onClick}>
      <div className="work-item-main"><span className={`type-mark ${item.type}`}><FileText size={15} /></span><span className="work-title-block"><strong>{item.title}</strong><span>{titleCase(item.type)} <i>·</i> Updated {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(item.updatedAt))}</span></span></div>
      <div><span className={`status-pill ${item.status}`}><span />{titleCase(item.status)}</span></div>
      <div><span className={`priority-label ${item.priority}`}><span className="priority-icon">{item.priority === "urgent" ? <Zap size={12} /> : item.priority === "high" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}</span>{titleCase(item.priority)}</span></div>
      <div className="assignee-cell">{item.assignee ? <><span className="person-avatar mini">{initials(item.assignee.name)}</span><span>{item.assignee.name.split(" ")[0]}</span></> : <span className="unassigned">Unassigned</span>}</div>
      <div className={`due-date ${item.dueAt && new Date(item.dueAt) < new Date() && item.status !== "resolved" ? "overdue" : ""}`}>{item.dueAt && new Date(item.dueAt) < new Date() && item.status !== "resolved" && <AlertCircle size={13} />}{dateLabel(item.dueAt)}</div>
      <div className="row-more"><ChevronRight size={15} /></div>
    </button>
  );
}

function ItemDrawer({ data, user, team, onClose, onUpdate, onComment, onConflict }) {
  const [item, setItem] = useState(data.item);
  const [activities, setActivities] = useState(data.activities);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawerError, setDrawerError] = useState("");
  const [members, setMembers] = useState([]);
  const [editing, setEditing] = useState(false);
  const isOwner = item.assignee?.id === user.id;
  const canAssign = team.role === "owner" || team.role === "admin";
  useEffect(() => { api(`/teams/${team.id}/members`).then((result) => setMembers(result.members)).catch((error) => setDrawerError(error.message)); }, [team.id]);
  async function change(patch) {
    setBusy(true);
    setDrawerError("");
    try {
      const updated = await onUpdate(item.id, patch, item.version);
      setItem(updated);
      const refreshed = await api(`/teams/${team.id}/items/${item.id}`);
      setActivities(refreshed.activities);
    } catch (error) {
      if (error.status === 409) {
        setDrawerError(error.message);
        await onConflict();
        const latest = await api(`/teams/${team.id}/items/${item.id}`);
        setItem(latest.item);
        setActivities(latest.activities);
      } else setDrawerError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function submitComment(event) {
    event.preventDefault();
    if (!comment.trim()) return;
    setBusy(true);
    setDrawerError("");
    try {
      await onComment(item.id, comment.trim());
      const refreshed = await api(`/teams/${team.id}/items/${item.id}`);
      setActivities(refreshed.activities);
      setComment("");
    } catch (error) {
      setDrawerError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function claim() {
    setBusy(true);
    setDrawerError("");
    try {
      const result = await api(`/teams/${team.id}/items/${item.id}/claim`, { method: "POST" });
      setItem(result.item);
      setActivities((await api(`/teams/${team.id}/items/${item.id}`)).activities);
    } catch (error) {
      setDrawerError(error.message);
      if (error.status === 409) {
        const latest = await api(`/teams/${team.id}/items/${item.id}`);
        setItem(latest.item);
      }
    } finally {
      setBusy(false);
    }
  }
  async function submitEdit(form) {
    const fields = new FormData(form);
    await change({ title: fields.get("title"), description: fields.get("description"), priority: fields.get("priority"), dueAt: fields.get("dueAt") ? new Date(`${fields.get("dueAt")}T12:00:00`).toISOString() : null });
    setEditing(false);
  }
  const dateInput = item.dueAt ? new Date(item.dueAt).toISOString().slice(0, 10) : "";
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="item-drawer">
        <div className="drawer-top"><div className="drawer-breadcrumb"><span>Work items</span><ChevronRight size={13} /><span>{titleCase(item.type)}</span></div><div className="drawer-top-actions"><button className="icon-button" title="More actions"><MoreHorizontal size={18} /></button><button className="icon-button" onClick={onClose} title="Close"><X size={18} /></button></div></div>
        <div className="drawer-scroll">
          <div className="item-kicker"><span className={`type-mark ${item.type}`}><FileText size={15} /></span><span>WORK ITEM</span><span className="item-id">#{item.id.slice(-6).toUpperCase()}</span></div>
          {editing ? <form className="edit-form" onSubmit={(event) => { event.preventDefault(); submitEdit(event.currentTarget); }}><input name="title" defaultValue={item.title} maxLength="160" required /><label>Description<textarea name="description" defaultValue={item.description} rows="5" maxLength="10000" /></label><div className="form-grid"><label>Priority<select name="priority" defaultValue={item.priority}>{priorities.map((priority) => <option key={priority} value={priority}>{titleCase(priority)}</option>)}</select></label><label>Due date<input type="date" name="dueAt" defaultValue={dateInput} /></label></div><div className="edit-actions"><button type="button" className="button secondary" onClick={() => setEditing(false)}>Cancel</button><button className="button primary" disabled={busy}>Save changes</button></div></form> : <><h2 className="drawer-title">{item.title}</h2><p className="drawer-description">{item.description || "No description added yet."}</p></>}
          {drawerError && <div className="inline-error drawer-error"><AlertCircle size={15} /><span>{drawerError}</span>{drawerError.includes("changed") && <button onClick={async () => { const result = await api(`/teams/${team.id}/items/${item.id}`); setItem(result.item); setActivities(result.activities); setDrawerError(""); }}>Refresh</button>}</div>}
          <div className="drawer-actions"><button className="button secondary" onClick={() => setEditing((value) => !value)}><Settings2 size={15} />{editing ? "Close editor" : "Edit details"}</button>{!item.assignee && <button className="button claim-button" disabled={busy} onClick={claim}><UserRound size={15} />Take ownership</button>}</div>

          <div className="detail-grid">
            <div className="detail-field"><span>STATUS</span><select value={item.status} disabled={busy} onChange={(event) => change({ status: event.target.value })}>{statuses.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}</select></div>
            <div className="detail-field"><span>PRIORITY</span><select value={item.priority} disabled={busy || editing} onChange={(event) => change({ priority: event.target.value })}>{priorities.map((priority) => <option key={priority} value={priority}>{titleCase(priority)}</option>)}</select></div>
            <div className="detail-field"><span>ASSIGNEE</span><select value={item.assignee?.id || ""} disabled={busy || (!canAssign && !isOwner)} onChange={(event) => change({ assignee: event.target.value || null })}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}{member.id === user.id ? " (you)" : ""}</option>)}</select>{!canAssign && <small>Only team admins can assign others.</small>}</div>
            <div className="detail-field"><span>CREATED BY</span><div className="detail-person"><span className="person-avatar mini">{initials(item.createdBy?.name)}</span>{item.createdBy?.name || "Unknown"}</div></div>
            <div className="detail-field"><span>DUE DATE</span><div className="detail-date"><Clock3 size={14} />{dateLabel(item.dueAt)}</div></div>
            <div className="detail-field"><span>LAST UPDATED</span><div className="detail-date">{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(item.updatedAt))}</div></div>
          </div>

          <section className="activity-section"><div className="activity-heading"><div><Activity size={16} /><h3>Activity</h3></div><span>{activities.length} events</span></div>
            <form className="comment-box" onSubmit={submitComment}><div className="person-avatar mini">{initials(user.name)}</div><input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a comment or share an update…" maxLength="2000" /><button disabled={busy || !comment.trim()} title="Post comment"><ArrowUpRight size={16} /></button></form>
            <div className="activity-timeline">{activities.map((activity) => <div className="activity-entry" key={activity.id}><div className={`activity-avatar ${activity.kind}`}><Activity size={13} /></div><div className="activity-copy"><p><strong>{activity.actor?.name || "A teammate"}</strong> {activity.message}</p>{Object.entries(activity.changes || {}).map(([key, value]) => <span className="activity-change" key={key}>{titleCase(key)}: {typeof value === "object" && value !== null ? dateLabel(value) : value === null ? "Unassigned" : titleCase(String(value))}</span>)}<span className="activity-time">{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(activity.createdAt))}</span></div></div>)}</div>
          </section>
        </div>
        <div className="drawer-footer"><span><ShieldCheck size={14} />Changes are recorded in the activity history.</span><button className="icon-button" title="Share"><ArrowUpRight size={16} /></button></div>
      </aside>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal-card"><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose}><X size={17} /></button></div>{children}</section></div>;
}

function CreateModal({ onClose, onSubmit }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef(crypto.randomUUID());
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(event.currentTarget, idempotencyKey.current);
    } catch (problem) {
      setError(problem.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Create a work item" onClose={onClose}>
      <p className="modal-copy">Give your team the context and a clear next step.</p>
      <form className="create-form" onSubmit={submit}>
        <label>Title<input name="title" placeholder="What needs to get done?" required maxLength="160" autoFocus /></label>
        <label>Description<textarea name="description" placeholder="Add context, impact, or what a good outcome looks like…" rows="4" maxLength="10000" /></label>
        <div className="form-grid">
          <label>Work type<select name="type" defaultValue="operations">{types.map((type) => <option key={type} value={type}>{titleCase(type)}</option>)}</select></label>
          <label>Priority<select name="priority" defaultValue="normal">{priorities.map((priority) => <option key={priority} value={priority}>{titleCase(priority)}</option>)}</select></label>
        </div>
        <label>Due date<input type="date" name="dueAt" /></label>
        {error && <div className="form-error"><AlertCircle size={16} />{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="button primary" disabled={busy}><Plus size={15} />{busy ? "Creating…" : "Create item"}</button>
        </div>
      </form>
    </Modal>
  );
}

export default App;
