# Jak přispět

Díky za zájem! Projekt je malý a přátelský – nápady, hlášení chyb i pull requesty jsou vítané.

## Hlášení chyb

Založte issue a popište:

- co jste dělali a co se stalo (ideálně snímek obrazovky),
- verzi aplikace a systému,
- zda šlo o ElevenLabs nebo systémové hlasy a jaký model OpenAI.

Prosím **nepřikládejte stránky komiksů** chráněné autorským právem.

## Pull requesty

1. Forkněte repozitář a vytvořte větev (`feat/…`, `fix/…`).
2. `npm install`, pak vývoj přes `npm run dev` (bez API klíčů: `CTYRLISTEK_MOCK_AI=1 npm run dev`).
3. Přidejte nebo upravte testy (`test/unit`), u UI změn spusťte `npm run test:e2e`.
4. Před odesláním: `npm run check`.
5. Commity pište ve stylu Conventional Commits (`feat: …`, `fix: …`).

Podrobnosti o architektuře: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Vývojové příkazy: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Chování

Buďme k sobě laskaví – tahle aplikace vznikla pro děti. 🍀
