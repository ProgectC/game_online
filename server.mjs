/**
 * Game Online — server statico minimo.
 *
 * Serve solo i file della cartella con gli header COOP/COEP, necessari per
 * abilitare SharedArrayBuffer: senza, il core multi-thread di EmulatorJS
 * non parte. Nessun catalogo, nessuna API, nessun processo di sistema.
 *
 * Avvio:  node server.mjs   →  http://localhost:5173
 */
import { createServer } from 'node:http';
import { stat, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

/** Indirizzi IPv4 di questo PC sulla rete locale (per invitare un amico). */
function lanAddresses() {
  const out = [];
  const ifs = networkInterfaces();
  for (const name in ifs) {
    for (const net of ifs[name] || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;                 // scarta 127.0.0.1
      out.push(net.address);
    }
  }
  // Gli indirizzi di casa (192.168.x, 10.x, 172.16-31.x) vengono prima.
  const privato = (a) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  return out.sort((a, b) => (privato(b) ? 1 : 0) - (privato(a) ? 1 : 0));
}

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 5173;

/* CHIUSO DI DEFAULT: ascolta solo su questo computer, nessun altro puo'
   raggiungerlo nemmeno in casa. Si apre alla rete solo quando lo decidi tu,
   con "APRI ALLA RETE.bat" (che imposta HOST=0.0.0.0).                      */
const HOST = process.env.HOST || '127.0.0.1';

// Indirizzo del server netplay (WebRTC). Vuoto = multiplayer disattivato.
// Si imposta cosi':  NETPLAY=http://192.168.1.50:3000 node server.mjs
const NETPLAY = process.env.NETPLAY || '';

/* CODICE D'ACCESSO. Chi arriva dalla rete non vede NIENTE finche' non lo
   inserisce: ne' i giochi, ne' l'elenco, ne' un indizio su cosa ci sia dietro.
   Dal tuo computer non viene mai chiesto. Il link d'invito lo contiene gia',
   quindi per il tuo amico e' automatico: clicca e entra. */
function nuovoCodice() {
  return Array.from({ length: 6 },
    () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
}
let CODE = process.env.CODE || nuovoCodice();

/* LA STANZA.
   host      = chi ha avviato il server (questo computer). Comanda lui.
   ospiti    = chi e' entrato col link: nickname, ruolo, ultimo segno di vita.
   espulsi   = token e indirizzi buttati fuori: non rientrano in QUESTA stanza.
   Chiudendo il server la stanza sparisce; alla riapertura la chiave e' nuova
   e l'elenco degli espulsi riparte da zero, come volevi. */
const STANZA = {
  hostNick: '',
  ospiti: new Map(),      // token -> { nick, ruolo, ip, visto, entrato }
  espulsi: new Set(),     // token e IP
  chiusa: false,          // chiusa = il link non fa entrare piu' NESSUNO di nuovo,
                          // ma chi e' gia' dentro resta e continua a giocare
  partita: null,          // { url, core, nome, ts } - il gioco che l'host ha avviato:
                          // gli ospiti lo vedono e lo fanno partire da soli
};

const OSPITE_SCADUTO = 25000;   // 25s senza segni di vita = uscito

/** Ripulisce chi ha chiuso la pagina senza dire niente. */
function potaOspiti() {
  const ora = Date.now();
  for (const [tok, o] of STANZA.ospiti) {
    if (ora - o.visto > OSPITE_SCADUTO) STANZA.ospiti.delete(tok);
  }
}

function nuovaStanza() {
  CODE = nuovoCodice();
  STANZA.ospiti.clear();
  STANZA.espulsi.clear();
  STANZA.chiusa = false;
  STANZA.partita = null;
  console.log(`\n  🔑 Nuova stanza. Codice: ${CODE}\n`);
}

/** Legge il token dai cookie (identifica un ospite fra un click e l'altro). */
function tokenDi(req) {
  const c = req.headers.cookie || '';
  const m = /(?:^|;\s*)tk=([A-Za-z0-9]+)/.exec(c);
  return m ? m[1] : null;
}

/** Corpo JSON piccolo (nickname e poco altro). */
async function leggiJson(req) {
  let n = 0; const parti = [];
  for await (const c of req) {
    n += c.length;
    if (n > 4096) throw new Error('troppo grande');
    parti.push(c);
  }
  try { return JSON.parse(Buffer.concat(parti).toString('utf8')); } catch { return {}; }
}

/** Nickname ripulito: niente HTML, niente righe, lunghezza sensata. */
function pulisciNick(s) {
  return String(s || '').replace(/[<>&"'\r\n\t]/g, '').trim().slice(0, 20);
}

/** Richiesta che arriva da questo stesso computer? */
function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

/** Chi bussa ha diritto di entrare? */
function authorized(req, url) {
  if (isLocal(req)) return true;                       // il tuo PC: sempre
  // Espulso: non rientra, nemmeno col link giusto. Blocchiamo sia il suo
  // token sia il suo indirizzo, cosi' non basta ripulire i cookie.
  const tok = tokenDi(req);
  if (tok && STANZA.espulsi.has(tok)) return false;
  if (STANZA.espulsi.has(req.socket.remoteAddress || '')) return false;
  /* STANZA CHIUSA: passa solo chi era gia' dentro (ha un token nell'elenco).
     Il codice e il link non bastano piu': nessun nuovo ingresso. Chi sta
     giocando non se ne accorge nemmeno, la sua partita non si interrompe. */
  if (STANZA.chiusa) return !!(tok && STANZA.ospiti.has(tok));
  if (url.searchParams.get('code') === CODE) return true;
  const cookie = req.headers.cookie || '';
  return cookie.split(';').some(c => c.trim() === 'ol=' + CODE);
}

/* Pagina del codice: volutamente spoglia. Non nomina giochi, non dice quanti
   ce ne sono, non rivela se il codice inserito e' "quasi" giusto. */
const LOGIN_PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Game Online</title>
<style>body{background:#16171a;color:#e8e9ec;font:15px/1.6 system-ui,sans-serif;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0}
form{background:#1f2124;border:1px solid #33363c;border-radius:12px;padding:28px;width:300px;text-align:center}
h1{font-size:18px;margin:0 0 6px}p{color:#9aa0a8;font-size:13px;margin:0 0 18px}
input{width:100%;background:#282b30;border:1px solid #33363c;border-radius:8px;color:#e8e9ec;
padding:11px;font:600 17px/1 inherit;letter-spacing:4px;text-align:center;text-transform:uppercase}
button{width:100%;margin-top:12px;background:#4a9eff;color:#fff;border:0;border-radius:8px;
padding:11px;font:600 14px inherit;cursor:pointer}</style></head><body>
<form method="GET"><h1>Game Online</h1><p>Enter the access code</p>
<input name="code" maxlength="12" autofocus autocomplete="off" spellcheck="false">
<button type="submit">Enter</button></form></body></html>`;

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',   '.json':'application/json; charset=utf-8',
  '.wasm':'application/wasm', '.png':'image/png', '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif',
  '.svg':'image/svg+xml', '.ico':'image/x-icon',
};

/**
 * COOP/COEP: abilitano SharedArrayBuffer (core multi-thread), MA rendono la
 * pagina "cross-origin isolated" — e in quello stato il browser blocca o
 * limita le risorse di altre origini. Noi carichiamo core, WASM e worker
 * dalla CDN di EmulatorJS: con l'isolamento attivo l'avvio può fallire.
 * La demo ufficiale non ha il problema perché ospita tutto sul proprio dominio.
 *
 * Di default quindi NON li mandiamo: il core gira a thread singolo, ma parte.
 * Per riattivarli:  ISOLATE=1 node server.mjs
 */
const ISOLATE = process.env.ISOLATE === '1';

const server = createServer(async (req, res) => {
  if (ISOLATE) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  }
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';

    /* PORTA D'INGRESSO. Prima di ogni altra cosa: chi non e' autorizzato vede
       solo la richiesta del codice, mai un contenuto e mai un messaggio che
       riveli cosa c'e' dietro. */
    if (!authorized(req, url)) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(401).end(LOGIN_PAGE);
      return;
    }

    // Codice giusto arrivato nel link: lo ricordiamo e ripuliamo l'indirizzo,
    // cosi' non resta scritto nella barra del browser.
    if (!isLocal(req) && url.searchParams.get('code') === CODE) {
      url.searchParams.delete('code');
      const pulito = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams : '');
      res.setHeader('Set-Cookie', `ol=${CODE}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
      res.writeHead(302, { Location: pulito }).end();
      return;
    }

    /* File nascosti (.git, .gitignore, .vscode...): non esistono, per chi
       chiede. Rispondiamo 404 e non 403: un 403 confermerebbe che ci sono. */
    if (rel.split('/').some(p => p.startsWith('.'))) {
      res.writeHead(404).end('Not found'); return;
    }

    // Elenco dei giochi in data/roms. Per ogni cartella scegliamo il file da
    // avviare: il .cue se c'è (gestisce le tracce multiple), altrimenti il
    // disco più grande. I BIOS finiti per errore in quelle cartelle vengono
    // scartati (nome tipo scph… oppure dimensione da BIOS).
    if (rel === '/api/roms') {
      const dir = join(ROOT, 'data', 'roms');
      const out = [];
      // Dischi (PlayStation, Sega CD, Saturn...): stanno in una cartella,
      // spesso con più tracce. Ne serviamo UNO solo, il più grande.
      const DISC = /\.(bin|iso|img|chd|pbp|ccd|mdf|nrg)$/i;
      // Cartucce (GBA, NES, SNES, N64, Mega Drive...): un file = un gioco.
      const CART = /\.(gba|nes|fds|unf|unif|sfc|smc|swc|fig|gb|gbc|n64|z64|v64|ndd|nds|dsi|vb|vboy|md|gen|smd|32x|sms|gg|a26|a52|a78|j64|jag|lnx|col|d64|t64|prg|cso|adf|zip|7z)$/i;

      /* Soglia minima. Le cartucce sono piccole (un NES sta in 40 KB), quindi
         non possiamo usare il minimo dei dischi. Caso speciale ".md": è sia
         Sega Mega Drive sia Markdown — un README.md finirebbe tra i giochi.
         Le ROM Mega Drive vere superano abbondantemente i 64 KB. */
      const minSize = (f) => /\.md$/i.test(f) ? 64 * 1024 : 8 * 1024;
      const isJunk = (f) => /bios|scph/i.test(f);

      try {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            let files = [];
            try { files = await readdir(join(dir, entry.name)); } catch { continue; }
            const cue = files.find(f => /\.cue$/i.test(f));
            let best = null, bestSize = 0;
            for (const f of files) {
              if (!DISC.test(f)) continue;
              if (isJunk(f)) continue;
              let sz = 0; try { sz = (await stat(join(dir, entry.name, f))).size; } catch {}
              if (sz <= 1024 * 1024) continue;
              if (sz > bestSize) { bestSize = sz; best = f; }
            }
            if (best) {
              // Serviamo il DISCO, non il .cue: via HTTP il cue rimanda al .bin
              // per nome relativo, e l'emulatore non andrebbe a prenderlo.
              out.push({ title: entry.name, folder: entry.name,
                         file: best, cue: cue || null, size: bestSize,
                         tracks: files.filter(f => DISC.test(f) && !isJunk(f)).length });
              continue;
            }
            // Nessun disco: la cartella raccoglie cartucce (es. data/roms/GBA/).
            // Ognuna è un gioco a sé.
            for (const f of files) {
              if (!CART.test(f) || isJunk(f)) continue;
              let sz = 0; try { sz = (await stat(join(dir, entry.name, f))).size; } catch {}
              if (sz < minSize(f)) continue;
              out.push({ title: f.replace(/\.[^.]+$/, ''), folder: entry.name,
                         file: f, cue: null, size: sz, tracks: 1 });
            }
          } else if (DISC.test(entry.name) && !isJunk(entry.name)) {
            let sz = 0; try { sz = (await stat(join(dir, entry.name))).size; } catch {}
            if (sz > 1024 * 1024)
              out.push({ title: entry.name.replace(/\.[^.]+$/, ''), folder: '',
                         file: entry.name, disc: entry.name, size: sz, tracks: 1 });
          } else if (CART.test(entry.name) && !isJunk(entry.name)) {
            // Cartuccia lasciata direttamente in data/roms: va benissimo.
            let sz = 0; try { sz = (await stat(join(dir, entry.name))).size; } catch {}
            if (sz >= minSize(entry.name))
              out.push({ title: entry.name.replace(/\.[^.]+$/, ''), folder: '',
                         file: entry.name, cue: null, size: sz, tracks: 1 });
          }
        }
      } catch {}
      out.sort((a, b) => a.title.localeCompare(b.title));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(200).end(JSON.stringify(out));
      return;
    }

    /* Dati di rete: servono alla pagina per costruire il link d'invito.
       Se apri il sito su "localhost", quel link sarebbe inutile per il tuo
       amico: qui gli diciamo qual e' l'indirizzo giusto da mandargli. */
    if (rel === '/api/net') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      // Indirizzi e codice d'accesso li vede SOLO il tuo computer: sono i dati
      // che servono a creare l'invito, non a usarlo.
      if (!isLocal(req)) { res.writeHead(200).end(JSON.stringify({ ospite: true })); return; }
      const ips = lanAddresses();
      res.writeHead(200).end(JSON.stringify({
        lan: ips[0] || null,
        tutti: ips,
        porta: Number(PORT),
        netplay: NETPLAY,
        codice: CODE,
        aperto: HOST === '0.0.0.0',
      }));
      return;
    }

    /* ---- LA STANZA: chi c'e', chi comanda, chi puo' giocare -------------- */
    if (rel.startsWith('/api/room')) {
      const host = isLocal(req);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      const rispondi = (o) => res.writeHead(200).end(JSON.stringify(o));
      potaOspiti();

      // Entra in stanza con un nickname. Da qui in poi e' riconoscibile.
      if (rel === '/api/room/join' && req.method === 'POST') {
        const body = await leggiJson(req);
        const nick = pulisciNick(body.nick) || 'Ospite';
        if (host) { STANZA.hostNick = nick; return rispondi({ ok: true, host: true }); }
        let tok = tokenDi(req);
        if (!tok || !/^[A-Za-z0-9]{8,}$/.test(tok)) {
          tok = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
          res.setHeader('Set-Cookie', `tk=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
        }
        if (STANZA.espulsi.has(tok)) return rispondi({ espulso: true });
        const gia = STANZA.ospiti.get(tok);
        STANZA.ospiti.set(tok, {
          nick,
          ruolo: gia ? gia.ruolo : 'spettatore',   // si entra a guardare
          ip: req.socket.remoteAddress || '',
          visto: Date.now(),
          entrato: gia ? gia.entrato : Date.now(),
        });
        console.log(`  👋 "${nick}" e' entrato nella stanza`);
        return rispondi({ ok: true, ruolo: STANZA.ospiti.get(tok).ruolo });
      }

      // Chi c'e' adesso. Serve anche da battito: dice che sei ancora vivo.
      if (rel === '/api/room' && req.method === 'GET') {
        const tok = tokenDi(req);
        if (!host) {
          if (tok && STANZA.espulsi.has(tok)) return rispondi({ espulso: true });
          const io = tok ? STANZA.ospiti.get(tok) : null;
          if (io) io.visto = Date.now();
          return rispondi({
            host: false,
            entrato: !!io,
            ruolo: io ? io.ruolo : null,
            chiusa: STANZA.chiusa,
            partita: STANZA.partita,
            hostNick: STANZA.hostNick,
            // L'ospite vede i nomi, non i token: non deve poter espellere.
            presenti: [...STANZA.ospiti.values()].map(o => ({ nick: o.nick, ruolo: o.ruolo })),
          });
        }
        return rispondi({
          host: true,
          codice: CODE,
          chiusa: STANZA.chiusa,
          partita: STANZA.partita,
          hostNick: STANZA.hostNick,
          presenti: [...STANZA.ospiti.entries()].map(([t, o]) => ({
            token: t, nick: o.nick, ruolo: o.ruolo, ip: o.ip,
            da: Math.floor((Date.now() - o.entrato) / 1000),
          })),
          espulsi: STANZA.espulsi.size,
        });
      }

      // Da qui in poi comanda solo l'host. Un ospite non deve nemmeno sapere
      // che queste rotte esistono: 404.
      if (!host) { res.writeHead(404).end('Not found'); return; }

      if (rel === '/api/room/kick' && req.method === 'POST') {
        const { token } = await leggiJson(req);
        const o = STANZA.ospiti.get(token);
        if (o) {
          STANZA.espulsi.add(token);
          if (o.ip) STANZA.espulsi.add(o.ip);    // niente rientri ripulendo i cookie
          STANZA.ospiti.delete(token);
          console.log(`  🚫 "${o.nick}" espulso dalla stanza`);
        }
        return rispondi({ ok: true });
      }

      if (rel === '/api/room/role' && req.method === 'POST') {
        const { token, ruolo } = await leggiJson(req);
        const o = STANZA.ospiti.get(token);
        if (o && (ruolo === 'giocatore' || ruolo === 'spettatore')) {
          o.ruolo = ruolo;
          console.log(`  🎮 "${o.nick}" ora e' ${ruolo}`);
        }
        return rispondi({ ok: true });
      }

      /* L'host ha premuto Avvia: lo registriamo qui. Gli ospiti, che
         controllano ogni pochi secondi, vedono la partita e la fanno partire
         sul loro schermo con lo stesso gioco. */
      if (rel === '/api/room/start' && req.method === 'POST') {
        const b = await leggiJson(req);
        if (typeof b.url !== 'string' || !b.url.startsWith('/data/roms/')) {
          return rispondi({ ok: false });     // solo giochi serviti da noi
        }
        STANZA.partita = {
          url: b.url,
          core: String(b.core || '').slice(0, 40),
          nome: pulisciNick(b.nome).slice(0, 60),
          ts: Date.now(),
        };
        console.log(`  ▶ Partita avviata: ${STANZA.partita.nome} (parte anche agli ospiti)`);
        return rispondi({ ok: true });
      }

      if (rel === '/api/room/stop' && req.method === 'POST') {
        STANZA.partita = null;
        console.log('  ⏹ Partita chiusa');
        return rispondi({ ok: true });
      }

      // Chiude o riapre la stanza. Non tocca nessuno di quelli gia' dentro:
      // il server continua a girare e le partite in corso proseguono.
      if (rel === '/api/room/lock' && req.method === 'POST') {
        const { chiusa } = await leggiJson(req);
        STANZA.chiusa = !!chiusa;
        console.log(STANZA.chiusa
          ? `  🔒 Stanza chiusa: il link non fa entrare piu' nessuno (dentro restano in ${STANZA.ospiti.size})`
          : `  🔓 Stanza riaperta: il link funziona di nuovo (codice ${CODE})`);
        return rispondi({ ok: true, chiusa: STANZA.chiusa });
      }

      if (rel === '/api/room/new' && req.method === 'POST') {
        nuovaStanza();
        return rispondi({ ok: true, codice: CODE });
      }

      res.writeHead(404).end('Not found');
      return;
    }

    // Elenco dei BIOS presenti in data/bios (per il menu a tendina dell'app).
    if (rel === '/api/bios') {
      const dir = join(ROOT, 'data', 'bios');
      let out = [];
      try {
        for (const f of await readdir(dir)) {
          if (!/\.(bin|rom)$/i.test(f)) continue;
          const st = await stat(join(dir, f));
          if (st.size < 100 * 1024 || st.size > 8 * 1024 * 1024) continue;
          out.push({ file: f, size: st.size });
        }
      } catch {}
      out.sort((a, b) => a.file.localeCompare(b.file));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(200).end(JSON.stringify(out));
      return;
    }

    // Serve un BIOS SOTTO IL NOME CHE IL CORE PRETENDE.
    //   /firmware/scph5502.bin?src=<nome reale del file>
    // Il core cerca il firmware per nome esatto: un blob URL non ne ha uno,
    // ed è questo il motivo di "Firmware is missing".
    if (rel.startsWith('/firmware/')) {
      // Formato:  /firmware/<file reale>/<nome canonico>
      // Il nome canonico è l'ULTIMO segmento: così l'URL finisce davvero con
      // "scph5502.bin". Con una query (?src=…) il core leggerebbe come nome
      // "scph5502.bin?src=…" e non troverebbe il firmware.
      const parts = rel.slice('/firmware/'.length).split('/');
      if (parts.length !== 2) { res.writeHead(400).end('Bad request'); return; }
      const [src, want] = parts;
      const simple = (v) => /^[\w.\- ()&',+!]+$/.test(v) && !v.includes('..')
        && !v.includes('\\');
      if (!simple(want) || !/\.(bin|rom)$/i.test(want) || !simple(src)) {
        res.writeHead(400).end('Bad request'); return;
      }
      const file = normalize(join(ROOT, 'data', 'bios', src));
      if (!file.startsWith(normalize(join(ROOT, 'data', 'bios')))) { res.writeHead(403).end('Forbidden'); return; }
      let info; try { info = await stat(file); } catch { res.writeHead(404).end('Not found'); return; }
      console.log(`  🧠 ${want}  ←  ${src}`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.writeHead(200, { 'Content-Length': info.size });
      createReadStream(file).pipe(res);
      return;
    }

    /* SALVATAGGI SU DISCO
       EmulatorJS salva gia' da solo dentro al browser (IndexedDB). Qui in piu'
       ne teniamo una copia come FILE VERO, cosi' e' copiabile e non sparisce
       se si svuota la cache del browser.
         /api/save/<gioco>   -> data/memcards/<gioco>.srm     (memory card)
         /api/state/<gioco>  -> data/savestates/<gioco>.state (stato partita)
       GET rilegge, POST scrive. */
    if (rel.startsWith('/api/save/') || rel.startsWith('/api/state/')) {
      const isState = rel.startsWith('/api/state/');
      const id = rel.slice((isState ? '/api/state/' : '/api/save/').length);
      // Il nome arriva dal browser: niente percorsi, niente risalite di cartella.
      if (!id || id.includes('..') || id.includes('/') || id.includes('\\')
          || !/^[\w.\- ()&',+!\[\]]+$/.test(id)) {
        res.writeHead(400).end('Bad request'); return;
      }
      const sub  = isState ? 'savestates' : 'memcards';
      const dir  = join(ROOT, 'data', sub);
      const file = normalize(join(dir, id + (isState ? '.state' : '.srm')));
      if (!file.startsWith(normalize(dir))) { res.writeHead(403).end('Forbidden'); return; }

      if (req.method === 'GET') {
        try {
          const buf = await readFile(file);
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store');
          res.writeHead(200, { 'Content-Length': buf.length }).end(buf);
        } catch { res.writeHead(404).end('Not found'); }
        return;
      }

      if (req.method === 'POST') {
        // Scrivere sul tuo disco puo' farlo solo il tuo computer. Un ospite
        // gioca e basta: non lascia file sulla tua macchina.
        if (!isLocal(req)) { res.writeHead(404).end('Not found'); return; }
        const chunks = [];
        let total = 0;
        for await (const c of req) {
          total += c.length;
          if (total > 64 * 1024 * 1024) { res.writeHead(413).end('Too large'); return; }
          chunks.push(c);
        }
        const buf = Buffer.concat(chunks);
        if (!buf.length) { res.writeHead(400).end('Empty'); return; }
        try {
          await mkdir(dir, { recursive: true });
          await writeFile(file, buf);
          console.log(`  💾 ${sub}/${id}  (${(buf.length / 1024).toFixed(0)} KB)`);
          res.writeHead(200).end('OK');
        } catch (e) { res.writeHead(500).end('Write failed'); }
        return;
      }

      res.writeHead(405).end('Method not allowed');
      return;
    }

    // I file del progetto non vanno serviti come contenuto statico.
    // 404 e non 403: chi chiede non deve sapere che esistono.
    if (/^\/(server\.mjs|package(-lock)?\.json|.*\.(bat|md|log))$/i.test(rel)) {
      res.writeHead(404).end('Not found'); return;
    }

    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT)) { res.writeHead(404).end('Not found'); return; }

    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404).end('Not found'); return; }

    const ext = extname(file).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    // La pagina cambia spesso: senza questo il browser servirebbe la versione
    // vecchia dalla cache e le modifiche non si vedrebbero.
    if (ext === '.html' || ext === '.js' || ext === '.css') {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
    }

    // Range: serve per i file grandi senza caricarli tutti in memoria.
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end   = m && m[2] ? parseInt(m[2], 10) : info.size - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= info.size) end = info.size - 1;
      if (start > end) { res.writeHead(416).end(); return; }
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${info.size}`,
                           'Content-Length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': info.size });
      createReadStream(file).pipe(res);
    }
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  const ips = lanAddresses();
  console.log(`\n  ✅ Game Online pronto\n`);
  console.log(`  Su questo PC   →  http://localhost:${PORT}`);
  if (HOST === '0.0.0.0' && ips.length) {
    console.log(`  Per gli amici  →  http://${ips[0]}:${PORT}`);
    if (ips.length > 1) console.log(`     (altri indirizzi: ${ips.slice(1).join(', ')})`);
    console.log(`\n  🔑 Codice d'accesso:  ${CODE}`);
    console.log('  Chi arriva dalla rete deve inserirlo. Il link d\'invito');
    console.log('  che trovi nella pagina lo contiene gia\'.');
  } else if (HOST === '0.0.0.0') {
    console.log('  (nessuna rete locale rilevata: sei offline o solo su questo PC)');
    console.log(`\n  🔑 Codice d'accesso:  ${CODE}`);
  } else {
    console.log('\n  🔒 Chiuso: raggiungibile SOLO da questo computer.');
    console.log('     Per invitare qualcuno usa  "APRI ALLA RETE.bat"');
  }
  console.log(NETPLAY
    ? `\n  🎮 Multiplayer attivo tramite  ${NETPLAY}`
    : '\n  Multiplayer non attivo: manca il server netplay (vedi AVVIA MULTIPLAYER.bat)');
  console.log('\n  Per chiudere: Ctrl+C\n');
});
