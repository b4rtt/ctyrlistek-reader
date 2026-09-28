# CLAUDE.md – orientation for AI assistants

Čtyřlístek Reader: Electron + React + TypeScript app that turns a comic PDF into a voiced, film-like playback. Read `docs/ARCHITECTURE.md` first; commands are in `docs/DEVELOPMENT.md`.

## Product decisions (from the owner – do not change without asking)

- Page analysis uses the **OpenAI API** (Responses API, vision, strict JSON schema). Default model `gpt-6-sol`.
- Voices use **ElevenLabs** (default `eleven_v3` with audio tags for emotions) with a **system-voice fallback**.
- Expressive acting per line (emotion / intensity / delivery) is a core feature – "playable like a movie".
- Uncertain character names/genders must be surfaced to the user for confirmation.
- UI language is Czech; code, comments and commit messages are English.
- Public open-source repo: commit in small Conventional-Commit steps, keep docs + CHANGELOG current.

## Commands

```bash
npm run check                         # typecheck + lint + unit tests (run before committing)
npm run test:e2e                      # build + Playwright/Electron smoke test (mock AI, system voices)
CTYRLISTEK_MOCK_AI=1 npm run dev      # run without API keys
```

## Gotchas

- Never commit real comic pages/PDFs (copyrighted). Only the original `test/fixtures/sample-comic.pdf`.
- Do not draw or reproduce the Čtyřlístek characters anywhere (icons, fixtures, docs).
- HTTP headers must be ASCII: the app name has diacritics, so the user agent is normalised in `src/main/index.ts`. Keep it.
- pdf.js v6: `destroy()` lives on the loading task (`openPdf()` returns `close`).
- OpenAI strict schemas: every property must be in `required`, `additionalProperties: false`, nullable via `type: [..., 'null']` / `anyOf`. `test/unit/main-pure.test.ts` enforces this – extend the schema, extend the converter (`src/main/ai/convert.ts`).
- Geometry is normalized (0..1). AI returns pixel boxes in the _sent_ image; convert with `boxToRect`.
- Modules imported by unit tests must not import `electron` (keep pure logic in `src/shared` or pure files like `wav.ts`, `convert.ts`, `voiceInfo.ts`).
- Audio cache keys include `PIPELINE_VERSION` in `src/main/tts/audio.ts` – bump it when the synthesis pipeline changes.
- The import job keeps its in-memory document authoritative; never replace it with the result of `library.save()` (concurrent page results would be lost).
- `PlayerController` waits are generation-bound; any new async step in the loop must check `gen === this.gen` / use `wait()`.
