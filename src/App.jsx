import { useState, useEffect, useRef } from "react";

// ─── ΡΥΘΜΙΣΕΙΣ ────────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = "573756131713-rb70c45jv26tntqqfi5l34ji554kvlij.apps.googleusercontent.com";
const DRIVE_FOLDER_NAME = "MediVault";
const YOUR_NAME = "Μιχάλης Σαλαχώρης";
const RECORDS_FILENAME = "records.json";
const DOCTORS_FILENAME = "doctors.json";
// ─────────────────────────────────────────────────────────────────────────────

const SCOPES = "https://www.googleapis.com/auth/drive.file";

const CATS = {
  lab:          { label: "Αιματολογικές",  color: "#e05c7a", bg: "rgba(224,92,122,0.12)" },
  imaging:      { label: "Απεικονιστικές", color: "#3b9eff", bg: "rgba(59,158,255,0.12)" },
  report:       { label: "Γνωματεύσεις",   color: "#2ecc9a", bg: "rgba(46,204,154,0.12)" },
  prescription: { label: "Συνταγές",       color: "#f5a623", bg: "rgba(245,166,35,0.12)" },
  other:        { label: "Άλλο",           color: "#9b59b6", bg: "rgba(155,89,182,0.12)" },
};
const getCat  = (id) => CATS[id] || CATS.other;
const fmtSize = (b) => !b ? "" : b > 1e6 ? (b/1e6).toFixed(1)+" MB" : Math.round(b/1024)+" KB";
const fmtDate = (d, o) => new Date(d).toLocaleDateString("el-GR", o || { day:"numeric", month:"short", year:"numeric" });

// ─── GOOGLE AUTH ──────────────────────────────────────────────────────────────
let _token = null;

function loadGsi() {
  return new Promise(res => {
    if (window.google?.accounts) { res(); return; }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = res;
    document.head.appendChild(s);
  });
}

async function getToken() {
  await loadGsi();
  return new Promise((res, rej) => {
    if (_token) { res(_token); return; }
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: (r) => {
        if (r.error) { rej(r.error); return; }
        _token = r.access_token;
        setTimeout(() => { _token = null; }, (r.expires_in - 60) * 1000);
        res(_token);
      },
    });
    tc.requestAccessToken({ prompt: "" });
  });
}

// ─── DRIVE API ────────────────────────────────────────────────────────────────
async function getFolderId(token) {
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const d = await r.json();
  if (d.files?.length) return d.files[0].id;
  const c = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  return (await c.json()).id;
}

async function readJsonFile(token, folderId, filename) {
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${filename}' and '${folderId}' in parents and trashed=false&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const d = await r.json();
  if (!d.files?.length) return null;
  const fileId = d.files[0].id;
  const content = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return { data: await content.json(), fileId };
}

async function writeJsonFile(token, folderId, filename, data, existingFileId) {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const form = new FormData();
  if (existingFileId) {
    form.append("metadata", new Blob([JSON.stringify({ name: filename })], { type: "application/json" }));
    form.append("file", blob);
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    return existingFileId;
  }
  form.append("metadata", new Blob([JSON.stringify({ name: filename, parents: [folderId] })], { type: "application/json" }));
  form.append("file", blob);
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return (await r.json()).id;
}

async function uploadFile(token, folderId, file) {
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({ name: file.name, parents: [folderId] })], { type: "application/json" }));
  form.append("file", file);
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,size", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return await r.json();
}

function openMailto(toEmail, subject, body) {
  window.open(`mailto:${toEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank");
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const css = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700&family=Manrope:wght@400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0c0e12;--s1:#141720;--s2:#1b1f2b;--s3:#222738;
  --b:rgba(255,255,255,0.06);--b2:rgba(255,255,255,0.11);
  --tx:#dde1ec;--mu:#636b82;--ac:#3b9eff;--gr:#2ecc9a;--rd:#e05c7a;
  --fh:'Syne',sans-serif;--fb:'Manrope',sans-serif;--r:12px;--rs:8px;
}
body{background:var(--bg);color:var(--tx);font-family:var(--fb);-webkit-font-smoothing:antialiased}
.app{max-width:480px;margin:0 auto;min-height:100vh;background:var(--bg);padding-bottom:72px}
.hdr{padding:16px 18px 10px;background:var(--bg);position:sticky;top:0;z-index:20;border-bottom:1px solid var(--b)}
.hdr-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.logo{font-family:var(--fh);font-size:20px;font-weight:700;letter-spacing:-0.3px}
.logo em{color:var(--ac);font-style:normal}
.sw{position:relative}
.sw svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--mu);pointer-events:none}
.si{width:100%;background:var(--s1);border:1px solid var(--b);border-radius:var(--rs);padding:9px 12px 9px 36px;color:var(--tx);font-family:var(--fb);font-size:13px;outline:none;transition:border-color .2s}
.si:focus{border-color:var(--ac)}.si::placeholder{color:var(--mu)}
.sbar{display:flex;align-items:center;justify-content:space-between;padding:8px 18px;background:rgba(59,158,255,0.06);border-bottom:1px solid rgba(59,158,255,0.15)}
.sinfo{font-size:13px;font-weight:500;color:var(--ac)}
.sacts{display:flex;gap:8px}
.bg{background:none;border:1px solid var(--b2);color:var(--mu);padding:5px 12px;border-radius:20px;font-size:12px;font-family:var(--fb);cursor:pointer;transition:all .2s}
.bg:hover{border-color:var(--ac);color:var(--ac)}
.bsend{background:var(--ac);border:none;color:#fff;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;font-family:var(--fb);cursor:pointer;display:flex;align-items:center;gap:5px}
.bsend:disabled{opacity:.5;cursor:not-allowed}
.con{padding:14px 18px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px}
.stat{background:var(--s1);border:1px solid var(--b);border-radius:var(--r);padding:12px 10px;text-align:center}
.stat .v{font-family:var(--fh);font-size:24px;font-weight:700}
.stat .l{font-size:10px;color:var(--mu);margin-top:2px;text-transform:uppercase;letter-spacing:.5px}
.sh{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.st{font-size:11px;font-weight:600;color:var(--mu);text-transform:uppercase;letter-spacing:.8px}
.rc{background:var(--s1);border:1px solid var(--b);border-radius:var(--r);padding:13px;margin-bottom:8px;cursor:pointer;transition:border-color .2s,transform .15s;animation:fu .25s ease both}
.rc:hover{border-color:var(--b2);transform:translateY(-1px)}
.rc.sel{border-color:var(--ac);background:rgba(59,158,255,0.05)}
@keyframes fu{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.rt{display:flex;align-items:flex-start;gap:10px}
.rck{width:20px;height:20px;border-radius:50%;border:1.5px solid var(--b2);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;transition:all .2s}
.rc.sel .rck{background:var(--ac);border-color:var(--ac)}
.ri{width:38px;height:38px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.rn{flex:1;min-width:0}
.rtl{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px}
.rm{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.rd{font-size:11px;color:var(--mu)}
.cp{font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;text-transform:uppercase;letter-spacing:.3px}
.rf{font-size:11px;color:var(--mu);margin-top:5px;display:flex;align-items:center;gap:4px}
.rnote{font-size:12px;color:var(--mu);margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dl{font-size:11px;color:var(--ac);margin-top:4px;display:flex;align-items:center;gap:4px;text-decoration:none}
.dl:hover{text-decoration:underline}
.fab{position:fixed;bottom:22px;right:calc(50% - 220px);background:var(--gr);border:none;color:#fff;width:52px;height:52px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(46,204,154,.4);transition:transform .2s;z-index:100}
.fab:hover{transform:scale(1.06)}
.bnav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:var(--s1);border-top:1px solid var(--b);display:flex;z-index:50;padding:6px 0 10px}
.nb{flex:1;background:none;border:none;color:var(--mu);cursor:pointer;font-size:10px;font-family:var(--fb);font-weight:500;display:flex;flex-direction:column;align-items:center;gap:3px;padding:4px 0;transition:color .2s;text-transform:uppercase;letter-spacing:.4px}
.nb.active{color:var(--ac)}.nb.sm.active{color:var(--gr)}
.ov{position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(6px);z-index:200;display:flex;align-items:flex-end;justify-content:center}
.mo{background:var(--s1);border-radius:20px 20px 0 0;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;padding:22px 18px 32px;animation:su .3s cubic-bezier(.34,1.56,.64,1)}
@keyframes su{from{transform:translateY(100%)}to{transform:translateY(0)}}
.mh2{width:32px;height:3px;background:var(--b2);border-radius:2px;margin:0 auto 18px}
.mhdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
.mtl{font-family:var(--fh);font-size:20px;font-weight:700}
.mcl{background:var(--s2);border:none;color:var(--mu);width:30px;height:30px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center}
.fg{margin-bottom:16px}
.fl{display:block;font-size:12px;font-weight:500;color:var(--mu);margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px}
.fi,.fta{width:100%;background:var(--s2);border:1px solid var(--b);border-radius:var(--rs);padding:10px 13px;color:var(--tx);font-family:var(--fb);font-size:13px;outline:none;transition:border-color .2s}
.fi:focus,.fta:focus{border-color:var(--ac)}.fta{resize:vertical;min-height:70px}
.cgr{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.cb{padding:9px 10px;border-radius:var(--rs);font-size:12px;font-family:var(--fb);cursor:pointer;transition:all .2s;text-align:center}
.uz{border:2px dashed var(--b2);border-radius:var(--r);padding:20px;text-align:center;cursor:pointer;color:var(--mu);transition:all .2s;font-size:13px}
.uz:hover{border-color:var(--ac);color:var(--ac)}.uz p{margin-top:6px}.uz small{font-size:11px;opacity:.6}
.fps{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.fp{display:flex;align-items:center;gap:5px;background:var(--s2);border:1px solid var(--b);border-radius:20px;padding:3px 9px 3px 7px;font-size:11px}
.fp button{background:none;border:none;color:var(--mu);cursor:pointer;line-height:1;padding:0}
.dc{background:var(--s2);border:1px solid var(--b);border-radius:var(--rs);padding:10px 13px;cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:10px;margin-bottom:6px}
.dc:hover,.dc.dsel{border-color:var(--ac)}.dc.dsel{background:rgba(59,158,255,.07)}
.dav{width:36px;height:36px;border-radius:50%;background:rgba(59,158,255,.15);display:flex;align-items:center;justify-content:center;font-size:14px;font-family:var(--fh);font-weight:700;color:var(--ac);flex-shrink:0}
.di{flex:1;min-width:0}.dn{font-size:13px;font-weight:600}.ds{font-size:11px;color:var(--mu)}.de{font-size:11px;color:var(--mu);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ss{background:var(--s2);border:1px solid var(--b);border-radius:var(--r);padding:14px;margin-bottom:16px}
.btn{width:100%;padding:13px;border-radius:var(--rs);border:none;font-family:var(--fb);font-size:14px;font-weight:600;cursor:pointer;transition:opacity .2s,transform .15s}
.btn:hover:not(:disabled){opacity:.9;transform:translateY(-1px)}.btn:disabled{opacity:.45;cursor:not-allowed}
.btp{background:var(--ac);color:#fff;margin-top:6px}.btg{background:var(--gr);color:#fff;margin-top:6px}
.prog{background:var(--s2);border:1px solid var(--b);border-radius:var(--r);padding:14px;margin-bottom:12px}
.plab{font-size:12px;color:var(--mu);margin-bottom:8px}
.pbw{background:var(--s3);border-radius:4px;height:6px;overflow:hidden}
.pb{background:var(--gr);height:6px;border-radius:4px;transition:width .3s}
.pst{font-size:11px;color:var(--gr);margin-top:6px}
.toast{position:fixed;bottom:88px;left:50%;transform:translateX(-50%);background:var(--s2);border:1px solid var(--b2);border-radius:var(--r);padding:10px 16px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:8px;z-index:300;white-space:nowrap;box-shadow:0 8px 32px rgba(0,0,0,.4);animation:ti .3s ease,to2 .3s ease 2.7s forwards}
@keyframes ti{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
@keyframes to2{from{opacity:1}to{opacity:0}}
.toast.ok{border-color:rgba(46,204,154,.3);color:var(--gr)}.toast.err{border-color:rgba(224,92,122,.3);color:var(--rd)}
.empty{text-align:center;padding:40px 20px;color:var(--mu)}.empty p{font-size:13px;margin-top:8px;line-height:1.6}
.gbadge{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--gr);background:rgba(46,204,154,.1);border:1px solid rgba(46,204,154,.2);padding:4px 10px;border-radius:20px;cursor:pointer;background:none}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:var(--b2);border-radius:2px}
`;

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
    link:   <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
    sync:   <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>,
  };
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p[n]}</svg>;
};

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function MediVault() {
  const [records, setRecords]       = useState([]);
  const [doctors, setDoctors]       = useState([]);
  const [view, setView]             = useState("records");
  const [search, setSearch]         = useState("");
  const [selected, setSelected]     = useState(new Set());
  const [showAdd, setShowAdd]       = useState(false);
  const [showSend, setShowSend]     = useState(false);
  const [showAddDoc, setShowAddDoc] = useState(false);
  const [toast, setToast]           = useState(null);
  const [loggedIn, setLoggedIn]     = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const driveIds = useRef({ folderId:null, recordsFileId:null, doctorsFileId:null });

  const showToast = (msg, type="ok") => {
    setToast({ msg, type, id:Date.now() });
    setTimeout(() => setToast(null), 3100);
  };

  const syncFromDrive = async () => {
    setSyncing(true);
    try {
      const token = await getToken();
      setLoggedIn(true);
      const folderId = await getFolderId(token);
      driveIds.current.folderId = folderId;

      const recRes = await readJsonFile(token, folderId, RECORDS_FILENAME);
      if (recRes) { setRecords(recRes.data); driveIds.current.recordsFileId = recRes.fileId; }

      const docRes = await readJsonFile(token, folderId, DOCTORS_FILENAME);
      if (docRes) { setDoctors(docRes.data); driveIds.current.doctorsFileId = docRes.fileId; }

      showToast("✓ Συγχρονίστηκε με Drive");
    } catch(e) {
      showToast("Σφάλμα σύνδεσης", "err");
    }
    setSyncing(false);
  };

  const saveRecs = async (data) => {
    try {
      const token = await getToken();
      const fid = driveIds.current.folderId || await getFolderId(token);
      driveIds.current.folderId = fid;
      const id = await writeJsonFile(token, fid, RECORDS_FILENAME, data, driveIds.current.recordsFileId);
      driveIds.current.recordsFileId = id;
    } catch(e) { showToast("Σφάλμα αποθήκευσης","err"); }
  };

  const saveDocs = async (data) => {
    try {
      const token = await getToken();
      const fid = driveIds.current.folderId || await getFolderId(token);
      driveIds.current.folderId = fid;
      const id = await writeJsonFile(token, fid, DOCTORS_FILENAME, data, driveIds.current.doctorsFileId);
      driveIds.current.doctorsFileId = id;
    } catch(e) { showToast("Σφάλμα αποθήκευσης","err"); }
  };

  const addRecord = async (rec) => {
    const updated = [rec, ...records];
    setRecords(updated);
    await saveRecs(updated);
  };

  const addDoctor = async (doc) => {
    const updated = [...doctors, doc];
    setDoctors(updated);
    await saveDocs(updated);
  };

  const deleteDoctor = async (id) => {
    const updated = doctors.filter(d=>d.id!==id);
    setDoctors(updated);
    await saveDocs(updated);
  };

  const filtered = records.filter(r =>
    !search ||
    r.title.toLowerCase().includes(search.toLowerCase()) ||
    (r.doctor||"").toLowerCase().includes(search.toLowerCase())
  );

  const toggleSelect = (id) => setSelected(prev => {
    const n = new Set(prev); n.has(id)?n.delete(id):n.add(id); return n;
  });

  const selectedRecords = records.filter(r=>selected.has(r.id));

  return (
    <>
      <style>{css}</style>
      <div className="app">

        <div className="hdr">
          <div className="hdr-row">
            <div className="logo">Medi<em>Vault</em></div>
            {loggedIn
              ? <button className="gbadge" onClick={syncFromDrive} style={{border:"1px solid rgba(46,204,154,.2)",padding:"4px 10px",borderRadius:20,background:"rgba(46,204,154,.1)",cursor:"pointer"}}>
                  <Ico n="sync" s={12}/> {syncing ? "Συγχρονισμός…" : "Sync"}
                </button>
              : <button className="bsend" style={{fontSize:12,padding:"6px 12px"}} onClick={syncFromDrive}>
                  Σύνδεση Google
                </button>
            }
          </div>
          {view==="records" && <div className="sw"><Ico n="search" s={15}/><input className="si" placeholder="Αναζήτηση…" value={search} onChange={e=>setSearch(e.target.value)}/></div>}
        </div>

        {selected.size>0 && view==="send" && (
          <div className="sbar">
            <span className="sinfo">{selected.size} εξετάσεις</span>
            <div className="sacts">
              <button className="bg" onClick={()=>setSelected(new Set())}>Καθαρισμός</button>
              <button className="bsend" onClick={()=>setShowSend(true)}><Ico n="send" s={12}/> Αποστολή</button>
            </div>
          </div>
        )}

        {view==="records" && (
          <div className="con">
            <div className="stats">
              <div className="stat"><div className="v">{records.length}</div><div className="l">Εξετάσεις</div></div>
              <div className="stat"><div className="v">{records.reduce((s,r)=>s+(r.files?.length||0),0)}</div><div className="l">Αρχεία</div></div>
              <div className="stat"><div className="v" style={{fontSize:16}}>{records[0]?.date?fmtDate(records[0].date,{day:"numeric",month:"short"}):"—"}</div><div className="l">Τελευταία</div></div>
            </div>
            <div className="sh"><span className="st">Εξετάσεις</span><span style={{fontSize:12,color:"var(--mu)"}}>{filtered.length} αποτελέσματα</span></div>
            {!loggedIn && <div className="empty"><Ico n="sync" s={40}/><p>Πάτα "Σύνδεση Google"<br/>για να φορτώσεις τις εξετάσεις σου.</p></div>}
            {loggedIn && filtered.length===0 && <div className="empty"><Ico n="file" s={40}/><p>Δεν υπάρχουν εξετάσεις.<br/>Πάτα + για να προσθέσεις.</p></div>}
            {filtered.map((r,i)=>{
              const cat=getCat(r.category);
              return (
                <div key={r.id} className="rc" style={{animationDelay:`${i*.04}s`}}>
                  <div className="rt">
                    <div className="ri" style={{background:cat.bg,color:cat.color}}><Ico n={r.category==="imaging"?"img":"file"} s={16}/></div>
                    <div className="rn">
                      <div className="rtl">{r.title}</div>
                      <div className="rm"><span className="rd">{fmtDate(r.date)}</span><span className="cp" style={{background:cat.bg,color:cat.color}}>{cat.label}</span></div>
                    </div>
                  </div>
                  {r.doctor&&<div className="rf"><Ico n="user" s={11}/> {r.doctor}</div>}
                  {r.files?.map((f,fi)=>f.webViewLink
                    ?<a key={fi} className="dl" href={f.webViewLink} target="_blank" rel="noreferrer"><Ico n="link" s={11}/> {f.name} {f.size?`· ${fmtSize(f.size)}`:""}</a>
                    :<div key={fi} className="rf"><Ico n="file" s={11}/> {f.name}</div>
                  )}
                  {r.notes&&<div className="rnote">{r.notes}</div>}
                </div>
              );
            })}
          </div>
        )}

        {view==="send" && (
          <div className="con">
            <p style={{fontSize:13,color:"var(--mu)",lineHeight:1.6,marginBottom:16}}>Επέλεξε εξετάσεις για αποστολή.</p>
            <div className="sh">
              <span className="st">Επιλογή</span>
              {records.length>0&&<button className="bg" style={{fontSize:11}} onClick={()=>setSelected(selected.size===records.length?new Set():new Set(records.map(r=>r.id)))}>{selected.size===records.length?"Αποεπιλογή":"Επιλογή όλων"}</button>}
            </div>
            {records.map((r,i)=>{
              const cat=getCat(r.category); const isSel=selected.has(r.id);
              return (
                <div key={r.id} className={`rc${isSel?" sel":""}`} style={{animationDelay:`${i*.04}s`}} onClick={()=>toggleSelect(r.id)}>
                  <div className="rt">
                    <div className="rck">{isSel&&<Ico n="check" s={12}/>}</div>
                    <div className="ri" style={{background:cat.bg,color:cat.color}}><Ico n={r.category==="imaging"?"img":"file"} s={16}/></div>
                    <div className="rn">
                      <div className="rtl">{r.title}</div>
                      <div className="rm"><span className="rd">{fmtDate(r.date)}</span><span className="cp" style={{background:cat.bg,color:cat.color}}>{cat.label}</span></div>
                    </div>
                  </div>
                  {r.files?.length>0&&<div className="rf" style={{paddingLeft:30}}><Ico n="file" s={11}/>{r.files.map(f=>f.name).join(" · ")}</div>}
                </div>
              );
            })}
          </div>
        )}

        {view==="doctors" && (
          <div className="con" style={{paddingTop:20}}>
            <div className="sh"><span className="st">Γιατροί</span><button className="bg" style={{fontSize:11}} onClick={()=>setShowAddDoc(true)}>+ Προσθήκη</button></div>
            {doctors.length===0&&<div className="empty"><Ico n="user" s={40}/><p>Πρόσθεσε γιατρούς για γρήγορη αποστολή.</p></div>}
            {doctors.map(d=>(
              <div key={d.id} className="dc" style={{cursor:"default"}}>
                <div className="dav">{d.name.split(" ").pop()[0]}</div>
                <div className="di"><div className="dn">{d.name}</div><div className="ds">{d.specialty}</div><div className="de">{d.email}</div></div>
                <button style={{background:"none",border:"none",color:"var(--mu)",cursor:"pointer"}} onClick={()=>deleteDoctor(d.id)}><Ico n="trash" s={15}/></button>
              </div>
            ))}
          </div>
        )}

        {view==="records"&&<button className="fab" onClick={()=>{if(!loggedIn){syncFromDrive();return;}setShowAdd(true);}}><Ico n="plus" s={22}/></button>}

        <div className="bnav">
          <button className={`nb${view==="records"?" active":""}`} onClick={()=>{setView("records");setSelected(new Set());}}><Ico n="file" s={20}/> Εξετάσεις</button>
          <button className={`nb sm${view==="send"?" active":""}`} onClick={()=>setView("send")}><Ico n="mail" s={20}/> Αποστολή</button>
          <button className={`nb${view==="doctors"?" active":""}`} onClick={()=>setView("doctors")}><Ico n="user" s={20}/> Γιατροί</button>
        </div>

        {showAdd&&<AddModal onAdd={async r=>{await addRecord(r);setShowAdd(false);showToast("✓ Αποθηκεύτηκε στο Drive");}} onClose={()=>setShowAdd(false)} showToast={showToast} driveIds={driveIds}/>}
        {showAddDoc&&<AddDoctorModal onAdd={async d=>{await addDoctor(d);setShowAddDoc(false);showToast("✓ Γιατρός αποθηκεύτηκε");}} onClose={()=>setShowAddDoc(false)}/>}
        {showSend&&<SendModal records={selectedRecords} doctors={doctors} onSend={(doctor,note)=>{
          const lines=selectedRecords.flatMap(r=>(r.files||[]).filter(f=>f.webViewLink).map(f=>`• ${f.name}: ${f.webViewLink}  (${r.title}, ${fmtDate(r.date)})`));
          const subject=`Ιατρικές Εξετάσεις — ${selectedRecords.map(r=>r.title).join(", ")}`;
          const body=[`Γεια σας ${doctor.name},`,``,`Σας αποστέλλω τις παρακάτω ιατρικές εξετάσεις:`,``,...lines,``,note||"",``,`Με εκτίμηση,`,YOUR_NAME].filter((l,i,a)=>!(l===""&&a[i-1]==="")).join("\n");
          openMailto(doctor.email,subject,body);
          setShowSend(false);setSelected(new Set());setView("records");
          showToast("✓ Το Gmail άνοιξε έτοιμο");
        }} onClose={()=>setShowSend(false)}/>}

        {toast&&<div key={toast.id} className={`toast ${toast.type}`}>{toast.msg}</div>}
      </div>
    </>
  );
}

function AddModal({onAdd,onClose,showToast,driveIds}) {
  const [title,setTitle]=useState("");
  const [date,setDate]=useState(new Date().toISOString().split("T")[0]);
  const [cat,setCat]=useState("lab");
  const [doctor,setDoctor]=useState("");
  const [notes,setNotes]=useState("");
  const [files,setFiles]=useState([]);
  const [uploading,setUploading]=useState(false);
  const [prog,setProg]=useState({step:"",pct:0});
  const fileRef=useRef();

  const handleSave=async()=>{
    if(!title.trim())return;
    setUploading(true);
    let uploaded=[];
    try{
      if(files.length>0){
        setProg({step:"Σύνδεση με Google Drive…",pct:10});
        const token=await getToken();
        const fid=driveIds.current.folderId||await getFolderId(token);
        driveIds.current.folderId=fid;
        for(let i=0;i<files.length;i++){
          setProg({step:`Ανέβασμα: ${files[i].name}`,pct:30+Math.round((i/files.length)*60)});
          const res=await uploadFile(token,fid,files[i]);
          uploaded.push({name:res.name||files[i].name,size:parseInt(res.size||files[i].size),type:files[i].type,driveId:res.id,webViewLink:res.webViewLink});
        }
        setProg({step:"Ολοκληρώθηκε!",pct:100});
      }
      await onAdd({id:Date.now(),title:title.trim(),date,category:cat,doctor:doctor.trim(),notes:notes.trim(),files:uploaded,createdAt:new Date().toISOString()});
    }catch(e){setUploading(false);showToast("Σφάλμα ανεβάσματος","err");}
  };

  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&!uploading&&onClose()}>
      <div className="mo">
        <div className="mh2"/>
        <div className="mhdr"><div className="mtl">Νέα Εξέταση</div>{!uploading&&<button className="mcl" onClick={onClose}><Ico n="close" s={14}/></button>}</div>
        {uploading?(
          <div className="prog">
            <div className="plab">Ανέβασμα στο Google Drive…</div>
            <div className="pbw"><div className="pb" style={{width:`${prog.pct}%`}}/></div>
            <div className="pst">{prog.step}</div>
          </div>
        ):(<>
          <div className="fg"><label className="fl">Τίτλος *</label><input className="fi" placeholder="π.χ. Αιματολογικές Μαρτίου" value={title} onChange={e=>setTitle(e.target.value)}/></div>
          <div className="fg"><label className="fl">Κατηγορία</label>
            <div className="cgr">{Object.entries(CATS).map(([id,c])=>(
              <button key={id} className="cb" onClick={()=>setCat(id)} style={{border:`1px solid ${cat===id?c.color:"var(--b)"}`,background:cat===id?c.bg:"transparent",color:cat===id?c.color:"var(--mu)"}}>{c.label}</button>
            ))}</div>
          </div>
          <div className="fg"><label className="fl">Ημερομηνία</label><input className="fi" type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
          <div className="fg"><label className="fl">Γιατρός / Εργαστήριο</label><input className="fi" placeholder="π.χ. Δρ. Παπαδόπουλος" value={doctor} onChange={e=>setDoctor(e.target.value)}/></div>
          <div className="fg"><label className="fl">Σημειώσεις</label><textarea className="fta" placeholder="Παρατηρήσεις…" value={notes} onChange={e=>setNotes(e.target.value)}/></div>
          <div className="fg">
            <label className="fl">Αρχεία</label>
            <div className="uz" onClick={()=>fileRef.current?.click()}><Ico n="upload" s={24}/><p>Κλίκ για επιλογή</p><small>PDF · JPG · PNG</small>
              <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" style={{display:"none"}} onChange={e=>setFiles(Array.from(e.target.files))}/>
            </div>
            {files.length>0&&<div className="fps">{files.map((f,i)=><div key={i} className="fp"><Ico n={f.type?.includes("pdf")?"file":"img"} s={11}/>{f.name.length>22?f.name.slice(0,20)+"…":f.name}<button onClick={()=>setFiles(p=>p.filter((_,j)=>j!==i))}><Ico n="close" s={10}/></button></div>)}</div>}
          </div>
          <button className="btn btp" disabled={!title.trim()} onClick={handleSave}>{files.length>0?"Αποθήκευση & Ανέβασμα στο Drive":"Αποθήκευση"}</button>
        </>)}
      </div>
    </div>
  );
}

function SendModal({records,doctors,onSend,onClose}) {
  const [selDoc,setSelDoc]=useState(doctors[0]?.id||null);
  const [note,setNote]=useState("");
  const [custom,setCustom]=useState("");
  const [useCustom,setUseCustom]=useState(doctors.length===0);
  const doctor=doctors.find(d=>d.id===selDoc);
  const hasLinks=records.some(r=>r.files?.some(f=>f.webViewLink));
  const canSend=useCustom?custom.includes("@"):!!doctor;
  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="mo">
        <div className="mh2"/>
        <div className="mhdr"><div className="mtl">Αποστολή</div><button className="mcl" onClick={onClose}><Ico n="close" s={14}/></button></div>
        <div className="ss">
          <div style={{fontSize:12,color:"var(--mu)",marginBottom:10,textTransform:"uppercase",letterSpacing:".4px"}}>Θα σταλούν σύνδεσμοι για</div>
          {records.map(r=>{const cat=getCat(r.category);return(
            <div key={r.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <div style={{width:28,height:28,borderRadius:6,background:cat.bg,color:cat.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ico n={r.category==="imaging"?"img":"file"} s={13}/></div>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600}}>{r.title}</div><div style={{fontSize:11,color:"var(--mu)"}}>{fmtDate(r.date)} · {r.files?.filter(f=>f.webViewLink).length||0} σύνδεσμοι</div></div>
            </div>
          );})}
          {!hasLinks&&<div style={{fontSize:12,color:"var(--rd)",marginTop:8,padding:"8px",background:"rgba(224,92,122,.08)",borderRadius:6}}>⚠️ Δεν βρέθηκαν αρχεία στο Drive.</div>}
        </div>
        <div className="fg">
          <label className="fl">Αποστολή σε</label>
          {!useCustom&&doctors.length>0&&(<>
            {doctors.map(d=>(
              <div key={d.id} className={`dc${selDoc===d.id?" dsel":""}`} onClick={()=>setSelDoc(d.id)}>
                <div className="dav">{d.name.split(" ").pop()[0]}</div>
                <div className="di"><div className="dn">{d.name}</div><div className="ds">{d.specialty}</div><div className="de">{d.email}</div></div>
                {selDoc===d.id&&<span style={{color:"var(--ac)"}}><Ico n="check" s={16}/></span>}
              </div>
            ))}
            <button className="bg" style={{width:"100%",marginTop:4}} onClick={()=>setUseCustom(true)}>+ Άλλο email</button>
          </>)}
          {(useCustom||doctors.length===0)&&(<>
            <input className="fi" type="email" placeholder="email@doctor.gr" value={custom} onChange={e=>setCustom(e.target.value)}/>
            {doctors.length>0&&<button className="bg" style={{marginTop:6,width:"100%"}} onClick={()=>setUseCustom(false)}>← Επιστροφή</button>}
          </>)}
        </div>
        <div className="fg"><label className="fl">Σημείωση (προαιρετικό)</label><textarea className="fta" placeholder="π.χ. Για επανέλεγχο χοληστερίνης…" value={note} onChange={e=>setNote(e.target.value)} style={{minHeight:60}}/></div>
        <button className="btn btg" disabled={!canSend} onClick={()=>onSend(useCustom?{name:"Γιατρός",email:custom}:doctor,note)}>Άνοιγμα Gmail με έτοιμο email →</button>
      </div>
    </div>
  );
}

function AddDoctorModal({onAdd,onClose}) {
  const [name,setName]=useState("");
  const [spec,setSpec]=useState("");
  const [email,setEmail]=useState("");
  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="mo">
        <div className="mh2"/>
        <div className="mhdr"><div className="mtl">Νέος Γιατρός</div><button className="mcl" onClick={onClose}><Ico n="close" s={14}/></button></div>
        <div className="fg"><label className="fl">Όνομα *</label><input className="fi" placeholder="Δρ. Παπαδόπουλος" value={name} onChange={e=>setName(e.target.value)}/></div>
        <div className="fg"><label className="fl">Ειδικότητα</label><input className="fi" placeholder="Καρδιολόγος" value={spec} onChange={e=>setSpec(e.target.value)}/></div>
        <div className="fg"><label className="fl">Email *</label><input className="fi" type="email" placeholder="doctor@email.gr" value={email} onChange={e=>setEmail(e.target.value)}/></div>
        <button className="btn btp" disabled={!name.trim()||!email.includes("@")} onClick={()=>onAdd({id:Date.now(),name:name.trim(),specialty:spec.trim(),email:email.trim()})}>Αποθήκευση</button>
      </div>
    </div>
  );
}
