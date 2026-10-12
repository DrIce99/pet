// Entry point: wires the pet's body, behaviour, brain, memory and UI together.
import { app, BrowserWindow, globalShortcut, net, powerMonitor, screen, shell, type Display } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROVIDER_IDS, PROVIDERS, type ProviderId } from "../shared/providers";
import type { ConnectionReport, KeySource, LookDirection, PetLayout, SettingsSnapshot } from "../shared/types";
import { Activity } from "./activity";
import { Autonomy } from "./autonomy";
import { Behavior, type ActStep } from "./behavior";
import { Body, sortedDisplays } from "./body";
import { Brain, type BrainHost, type LookResult, type Purpose } from "./brain";
import { desktopWindows } from "./desktop";
import { findLedges } from "./ledges";
import { initLog, log } from "./log";
import { Memory } from "./memory";
import { PetWindow } from "./petWindow";
import { CursorGame } from "./play";
import type { Situation } from "./prompt";
import { createProvider, listModels, ProviderError, type ChatProvider, type FetchLike } from "./providers";
import { ApiKeyStore } from "./secrets";
import { SettingsStore } from "./settings";
import { SettingsWindow } from "./settingsWindow";
import { Speech } from "./speech";
import { SpritePacks } from "./sprites";
import { PetTray } from "./tray";
import { localDate, UsageTracker } from "./usage";
import { Vision } from "./vision";

const DEBUG = process.argv.includes("--debug");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app
    .whenReady()
    .then(start)
    .catch((err) => {
      log.error("Startup failed", err);
      app.quit();
    });
}

function start(): void {
  const dataDir = app.getPath("userData");
  initLog(join(dataDir, "logs"));
  log.info(`Pixel Pet ${app.getVersion()} (Electron ${process.versions.electron}), data in ${dataDir}`);

  const settingsStore = new SettingsStore(dataDir);
  const settings = () => settingsStore.get();
  const apiKeys = new ApiKeyStore(dataDir);
  const memory = new Memory(join(dataDir, "memory.json"));
  const usage = new UsageTracker(join(dataDir, "usage.json"));
  const activity = new Activity(() => powerMonitor.getSystemIdleTime());
  const vision = new Vision();

  // ---- AI services: providers are cached so what they learn about models sticks ----
  const providers = new Map<string, ChatProvider>();
  // Electron's network stack (Chromium) trusts the Windows certificate store
  // and follows the system proxy: Node's fetch fails behind networks that
  // inspect HTTPS with their own certificate authority.
  const netFetch: FetchLike = (input, init) => net.fetch(input instanceof URL ? input.href : input, init);
  const providerConfig = (id: ProviderId) => ({
    apiKey: apiKeys.get(id),
    ollamaUrl: settings().ollamaUrl,
    customUrl: settings().customUrl,
    fetch: netFetch,
  });
  const providerFor = (id: ProviderId): ChatProvider | null => {
    const config = providerConfig(id);
    const cacheKey = `${id}|${config.apiKey ?? ""}|${config.ollamaUrl}|${config.customUrl}`;
    const cached = providers.get(cacheKey);
    if (cached) return cached;
    const created = createProvider(id, config);
    if (created) providers.set(cacheKey, created);
    return created;
  };
  /** The service and model configured for conversations or autonomous moments. */
  const chosenProvider = (purpose: Purpose): { provider: ChatProvider; model: string } | null => {
    const s = settings();
    const id = purpose === "chat" ? s.chatProvider : s.autonomousProvider;
    const model = purpose === "chat" ? s.chatModel : s.autonomousModel;
    const provider = model ? providerFor(id) : null;
    return provider ? { provider, model } : null;
  };

  // ---- the pet: window, body, behaviour, speech ----
  let petVisible = true;
  let layout: PetLayout = {
    scale: settings().scale,
    spriteX: 170,
    windowWidth: 340,
    windowHeight: 440,
    species: settings().species,
    theme: settings().theme,
    name: settings().petName,
  };
  let rendererStarted = false;
  let dragStartDisplay = 0;
  let lastPettingMoment = 0;
  let lastDropMoment = 0;

  const petWindow = new PetWindow(
    {
      ready: () => {
        petWindow.layout(layout);
        applySpritePack();
        behavior.resend();
        onRendererReady();
      },
      click: () => {
        behavior.poked();
        petWindow.openInput();
      },
      petted: () => onPetted(),
      dragStart: () => {
        dragStartDisplay = body.currentDisplay().id;
        game.interrupt();
        behavior.pickedUp();
        body.startDrag();
      },
      dragEnd: () => body.endDrag(),
      contextMenu: () => tray.popup(petWindow.win),
      send: (text) => void brain.handle({ kind: "message", text }),
      inputClosed: () => undefined,
      bubbleClicked: () => petWindow.openInput(),
    },
    settings().hideFromCapture,
  );

  const body = new Body(
    petWindow.win,
    {
      setLocomotion: (locomotion) => behavior.setLocomotion(locomotion),
      setFacing: (facing) => behavior.setFacing(facing),
      layoutChanged: (spriteX, windowWidth, windowHeight) => {
        layout = { ...layout, spriteX, windowWidth, windowHeight };
        petWindow.layout(layout);
      },
      landed: (display, fromDrag) => onLanded(display, fromDrag),
      slipped: () => behavior.slipped(),
    },
    {
      ledges: () => (settings().climbWindows ? findLedges(desktopWindows()) : []),
      climbing: () => settings().climbWindows,
    },
    settings().scale,
    memory.stats().lastPosition,
  );

  // Hand-drawn sprites: loaded when chosen, reloaded whenever a file in the pack changes
  const spritePacks = new SpritePacks(join(dataDir, "sprites"));
  let spritePackProblem = "";
  function applySpritePack(): void {
    const id = settings().spritePack;
    const pack = id ? spritePacks.load(id) : null;
    spritePackProblem = id && !pack ? `Il pacchetto "${id}" non si può usare (i dettagli sono nel log): uso gli sprite disegnati dall'app.` : "";
    if (pack) log.info(`Sprite pack "${id}": ${Object.keys(pack.strips).length} strips`);
    petWindow.spritePack(pack);
    spritePacks.watch(id || null, applySpritePack);
  }

  const cursorDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const behavior = new Behavior(body, {
    displays: sortedDisplays,
    cursorDisplay,
    cursorPoint: () => screen.getCursorScreenPoint(),
    activity: () => activity.snapshot(),
    followCursorScreen: () => settings().followCursorScreen,
    climbing: () => settings().climbWindows,
    brainBusy: () => brain.isBusy(),
    send: (visual) => petWindow.visual(visual),
    effect: (effect) => petWindow.effect(effect),
  });
  body.place();

  const game = new CursorGame(body, behavior, {
    enabled: () => settings().chaseCursor && petVisible,
    cursor: () => screen.getCursorScreenPoint(),
    scale: () => settings().scale,
  });

  const speech = new Speech(
    petWindow,
    () => activity.snapshot().idleSec,
    () => settings().doNotDisturb || !petVisible,
  );

  // ---- the mind ----
  const host: BrainHost = {
    settings,
    memory,
    usage,
    provider: chosenProvider,
    situation: () => situation(),
    perform: (steps) => {
      game.interrupt();
      behavior.perform(steps);
    },
    lookAtScreen: (which, requestedByUser) => lookAtScreen(which, requestedByUser),
    startSpeech: () => speech.start(),
    say: (text, options) => speech.say(text, options),
    setThinking: (thinking) => behavior.setThinking(thinking),
    scheduleNextCheck: (minutes) => autonomy.scheduleIn(minutes),
    backOff: (minutes) => autonomy.backOff(minutes),
  };
  const brain = new Brain(host);
  const autonomy = new Autonomy(
    () => settings().talkativeness,
    () => canReact() && !activity.snapshot().away,
    () => void brain.handle({ kind: "tick" }),
  );

  /** Whether an event may start a Claude moment on the pet's own initiative. */
  function canReact(): boolean {
    const s = settings();
    return petVisible && !s.doNotDisturb && s.talkativeness > 0 && brain.isAvailable() && !brain.isBusy() && !usage.overBudget(s.dailyBudgetUsd);
  }

  function situation(): Situation {
    const displays = sortedDisplays();
    const primary = screen.getPrimaryDisplay().id;
    const number = (d: Display) => Math.max(1, displays.findIndex((x) => x.id === d.id) + 1);
    const stats = memory.stats();
    const visual = behavior.state();
    const since = vision.sinceLastLook();
    const now = new Date();
    return {
      now,
      activity: activity.snapshot(),
      screens: displays.map((d) => `${d.size.width}x${d.size.height}${d.id === primary ? " (primary)" : ""}`),
      petScreen: number(body.currentDisplay()),
      cursorScreen: number(cursorDisplay()),
      pet: {
        animation: visual.animation,
        emotion: visual.emotion,
        affection: stats.affection,
        daysTogether: Math.floor((now.getTime() - Date.parse(stats.bornAt)) / 86_400_000) + 1,
        petsToday: stats.petsDate === localDate(now) ? stats.petsToday : 0,
        place: body.where(),
      },
      vision: { enabled: settings().visionEnabled, minutesSinceLook: since === null ? null : Math.round(since / 60_000) },
      talkativeness: settings().talkativeness,
    };
  }

  async function lookAtScreen(which: string, requestedByUser: boolean): Promise<LookResult> {
    const s = settings();
    if (!s.visionEnabled) return { notes: ["Vision is turned off by the user: you cannot see the screen."], images: [] };
    const since = vision.sinceLastLook();
    if (!requestedByUser && since !== null && since < s.visionMinIntervalSec * 1000) {
      return { notes: [`You looked at the screen ${Math.round(since / 1000)} s ago: rely on your notes and look again later.`], images: [] };
    }
    const displays = sortedDisplays();
    const primary = screen.getPrimaryDisplay().id;
    let targets: Display[];
    if (which === "all") targets = displays;
    else if (which === "mine") targets = [body.currentDisplay()];
    else if (/^\d+$/.test(which)) {
      const display = displays[Number(which) - 1];
      if (!display) return { notes: [`There is no screen ${which}: there are ${displays.length}.`], images: [] };
      targets = [display];
    } else targets = [cursorDisplay()];

    behavior.setLooking(true);
    try {
      const shots = await vision.capture(
        targets.map((display) => ({
          display,
          label: `Screen ${displays.findIndex((d) => d.id === display.id) + 1}${display.id === primary ? " (primary)" : ""}`,
        })),
        s.visionMaxWidth,
      );
      const result: LookResult = { notes: [], images: [] };
      for (const shot of shots) {
        if (shot.unchanged && !requestedByUser) result.notes.push(`${shot.label} looks the same as the last time you looked: rely on your notes.`);
        else result.images.push({ label: `${shot.label}, ${shot.width}x${shot.height}`, jpegBase64: shot.jpegBase64 });
      }
      if (!shots.length) result.notes.push("The screenshot failed.");
      log.info(`Looked at ${targets.length} screen(s): ${result.images.length} image(s) sent`);
      return result;
    } finally {
      setTimeout(() => behavior.setLooking(false), 1200);
    }
  }

  // ---- events ----

  function onRendererReady(): void {
    if (rendererStarted) return;
    rendererStarted = true;
    if (DEBUG) petWindow.win.webContents.openDevTools({ mode: "detach" });
    setTimeout(() => void greet(), 1500);
    // Development aids: save frames of the pet window (and of a settings tab) as PNG files
    const capturePrefix = process.env.PET_DEBUG_CAPTURE;
    if (capturePrefix) {
      for (let i = 1; i <= 4; i++) {
        setTimeout(async () => {
          const image = await petWindow.win.webContents.capturePage();
          writeFileSync(`${capturePrefix}_${i}.png`, image.toPNG());
        }, 2500 + i * 1500);
      }
    }
    const settingsTab = process.env.PET_DEBUG_SETTINGS;
    if (settingsTab) {
      settingsWindow.open();
      setTimeout(async () => {
        const win = BrowserWindow.getAllWindows().find((w) => w !== petWindow.win);
        if (!win || !capturePrefix) return;
        await win.webContents.executeJavaScript(`document.querySelector('[data-tab="${settingsTab.replace(/\W/g, "")}"]')?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 600));
        writeFileSync(`${capturePrefix}_settings.png`, (await win.webContents.capturePage()).toPNG());
      }, 3500);
    }
  }

  async function greet(): Promise<void> {
    // Development aids: show a line, open the chat box, send a message as if typed, or run act steps
    const debugLine = process.env.PET_DEBUG_SAY;
    const debugMessage = process.env.PET_DEBUG_MESSAGE;
    const debugAct = process.env.PET_DEBUG_ACT;
    if (process.env.PET_DEBUG_INPUT) petWindow.openInput();
    if (debugLine || debugMessage || debugAct) {
      if (debugAct) behavior.perform(JSON.parse(debugAct) as ActStep[]);
      if (debugLine) speech.say(debugLine, { spontaneous: false, expectsReply: false });
      if (debugMessage) await brain.handle({ kind: "message", text: debugMessage });
    } else if (!settings().doNotDisturb) {
      const stats = memory.stats();
      const firstRun = memory.facts().length === 0 && memory.recentConversation(1).length === 0 && memory.diary().length === 0;
      await brain.handle({ kind: "startup", hoursAway: (Date.now() - Date.parse(stats.lastSeenAt)) / 3_600_000, firstRun });
    }
    memory.touch();
    await brain.writeDiary();
  }

  function onPetted(): void {
    behavior.petted();
    const times = memory.recordPetting();
    if (Date.now() - lastPettingMoment > 3 * 60_000 && canReact()) {
      lastPettingMoment = Date.now();
      void brain.handle({ kind: "petted", timesToday: times });
    }
  }

  function onLanded(display: Display, fromDrag: boolean): void {
    memory.setLastPosition({ displayId: display.id, fraction: body.fraction() });
    if (!fromDrag) return;
    behavior.dropped();
    const changedScreen = display.id !== dragStartDisplay;
    if ((changedScreen || Date.now() - lastDropMoment > 2 * 60_000) && canReact()) {
      lastDropMoment = Date.now();
      void brain.handle({ kind: "dropped", screen: sortedDisplays().findIndex((d) => d.id === display.id) + 1, changedScreen });
    }
  }

  activity.on("back", (minutesAway) => {
    behavior.wakeUp();
    if (minutesAway >= 10 && canReact()) void brain.handle({ kind: "back", minutesAway });
  });
  powerMonitor.on("lock-screen", () => activity.setLocked(true));
  powerMonitor.on("unlock-screen", () => activity.setLocked(false));

  screen.on("display-added", () => body.refreshDisplays());
  screen.on("display-removed", () => body.refreshDisplays());
  screen.on("display-metrics-changed", () => body.refreshDisplays());

  // Due reminders, announced only while the user is at the computer
  setInterval(() => {
    if (activity.snapshot().away) return;
    for (const reminder of memory.takeDueReminders()) {
      if (!petVisible) setVisible(true);
      behavior.perform([{ emotion: "excited", animation: "wave" }]);
      behavior.effect("exclamation");
      const text = `⏰ ${reminder.text}`;
      memory.addMessage("pet", text);
      speech.say(text, { spontaneous: false, expectsReply: false });
    }
  }, 15_000);

  // Eyes follow the mouse pointer
  let lastLook: LookDirection = { x: 0, y: 0 };
  setInterval(() => {
    if (!petVisible || body.isHeld()) return;
    const cursor = screen.getCursorScreenPoint();
    const head = body.headPoint();
    const dx = cursor.x - head.x;
    const dy = cursor.y - head.y;
    const clamp = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 10) / 10;
    const look = Math.hypot(dx, dy) < 25 ? { x: 0, y: 0 } : { x: clamp(dx / 260), y: clamp(dy / 260) };
    if (look.x !== lastLook.x || look.y !== lastLook.y) {
      lastLook = look;
      petWindow.look(look);
    }
  }, 150);

  // ---- tray, hotkey, settings ----

  function setVisible(visible: boolean): void {
    petVisible = visible;
    if (visible) {
      petWindow.win.showInactive();
    } else {
      petWindow.closeInput();
      petWindow.win.hide();
    }
    tray.refresh();
  }

  function talk(): void {
    if (!petVisible) setVisible(true);
    petWindow.openInput();
  }

  const tray = new PetTray(
    {
      talk,
      toggleVisible: () => setVisible(!petVisible),
      toggleDoNotDisturb: () => settingsStore.update({ doNotDisturb: !settings().doNotDisturb }),
      toggleVision: () => settingsStore.update({ visionEnabled: !settings().visionEnabled }),
      sendToOtherScreen: () => behavior.perform([{ move: "other_screen", emotion: "happy" }]),
      openSettings: () => settingsWindow.open(),
      openDataFolder: () => void shell.openPath(dataDir),
      quit: () => app.quit(),
    },
    () => ({
      name: settings().petName,
      species: settings().species,
      theme: settings().theme,
      visible: petVisible,
      doNotDisturb: settings().doNotDisturb,
      vision: settings().visionEnabled,
      online: chosenProvider("chat") !== null,
      spentToday: usage.today().costUsd,
      budget: settings().dailyBudgetUsd,
      hotkey: settings().hotkey,
    }),
  );

  function registerHotkey(): void {
    globalShortcut.unregisterAll();
    const hotkey = settings().hotkey;
    if (!hotkey) return;
    try {
      const ok = globalShortcut.register(hotkey, () => {
        if (petVisible && petWindow.isInputOpen()) petWindow.closeInput();
        else talk();
      });
      if (!ok) log.warn(`Hotkey ${hotkey} is already used by another application`);
    } catch (err) {
      log.warn(`Invalid hotkey ${hotkey}`, err);
    }
  }

  function applyLoginItem(): void {
    // In development the app runs as `electron <folder>`, so pass the folder along
    app.setLoginItemSettings({
      openAtLogin: settings().launchAtLogin,
      path: process.execPath,
      args: app.isPackaged ? [] : [app.getAppPath()],
    });
  }

  function snapshot(): SettingsSnapshot {
    const today = usage.today();
    return {
      settings: settings(),
      keys: Object.fromEntries(PROVIDER_IDS.map((id) => [id, apiKeys.source(id)])) as Record<ProviderId, KeySource>,
      usage: { todayUsd: today.costUsd, todayRequests: today.requests },
      facts: memory.facts(),
      reminders: memory.reminders(),
      diary: memory.diary(),
      dataPath: dataDir,
      sprites: { packs: spritePacks.list(), folder: spritePacks.dir, problem: spritePackProblem },
    };
  }

  /** Tries the services chosen for conversations and for autonomous moments. */
  async function testConnection(): Promise<ConnectionReport[]> {
    const reports: ConnectionReport[] = [];
    const tried = new Set<string>();
    for (const [purpose, label] of [
      ["chat", "Conversazioni"],
      ["autonomous", "Momenti autonomi"],
    ] as const) {
      const s = settings();
      const id = purpose === "chat" ? s.chatProvider : s.autonomousProvider;
      const model = purpose === "chat" ? s.chatModel : s.autonomousModel;
      const what = `${label}: ${PROVIDERS[id].name}${model ? `, ${model}` : ""}`;
      if (tried.has(`${id}|${model}`)) continue;
      tried.add(`${id}|${model}`);
      const chosen = chosenProvider(purpose);
      if (!chosen) {
        const missing = !model ? "scegli un modello" : id === "custom" && !s.customUrl ? "manca l'indirizzo del servizio" : "manca la chiave API";
        reports.push({ ok: false, message: `${what}: ${missing}.` });
        continue;
      }
      try {
        const result = await chosen.provider.complete({ model, system: "Reply with a single short, friendly word.", prompt: "Ciao!" });
        usage.record(id, model, result.usage);
        reports.push({ ok: true, message: `${what}: funziona${result.text ? ` (ha risposto "${result.text.slice(0, 40)}")` : ""}.` });
      } catch (err) {
        log.warn("Connection test failed", err);
        const e = err instanceof ProviderError ? err : new ProviderError("unknown", String(err));
        const hint: Record<string, string> = {
          auth: "la chiave API non è valida",
          permission: "la chiave non può usare questo modello",
          not_found: id === "ollama" ? `modello non trovato: scaricalo con "ollama pull ${model}"` : "modello non trovato",
          rate_limit: "limite di richieste raggiunto, riprova tra poco",
          connection:
            id === "ollama"
              ? "Ollama non risponde: è installato e avviato?"
              : e.certificate
                ? `certificato della connessione non valido (${e.message})`
                : `non riesco a raggiungere il servizio (${e.message})`,
          overloaded: "il servizio è sovraccarico o non risponde, riprova tra poco",
        };
        reports.push({ ok: false, message: `${what}: ${hint[e.kind] ?? e.message}.` });
      }
    }
    brain.credentialsChanged();
    tray.refresh();
    return reports;
  }

  const settingsWindow = new SettingsWindow({
    snapshot,
    save: (next, keys) => {
      if (Object.keys(keys).length) apiKeys.update(keys);
      providers.clear();
      brain.credentialsChanged();
      settingsStore.update(next);
      return snapshot();
    },
    testConnection,
    listModels: async (id) => {
      try {
        const models = await listModels(id, providerConfig(id));
        return { ok: true, models, message: models.length ? `${models.length} modelli trovati.` : "Nessun modello trovato." };
      } catch (err) {
        const offline = err instanceof ProviderError && err.kind === "connection" && id === "ollama";
        const message = offline ? "Ollama non risponde: è installato e avviato?" : err instanceof Error ? err.message : String(err);
        return { ok: false, models: [], message };
      }
    },
    forgetFact: (id) => {
      memory.forget(id);
      return snapshot();
    },
    clearMemory: () => {
      memory.clear();
      return snapshot();
    },
    openDataFolder: () => void shell.openPath(dataDir),
    exportSprites: () => {
      const s = settings();
      const result = spritePacks.exportDrawn(s.species, s.theme);
      return {
        snapshot: snapshot(),
        message: `Creato il pacchetto "${result.id}": ${result.files} file con ${result.frames} fotogrammi in tutto. Sceglilo qui sopra e salva per usarlo.`,
      };
    },
    openSpritesFolder: () => {
      mkdirSync(spritePacks.dir, { recursive: true });
      void shell.openPath(spritePacks.dir);
    },
  });

  settingsStore.onChange((next, prev) => {
    if (next.scale !== prev.scale) {
      layout = { ...layout, scale: next.scale };
      body.setScale(next.scale);
    }
    if (next.species !== prev.species || next.theme !== prev.theme || next.petName !== prev.petName) {
      layout = { ...layout, species: next.species, theme: next.theme, name: next.petName };
      petWindow.layout(layout);
    }
    if (!next.climbWindows && prev.climbWindows) body.leaveWindows();
    if (next.spritePack !== prev.spritePack) applySpritePack();
    if (next.hideFromCapture !== prev.hideFromCapture) petWindow.setHiddenFromCapture(next.hideFromCapture);
    if (next.hotkey !== prev.hotkey) registerHotkey();
    if (next.launchAtLogin !== prev.launchAtLogin) applyLoginItem();
    tray.refresh();
  });

  app.on("second-instance", talk);
  // The pet lives in the tray: closing the settings window must not quit
  app.on("window-all-closed", () => undefined);
  app.on("before-quit", () => {
    memory.setLastPosition({ displayId: body.currentDisplay().id, fraction: body.fraction() });
    memory.touch();
    memory.flush();
    usage.flush();
    speech.dispose();
    globalShortcut.unregisterAll();
  });

  activity.start();
  behavior.start();
  game.start();
  autonomy.start();
  registerHotkey();
  if (settings().launchAtLogin) applyLoginItem();
  setInterval(() => memory.touch(), 5 * 60_000);
  setInterval(() => {
    if (!brain.isBusy()) void brain.writeDiary();
  }, 30 * 60_000);
  setInterval(() => tray.refresh(), 60_000);
  const brainInfo = (purpose: Purpose) => {
    const chosen = chosenProvider(purpose);
    return chosen ? `${chosen.provider.id}/${chosen.model}` : "offline";
  };
  log.info(`Ready: chat ${brainInfo("chat")}, moments ${brainInfo("autonomous")}; pet window at ${JSON.stringify(petWindow.win.getBounds())}`);
}
