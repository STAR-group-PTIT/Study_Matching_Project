// Short 2-note chime for "phase hết giờ" — generated via Web Audio API, no asset file needed.
export function playChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const now = ctx.currentTime
    const notes = [880, 1108.73]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + i * 0.16)
      gain.gain.linearRampToValueAtTime(0.22, now + i * 0.16 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.4)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + i * 0.16)
      osc.stop(now + i * 0.16 + 0.42)
    })
    setTimeout(() => void ctx.close(), 700)
  } catch {
    // Web Audio unavailable/blocked — silently skip, timer UI already shows completion.
  }
}
