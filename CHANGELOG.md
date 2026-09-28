# Changelog

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/), verze podle [SemVer](https://semver.org/lang/cs/).

## [Unreleased]

## [0.1.0] – 2026-09-28

První veřejná verze.

### Přidáno

- Import komiksu z PDF (přetažením i výběrem), vykreslení stránek přes pdf.js.
- Lokální detekce okének (včetně okének „slepených“ bublinou přes mezeru) a zpřesnění poloh bublin.
- AI analýza stránek přes OpenAI (výchozí `gpt-6-sol`): pořadí okének, přepis bublin a rámečků, mluvčí, emoce, intenzita a přednes, zvukové efekty, jména a pohlaví postav s mírou jistoty.
- Sjednocení postav napříč stránkami (slučování duplicit, lepší jména).
- Obrazovka Postavy a hlasy: doplnění nejistých jmen/pohlaví, automatické obsazení hlasů, ukázky hlasů, sloučení postav.
- Editor stránek: úprava textu, mluvčího, emoce, přednesu a pořadí; opětovné přečtení stránky; vynechání stránky.
- ElevenLabs hlasy s „hereckým“ přednesem (`eleven_v3` audio tagy), časování slov, zvukové efekty, cache a odhad spotřeby.
- Záložní systémové hlasy (macOS `say`) s posunem výšky a tempa pro odlišení postav; Web Speech jinde.
- Přehrávač jako film: plynulá kamera mezi okénky, reflektor, svítící bublina, titulky se zvýrazněním slov, třesení kamery u efektů, klávesové zkratky, pokračování od posledního místa.
- Okamžité spuštění přehrávání: hlasy se namlouvají na pozadí, repliky potřebné pro přehrávač mají přednost.
- Náhledy stránek (menší spotřeba paměti u velkých komiksů), automatické opakování stránek, které selhaly.
- Šifrované ukládání API klíčů, testovací režim bez AI, unit, integrační a E2E testy, CI.
