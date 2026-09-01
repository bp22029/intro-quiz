let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  if (typeof window === "undefined") return null;

  const AudioContextClass =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextClass) return null;

  try {
    audioContext = new AudioContextClass();
  } catch {
    return null;
  }

  return audioContext;
}

/** モジュールスコープで AudioContext を1つだけ持つ。毎回 new しない */
export function beep(): void {
  const ctx = audioContext;
  if (!ctx || ctx.state !== "running") return;

  try {
    // 880Hz を 0.12 秒。矩形波でよく通る音になる
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.13);
  } catch {
    // 未解除・一時停止などで再生できない場合も、早押し処理は止めない。
  }
}

/** 「準備完了」ボタンのクリックハンドラから呼ぶ。AudioContext.resume() する */
export function unlockAudio(): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx || ctx.state === "running") return Promise.resolve();
  return ctx.resume();
}

/** 解除済みかどうか。投影画面の警告表示に使う */
export function isAudioUnlocked(): boolean {
  return audioContext?.state === "running";
}
