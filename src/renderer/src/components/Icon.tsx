/** Small inline SVG icon set (stroke icons, 24×24 grid). */
const PATHS: Record<string, string> = {
  play: 'M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z',
  pause: 'M7 4h3.5v16H7zM13.5 4H17v16h-3.5z',
  next: 'M5 5v14l10-7L5 5Zm12 0v14',
  prev: 'M19 5v14L9 12l10-7ZM7 5v14',
  back: 'M15 5 8 12l7 7',
  close: 'M6 6l12 12M18 6 6 18',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-2.1.9 1.7-1.9 3.2-1.9-.3a7.6 7.6 0 0 1-1.7 1l-.6 1.9h-3.8l-.6-1.9a7.6 7.6 0 0 1-1.7-1l-1.9.3-1.9-3.2.9-1.7a7.8 7.8 0 0 1 0-2l-.9-1.7 1.9-3.2 1.9.3a7.6 7.6 0 0 1 1.7-1l.6-1.9h3.8l.6 1.9c.6.25 1.2.58 1.7 1l1.9-.3 1.9 3.2-.9 1.7c.1.66.1 1.34 0 2Z',
  upload: 'M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
  check: 'M5 12.5 10 17 19 7',
  warn: 'M12 9v4m0 4h.01M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  subtitles: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Zm4 8h4m3 0h3M7 10h2m3 0h5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  refresh: 'M20 11a8 8 0 0 0-14.8-4M4 5v4h4m-4 4a8 8 0 0 0 14.8 4M20 19v-4h-4',
  wand: 'M5 19 16 8m2-4v2m0 4v2m-4-6h2m4 0h2M8 4v2M7 5h2m9 11v2m-1-1h2',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm-6-3a6 6 0 0 0 12 0M12 18v3',
  volume: 'M4 9v6h4l5 4V5L8 9H4Zm12.5-1.5a6 6 0 0 1 0 9M19 5a9.5 9.5 0 0 1 0 14',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5',
  users: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm13 9v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8',
  pages: 'M7 3h8l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm8 0v4h4M9 13h6m-6 4h4',
  plus: 'M12 5v14M5 12h14',
  up: 'M12 19V5m-6 6 6-6 6 6',
  down: 'M12 5v14m6-6-6 6-6-6',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 12 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z',
  replay: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4',
  info: 'M12 16v-5m0-3h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20, stroke = 2 }: { name: IconName; size?: number; stroke?: number }): React.JSX.Element {
  const filled = name === 'play' || name === 'pause'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
