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

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 5173;

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
    if (/^\/(server\.mjs|package(-lock)?\.json|.*\.bat)$/i.test(rel)) {
      res.writeHead(403).end('Forbidden'); return;
    }

    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ✅ Game Online pronto →  http://localhost:${PORT}\n`);
  console.log('  Trascina la ROM, scegli la console, premi Avvia.');
  console.log('  Per chiudere: Ctrl+C\n');
});
