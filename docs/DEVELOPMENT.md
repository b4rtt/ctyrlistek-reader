# Vývoj

## Požadavky

- Node.js 22+ a npm
- macOS doporučeno (systémové české hlasy přes `say`); Windows/Linux fungují s hlasy prohlížeče

## Příkazy

| Příkaz                                   | Co dělá                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm install`                            | instalace; `postinstall` zkopíruje runtime soubory pdf.js do `src/renderer/public/pdfjs` |
| `npm run dev`                            | vývojový režim s hot reloadem rendereru                                                  |
| `npm run build`                          | produkční build do `out/`                                                                |
| `npm start`                              | spustí sestavenou aplikaci                                                               |
| `npm run typecheck`                      | TypeScript (main/preload, renderer, testy)                                               |
| `npm run lint`                           | ESLint                                                                                   |
| `npm test`                               | unit testy (Vitest)                                                                      |
| `npm run check`                          | typecheck + lint + testy – spusťte před každým commitem                                  |
| `npm run test:e2e`                       | build + end-to-end test v Electronu (Playwright), snímky do `screenshots/`               |
| `npm run fixture`                        | znovu vygeneruje testovací komiks `test/fixtures/sample-comic.pdf`                       |
| `npm run icon`                           | vykreslí `build/icon.svg` do `build/icon.png`                                            |
| `npm run dist:mac` / `dist:win` / `dist` | instalační balíčky do `release/`                                                         |

## Proměnné prostředí

| Proměnná                                  | Význam                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `OPENAI_API_KEY`                          | OpenAI klíč (klíč uložený v aplikaci má přednost)                      |
| `ELEVENLABS_API_KEY`                      | ElevenLabs klíč                                                        |
| `CTYRLISTEK_MOCK_AI=1`                    | analýza bez OpenAI – deterministická simulace z lokální detekce okének |
| `CTYRLISTEK_DATA_DIR`                     | jiná složka s daty (testy tak nesahají na skutečnou knihovnu)          |
| `CTYRLISTEK_HIDDEN=1`                     | nezobrazovat okno (automatizace)                                       |
| `OPENAI_BASE_URL` / `ELEVENLABS_BASE_URL` | jiná adresa API (integrační testy, proxy)                              |

Rychlé vyzkoušení bez klíčů:

```bash
CTYRLISTEK_MOCK_AI=1 npm run dev
```

V Nastavení pak přepněte hlasy na **Systémové**.

## Testy

- **Unit** (`test/unit`): detekce okének a bublin na syntetických rastrech, slučování postav, obsazování hlasů, audio tagy a prozodie, časování slov, časová osa, převod odpovědi AI a **kontrola, že JSON schémata splňují strict mode OpenAI** (všechny vlastnosti v `required`, `additionalProperties: false`).
- **Integrační** (`test/integration`): skutečný kód OpenAI SDK a ElevenLabs klienta proti lokálnímu falešnému serveru (`OPENAI_BASE_URL`, `ELEVENLABS_BASE_URL`) – ověřuje přesný tvar požadavků (strict JSON schéma, obrázky, audio tagy, `language_code`, zvukové efekty), zpracování odpovědí, chybové hlášky, cache a záložní endpoint. Bez klíčů a bez nákladů.
- **E2E** (`scripts/e2e.mjs`): spustí sestavenou aplikaci s prázdnou datovou složkou a `CTYRLISTEK_MOCK_AI=1`, nahraje testovací komiks, vyřeší nejistou postavu, otevře editor, namluví repliky systémovým hlasem a přehrává. Kontroluje i chyby v konzoli.

### Test se skutečnými klíči

Klíče jsou šifrované přes `safeStorage` (macOS Klíčenka). Electron spuštěný **přes Playwright** je nedokáže dešifrovat – aplikaci proto spusťte normálně a ovládejte ji přes DevTools protokol:

```bash
CTYRLISTEK_SELFTEST=1 npx electron .                     # ověří uložené klíče (hodnoty nevypisuje) a skončí
CTYRLISTEK_DATA_DIR=/tmp/kopie-dat npx electron . --remote-debugging-port=9333
```

a v testovacím skriptu `chromium.connectOverCDP('http://127.0.0.1:9333')` (Playwright). Pro test na kopii knihovny zkopírujte do nové datové složky `settings.json`, `secrets.json` a složku komiksu.

Skutečná volání OpenAI/ElevenLabs automatické testy nepoužívají (stojí peníze a vyžadují klíče). Po změnách v `src/main/ai` nebo `src/main/tts` je ověřte ručně s vlastními klíči na krátkém PDF.

## Struktura

```
src/
  main/            Electron main process
    ai/            OpenAI analýza, prompty + JSON schémata, mock
    tts/           ElevenLabs, systémové TTS, WAV zpracování, cache zvuku
    library.ts     knihovna na disku
    settings.ts    nastavení + šifrované klíče
    protocol.ts    comic:// a app://
    ipc.ts         všechny IPC handlery
  preload/         contextBridge → window.ctyrlistek
  shared/          typy a čistá logika sdílená main/rendererem
  renderer/src/
    cv/            detekce okének a bublin
    pdf/           pdf.js
    pipeline/      import job, obrázky pro AI, příprava hlasů
    player/        PlayerController + kamera
    screens/       Knihovna, Průběh, Postavy, Editor, Přehrávač
    components/    UI prvky
test/              unit testy, pomocníci, fixture PDF
scripts/           e2e, generátory fixture/ikony, kopie pdf.js assetů
docs/              dokumentace
```

## Konvence

- UI texty jsou česky, kód a komentáře anglicky.
- Commity ve stylu [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `build:`…).
- Formátování Prettier (`npm run format`), žádné středníky, jednoduché uvozovky, šířka 110.
- Čistou logiku dávejte do `src/shared` nebo do samostatných modulů bez importu `electron`, aby šla testovat.
- **Nikdy necommitujte skutečné komiksy** (`*.pdf` je v `.gitignore`, výjimkou je `test/fixtures`).

## Balení a vydání

1. Aktualizujte `version` v `package.json` a `CHANGELOG.md`.
2. `npm run check && npm run test:e2e`
3. `npm run dist:mac` (resp. `dist:win`, `dist`)
4. Aplikace není podepsaná – na macOS ji poprvé otevřete přes pravé tlačítko → Otevřít.
