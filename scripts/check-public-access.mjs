// Proves what a stranger holding the website's public key can do to memos.
// Never prints row contents, never changes a row: every write targets an id
// that does not exist, so even an open table is left as it was.
//   node --env-file=.env.local scripts/check-public-access.mjs
const clean = (v) => (v ?? "").trim().replace(/^"|"$/g, "").replace(/\\n/g, "").trim();
const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/$/, "");
const anon = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const service = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
if (!url || !anon || !service) { console.error("missing env"); process.exit(2); }

const NOBODY = "00000000-0000-0000-0000-000000000000";
const call = async (path, key, init = {}) => {
  const res = await fetch(url + path, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, range: res.headers.get("content-range"), body };
};
let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`); };
const denied = (s) => s === 401 || s === 403;

for (const t of ["memos", "job_runs"]) {
  const r = await call(`/rest/v1/${t}?select=id&limit=1`, anon);
  check(`stranger cannot read ${t}`, denied(r.status), `status ${r.status}`);
  const d = await call(`/rest/v1/${t}?id=eq.${NOBODY}`, anon, { method: "DELETE" });
  check(`stranger cannot delete from ${t}`, denied(d.status), `status ${d.status}`);
  const p = await call(`/rest/v1/${t}?id=eq.${NOBODY}`, anon, { method: "PATCH", body: JSON.stringify({ created_at: "2000-01-01" }) });
  check(`stranger cannot edit ${t}`, denied(p.status), `status ${p.status}`);
  const s = await call(`/rest/v1/${t}?select=id&limit=1`, service, { headers: { Prefer: "count=exact" } });
  const n = Number(s.range?.split("/")[1] ?? 0);
  check(`server can still read ${t}`, s.status < 300 && n > 0, `${n} rows`);
}
const list = { method: "POST", body: JSON.stringify({ prefix: "audio", limit: 1 }) };
const la = await call("/storage/v1/object/list/voice-memos", anon, list);
check("stranger cannot list audio", denied(la.status) || (Array.isArray(la.body) && la.body.length === 0), `status ${la.status}, ${Array.isArray(la.body) ? la.body.length : "-"} files`);
const ls = await call("/storage/v1/object/list/voice-memos", service, list);
check("server can still list audio", Array.isArray(ls.body) && ls.body.length > 0, `status ${ls.status}`);
const hb = await call("/rest/v1/rpc/heartbeat_job_run", anon, { method: "POST", body: JSON.stringify({ p_job_id: NOBODY }) });
check("stranger cannot call worker functions", denied(hb.status) || hb.status === 404, `status ${hb.status}`);
// The route real recordings take: server signs, browser uploads with the public key.
const path = `audio/access-check-${Date.now()}.webm`;
const sign = await call(`/storage/v1/object/upload/sign/voice-memos/${path}`, service, { method: "POST", headers: { "x-upsert": "true" }, body: "{}" });
const up = sign.body?.url ? await call(`/storage/v1${sign.body.url}`, anon, { method: "PUT", headers: { "Content-Type": "audio/webm", "x-upsert": "true" }, body: "check" }) : { status: `sign ${sign.status}` };
check("signed upload still works", up.status === 200, `status ${up.status}`);
const pub = await fetch(`${url}/storage/v1/object/public/voice-memos/${path}`);
check("playback by direct link still works", pub.status === 200, `status ${pub.status}`);
await call("/storage/v1/object/voice-memos", service, { method: "DELETE", body: JSON.stringify({ prefixes: [path] }) });
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
