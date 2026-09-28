/**
 * Generates test/fixtures/sample-comic.pdf – a small, original 3-page comic
 * (two made-up characters, Czech balloons, captions and a sound effect) used
 * by the end-to-end test. Contains no third-party artwork.
 *
 *   npm run fixture
 */
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const W = 1240
const H = 1754

function robot(x, y, s, mood = 'happy') {
  const mouth =
    mood === 'angry'
      ? `<path d="M${x - 18 * s} ${y + 22 * s} q ${18 * s} ${-12 * s} ${36 * s} 0" stroke="#222" stroke-width="${4 * s}" fill="none"/>`
      : `<path d="M${x - 18 * s} ${y + 16 * s} q ${18 * s} ${16 * s} ${36 * s} 0" stroke="#222" stroke-width="${4 * s}" fill="none"/>`
  return `
    <line x1="${x}" y1="${y - 60 * s}" x2="${x}" y2="${y - 90 * s}" stroke="#555" stroke-width="${5 * s}"/>
    <circle cx="${x}" cy="${y - 95 * s}" r="${9 * s}" fill="#ef4444"/>
    <rect x="${x - 55 * s}" y="${y - 60 * s}" width="${110 * s}" height="${100 * s}" rx="${24 * s}" fill="#fb923c" stroke="#222" stroke-width="${4 * s}"/>
    <circle cx="${x - 22 * s}" cy="${y - 18 * s}" r="${10 * s}" fill="#fff" stroke="#222" stroke-width="${3 * s}"/>
    <circle cx="${x + 22 * s}" cy="${y - 18 * s}" r="${10 * s}" fill="#fff" stroke="#222" stroke-width="${3 * s}"/>
    <circle cx="${x - 22 * s}" cy="${y - 18 * s}" r="${4 * s}" fill="#222"/>
    <circle cx="${x + 22 * s}" cy="${y - 18 * s}" r="${4 * s}" fill="#222"/>
    ${mouth}
    <rect x="${x - 40 * s}" y="${y + 40 * s}" width="${80 * s}" height="${70 * s}" rx="${10 * s}" fill="#fdba74" stroke="#222" stroke-width="${4 * s}"/>`
}

function star(x, y, s) {
  const pts = []
  for (let i = 0; i < 10; i++) {
    const r = (i % 2 ? 38 : 80) * s
    const a = (Math.PI / 5) * i - Math.PI / 2
    pts.push(`${x + r * Math.cos(a)},${y + r * Math.sin(a)}`)
  }
  return `
    <polygon points="${pts.join(' ')}" fill="#facc15" stroke="#222" stroke-width="${4 * s}"/>
    <circle cx="${x - 16 * s}" cy="${y - 4 * s}" r="${6 * s}" fill="#222"/>
    <circle cx="${x + 16 * s}" cy="${y - 4 * s}" r="${6 * s}" fill="#222"/>
    <path d="M${x - 14 * s} ${y + 16 * s} q ${14 * s} ${12 * s} ${28 * s} 0" stroke="#222" stroke-width="${4 * s}" fill="none"/>
    <path d="M${x - 60 * s} ${y - 70 * s} l ${60 * s} ${-40 * s} l ${60 * s} ${40 * s} z" fill="#a855f7" stroke="#222" stroke-width="${4 * s}"/>`
}

function balloon(cx, cy, rx, ry, tailX, tailY, lines) {
  const text = lines
    .map(
      (l, i) =>
        `<text x="${cx}" y="${cy - ((lines.length - 1) * 30) / 2 + i * 30 + 10}" text-anchor="middle">${l}</text>`,
    )
    .join('')
  return `
    <path d="M${cx - rx * 0.2} ${cy + ry * 0.8} L ${tailX} ${tailY} L ${cx + rx * 0.15} ${cy + ry * 0.85} Z" fill="#fff" stroke="#111" stroke-width="4"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" stroke="#111" stroke-width="4"/>
    <rect x="${cx - rx * 0.25}" y="${cy + ry * 0.7}" width="${rx * 0.5}" height="${ry * 0.3}" fill="#fff"/>
    ${text}`
}

function caption(x, y, w, h, textLine) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fde68a" stroke="#111" stroke-width="4"/>
    <text x="${x + 18}" y="${y + h / 2 + 10}" font-style="italic">${textLine}</text>`
}

function panel(x, y, w, h, bg, inner) {
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}" stroke="#111" stroke-width="7"/>
    <svg x="${x}" y="${y}" width="${w}" height="${h}" overflow="hidden">${inner}</svg></g>`
}

const pages = [
  // Page 1 – 2×2 grid, one balloon crosses the gutter.
  `${panel(60, 60, 540, 760, '#bfdbfe', `${caption(20, 20, 380, 64, 'JEDNOHO RÁNA NA KOPCI…')}${robot(270, 560, 1.6)}`)}
   ${panel(640, 60, 540, 760, '#bbf7d0', `${star(260, 560, 1.5)}`)}
   ${balloon(610, 250, 170, 90, 760, 440, ['AHOJ, HVĚZDIČKO!', 'KAM LETÍŠ?'])}
   ${panel(60, 860, 540, 834, '#fecaca', `${star(280, 560, 1.5)}${balloon(270, 180, 220, 110, 280, 420, ['NA VÝLET K MĚSÍCI!', 'POLETÍŠ SE MNOU?'])}`)}
   ${panel(640, 860, 540, 834, '#e9d5ff', `${robot(270, 600, 1.5)}${balloon(270, 180, 210, 100, 270, 420, ['JASNĚ!', 'UŽ SE TĚŠÍM!'])}`)}`,
  // Page 2 – wide panel + two panels, sound effect.
  `${panel(
    60,
    60,
    1120,
    700,
    '#dbeafe',
    `${robot(300, 470, 1.6, 'angry')}${star(820, 460, 1.4)}
      <text x="560" y="220" font-size="96" font-weight="900" fill="#dc2626" stroke="#111" stroke-width="3" text-anchor="middle">BUM!</text>
      ${balloon(300, 150, 200, 80, 300, 330, ['AU! TO BOLELO!'])}`,
  )}
   ${panel(60, 800, 540, 894, '#fef9c3', `${star(270, 620, 1.5)}${balloon(270, 200, 230, 120, 280, 480, ['PROMIŇ, ROBÍKU.', 'NEVIDĚLA JSEM', 'TEN KÁMEN.'])}`)}
   ${panel(640, 800, 540, 894, '#dcfce7', `${robot(270, 640, 1.5)}${balloon(270, 200, 220, 110, 270, 470, ['NIC SE NESTALO.', 'LETÍME DÁL!'])}`)}`,
  // Page 3 – three stacked panels.
  `${panel(60, 60, 1120, 520, '#e0e7ff', `${caption(24, 24, 520, 64, 'A TAK LETĚLI AŽ K MĚSÍCI.')}<circle cx="900" cy="260" r="160" fill="#fef3c7" stroke="#111" stroke-width="5"/>`)}
   ${panel(60, 620, 1120, 520, '#fce7f3', `${robot(300, 380, 1.3)}${star(820, 360, 1.2)}${balloon(560, 130, 230, 80, 380, 250, ['TO JE KRÁSA!'])}`)}
   ${panel(60, 1180, 1120, 514, '#ccfbf1', `${caption(24, 24, 360, 64, 'KONEC.')}${star(560, 330, 1.3)}`)}`,
]

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: ${W}px ${H}px; margin: 0 }
  html, body { margin: 0; background: #fff }
  .page { width: ${W}px; height: ${H}px; page-break-after: always; overflow: hidden }
  text { font-family: 'Comic Sans MS', 'Chalkboard SE', 'Marker Felt', sans-serif; font-size: 26px; font-weight: 700; fill: #111 }
</style></head><body>
${pages.map((p) => `<div class="page"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${p}</svg></div>`).join('')}
</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: W, height: H })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  const pdf = await win.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    margins: { marginType: 'none' },
  })
  const dir = join(__dirname, '..', 'test', 'fixtures')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'sample-comic.pdf'), pdf)
  console.log(`wrote ${join(dir, 'sample-comic.pdf')} (${pdf.length} bytes)`)
  app.quit()
})
