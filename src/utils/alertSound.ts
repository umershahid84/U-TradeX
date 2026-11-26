// A short beep for alerts. Browsers only allow sound after a click on the page, so the audio context is created (or
// resumed) from a click handler, and later alerts reuse it.
let ctx: AudioContext | null = null;

export const enableSound = (): boolean => {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    ctx ??= new AC();
    void ctx.resume();
    return true;
  } catch {
    return false;
  }
};

/** entry: two rising tones; target: three quick ones */
export const playAlert = (kind: 'entry' | 'target') => {
  if (!ctx || ctx.state === 'closed') return;
  try {
    const tones = kind === 'entry' ? [660, 880] : [880, 1100, 1320];
    const t0 = ctx.currentTime + 0.02;
    tones.forEach((f, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      const start = t0 + i * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + 0.15);
    });
  } catch {
    /* no sound */
  }
};
