# Architektura

Tento dokument popisuje, jak je Čtyřlístek Reader postavený a proč. Je určený vývojářům (i budoucím AI asistentům), kteří potřebují rychle pochopit, kde co najdou.

## Přehled

Electron aplikace se třemi vrstvami:

| Vrstva                  | Složka             | Odpovědnost                                                                                                                                  |
| ----------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Main process** (Node) | `src/main`         | disk (knihovna, nastavení, šifrované klíče), volání OpenAI a ElevenLabs, systémové TTS, cache zvuku, vlastní protokoly `comic://` a `app://` |
| **Preload**             | `src/preload`      | bezpečný most `window.ctyrlistek` (typ `AppApi`) přes `contextBridge`                                                                        |
| **Renderer** (React)    | `src/renderer/src` | UI, vykreslení PDF (pdf.js), počítačové vidění, orchestrace importu, přehrávač                                                               |
| **Sdílené**             | `src/shared`       | datový model, typy IPC, čistá logika (slučování postav, obsazování hlasů, „herecká“ vrstva, časová osa)                                      |

Renderer běží s `contextIsolation`, `sandbox` a bez `nodeIntegration`. Všechno, co potřebuje Node nebo tajné klíče, jde přes IPC (`src/main/ipc.ts`). API klíče nikdy neopustí main process.

## Datový model (`src/shared/types.ts`)

```
ComicDoc
├─ meta: ComicMeta          (id, název, fáze, spotřeba tokenů, pozice přehrávání)
├─ pages: PageData[]
│   ├─ candidates: Rect[]   (okénka z lokální detekce)
│   └─ panels: Panel[]      (v pořadí čtení)
│       └─ lines: Line[]    (bublina/rámeček/efekt: text, mluvčí, emoce, přednes, poloha)
└─ characters: Character[]  (jméno + jistota, pohlaví + jistota, věk, popis, hlas, portrét)
```

- Veškerá geometrie je v **normalizovaných souřadnicích stránky** (0–1), takže nezávisí na rozlišení.
- `Line.text` je text připravený pro TTS (normální velká/malá písmena, bez dělení slov), `Line.originalText` je přesný přepis.
- `Line.emotion` × `intensity` (1–3) × `delivery` (šepot/normálně/hlasitě/křik) popisují přednes.
- Knihovna na disku: `<userData>/library/<id>/{comic.json, source.pdf, pages/pNNN.jpg, audio/<hash>.{mp3,wav,json}}`.

## Import a analýza (`src/renderer/src/pipeline/importJob.ts`)

`ImportJob` běží v rendereru nezávisle na obrazovkách (registr jobů), po každé stránce ukládá stav, takže přerušený import jde později **navázat**.

1. **Vykreslení** – pdf.js vykreslí stránky (delší strana max. 3000 px) do JPEG.
2. **Lokální detekce okének** (`cv/panels.ts`):
   - barva papíru se odhadne z okraje stránky,
   - flood-fill této barvy od okraje najde okraje a mezery mezi panely,
   - souvislé komponenty zbytku = kandidáti na okénka,
   - kandidáti slepení bublinou přes mezeru se rozdělí rekurzivním **XY-cut**, který přijme jen řez „otevřený na obou koncích“ (bílá obloha uvnitř orámovaného okénka se tak nerozřízne).
3. **AI analýza stránky** (`src/main/ai/openai.ts`, `prompts.ts`) – OpenAI Responses API se strukturovaným výstupem (`json_schema`, `strict: true`):
   - obrázek 1: čistá stránka zmenšená tak, aby se vešla do rozpočtu 2 400 „patchů“ 32×32 px (služba ji pak nepřeškáluje a souřadnice sedí 1:1),
   - obrázek 2: stránka s kandidáty orámovanými a označenými P1, P2…,
   - v textu: kandidáti v pixelech a **soupiska postav** (aby AI napříč stránkami používala stejná ID).
   - AI vrací okénka v pořadí čtení (s odkazem na kandidáta nebo vlastním rámečkem), repliky (druh, mluvčí, přepis, text pro TTS, emoce, intenzita, přednes, herecká poznámka, poloha bubliny, popis zvukového efektu) a postavy (jméno + jistota + zdůvodnění, pohlaví podle české gramatiky + jistota, věk, vzhled, hlasové rysy, poloha obličeje).
4. **Zpracování výsledku** (`src/shared/roster.ts`):
   - okénko potvrzené AI se nahradí přesným lokálním kandidátem (`choosePanelRect`),
   - poloha bubliny se zpřesní lokálně (`cv/bubbles.ts`): z několika bodů uvnitř přibližného rámečku se vyplní souvislá světlá oblast bubliny; vybere se výplň, která s rámečkem AI nejlépe sedí,
   - klíče postav se namapují na stabilní ID; stejné (nikoli obecné) jméno na jiné stránce = stejná postava.
   - Stránky, které selžou (např. přetížení API), se na konci zkusí znovu po jedné.
5. **Sjednocení postav** – druhé, levné volání AI dostane seznam postav s ukázkami replik, jak je oslovují ostatní, a portréty; vrátí sloučení duplicit a lepší jména/pohlaví. Když selže, import pokračuje.

Postava s nejistým jménem nebo pohlavím má `needsReview()` → obrazovka **Postavy a hlasy** ji zvýrazní.

### Testovací režim

`CTYRLISTEK_MOCK_AI=1` nahradí OpenAI deterministickým `src/main/ai/mock.ts` (okénka z detektoru, vymyšlené repliky). Používá ho E2E test.

## Hlasy

### Obsazení (`src/shared/voiceMatch.ts`)

Hlavní postavy vybírají první, pak vypravěč, pak ostatní podle počtu replik. Skóre hlasu: shoda pohlaví (+12 / −30), věk, **ověřená čeština (+8)**, shoda povahových rysů (synonyma: „deep“ ≈ „gravelly“…), typ použití (vypravěč ↔ narration), a −14 za každé předchozí použití (aby měl každý jiný hlas). Ruční volba uživatele (`voice.manual`) se nikdy nepřepisuje.

Pro systémové hlasy dostane každá postava posun výšky (půltóny) a tempo – Bobík nejhlubší, Pinďa rychlejší a vyšší atd.

### Herecká vrstva (`src/shared/performance.ts`)

| Engine                 | Jak se promítne emoce                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| ElevenLabs `eleven_v3` | audio tagy před textem: `[shouting] [angry] Co to děláš?!`, `[whispers] [nervous] …`, `[laughs harder] …`; stabilita 0 / 0,5 / 1    |
| ElevenLabs v2 / flash  | `voice_settings` (nižší stabilita + vyšší `style` pro emotivní repliky), `speed`, `previous_text`/`next_text` pro plynulou intonaci |
| systémový hlas         | tempo, výška a hlasitost podle emoce a přednesu                                                                                     |

### Generování a cache (`src/main/tts/audio.ts`)

- Klíč cache = hash všeho, co ovlivňuje zvuk (text, tagy, hlas, model, nastavení, verze pipeline). Stejná replika se nikdy negeneruje dvakrát.
- ElevenLabs volání mají **prioritní semafor** (souběžnost z nastavení): repliky, které přehrávač potřebuje hned, předbíhají generování na pozadí, a když přehrávač požádá o repliku, která už čeká ve frontě pozadí, její priorita se zvýší. Opakování s exponenciálním odstupem při 429/5xx a `retry-after`.
- **Generování na pozadí** (`src/renderer/src/pipeline/voiceJob.ts`) běží nezávisle na obrazovkách – „Přehrát komiks“ spustí přehrávač okamžitě a zbytek replik se namlouvá souběžně. Po dokončení se odkazy na zvuky sloučí do aktuálně uloženého dokumentu.
- Změna hlasu postavy zneplatní její dříve namluvené repliky (`invalidateChangedVoices`).
- `/with-timestamps` vrací časování znaků → časování slov pro „karaoke“ titulky (`src/shared/alignment.ts`). Když endpoint pro model nefunguje, použije se běžný endpoint a odhad časování.
- Systémové TTS (`src/main/tts/system.ts`): macOS `say` → WAV. Moderní hlasy ignorují `[[pbas]]`/`[[volm]]`, proto se výška mění **převzorkováním** WAV (`wav.ts`) a tempo se předem kompenzuje parametrem `-r`. Ticho na začátku a konci se ořízne, aby přehrávání mělo spád.

## Přehrávač (`src/renderer/src/player`)

- `buildTimeline` (`src/shared/timeline.ts`) zploští komiks na **beaty**: replika, nebo tiché okénko/stránka.
- `PlayerController` je nezávislý na Reactu: prochází beaty, řídí kameru, přehrává zvuk a publikuje stav. Všechna čekání jsou **pozastavitelná** a vázaná na „generaci“ – přeskočení spustí novou generaci a stará smyčka tiše skončí. Po posunu v pauze se smyčka rozběhne od zobrazeného beatu.
- Zvuk se **předem načítá** (5 replik dopředu); když chybí, vygeneruje se za běhu (ukazatel „Připravuji hlas…“), a když selže, nastoupí Web Speech, aby příběh nikdy nezamrzl.
- Kamera (`camera.ts`) spočítá transformaci, která okénko vycentruje nad titulky (max. zoom 3,4×); přechody jsou CSS transformace s délkou podle vzdálenosti. Reflektor je prvek s obřím `box-shadow`, bublina svítí barvou mluvčího. Zvukové efekty zatřesou scénou.
- Pozice se ukládá při začátku stránky a pauze (`meta.lastBeat`).

## Protokoly a bezpečnost

- `comic://<id>/<cesta>` servíruje stránky a zvuky z knihovny (ochrana proti path traversal v `paths.ts`); `comic://preview-cache/audio/…` ukázky hlasů.
- `app://bundle/…` servíruje sestavený renderer (standardní origin → ES moduly, workery, fetch) a přidává přísné CSP.
- Výchozí User-Agent obsahuje název aplikace s diakritikou – HTTP hlavičky musí být ASCII, proto se v `src/main/index.ts` normalizuje.
- Nová okna se neotevírají; externí `https` odkazy jdou do prohlížeče; navigace mimo aplikaci je blokovaná.
- Klíče: `secrets.json` šifrovaný `safeStorage` (Keychain/DPAPI/libsecret).
