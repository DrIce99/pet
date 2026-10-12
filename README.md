# Pixel Pet

Un piccolo animaletto in pixel art che vive sul bordo del tuo schermo e ti
tiene compagnia mentre lavori. Decide da solo cosa fare, chiacchiera con te,
risponde alle tue domande, può dare un'occhiata allo schermo, ricorda le cose
importanti e ti tira su il morale. Per pensare usa un servizio di intelligenza
artificiale a tua scelta: Claude, servizi gratuiti come Gemini, Groq e
OpenRouter, oppure un modello che gira sul tuo PC con Ollama.

## Cosa sa fare

- **Due pet a scelta**: un gattino rotondo (sei colori) oppure **Eevee**
  (classico o cromatico/shiny). Si cambia da Impostazioni → Pet.
- **Vive sul desktop**: cammina sopra la barra delle applicazioni, segue il
  mouse con lo sguardo, dorme quando non ci sei.
- **Tante attività quando è libero**: si siede, si stiracchia, sbadiglia, si
  lecca la zampa, si gratta dietro l'orecchio, si rincorre la coda, fa le
  fusa impastando con le zampette, si sdraia, scodinzola, saltella, si rotola, fa un
  agguato a qualcosa, gioca con un gomitolo, insegue una farfalla, starnutisce,
  canticchia, fa un pisolino… Le sceglie da solo in base all'ora e a cosa stai
  facendo, senza nessun costo.
- **Si arrampica sulle finestre**: sale lungo il bordo di una finestra aperta
  e si siede, si sdraia o dorme sopra. Se sposti la finestra lui viaggia con
  lei; se la chiudi, la riduci a icona o la copri, cade giù. Se lo lasci
  cadere sopra una finestra ci atterra. Si disattiva da Impostazioni →
  Comportamento.
- **Più schermi**: se lavori a lungo su un altro monitor ti raggiunge.
- **Decide da solo**: ogni tanto ha un "momento autonomo" con l'IA in cui
  sceglie se dire qualcosa, cambiare espressione, guardare lo schermo o
  restare tranquillo. Parla di sua iniziativa soprattutto nelle pause.
- **Conversazioni**: clicca il pet (o premi `Ctrl+Alt+P`) e scrivigli.
- **Vede lo schermo** (se glielo permetti e se il modello supporta le immagini).
- **Memoria persistente**, diario dei giorni passati, **promemoria**
  ("ricordami tra 20 minuti di chiamare Marco") e attenzione alle pause.
- **Coccole**: muovi il mouse avanti e indietro sopra di lui per accarezzarlo,
  oppure prendilo e lancialo da un'altra parte.
- **Gioca col mouse**: agita il puntatore vicino a lui (non sopra) e lo prende
  per un giocattolo: si acquatta, scodinzola col sedere e ci salta sopra. Se
  lo prende festeggia, altrimenti riprova un paio di volte e poi si stufa. Il
  puntatore vero non viene mai spostato. Si disattiva da Impostazioni →
  Comportamento.

## Avvio

Serve Node.js 20 o superiore.

```bash
npm install   # la prima volta: scarica anche Electron (~100 MB) dentro node_modules
npm start
```

Il pet compare in basso a destra dello schermo principale e la sua icona
appare nell'area di notifica. Senza un servizio di IA configurato funziona in
**modalità offline**: si muove, gioca e reagisce, ma non parla.

## Disegnare i propri sprite

Il pet può usare sprite disegnati da te al posto di quelli generati dall'app.

1. Impostazioni → Pet → **Crea un pacchetto da disegnare**: salva gli sprite
   attuali del pet (specie e colore scelti) in una cartella dentro
   `%APPDATA%\Pixel Pet\sprites`, come punto di partenza.
2. **Apri la cartella** e modifica i PNG con un programma di pixel art
   (Aseprite, LibreSprite o Piskel, che è gratuito e funziona nel browser).
3. Scegli il pacchetto nel menu "Sprite" e salva: da quel momento, ogni volta
   che salvi un file il pet si aggiorna da solo.

Ogni PNG è un'animazione con i fotogrammi affiancati, ognuno di **41×46
pixel**, disegnato **rivolto a destra** (l'app lo specchia), con i piedi
sull'ultima riga e lo sfondo trasparente. Il pacchetto completo ha 48 file e
164 fotogrammi (36 animazioni da 140 fotogrammi + le facce delle 12 emozioni,
2 fotogrammi ciascuna), ma l'unico obbligatorio è `idle.png`: quelli che
mancano vengono sostituiti da animazioni simili. Effetti come cuori, zzz,
note, la palla e la farfalla li disegna l'app sopra ai tuoi sprite. Il file
`LEGGIMI.txt` nella cartella spiega tutto il formato.

## Il "cervello": quale servizio usare

Da clic destro sul pet → **Impostazioni** → **Cervello** scegli un servizio e
un modello per le **conversazioni** e uno per i **momenti autonomi** (possono
essere diversi: per esempio Claude per parlare e un servizio gratuito per i
momenti autonomi). "Rileva modelli" scarica l'elenco reale dei modelli
disponibili e "Prova la connessione" verifica tutto.

| Servizio | Costo | Cosa serve |
| --- | --- | --- |
| **Ollama** | gratis, gira sul tuo PC | installare [Ollama](https://ollama.com) e un modello |
| **Google Gemini** | gratis con limiti giornalieri | una chiave da aistudio.google.com |
| **Groq** | gratis con limiti | una chiave da console.groq.com |
| **OpenRouter** | gratis con i modelli `:free` | una chiave da openrouter.ai |
| **Claude (Anthropic)** | a pagamento | una chiave da console.anthropic.com |
| Altro compatibile OpenAI | dipende | indirizzo dell'API (LM Studio, OpenAI, Mistral…) |

### Ollama (consigliato se vuoi gratis e privato)

1. Installa Ollama da <https://ollama.com>.
2. Scarica un modello da un terminale, ad esempio:
   - `ollama pull qwen3` (buon compromesso, usa gli strumenti),
   - `ollama pull qwen2.5vl` oppure `ollama pull mistral-small3.2` se vuoi che
     veda anche lo schermo.
3. Nelle impostazioni scegli "Ollama" e il modello ("Rileva modelli" li elenca).

Serve un PC con abbastanza memoria (indicativamente 8–16 GB di RAM per i
modelli da 7–8 miliardi di parametri; molto meglio con una scheda video).
Con i modelli più piccoli il pet è meno brillante e reattivo. Se un modello
non supporta gli strumenti (function calling), il pet passa da solo a un
formato di risposta alternativo; se non vede le immagini, rinuncia a guardare
lo schermo.

### Google Gemini

Crea una chiave gratuita su <https://aistudio.google.com> ("Get API key") e
scegli `gemini-flash-lite-latest` (veloce, con i limiti gratuiti più ampi)
oppure `gemini-flash-latest`. I nomi che finiscono con `-latest` seguono
sempre i modelli attuali, mentre quelli con la versione (per esempio
`gemini-2.5-flash`) prima o poi vengono ritirati. Nei momenti di traffico
Google può rispondere che il modello è sovraccarico: il pet riprova una volta
e poi lascia perdere fino al momento successivo.

### Claude

È il più capace (personalità, memoria e visione funzionano al meglio). La
chiave si crea sulla Console di Anthropic ed è a consumo, **separata** dagli
abbonamenti a Claude.ai e Claude Code. Stime indicative per 8 ore al
computer con "Socievole" e qualche chiacchierata:

| Modello per i momenti autonomi | Spesa indicativa al giorno |
| --- | --- |
| Claude Opus 5.5 | 1,5 – 2,5 $ |
| Claude Sonnet 5.5 | 0,8 – 1,3 $ |
| Claude Haiku 5.5 | pochi centesimi |

C'è un **budget giornaliero** (predefinito 3 $): raggiunto il limite, il pet
smette di usare Claude fino al giorno dopo. Gli altri servizi sono gratuiti o
locali e non vengono conteggiati.

Le chiavi vengono salvate cifrate con le credenziali di Windows (DPAPI). In
alternativa l'app legge le variabili d'ambiente `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `GROQ_API_KEY` e `OPENROUTER_API_KEY`.

## Privacy

- Quando guarda lo schermo, lo **screenshot viene inviato al servizio scelto**
  (con Ollama resta sul tuo PC). Se lavori con dati riservati verifica che sia
  consentito, oppure disattiva la visione o usa "Non disturbare".
- Sui **piani gratuiti** alcuni servizi (per esempio Gemini) possono usare i
  contenuti inviati per migliorare i propri modelli: leggi le loro condizioni.
- Il pet è escluso dalle catture e dalle condivisioni dello schermo.
- Le richieste passano dalla rete di Windows (certificati e proxy di
  sistema), quindi funzionano anche nelle reti aziendali che ispezionano le
  connessioni HTTPS.
- Tutti i dati restano in `%APPDATA%\Pixel Pet`: impostazioni, memoria,
  consumi, log e chiavi cifrate ("Apri la cartella dei dati" dal menu).

## Comandi

| Azione | Come |
| --- | --- |
| Parlargli | clic sul pet, `Ctrl+Alt+P` o clic sull'icona |
| Inviare / andare a capo | `Invio` / `Maiusc+Invio`; `Esc` chiude il riquadro |
| Accarezzarlo | muovi il mouse avanti e indietro sopra di lui |
| Spostarlo | tienilo premuto e trascinalo (anche su un altro schermo) |
| Menu | clic destro sul pet o sull'icona nell'area di notifica |
| Rispondere a una sua domanda | clic sul fumetto |

## Sviluppo

```bash
npm run check   # controllo dei tipi + test
npm run debug   # avvia con gli strumenti di sviluppo aperti
```

- `src/main/` - processo principale: corpo e movimenti (`body.ts`), istinti e
  azioni (`behavior.ts`), cervello (`brain.ts`, `prompt.ts`, `tools.ts`),
  servizi di IA (`providers/`), memoria, visione, attività, tray, impostazioni
- `src/shared/sprite/` - pixel art procedurale: pose condivise, faccia,
  effetti e un file per specie (`cat.ts`, `eevee.ts`)
- `src/renderer/` - finestra del pet e delle impostazioni
- `test/` - test con `node:test`; i servizi di IA sono simulati

## Crediti

- Eevee è un personaggio © Nintendo / Creatures / GAME FREAK / The Pokémon
  Company. Questo è un progetto personale e non ufficiale: se vuoi
  distribuire l'app, togli o sostituisci quel pet.
- La pixel art di Eevee è disegnata da zero prendendo come riferimento il
  modello 3D "Eevee" di drewsdigitaldesigns su Sketchfab (licenza CC BY 4.0),
  file `eevee.glb` nella cartella del progetto (non usato dall'app).
