// Sounds and speech for announcements. Browsers only allow audio after a user gesture,
// so pages call `unlockAudio()` from a click before relying on these.

let ctx: AudioContext | null = null

export function unlockAudio() {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  // Prime speech synthesis too (Safari/Chrome need a gesture-initiated utterance first).
  if ('speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(''))
}

/** Two-tone "ding-dong" like a real queue display. */
export function chime() {
  if (!ctx) return
  const t = ctx.currentTime
  for (const [i, freq] of [880, 660].entries()) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t + i * 0.45)
    gain.gain.exponentialRampToValueAtTime(0.35, t + i * 0.45 + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.45 + 0.9)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t + i * 0.45)
    osc.stop(t + i * 0.45 + 1)
  }
}

/** Spell a code for speech: "C-014" → "C, 14". */
export const speakableCode = (code: string) => {
  const [prefix, num] = code.split('-')
  return `${prefix.split('').join(' ')}, ${Number(num)}`
}

export function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.rate = 0.9
  u.lang = 'en-PH'
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang === 'en-PH') ?? null
  if (voice) u.voice = voice
  window.speechSynthesis.speak(u)
}

export function buzz() {
  navigator.vibrate?.([300, 150, 300, 150, 600])
}
