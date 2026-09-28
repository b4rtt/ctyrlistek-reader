/**
 * Minimal 16-bit PCM WAV reader/writer plus the processing we need for the
 * system-voice fallback: pitch shifting (resampling), gain, silence trimming
 * and click-free fades.
 */

export interface Pcm {
  sampleRate: number
  samples: Float32Array
}

export function decodeWav(buf: Buffer): Pcm {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Not a WAV file')
  let offset = 12
  let channels = 1
  let sampleRate = 22050
  let bits = 16
  let data: Buffer | null = null
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2)
      sampleRate = buf.readUInt32LE(body + 4)
      bits = buf.readUInt16LE(body + 14)
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(buf.length, body + size))
      break
    }
    offset = body + size + (size % 2)
  }
  if (!data) throw new Error('WAV without data chunk')
  if (bits !== 16) throw new Error(`Unsupported WAV bit depth ${bits}`)
  const frames = Math.floor(data.length / (2 * channels))
  const samples = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let acc = 0
    for (let c = 0; c < channels; c++) acc += data.readInt16LE((i * channels + c) * 2)
    samples[i] = acc / channels / 32768
  }
  return { sampleRate, samples }
}

export function encodeWav(pcm: Pcm): Buffer {
  const n = pcm.samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(pcm.sampleRate, 24)
  buf.writeUInt32LE(pcm.sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, pcm.samples[i]))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf
}

/**
 * Resample by `factor` (> 1 raises pitch and shortens, < 1 lowers pitch and
 * lengthens) using linear interpolation.
 */
export function pitchShift(samples: Float32Array, factor: number): Float32Array {
  if (Math.abs(factor - 1) < 1e-3) return samples
  const outLen = Math.max(1, Math.floor(samples.length / factor))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * factor
    const i0 = Math.floor(pos)
    const i1 = Math.min(samples.length - 1, i0 + 1)
    const frac = pos - i0
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac
  }
  return out
}

/** Remove leading/trailing silence, keeping `padSec` of it on both ends. */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  threshold = 0.012,
  padSec = 0.05,
): Float32Array {
  let start = 0
  let end = samples.length - 1
  while (start < samples.length && Math.abs(samples[start]) < threshold) start++
  while (end > start && Math.abs(samples[end]) < threshold) end--
  if (start >= end) return samples
  const pad = Math.round(padSec * sampleRate)
  return samples.slice(Math.max(0, start - pad), Math.min(samples.length, end + pad))
}

export function applyGainAndFades(
  samples: Float32Array,
  sampleRate: number,
  gain: number,
  fadeSec = 0.008,
): Float32Array {
  const out = new Float32Array(samples.length)
  const fade = Math.min(Math.round(fadeSec * sampleRate), Math.floor(samples.length / 2))
  for (let i = 0; i < samples.length; i++) {
    let g = gain
    if (i < fade) g *= i / fade
    else if (i >= samples.length - fade) g *= (samples.length - 1 - i) / fade
    out[i] = samples[i] * g
  }
  return out
}

export const semitonesToFactor = (st: number): number => Math.pow(2, st / 12)
