import type { Character, ComicDoc } from '@shared/types'
import { assetUrl } from '../api'

interface Props {
  doc: ComicDoc
  character: Character | undefined
  size?: 'normal' | 'small' | 'tiny'
}

/** Character portrait cropped from the page where the AI found their face. */
export function Portrait({ doc, character, size = 'normal' }: Props): React.JSX.Element {
  const color = character?.color ?? '#64748b'
  const page = character?.thumb ? doc.pages[character.thumb.page] : undefined
  const cls = `portrait ${size === 'normal' ? '' : size}`
  const style = { '--char': color } as React.CSSProperties

  if (!character || !page || !character.thumb) {
    const initial = character?.isNarrator ? '📖' : (character?.name.trim()[0] ?? '?').toUpperCase()
    return (
      <div className={cls} style={{ ...style, background: `linear-gradient(145deg, ${color}, #0f1a14)` }}>
        {initial}
      </div>
    )
  }

  // Square crop around the face, expressed with background-size/position.
  const r = character.thumb.rect
  const aspect = page.width / page.height
  const side = Math.max(r.w * aspect, r.h) * 1.35 // in page-height units
  const cw = side / aspect
  const ch = side
  const cx = Math.min(Math.max(r.x + r.w / 2 - cw / 2, 0), Math.max(0, 1 - cw))
  const cy = Math.min(Math.max(r.y + r.h / 2 - ch / 2, 0), Math.max(0, 1 - ch))
  return (
    <div
      className={cls}
      style={{
        ...style,
        backgroundImage: `url("${assetUrl(doc.meta.id, page.image)}")`,
        backgroundSize: `${100 / cw}% ${100 / ch}%`,
        backgroundPosition: `${cw >= 1 ? 0 : (cx / (1 - cw)) * 100}% ${ch >= 1 ? 0 : (cy / (1 - ch)) * 100}%`,
      }}
      title={character.name}
    />
  )
}
