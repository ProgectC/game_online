# PSOnline

Emulatore multiconsole nel browser, costruito sul motore **EmulatorJS**
(caricato da CDN, nessuna installazione).

## Avvio

Doppio clic su **`AVVIA PSONLINE.bat`**, oppure:

```bash
node server.mjs
```

Poi apri **http://localhost:5173**

## Uso

1. Trascina la ROM (o clicca per sceglierla)
2. Controlla la console: viene riconosciuta dall'estensione del file
3. Carica il BIOS, se quella console lo richiede
4. Premi **Avvia**

Tutto il resto — controlli, salvataggi, stati, shader, schermo intero, netplay —
è nel menu del player, in basso a destra.

## Console supportate

PlayStation, NES, SNES, Nintendo 64, Game Boy/Color/Advance, Nintendo DS,
Virtual Boy, Sega Mega Drive/CD/32X/Master System/Game Gear/Saturn, PSP, 3DO,
Atari 2600/5200/7800/Jaguar/Lynx, ColecoVision, Commodore 64/128/PET/Plus4/VIC-20,
Amiga, MAME 2003, Arcade.

## I tuoi file

La cartella `data/` contiene i tuoi giochi, BIOS, copertine, memory card e
salvataggi. L'app **non** li legge da sola: li selezioni tu al momento
dell'avvio, così restano solo sul tuo computer.

- `data/roms/` — i giochi
- `data/bios/` — i BIOS (per la PlayStation europea: `scph5502.bin`)
- `data/memcards/`, `data/savestates/` — salvataggi

## Perché il server

Serve solo a fornire gli header COOP/COEP, necessari per abilitare
SharedArrayBuffer e quindi il core multi-thread. Aprire `index.html` con un
doppio clic non funziona.
