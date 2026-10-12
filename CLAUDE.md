# Pixel Pet - notes for development sessions

Electron + TypeScript desktop pet driven by an LLM of the user's choice. The
user writes in Italian; UI strings are Italian, code and comments English.

## Commands

- `npm run check` - typecheck (TypeScript 7) + tests (`node:test`, bundled by esbuild)
- `npm start` / `npm run debug` - build and run (debug opens DevTools)
- Always launch through `run.mjs`: shells spawned by VS Code export
  `ELECTRON_RUN_AS_NODE=1`, which makes `electron.exe` behave as plain Node.
- Electron 44 has no postinstall of its own; ours runs `node_modules/electron/install.js`.

## Architecture

- `body.ts` moves the transparent window along the bottom of the work area
  or the top edge of another window ("perch"); near a screen edge the sprite
  moves inside the window instead (`spriteX`). It climbs window sides, follows
  the perch window every 50 ms and falls when it moves away or closes.
- `play.ts` is the mouse game: the pointer wiggling near the pet (direction
  changes, not over the sprite, not below its feet) starts stalk → `Body.leap`
  (a ballistic jump through the pointer) → caught/missed, with cooldowns.
- `desktop.ts` lists the other apps' windows through koffi (user32/dwmapi:
  Z-order, DWM frame bounds, cloaked/tool windows skipped, own pid skipped);
  `ledges.ts` (pure, tested) turns them into visible, usable top edges.
- `behavior.ts` runs the model's `act` plans and weighted idle instincts.
- `brain.ts` turns events (`prompt.ts` `Trigger`) into one request each through
  a provider-neutral `MomentSession`; it only loops after `look_at_screen`,
  or once when a message got actions but no answer.
- `providers/`: `anthropic.ts` (SDK), `compat.ts` (neutral transcript, JSON
  reply fallback for models without tools, image stripping for models
  without vision), `openai.ts` (SSE chat completions: Gemini, Groq,
  OpenRouter, custom), `ollama.ts` (native `/api/chat`: needed for `num_ctx`).
- Network: providers take a `fetch`; the app passes Electron's `net.fetch`
  (Windows certificate store + system proxy). Node's fetch fails behind
  networks that inspect HTTPS (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`); for
  scripts use `node --use-system-ca`.
- Gemini (OpenAI endpoint) streams each tool call whole without `index`
  (calls are told apart by id), puts thought signatures in `extra_content`
  (echoed back, required by Gemini 3 models) and reports usage only with
  `stream_options.include_usage`.
- Sprite packs (`shared/sprite/pack.ts`, `main/sprites.ts`): folders of PNG
  strips (41x46 frames, facing right) in `userData/sprites`; only idle.png is
  required, `FALLBACK` maps the rest; `<anim>_<emotion>` and `talk` variants.
  Exported from the drawn sprites (`renderSprite(..., { effects: false })`),
  decoded with nativeImage (BGRA, premultiplied), hot-reloaded with fs.watch.
  The pet window draws the frame and overlays `renderEffects` at the pack's
  `anchors`; hit testing uses opaque pixels (`solid`).
- `src/shared/sprite/`: species-agnostic `pose.ts`, `face.ts`, `effects.ts`;
  one body file per species. New species: add it to `shared/species.ts`, write
  a body + limbs + 16x16 icon, register it in `sprite/index.ts`.

## Claude API decisions (Anthropic provider)

- Speech goes through the `say` tool, not text blocks: on Opus 5.5 text between
  tool calls can come back as hidden thinking blocks.
- Streaming with `eager_input_streaming` on all tools; inputs are validated in
  `tools.ts`. Live bubbles read raw `input_json_delta` fragments of `say`
  because the SDK parses tool input only at block stop.
- No `thinking` param, explicit `output_config.effort`, no forced `tool_choice`.
- `fallbacks: "default"` + beta `server-side-fallback-2026-07-01` except for Haiku.
- System prompt cached with a 1-hour TTL; keep it and the tool list byte-stable.

## Debug aids (env vars)

`PET_DEBUG_SAY`, `PET_DEBUG_MESSAGE`, `PET_DEBUG_INPUT=1`,
`PET_DEBUG_ACT=<JSON array of act steps>` (e.g. `[{"move":"window"}]`),
`PET_DEBUG_CAPTURE=<prefix>` (PNG frames of the pet window),
`PET_DEBUG_SETTINGS=<tab>` (opens settings on a tab; captured with
PET_DEBUG_CAPTURE). Screen captures skip the pet while "hide from capture" is
on. Logs: `%APPDATA%\Pixel Pet\logs\pet.log`.
