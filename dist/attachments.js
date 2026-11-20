// Allegati dei task: da dove arriva il file (path locale, URL pubblico, link di caricamento nel browser)
// prima di finire in POST /tasks/{id}/attachments dell'API ProTask.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
/** Il validator di ProTask accetta file fino a 20480 KB: oltre è inutile caricarli in memoria. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_MB = MAX_ATTACHMENT_BYTES / 1024 / 1024;
const MIME_BY_EXT = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', heic: 'image/heic', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
    json: 'application/json', zip: 'application/zip', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg',
    doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
export function mimeFromName(name) {
    return MIME_BY_EXT[path.extname(name).slice(1).toLowerCase()] ?? 'application/octet-stream';
}
function extFromMime(type) {
    return Object.entries(MIME_BY_EXT).find(([, m]) => m === type)?.[0];
}
/** Nome di file pulito: niente cartelle, caratteri di controllo o nomi vuoti. */
export function safeFileName(raw) {
    const base = raw.split(/[\\/]/).pop() ?? '';
    const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
    return clean && clean !== '.' && clean !== '..' ? clean : 'allegato';
}
const tooBig = (bytes) => new Error(`il file pesa ${(bytes / 1024 / 1024).toFixed(1)} MB: ProTask accetta allegati fino a ${MAX_MB} MB`);
// ---------------------------------------------------------------------------
// Path locale (solo server stdio: il processo gira sul computer dell'utente)
// ---------------------------------------------------------------------------
// Un path suggerito al modello da testo altrui (prompt injection) non deve poter mandare su ProTask
// chiavi o segreti: si rifiutano file e cartelle nascosti (.ssh, .env, .aws, ...)
const hasHiddenSegment = (p) => p.split(path.sep).some((s) => s.startsWith('.') && s !== '.' && s !== '..');
export async function loadLocalFile(rawPath) {
    const expanded = rawPath.startsWith('~/') ? path.join(os.homedir(), rawPath.slice(2)) : rawPath;
    if (!path.isAbsolute(expanded)) {
        throw new Error(`file_path deve essere un percorso assoluto (es. /Users/nome/Desktop/screenshot.png), non "${rawPath}"`);
    }
    const hiddenMsg = 'per sicurezza non si caricano file nascosti o dentro cartelle nascoste (.ssh, .env, .config, ...)';
    if (hasHiddenSegment(path.resolve(expanded)))
        throw new Error(hiddenMsg);
    let real;
    try {
        real = await fs.realpath(expanded);
    }
    catch {
        throw new Error(`file non trovato: ${expanded}`);
    }
    if (hasHiddenSegment(real))
        throw new Error(hiddenMsg);
    const stat = await fs.stat(real);
    if (!stat.isFile())
        throw new Error(`non è un file: ${expanded}`);
    if (stat.size > MAX_ATTACHMENT_BYTES)
        throw tooBig(stat.size);
    const name = safeFileName(path.basename(real));
    return { data: await fs.readFile(real), name, type: mimeFromName(name) };
}
// ---------------------------------------------------------------------------
// URL pubblico: il server scarica il file. Difesa SSRF: solo http/https, solo indirizzi pubblici
// (controllati sull'IP a cui ci si collega davvero, così il DNS rebinding non passa), redirect
// ricontrollati, tetto di dimensione e di tempo.
// ---------------------------------------------------------------------------
const BLOCKED = new net.BlockList();
for (const [net4, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
    ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
])
    BLOCKED.addSubnet(net4, prefix, 'ipv4');
for (const [net6, prefix] of [
    ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['2002::', 16],
    ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
])
    BLOCKED.addSubnet(net6, prefix, 'ipv6');
/** true se l'indirizzo è raggiungibile su Internet (non loopback, rete privata, link-local, riservato...). */
export function isPublicAddress(ip) {
    const family = net.isIP(ip);
    if (family === 4)
        return !BLOCKED.check(ip, 'ipv4');
    if (family !== 6)
        return false;
    const lower = ip.toLowerCase();
    // IPv4 dentro IPv6 (::ffff:a.b.c.d): si giudica la parte IPv4; la forma esadecimale si rifiuta
    if (lower.startsWith('::ffff:')) {
        const v4 = lower.slice(7);
        return net.isIPv4(v4) && isPublicAddress(v4);
    }
    return !BLOCKED.check(ip, 'ipv6');
}
// lookup usato dal socket: risolve il nome e rifiuta se anche uno solo degli indirizzi non è ammesso
const checkedLookup = (allowed) => (hostname, options, cb) => {
    dns.lookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
        if (err)
            return cb(err, '');
        const bad = addresses.find((a) => !allowed(a.address));
        if (bad || addresses.length === 0) {
            return cb(Object.assign(new Error(`indirizzo non pubblico (${bad?.address ?? 'nessuno'}): non si scarica`), { code: 'EBLOCKED' }), '');
        }
        if (options.all)
            return cb(null, addresses);
        cb(null, addresses[0].address, addresses[0].family);
    });
};
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
function fileNameFromResponse(res, url) {
    const cd = res.headers['content-disposition'] ?? '';
    const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd);
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
    let name = '';
    try {
        name = star ? decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')) : plain ? plain[1].trim() : '';
        if (!name)
            name = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    }
    catch {
        name = url.pathname.split('/').pop() ?? '';
    }
    return safeFileName(name);
}
function getOnce(url, signal, allowed) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    // Con un IP letterale il socket non chiama lookup: si controlla qui
    if (net.isIP(host) && !allowed(host)) {
        return Promise.reject(new Error(`indirizzo non pubblico (${host}): non si scarica`));
    }
    const lib = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const req = lib.get(url, {
            lookup: checkedLookup(allowed),
            signal,
            headers: { 'User-Agent': 'protask-mcp-server', Accept: '*/*' },
        }, resolve);
        req.on('error', reject);
    });
}
/** `allowed` sostituisce il controllo degli indirizzi solo nei test (server locale su 127.0.0.1). */
export async function downloadFile(rawUrl, opts = {}) {
    const allowed = opts.allowed ?? isPublicAddress;
    let url;
    try {
        url = new URL(rawUrl);
    }
    catch {
        throw new Error(`url non valido: ${rawUrl}`);
    }
    const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    for (let hops = 0;; hops++) {
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error(`si scaricano solo indirizzi http o https, non ${url.protocol}`);
        }
        let res;
        try {
            res = await getOnce(url, signal, allowed);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(signal.aborted ? `download troppo lento (oltre ${DOWNLOAD_TIMEOUT_MS / 1000} s): ${url.href}` : `download non riuscito: ${msg}`);
        }
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (hops >= MAX_REDIRECTS)
                throw new Error('download non riuscito: troppi redirect');
            url = new URL(res.headers.location, url);
            continue;
        }
        if (status < 200 || status >= 300) {
            res.resume();
            throw new Error(`download non riuscito: HTTP ${status} da ${url.href}`);
        }
        const declared = Number(res.headers['content-length']);
        if (declared > MAX_ATTACHMENT_BYTES) {
            res.destroy();
            throw tooBig(declared);
        }
        const chunks = [];
        let size = 0;
        try {
            for await (const chunk of res) {
                size += chunk.length;
                if (size > MAX_ATTACHMENT_BYTES) {
                    res.destroy();
                    throw tooBig(size);
                }
                chunks.push(chunk);
            }
        }
        catch (e) {
            if (e instanceof Error && e.message.startsWith('il file pesa'))
                throw e;
            throw new Error(signal.aborted ? `download troppo lento (oltre ${DOWNLOAD_TIMEOUT_MS / 1000} s): ${url.href}` : 'download interrotto');
        }
        const headerType = (res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        let name = fileNameFromResponse(res, url);
        if (!path.extname(name)) {
            const ext = extFromMime(headerType);
            if (ext)
                name = `${name}.${ext}`;
        }
        const type = headerType && headerType !== 'application/octet-stream' ? headerType : mimeFromName(name);
        return { data: Buffer.concat(chunks), name, type };
    }
}
// ---------------------------------------------------------------------------
// Link di caricamento (solo server remoto): il tool crea un link con un codice casuale, l'utente apre
// la pagina, trascina o incolla i file, e il server li carica sul task con il token di chi ha chiesto il link
// ---------------------------------------------------------------------------
export const UPLOAD_LINK_TTL_MS = 15 * 60_000;
export const UPLOAD_LINK_MAX_FILES = 10;
const MAX_OPEN_LINKS = 500;
export class UploadLinkStore {
    now;
    links = new Map();
    constructor(now = Date.now) {
        this.now = now;
    }
    sweep() {
        const t = this.now();
        for (const [code, link] of this.links)
            if (link.expiresAt <= t)
                this.links.delete(code);
    }
    create(client, taskId, taskTitle) {
        this.sweep();
        if (this.links.size >= MAX_OPEN_LINKS)
            throw new Error('troppi link di caricamento aperti: riprova tra qualche minuto');
        const code = crypto.randomBytes(24).toString('base64url');
        const expiresAt = this.now() + UPLOAD_LINK_TTL_MS;
        this.links.set(code, { client, taskId, taskTitle, expiresAt, uploaded: 0 });
        return { code, expiresAt };
    }
    /** Il link se esiste, non è scaduto e ha ancora caricamenti a disposizione. */
    get(code) {
        const link = this.links.get(code);
        if (!link)
            return undefined;
        if (link.expiresAt <= this.now() || link.uploaded >= UPLOAD_LINK_MAX_FILES) {
            this.links.delete(code);
            return undefined;
        }
        return link;
    }
    revoke(code) {
        this.links.delete(code);
    }
}
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function uploadPageHeaders(nonce) {
    return {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; ` +
            "img-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    };
}
const PAGE_STYLE = `
:root{--bg:#f6f7f9;--card:#fff;--text:#1a1d23;--muted:#5f6673;--line:#d5d9e0;--accent:#2f6fde;--ok:#1d7a46;--err:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--card:#1d2026;--text:#e8eaee;--muted:#9aa1ad;--line:#353a44;--accent:#6c9cf0;--ok:#4cc38a;--err:#f97066}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:560px;margin:0 auto;padding:40px 16px}h1{font-size:20px;margin:0 0 4px}
.task{color:var(--muted);margin:0 0 24px;overflow-wrap:anywhere}
.drop{display:block;background:var(--card);border:2px dashed var(--line);border-radius:12px;padding:40px 16px;text-align:center;cursor:pointer}
.drop.over{border-color:var(--accent)}.drop strong{color:var(--accent)}
.hint{color:var(--muted);font-size:14px;margin:12px 0 0}
input[type=file]{position:absolute;width:1px;height:1px;opacity:0}
ul{list-style:none;padding:0;margin:20px 0 0}li{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-bottom:8px;display:flex;justify-content:space-between;gap:12px}
li span:first-child{overflow-wrap:anywhere}.ok{color:var(--ok)}.err{color:var(--err)}.wait{color:var(--muted)}
`;
const PAGE_SCRIPT = `
const cfg = JSON.parse(document.getElementById('cfg').textContent);
const list = document.getElementById('list'), drop = document.getElementById('drop'), input = document.getElementById('file');
let sent = 0;
function row(name){const li=document.createElement('li');const a=document.createElement('span');a.textContent=name;const b=document.createElement('span');b.className='wait';b.textContent='invio…';li.append(a,b);list.append(li);return b;}
function stamp(){const d=new Date(),p=n=>String(n).padStart(2,'0');return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());}
async function send(file){
  let name=file.name||'';
  if(!name||/^image\\.(png|jpe?g|gif|webp)$/i.test(name)){const ext=(file.type.split('/')[1]||'png').replace('jpeg','jpg');name='screenshot-'+stamp()+'.'+ext;}
  const st=row(name);
  if(file.size>cfg.maxBytes){st.className='err';st.textContent='oltre '+cfg.maxMb+' MB';return;}
  if(sent>=cfg.maxFiles){st.className='err';st.textContent='limite di '+cfg.maxFiles+' file raggiunto';return;}
  sent++;
  try{
    const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name),'X-File-Type':file.type||''},body:file});
    const j=await r.json().catch(()=>({}));
    if(r.ok){st.className='ok';st.textContent='allegato ✓';}else{st.className='err';st.textContent=j.error||('errore '+r.status);}
  }catch(e){st.className='err';st.textContent='rete non raggiungibile';}
}
function sendAll(files){for(const f of files) send(f);}
input.addEventListener('change',()=>{sendAll(input.files);input.value='';});
['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add('over');}));
['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove('over');}));
drop.addEventListener('drop',e=>sendAll(e.dataTransfer.files));
document.addEventListener('paste',e=>{const f=[...(e.clipboardData?.files||[])];if(f.length){e.preventDefault();sendAll(f);}});
`;
export function renderUploadPage(opts) {
    const cfg = JSON.stringify({ maxBytes: MAX_ATTACHMENT_BYTES, maxMb: MAX_MB, maxFiles: UPLOAD_LINK_MAX_FILES })
        .replace(/</g, '\\u003c');
    const scadenza = new Date(opts.expiresAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
    return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Allega a ProTask</title><style nonce="${opts.nonce}">${PAGE_STYLE}</style></head>
<body><main><h1>Allega file al task</h1><p class="task">${escapeHtml(opts.taskTitle)}</p>
<label class="drop" id="drop" for="file"><strong>Scegli i file</strong> oppure trascinali qui<input type="file" id="file" multiple></label>
<p class="hint">Puoi anche incollare uno screenshot con Ctrl+V / ⌘V. Fino a ${UPLOAD_LINK_MAX_FILES} file, massimo ${MAX_MB} MB l'uno. Il link scade alle ${scadenza}.</p>
<ul id="list" aria-live="polite"></ul></main>
<script type="application/json" id="cfg">${cfg}</script><script nonce="${opts.nonce}">${PAGE_SCRIPT}</script></body></html>`;
}
export function renderExpiredPage(nonce) {
    return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Link scaduto</title><style nonce="${nonce}">${PAGE_STYLE}</style></head>
<body><main><h1>Link scaduto o non valido</h1><p class="task">Chiedi a Claude un nuovo link per allegare i file al task.</p></main></body></html>`;
}
/** Nome e tipo mandati dalla pagina di caricamento, ripuliti. */
export function payloadFromUpload(body, rawName, rawType) {
    let name = 'allegato';
    if (typeof rawName === 'string') {
        try {
            name = safeFileName(decodeURIComponent(rawName));
        }
        catch {
            name = safeFileName(rawName);
        }
    }
    const t = typeof rawType === 'string' ? rawType.trim().toLowerCase() : '';
    const type = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(t) ? t : mimeFromName(name);
    return { data: body, name, type };
}
