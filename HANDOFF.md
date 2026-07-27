# PSOnline — documento di passaggio di consegne

Progetto: emulatore multiconsole nel browser, basato su **EmulatorJS** (CDN).
Stato: **NON FUNZIONANTE.** Il gioco non parte. Errore ricorrente:
`Firmware is missing: scph5502.bin`

---

## 1. Obiettivo

Un'app web locale che permetta di:

1. scegliere un gioco (dalla cartella `data/roms` o trascinando un file);
2. avviarlo nel browser tramite EmulatorJS;
3. supportare più console (PlayStation è la priorità: l'utente ha 7 giochi PS1);
4. gestire i BIOS automaticamente, senza che l'utente debba capire quale file serve.

**Requisito dell'utente:** l'esperienza deve essere come quella di
<https://demo.emulatorjs.org>, che **sul suo PC funziona** (confermato da lui).
Questo è il dato più importante del documento: la demo ufficiale funziona,
la nostra copia no.

---

## 2. Ambiente

- Windows, Chrome, Node.js v24
- Cartella progetto: `C:\Users\Giuse\Desktop\gaming_psonline\psonline-core`
- Avvio: `AVVIA PSONLINE.bat` (esegue `node server.mjs`) → <http://localhost:5173>
- EmulatorJS: **4.2.3**, caricato da `https://cdn.emulatorjs.org/stable/data/`

### File del progetto

| File | Ruolo |
|---|---|
| `index.html` | tutta l'app: HTML, CSS e JS in un unico file |
| `server.mjs` | server statico + API (`/api/roms`, `/api/bios`, `/firmware/...`) |
| `AVVIA PSONLINE.bat` | avvio |
| `data/roms/` | 7 giochi PS1 (cartelle con `.bin` + `.cue`) |
| `data/bios/` | 21 BIOS PS1 |
| `data/covers/`, `data/memcards/`, `data/savestates/` | dati dell'utente |

---

## 3. Fatti VERIFICATI sul funzionamento di EmulatorJS

Ricavati leggendo il sorgente su
`https://cdn.emulatorjs.org/stable/data/src/emulator.js` e `.../loader.js`.
**Non sono ipotesi.**

### 3.1 Il punto d'ingresso è `loader.js`, non `emulator.min.js`

`loader.js` scarica `emulator.min.js` + il CSS, costruisce l'oggetto config
dalle variabili `EJS_*` e infine esegue:

```js
window.EJS_emulator = new EmulatorJS(EJS_player, config);
```

Caricare `emulator.min.js` da solo definisce la classe ma **non la istanzia
mai**: schermo nero senza alcun errore. È stato il primo bug trovato.

### 3.2 Nome del BIOS nel filesystem virtuale

```js
// downloadGameFile()
if (assetUrl instanceof File) assetUrl = assetUrl.name;
FS.writeFile(coreFilePath + assetUrl.split("/").pop().split("#")[0].split("?")[0], data)
```

Quindi il nome nel VFS è:
- un oggetto `File` → `file.name`
- una stringa URL → ultimo segmento del percorso, **senza** query e frammento

Il core cerca il firmware per **nome esatto**: per i giochi PAL `scph5502.bin`.

### 3.3 Il download del gioco parte solo dopo una richiesta HEAD

```js
if (!this.debug) {
    this.downloadFile(this.config.gameUrl, null, true, { method: "HEAD" }).then(async (res) => {
        const name = (typeof this.config.gameUrl === "string")
            ? this.config.gameUrl.split("/").pop() : "game";
        const result = await this.storage.rom.get(name);
        if (result && result["content-length"] === res.headers["content-length"] && name !== "game") {
            gotGameData(result.data); return;
        }
        downloadFile();      // ← il download vero avviene SOLO qui
    })
}
```

**Non c'è `.catch()`**: se la HEAD o `storage.rom.get()` falliscono, l'errore
viene inghiottito e il download non parte mai, senza messaggi.
Passando un `File`, `name` diventa `"game"` e il percorso è fragile.
→ **Conviene passare un URL http vero**, non un File né un blob.

### 3.4 Gli archivi sono riconosciuti dai magic bytes, non dall'estensione

```js
// compression.js — isCompressed()
if (data[0]===80 && data[1]===75 && ...) return "zip";
```

Quindi l'estensione dell'URL è irrilevante per il rilevamento; conta il
contenuto. I file estratti da un archivio vengono scritti col **proprio nome**
interno.

### 3.5 Nomi BIOS PlayStation accettati (dalla documentazione ufficiale)

`scph5500.bin` (JP) · `scph5501.bin` (US) · `scph5502.bin` (EU) ·
`scph1001.bin` · `scph7001.bin` · `scph101.bin` · `PSXONPSP660.bin`

### 3.6 Core PlayStation

`EJS_core` accetta `psx` (alias di `pcsx_rearmed`), `pcsx_rearmed`,
`mednafen_psx_hw`.

**Osservazione sperimentale:** con `pcsx_rearmed` e **nessun BIOS**, l'errore
`Firmware is missing: scph5502.bin` compare **lo stesso**. Quindi il core
richiede un BIOS reale; l'ipotesi del "BIOS HLE integrato" è stata smentita.

### 3.7 Limitazione nota (upstream)

EmulatorJS non espone l'impostazione del tipo di controller per la PlayStation,
quindi **gli stick analogici non funzionano** —
[issue #806](https://github.com/EmulatorJS/EmulatorJS/issues/806), ancora aperta.
Rimedio adottato: mappare lo stick sinistro sul D-pad digitale.

---

## 4. Cose PROVATE che NON hanno funzionato

Da non ripetere.

| # | Tentativo | Esito |
|---|---|---|
| 1 | Caricare `emulator.min.js` invece di `loader.js` | Schermo nero muto. **Bug reale, corretto.** |
| 2 | BIOS come `blob:` URL | `Firmware is missing`: il blob non porta un nome. |
| 3 | BIOS dentro uno ZIP costruito nel browser (CRC a blocchi) | `File CRC differs from ZIP CRC`. Lo zip era valido per `unzip -t` ma l'estrattore WASM lo rifiutava. **Codice rimosso.** |
| 4 | ZIP con tutti e 10 i nomi regionali | Stesso errore CRC. |
| 5 | URL `/firmware/scph5502.bin?src=<file>` | La query rovina il nome: il core leggeva `scph5502.bin?src=...`. |
| 6 | URL `/firmware/<file>/scph5502.bin` | Nome corretto, ma l'errore persiste. |
| 7 | `EJS_biosUrl` come oggetto `File` col nome giusto | Errore persiste. |
| 8 | Nessun BIOS (fiducia nel BIOS HLE) | Errore persiste → il core lo pretende. |
| 9 | Header COOP/COEP attivi (SharedArrayBuffer) | Sospetti di bloccare la CDN. **Ora disattivati** (`ISOLATE=1` per riattivarli). |
| 10 | Multi-thread on/off | Nessuna differenza evidente. |

---

## 5. Stato attuale del codice (build 13)

- `EJS_core = 'pcsx_rearmed'` (PlayStation), `bios: true`
- Gioco: **URL http vero** → `/data/roms/<cartella>/<disco>.bin`
  (viene servito il `.bin`, **non** il `.cue`: via HTTP il cue rimanda al bin
  per nome relativo e l'emulatore non lo recupera)
- BIOS: **URL http vero** → `/firmware/<file reale>/<nome canonico>.bin`
  (il nome canonico è l'ultimo segmento, così il core lo legge correttamente)
- BIOS scelto automaticamente per regione, scartando i dump marcati `[b]`/`[h]`
- Server senza COOP/COEP → niente SharedArrayBuffer → core a thread singolo
- Cache disattivata su HTML/JS/CSS
- Pannello **ℹ Dettagli** nel player: mostra core, gioco, BIOS, conteggi,
  `crossOriginIsolated`, `EJS_threads`

### Ultimo dato diagnostico raccolto

```
build          : 12
core (EJS_core): pcsx_rearmed
gioco          : Bugs Bunny ... .bin (file locale)
BIOS           : NESSUNO
file in data/bios trovati: 0        ← server non riavviato
SharedArrayBuffer: NO
crossOriginIsolated: NO
EJS_threads    : false
```

⚠ **Attenzione:** in quel test il server NON era stato riavviato, quindi le
rotte `/api/roms` e `/api/bios` non rispondevano e la configurazione nuova non
era attiva. **La build 13 non è ancora stata provata con il server aggiornato.**

---

## 6. Cosa fare adesso

### Passo 0 — prerequisito

Riavviare il server e verificare che la pagina mostri **build 13** senza
l'avviso giallo. Poi scegliere il gioco **dal menu a tendina** (non
trascinandolo) e leggere il pannello **ℹ Dettagli**. Senza questi dati ogni
ulteriore modifica è cieca.

### Ipotesi A (la più promettente) — ospitare EmulatorJS in locale

È **l'unica differenza strutturale rimasta** rispetto alla demo che funziona:
la demo serve `data/` dal proprio dominio, noi da CDN.

1. Scaricare l'ultima release da
   <https://github.com/EmulatorJS/EmulatorJS/releases> (contiene la cartella `data/`)
2. Estrarla in `psonline-core/emulatorjs/`
3. Impostare `EJS_pathtodata = '/emulatorjs/data/'`
4. Rimuovere il caricamento da CDN

Questo elimina in un colpo solo tutte le variabili cross-origin: CORS, COEP,
worker e WASM da un'altra origine.

### Ipotesi B — percorso del BIOS nel filesystem del core

Il core potrebbe cercare il firmware in una **cartella di sistema** e non
accanto al file del core. Verificare in `GameManager.js` come viene impostata
la system directory di RetroArch e, se serve, scrivere il BIOS lì.

### Ipotesi C — confronto diretto con la demo

Aprire la demo funzionante con gli strumenti di sviluppo, scheda **Rete**, e
confrontare le richieste con le nostre: quali file scarica, da dove, con quali
intestazioni. La differenza salta fuori da lì.

---

## 7. Vincoli da rispettare

- **Non** cancellare `data/`: contiene 3,75 GB di giochi e i salvataggi dell'utente.
- L'utente **non è uno sviluppatore**: servono istruzioni concrete, non teoria.
- Ha già perso molte ore su questo problema: evitare tentativi alla cieca,
  raccogliere prima i dati diagnostici.
- Non reintrodurre la creazione di ZIP nel browser (punto 4.3).
- La cartella `data/roms/Bugs Bunny.../` contiene per errore un file BIOS
  (`Sony PlayStation SCPH-5502...bin`): il server lo scarta già, ma andrebbe
  spostato in `data/bios/`.

---

## 8. Nota sul multi-traccia

`Tom and Jerry` ha 2 tracce reali. Via URL singolo parte solo la principale
(la musica da CD potrebbe mancare). Soluzione: convertire in `.chd`, oppure
comprimere la cartella in uno `.zip` **creato da Windows** (non generato dal
browser) e caricarlo tramite trascinamento.
