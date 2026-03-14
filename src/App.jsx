import { useState, useEffect, useRef, useCallback } from "react";

// ─── ΡΥΘΜΙΣΕΙΣ — ΑΛΛΑΞΕ ΜΟΝΟ ΑΥΤΑ ──────────────────────────────────────────
const GOOGLE_CLIENT_ID = "573756131713-rb70c45jv26tntqqfi5l34ji554kvlij.apps.googleusercontent.com"; 
const DRIVE_FOLDER_NAME = "MediVault";
const YOUR_NAME = "Μιχάλης Σαλαχώρης";
// ─────────────────────────────────────────────────────────────────────────────

const SCOPES = "https://www.googleapis.com/auth/drive.file";
const RECORDS_KEY = "medivault_records_v3";
const DOCTORS_KEY = "medivault_doctors_v3";

const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch { return fallback; }
};
const save = (key, val) => localStorage.setItem(key, JSON.stringify(val));

// ─── ΚΑΤΗΓΟΡΙΕΣ ───────────────────────────────────────────────────────────────
const CATS = {
  lab:          { label: "Αιματολογικές",  color: "#e05c7a", bg: "rgba(224,92,122,0.12)" },
  imaging:      { label: "Απεικονιστικές", color: "#3b9eff", bg: "rgba(59,158,255,0.12)" },
  report:       { label: "Γνωματεύσεις",   color: "#2ecc9a", bg: "rgba(46,204,154,0.12)" },
  prescription: { label: "Συνταγές",       color: "#f5a623", bg: "rgba(245,166,35,0.12)" },
  other:        { label: "Άλλο",           color: "#9b59b6", bg: "rgba(155,89,182,0.12)" },
};
const getCat = (id) => CATS[id] || CATS.other;
const fmtSize = (b) => !b ? "" : b > 1e6 ? (b/1e6).toFixed(1)+" MB" : Math.round(b/1024)+" KB";
const fmtDate = (d, opts) => new Date(d).toLocaleDateString("el-GR", opts || { day:"numeric", month:"short", year:"numeric" });

// ─── GOOGLE IDENTITY SERVICES ─────────────────────────────────────────────────
let tokenClient = null;
let accessToken = null;

function loadGoogleScript() {
  return new Promise((resolve) => {
    if (window.google?.accounts) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = resolve;
    document.head.appendChild(s);
  });
}

async function getAccessToken() {
  await loadGoogleScript();
  return new Promise((resolve, reject) => {
    if (accessToken) { resolve(accessToken); return; }
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) { reject(resp.error); return; }
        accessToken = resp.access_token;
        setTimeout(() => { accessToken = null; }, (resp.expires_in - 60) * 1000);
        resolve(accessToken);
      },
    });
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

// ─── DRIVE HELPERS ────────────────────────────────────────────────────────────
async function getDriveFolderId(token) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (data.files?.length > 0) return data.files[0].id;

  // Δημιουργία φακέλου αν δεν υπάρχει
  const create = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  const folder = await create.json();
  return folder.id;
}

async function uploadFileToDrive(token, folderId, file) {
  const meta = { name: file.name, parents: [folderId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  form.append("file", file);

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,size", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return await res.json();
}

// Ανοίγει το Gmail του χρήστη με έτοιμο email — χωρίς API, χωρίς άδειες
function openMailto(toEmail, subject, bodyText) {
  const url = `mailto:${toEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
  window.open(url, "_blank");
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const css = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700&family=Manrope:wght@300;400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0c0e12;--s1:#141720;--s2:#1b1f2b;--s3:#222738;
  --border:rgba(255,255,255,0.06);--border2:rgba(255,255,255,0.11);
  --text:#dde1ec;--muted:#636b82;--accent:#3b9eff;--green:#2ecc9a;--red:#e05c7a;
  --font-h:'Syne',sans-serif;--font-b:'Manrope',sans-serif;--r:12px;--rs:8px;
}
body{background:var(--bg);color:var(--text);font-family:var(--font-b);-webkit-font-smoothing:antialiased}
.app{max-width:480px;margin:0 auto;min-height:100vh;background:var(--bg);padding-bottom:72px;position:relative}
.hdr{padding:18px 18px 10px;background:var(--bg);position:sticky;top:0;z-index:20;border-bottom:1px solid var(--border)}
.hdr-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.logo{font-family:var(--font-h);font-size:20px;font-weight:700;letter-spacing:-0.3px}
.logo em{color:var(--accent);font-style:normal}
.search-wrap{position:relative}
.search-wrap svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}
.search{width:100%;background:var(--s1);border:1px solid var(--border);border-radius:var(--rs);padding:9px 12px 9px 36px;color:var(--text);font-family:var(--font-b);font-size:13px;outline:none;transition:border-color .2s}
.search:focus{border-color:var(--accent)}
.search::placeholder{color:var(--muted)}
.select-bar{display:flex;align-items:center;justify-content:space-between;padding:8px 18px;background:rgba(59,158,255,0.06);border-bottom:1px solid rgba(59,158,255,0.15)}
.select-info{font-size:13px;font-weight:500;color:var(--accent)}
.select-actions{display:flex;gap:8px}
.btn-ghost{background:none;border:1px solid var(--border2);color:var(--muted);padding:5px 12px;border-radius:20px;font-size:12px;font-family:var(--font-b);cursor:pointer;transition:all .2s}
.btn-ghost:hover{border-color:var(--accent);color:var(--accent)}
.btn-send{background:var(--accent);border:none;color:#fff;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;font-family:var(--font-b);cursor:pointer;display:flex;align-items:center;gap:5px;transition:all .2s}
.btn-send:hover{opacity:.9}
.btn-send:disabled{opacity:.5;cursor:not-allowed}
.content{padding:14px 18px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px}
.stat{background:var(--s1);border:1px solid var(--border);border-radius:var(--r);padding:12px 10px;text-align:center}
.stat .v{font-family:var(--font-h);font-size:24px;font-weight:700}
.stat .l{font-size:10px;color:var(--muted);margin-top:2px;text-transform:uppercase;letter-spacing:.5px}
.sec-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.sec-title{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.8px}
.rcard{background:var(--s1);border:1px solid var(--border);border-radius:var(--r);padding:13px;margin-bottom:8px;cursor:pointer;transition:border-color .2s,transform .15s;position:relative;animation:fadeUp .25s ease both}
.rcard:hover{border-color:var(--border2);transform:translateY(-1px)}
.rcard.selected{border-color:var(--accent);background:rgba(59,158,255,0.05)}
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.rcard-top{display:flex;align-items:flex-start;gap:10px}
.rcard-check{width:20px;height:20px;border-radius:50%;border:1.5px solid var(--border2);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;transition:all .2s}
.rcard.selected .rcard-check{background:var(--accent);border-color:var(--accent)}
.rcard-icon{width:38px;height:38px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.rcard-info{flex:1;min-width:0}
.rcard-title{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px}
.rcard-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.rcard-date{font-size:11px;color:var(--muted)}
.cat-pill{font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;text-transform:uppercase;letter-spacing:.3px}
.rcard-files{font-size:11px;color:var(--muted);margin-top:5px;display:flex;align-items:center;gap:4px}
.rcard-note{font-size:12px;color:var(--muted);margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drive-link{font-size:11px;color:var(--accent);margin-top:4px;display:flex;align-items:center;gap:4px;text-decoration:none}
.drive-link:hover{text-decoration:underline}
.fab{position:fixed;bottom:22px;right:calc(50% - 220px);background:var(--green);border:none;color:#fff;width:52px;height:52px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(46,204,154,.4);transition:transform .2s;z-index:100}
.fab:hover{transform:scale(1.06)}
.bnav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:var(--s1);border-top:1px solid var(--border);display:flex;z-index:50;padding:6px 0 10px}
.nav-btn{flex:1;background:none;border:none;color:var(--muted);cursor:pointer;font-size:10px;font-family:var(--font-b);font-weight:500;display:flex;flex-direction:column;align-items:center;gap:3px;padding:4px 0;transition:color .2s;text-transform:uppercase;letter-spacing:.4px}
.nav-btn.active{color:var(--accent)}
.nav-btn.send-mode.active{color:var(--green)}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(6px);z-index:200;display:flex;align-items:flex-end;justify-content:center}
.modal{background:var(--s1);border-radius:20px 20px 0 0;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;padding:22px 18px 32px;animation:slideU .3s cubic-bezier(.34,1.56,.64,1)}
@keyframes slideU{from{transform:translateY(100%)}to{transform:translateY(0)}}
.modal-handle{width:32px;height:3px;background:var(--border2);border-radius:2px;margin:0 auto 18px}
.modal-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
.modal-title{font-family:var(--font-h);font-size:20px;font-weight:700}
.modal-close{background:var(--s2);border:none;color:var(--muted);width:30px;height:30px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center}
.fg{margin-bottom:16px}
.fl{display:block;font-size:12px;font-weight:500;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px}
.fi,.fta{width:100%;background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);padding:10px 13px;color:var(--text);font-family:var(--font-b);font-size:13px;outline:none;transition:border-color .2s}
.fi:focus,.fta:focus{border-color:var(--accent)}
.fta{resize:vertical;min-height:70px}
.cat-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.cat-btn{padding:9px 10px;border-radius:var(--rs);font-size:12px;font-family:var(--font-b);cursor:pointer;transition:all .2s;text-align:center}
.upload-zone{border:2px dashed var(--border2);border-radius:var(--r);padding:20px;text-align:center;cursor:pointer;color:var(--muted);transition:all .2s;font-size:13px}
.upload-zone:hover{border-color:var(--accent);color:var(--accent)}
.upload-zone p{margin-top:6px}
.upload-zone small{font-size:11px;opacity:.6}
.file-pills{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.fpill{display:flex;align-items:center;gap:5px;background:var(--s2);border:1px solid var(--border);border-radius:20px;padding:3px 9px 3px 7px;font-size:11px}
.fpill button{background:none;border:none;color:var(--muted);cursor:pointer;line-height:1;padding:0}
.doc-card{background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);padding:10px 13px;cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:10px;margin-bottom:6px}
.doc-card:hover,.doc-card.sel{border-color:var(--accent)}
.doc-card.sel{background:rgba(59,158,255,.07)}
.doc-avatar{width:36px;height:36px;border-radius:50%;background:rgba(59,158,255,.15);display:flex;align-items:center;justify-content:center;font-size:14px;font-family:var(--font-h);font-weight:700;color:var(--accent);flex-shrink:0}
.doc-info{flex:1;min-width:0}
.doc-name{font-size:13px;font-weight:600}
.doc-spec{font-size:11px;color:var(--muted)}
.doc-email{font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.send-summary{background:var(--s2);border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:16px}
.btn{width:100%;padding:13px;border-radius:var(--rs);border:none;font-family:var(--font-b);font-size:14px;font-weight:600;cursor:pointer;transition:opacity .2s,transform .15s}
.btn:hover:not(:disabled){opacity:.9;transform:translateY(-1px)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-primary{background:var(--accent);color:#fff;margin-top:6px}
.btn-green{background:var(--green);color:#fff;margin-top:6px}
.btn-danger{background:transparent;border:1px solid var(--red);color:var(--red);margin-top:8px}
.progress{background:var(--s2);border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:12px}
.progress-label{font-size:12px;color:var(--muted);margin-bottom:8px}
.progress-bar-wrap{background:var(--s3);border-radius:4px;height:6px;overflow:hidden}
.progress-bar{background:var(--green);height:6px;border-radius:4px;transition:width .3s}
.progress-step{font-size:11px;color:var(--green);margin-top:6px}
.toast{position:fixed;bottom:88px;left:50%;transform:translateX(-50%);background:var(--s2);border:1px solid var(--border2);border-radius:var(--r);padding:10px 16px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:8px;z-index:300;white-space:nowrap;box-shadow:0 8px 32px rgba(0,0,0,.4);animation:toastIn .3s ease,toastOut .3s ease 2.7s forwards}
@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
@keyframes toastOut{from{opacity:1}to{opacity:0}}
.toast.ok{border-color:rgba(46,204,154,.3);color:var(--green)}
.toast.err{border-color:rgba(224,92,122,.3);color:var(--red)}
.empty{text-align:center;padding:40px 20px;color:var(--muted)}
.empty p{font-size:13px;margin-top:8px;line-height:1.6}
.google-badge{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--green);background:rgba(46,204,154,.1);border:1px solid rgba(46,204,154,.2);padding:4px 10px;border-radius:20px}
::-webkit-scrollbar{width:3px}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
`;

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Ico = ({ n, s = 18 }) => {
  const p = {
    file:   <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
    img:    <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,
    mail:   <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,
    plus:   <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    close:  <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    send:   <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
    check:  <><polyline points="20 6 9 17 4 12"/></>,
    trash:  <><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></>,
    user:   <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    upload: <><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></>,
    drive:  <><path d="M12 2L2 19h20L12 2z"/><path d="M2 19l10-6 10 6"/><path d="M12 13V2"/></>,
    link:   <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
  };
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {p[n]}
    </svg>
  );
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function MediVault() {
  const [records, setRecords]     = useState(() => load(RECORDS_KEY, []));
  const [doctors, setDoctors]     = useState(() => load(DOCTORS_KEY, []));
  const [view, setView]           = useState("records");
  const [search, setSearch]       = useState("");
  const [selected, setSelected]   = useState(new Set());
  const [showAdd, setShowAdd]     = useState(false);
  const [showSend, setShowSend]   = useState(false);
  const [showAddDoc, setShowAddDoc] = useState(false);
  const [toast, setToast]         = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(!!accessToken);

  useEffect(() => save(RECORDS_KEY, records), [records]);
  useEffect(() => save(DOCTORS_KEY, doctors), [doctors]);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type, id: Date.now() });
    setTimeout(() => setToast(null), 3100);
  };

  const handleLogin = async () => {
    try {
      await getAccessToken();
      setIsLoggedIn(true);
      showToast("✓ Συνδέθηκες με Google", "ok");
    } catch (e) {
      showToast("Σφάλμα σύνδεσης Google", "err");
    }
  };

  const filtered = records.filter(r =>
    !search ||
    r.title.toLowerCase().includes(search.toLowerCase()) ||
    (r.doctor || "").toLowerCase().includes(search.toLowerCase())
  );

  const toggleSelect = (id) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const selectedRecords = records.filter(r => selected.has(r.id));
  const totalFiles = selectedRecords.reduce((s, r) => s + (r.files?.length || 0), 0);

  return (
    <>
      <style>{css}</style>
      <div className="app">

        {/* HEADER */}
        <div className="hdr">
          <div className="hdr-row">
            <div className="logo">Medi<em>Vault</em></div>
            {isLoggedIn
              ? <div className="google-badge"><Ico n="drive" s={12}/> Drive συνδεδεμένο</div>
              : <button className="btn-send" style={{fontSize:12,padding:"6px 12px"}} onClick={handleLogin}>
                  Σύνδεση Google
                </button>
            }
          </div>
          {view === "records" && (
            <div className="search-wrap">
              <Ico n="search" s={15}/>
              <input className="search" placeholder="Αναζήτηση εξέτασης, γιατρού…" value={search} onChange={e => setSearch(e.target.value)}/>
            </div>
          )}
        </div>

        {/* SELECTION BAR */}
        {selected.size > 0 && view === "send" && (
          <div className="select-bar">
            <span className="select-info">{selected.size} εξετάσεις · {totalFiles} αρχεία</span>
            <div className="select-actions">
              <button className="btn-ghost" onClick={() => setSelected(new Set())}>Καθαρισμός</button>
              <button className="btn-send" onClick={() => setShowSend(true)}>
                <Ico n="send" s={12}/> Αποστολή
              </button>
            </div>
          </div>
        )}

        {/* RECORDS VIEW */}
        {view === "records" && (
          <div className="content">
            <div className="stats">
              <div className="stat">
                <div className="v">{records.length}</div>
                <div className="l">Εξετάσεις</div>
              </div>
              <div className="stat">
                <div className="v">{records.reduce((s,r) => s+(r.files?.length||0), 0)}</div>
                <div className="l">Αρχεία</div>
              </div>
              <div className="stat">
                <div className="v" style={{fontSize:16}}>
                  {records[0]?.date ? fmtDate(records[0].date, {day:"numeric",month:"short"}) : "—"}
                </div>
                <div className="l">Τελευταία</div>
              </div>
            </div>

            <div className="sec-hdr">
              <span className="sec-title">Εξετάσεις</span>
              <span style={{fontSize:12,color:"var(--muted)"}}>{filtered.length} αποτελέσματα</span>
            </div>

            {filtered.length === 0 && (
              <div className="empty">
                <Ico n="file" s={40}/>
                <p>Δεν υπάρχουν εξετάσεις ακόμη.<br/>Πάτα + για να προσθέσεις.</p>
              </div>
            )}

            {filtered.map((r, i) => {
              const cat = getCat(r.category);
              return (
                <div key={r.id} className="rcard" style={{animationDelay:`${i*0.04}s`}}>
                  <div className="rcard-top">
                    <div className="rcard-icon" style={{background:cat.bg,color:cat.color}}>
                      <Ico n={r.category==="imaging"?"img":"file"} s={16}/>
                    </div>
                    <div className="rcard-info">
                      <div className="rcard-title">{r.title}</div>
                      <div className="rcard-meta">
                        <span className="rcard-date">{fmtDate(r.date)}</span>
                        <span className="cat-pill" style={{background:cat.bg,color:cat.color}}>{cat.label}</span>
                      </div>
                    </div>
                  </div>
                  {r.doctor && <div className="rcard-files"><Ico n="user" s={11}/> {r.doctor}</div>}
                  {r.files?.map((f, fi) => (
                    f.webViewLink
                      ? <a key={fi} className="drive-link" href={f.webViewLink} target="_blank" rel="noreferrer">
                          <Ico n="link" s={11}/> {f.name} {f.size ? `· ${fmtSize(f.size)}` : ""}
                        </a>
                      : <div key={fi} className="rcard-files"><Ico n="file" s={11}/> {f.name}</div>
                  ))}
                  {r.notes && <div className="rcard-note">{r.notes}</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* SEND VIEW */}
        {view === "send" && (
          <div className="content">
            <div style={{marginBottom:16}}>
              <p style={{fontSize:13,color:"var(--muted)",lineHeight:1.6}}>
                Επέλεξε εξετάσεις και πάτα "Αποστολή" για να σταλούν μέσω Gmail με συνδέσμους Drive.
              </p>
            </div>
            <div className="sec-hdr">
              <span className="sec-title">Επιλογή εξετάσεων</span>
              {records.length > 0 && (
                <button className="btn-ghost" style={{fontSize:11}} onClick={() => {
                  setSelected(selected.size === records.length ? new Set() : new Set(records.map(r=>r.id)));
                }}>
                  {selected.size === records.length ? "Αποεπιλογή όλων" : "Επιλογή όλων"}
                </button>
              )}
            </div>

            {records.length === 0 && (
              <div className="empty"><p>Δεν υπάρχουν εξετάσεις ακόμη.</p></div>
            )}

            {records.map((r, i) => {
              const cat = getCat(r.category);
              const isSel = selected.has(r.id);
              return (
                <div key={r.id} className={`rcard${isSel?" selected":""}`} style={{animationDelay:`${i*0.04}s`}} onClick={() => toggleSelect(r.id)}>
                  <div className="rcard-top">
                    <div className="rcard-check">{isSel && <Ico n="check" s={12}/>}</div>
                    <div className="rcard-icon" style={{background:cat.bg,color:cat.color}}>
                      <Ico n={r.category==="imaging"?"img":"file"} s={16}/>
                    </div>
                    <div className="rcard-info">
                      <div className="rcard-title">{r.title}</div>
                      <div className="rcard-meta">
                        <span className="rcard-date">{fmtDate(r.date)}</span>
                        <span className="cat-pill" style={{background:cat.bg,color:cat.color}}>{cat.label}</span>
                      </div>
                    </div>
                  </div>
                  {r.files?.length > 0 && (
                    <div className="rcard-files" style={{paddingLeft:30}}>
                      <Ico n="file" s={11}/>
                      {r.files.map(f=>f.name).join(" · ")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* DOCTORS VIEW */}
        {view === "doctors" && (
          <div className="content" style={{paddingTop:20}}>
            <div className="sec-hdr">
              <span className="sec-title">Αποθηκευμένοι Γιατροί</span>
              <button className="btn-ghost" style={{fontSize:11}} onClick={() => setShowAddDoc(true)}>+ Προσθήκη</button>
            </div>
            {doctors.length === 0 && (
              <div className="empty"><Ico n="user" s={40}/><p>Πρόσθεσε γιατρούς για γρήγορη αποστολή.</p></div>
            )}
            {doctors.map(d => (
              <div key={d.id} className="doc-card" style={{cursor:"default"}}>
                <div className="doc-avatar">{d.name.split(" ").pop()[0]}</div>
                <div className="doc-info">
                  <div className="doc-name">{d.name}</div>
                  <div className="doc-spec">{d.specialty}</div>
                  <div className="doc-email">{d.email}</div>
                </div>
                <button style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer"}}
                  onClick={() => setDoctors(prev => prev.filter(x=>x.id!==d.id))}>
                  <Ico n="trash" s={15}/>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* FAB */}
        {view === "records" && (
          <button className="fab" onClick={() => {
            if (!isLoggedIn) { handleLogin(); return; }
            setShowAdd(true);
          }}>
            <Ico n="plus" s={22}/>
          </button>
        )}

        {/* BOTTOM NAV */}
        <div className="bnav">
          <button className={`nav-btn${view==="records"?" active":""}`} onClick={() => { setView("records"); setSelected(new Set()); }}>
            <Ico n="file" s={20}/> Εξετάσεις
          </button>
          <button className={`nav-btn send-mode${view==="send"?" active":""}`} onClick={() => setView("send")}>
            <Ico n="mail" s={20}/> Αποστολή
          </button>
          <button className={`nav-btn${view==="doctors"?" active":""}`} onClick={() => setView("doctors")}>
            <Ico n="user" s={20}/> Γιατροί
          </button>
        </div>

        {/* MODALS */}
        {showAdd && (
          <AddModal
            onAdd={r => { setRecords(p => [r,...p]); setShowAdd(false); showToast("✓ Εξέταση αποθηκεύτηκε στο Drive"); }}
            onClose={() => setShowAdd(false)}
            showToast={showToast}
          />
        )}
        {showAddDoc && (
          <AddDoctorModal
            onAdd={d => { setDoctors(p => [...p,d]); setShowAddDoc(false); showToast("✓ Γιατρός αποθηκεύτηκε"); }}
            onClose={() => setShowAddDoc(false)}
          />
        )}
        {showSend && (
          <SendModal
            records={selectedRecords}
            doctors={doctors}
            onSend={(doctor, note) => {
              const lines = selectedRecords.flatMap(r =>
                (r.files||[]).filter(f => f.webViewLink).map(f => `• ${f.name}: ${f.webViewLink}  (${r.title}, ${fmtDate(r.date)})`)
              );
              const subject = `Ιατρικές Εξετάσεις — ${selectedRecords.map(r=>r.title).join(", ")}`;
              const body = [
                `Γεια σας ${doctor.name},`,
                ``,
                `Σας αποστέλλω τις παρακάτω ιατρικές εξετάσεις μέσω Google Drive:`,
                ``,
                ...lines,
                ``,
                note ? note : "",
                ``,
                `Με εκτίμηση,`,
                YOUR_NAME,
              ].filter((l, i, arr) => !(l === "" && arr[i-1] === "")).join("\n");
              openMailto(doctor.email, subject, body);
              setShowSend(false);
              setSelected(new Set());
              setView("records");
              showToast("✓ Το Gmail άνοιξε έτοιμο για αποστολή");
            }}
            onClose={() => setShowSend(false)}
          />
        )}

        {toast && <div key={toast.id} className={`toast ${toast.type}`}>{toast.msg}</div>}
      </div>
    </>
  );
}

// ─── ADD RECORD MODAL ─────────────────────────────────────────────────────────
function AddModal({ onAdd, onClose, showToast }) {
  const [title, setTitle]   = useState("");
  const [date, setDate]     = useState(new Date().toISOString().split("T")[0]);
  const [cat, setCat]       = useState("lab");
  const [doctor, setDoctor] = useState("");
  const [notes, setNotes]   = useState("");
  const [files, setFiles]   = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState({ step: "", pct: 0 });
  const fileRef = useRef();

  const handleSave = async () => {
    if (!title.trim()) return;
    setUploading(true);

    let uploadedFiles = [];

    try {
      if (files.length > 0) {
        setProgress({ step: "Σύνδεση με Google Drive…", pct: 10 });
        const token = await getAccessToken();

        setProgress({ step: "Εύρεση φακέλου MediVault…", pct: 25 });
        const folderId = await getDriveFolderId(token);

        for (let i = 0; i < files.length; i++) {
          setProgress({ step: `Ανέβασμα: ${files[i].name}`, pct: 30 + Math.round((i / files.length) * 60) });
          const result = await uploadFileToDrive(token, folderId, files[i]);
          uploadedFiles.push({
            name: result.name || files[i].name,
            size: parseInt(result.size || files[i].size),
            type: files[i].type,
            driveId: result.id,
            webViewLink: result.webViewLink,
          });
        }
        setProgress({ step: "Ολοκληρώθηκε!", pct: 100 });
      }

      const record = {
        id: Date.now(),
        title: title.trim(),
        date,
        category: cat,
        doctor: doctor.trim(),
        notes: notes.trim(),
        files: uploadedFiles,
        createdAt: new Date().toISOString(),
      };

      setTimeout(() => {
        setUploading(false);
        onAdd(record);
      }, 500);

    } catch (e) {
      setUploading(false);
      showToast("Σφάλμα ανεβάσματος. Δοκίμασε ξανά.", "err");
    }
  };

  return (
    <div className="overlay" onClick={e => e.target===e.currentTarget && !uploading && onClose()}>
      <div className="modal">
        <div className="modal-handle"/>
        <div className="modal-hdr">
          <div className="modal-title">Νέα Εξέταση</div>
          {!uploading && <button className="modal-close" onClick={onClose}><Ico n="close" s={14}/></button>}
        </div>

        {uploading ? (
          <div className="progress">
            <div className="progress-label">Ανέβασμα στο Google Drive…</div>
            <div className="progress-bar-wrap">
              <div className="progress-bar" style={{width:`${progress.pct}%`}}/>
            </div>
            <div className="progress-step">{progress.step}</div>
          </div>
        ) : (
          <>
            <div className="fg">
              <label className="fl">Τίτλος *</label>
              <input className="fi" placeholder="π.χ. Αιματολογικές Μαρτίου" value={title} onChange={e => setTitle(e.target.value)}/>
            </div>

            <div className="fg">
              <label className="fl">Κατηγορία</label>
              <div className="cat-grid">
                {Object.entries(CATS).map(([id,c]) => (
                  <button key={id} className="cat-btn" onClick={() => setCat(id)} style={{
                    border:`1px solid ${cat===id?c.color:"var(--border)"}`,
                    background:cat===id?c.bg:"transparent",
                    color:cat===id?c.color:"var(--muted)",
                  }}>{c.label}</button>
                ))}
              </div>
            </div>

            <div className="fg">
              <label className="fl">Ημερομηνία</label>
              <input className="fi" type="date" value={date} onChange={e => setDate(e.target.value)}/>
            </div>

            <div className="fg">
              <label className="fl">Γιατρός / Εργαστήριο</label>
              <input className="fi" placeholder="π.χ. Δρ. Παπαδόπουλος" value={doctor} onChange={e => setDoctor(e.target.value)}/>
            </div>

            <div className="fg">
              <label className="fl">Σημειώσεις</label>
              <textarea className="fta" placeholder="Παρατηρήσεις γιατρού…" value={notes} onChange={e => setNotes(e.target.value)}/>
            </div>

            <div className="fg">
              <label className="fl">Αρχεία (PDF, εικόνες)</label>
              <div className="upload-zone" onClick={() => fileRef.current?.click()}>
                <Ico n="upload" s={24}/>
                <p>Κλίκ για επιλογή αρχείων</p>
                <small>PDF · JPG · PNG · DICOM</small>
                <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.dcm" style={{display:"none"}}
                  onChange={e => setFiles(Array.from(e.target.files))}/>
              </div>
              {files.length > 0 && (
                <div className="file-pills">
                  {files.map((f,i) => (
                    <div key={i} className="fpill">
                      <Ico n={f.type?.includes("pdf")?"file":"img"} s={11}/>
                      {f.name.length > 22 ? f.name.slice(0,20)+"…" : f.name}
                      <button onClick={() => setFiles(p => p.filter((_,j)=>j!==i))}><Ico n="close" s={10}/></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button className="btn btn-primary" disabled={!title.trim()} onClick={handleSave}>
              {files.length > 0 ? "Αποθήκευση & Ανέβασμα στο Drive" : "Αποθήκευση"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── SEND MODAL ───────────────────────────────────────────────────────────────
function SendModal({ records, doctors, onSend, onClose }) {
  const [selDoc, setSelDoc]       = useState(doctors[0]?.id || null);
  const [note, setNote]           = useState("");
  const [customEmail, setCustomEmail] = useState("");
  const [useCustom, setUseCustom] = useState(doctors.length === 0);
  const [sending, setSending]     = useState(false);

  const doctor = doctors.find(d => d.id === selDoc);
  const hasLinks = records.some(r => r.files?.some(f => f.webViewLink));
  const canSend  = (useCustom ? customEmail.includes("@") : !!doctor) && !sending;

  const handleSend = () => {
    const target = useCustom ? { name: "Γιατρός", email: customEmail } : doctor;
    onSend(target, note);
  };

  return (
    <div className="overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-handle"/>
        <div className="modal-hdr">
          <div className="modal-title">Αποστολή εξετάσεων</div>
          <button className="modal-close" onClick={onClose}><Ico n="close" s={14}/></button>
        </div>

        {/* Summary */}
        <div className="send-summary">
          <div style={{fontSize:12,color:"var(--muted)",marginBottom:10,textTransform:"uppercase",letterSpacing:".4px"}}>Θα σταλούν σύνδεσμοι Drive για</div>
          {records.map(r => {
            const cat = getCat(r.category);
            return (
              <div key={r.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <div style={{width:28,height:28,borderRadius:6,background:cat.bg,color:cat.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <Ico n={r.category==="imaging"?"img":"file"} s={13}/>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600}}>{r.title}</div>
                  <div style={{fontSize:11,color:"var(--muted)"}}>{fmtDate(r.date)} · {r.files?.filter(f=>f.webViewLink).length||0} σύνδεσμοι Drive</div>
                </div>
              </div>
            );
          })}
          {!hasLinks && (
            <div style={{fontSize:12,color:"var(--red)",marginTop:8,padding:"8px",background:"rgba(224,92,122,.08)",borderRadius:6}}>
              ⚠️ Δεν βρέθηκαν σύνδεσμοι Drive. Βεβαιώσου ότι τα αρχεία ανέβηκαν στο Drive.
            </div>
          )}
        </div>

        {/* Doctor selection */}
        <div className="fg">
          <label className="fl">Αποστολή σε</label>
          {!useCustom && doctors.length > 0 && (
            <>
              {doctors.map(d => (
                <div key={d.id} className={`doc-card${selDoc===d.id?" sel":""}`} onClick={() => setSelDoc(d.id)}>
                  <div className="doc-avatar">{d.name.split(" ").pop()[0]}</div>
                  <div className="doc-info">
                    <div className="doc-name">{d.name}</div>
                    <div className="doc-spec">{d.specialty}</div>
                    <div className="doc-email">{d.email}</div>
                  </div>
                  {selDoc===d.id && <span style={{color:"var(--accent)"}}><Ico n="check" s={16}/></span>}
                </div>
              ))}
              <button className="btn-ghost" style={{width:"100%",marginTop:4}} onClick={() => setUseCustom(true)}>
                + Άλλο email
              </button>
            </>
          )}
          {(useCustom || doctors.length === 0) && (
            <>
              <input className="fi" type="email" placeholder="email@doctor.gr" value={customEmail} onChange={e => setCustomEmail(e.target.value)}/>
              {doctors.length > 0 && (
                <button className="btn-ghost" style={{marginTop:6,width:"100%"}} onClick={() => setUseCustom(false)}>
                  ← Επιστροφή στη λίστα
                </button>
              )}
            </>
          )}
        </div>

        <div className="fg">
          <label className="fl">Σημείωση (προαιρετικό)</label>
          <textarea className="fta" placeholder="π.χ. Εξετάσεις για επανέλεγχο χοληστερίνης…" value={note} onChange={e => setNote(e.target.value)} style={{minHeight:60}}/>
        </div>

        <button className="btn btn-green" disabled={!canSend} onClick={handleSend}>
          "Άνοιγμα Gmail με έτοιμο email →"
        </button>
      </div>
    </div>
  );
}

// ─── ADD DOCTOR MODAL ─────────────────────────────────────────────────────────
function AddDoctorModal({ onAdd, onClose }) {
  const [name, setName]   = useState("");
  const [spec, setSpec]   = useState("");
  const [email, setEmail] = useState("");
  return (
    <div className="overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-handle"/>
        <div className="modal-hdr">
          <div className="modal-title">Νέος Γιατρός</div>
          <button className="modal-close" onClick={onClose}><Ico n="close" s={14}/></button>
        </div>
        <div className="fg">
          <label className="fl">Όνομα *</label>
          <input className="fi" placeholder="Δρ. Παπαδόπουλος" value={name} onChange={e => setName(e.target.value)}/>
        </div>
        <div className="fg">
          <label className="fl">Ειδικότητα</label>
          <input className="fi" placeholder="Καρδιολόγος" value={spec} onChange={e => setSpec(e.target.value)}/>
        </div>
        <div className="fg">
          <label className="fl">Email *</label>
          <input className="fi" type="email" placeholder="doctor@email.gr" value={email} onChange={e => setEmail(e.target.value)}/>
        </div>
        <button className="btn btn-primary" disabled={!name.trim() || !email.includes("@")}
          onClick={() => onAdd({ id:Date.now(), name:name.trim(), specialty:spec.trim(), email:email.trim() })}>
          Αποθήκευση
        </button>
      </div>
    </div>
  );
}
