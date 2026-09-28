# Bezpečnost

Pokud najdete bezpečnostní problém (např. únik API klíčů, spuštění kódu z PDF), nehlaste ho veřejně v issues – napište prosím správci přes GitHub (Security → Report a vulnerability).

Jak aplikace chrání data:

- API klíče jsou uložené šifrovaně přes Electron `safeStorage` a nikdy neopouštějí main process.
- Renderer běží s `contextIsolation`, `sandbox` a bez `nodeIntegration`; přístup k souborům je omezený na složku knihovny (kontrola path traversal).
- Sestavený renderer má přísné Content-Security-Policy; aplikace neotevírá nová okna a neumožní navigaci mimo sebe.
