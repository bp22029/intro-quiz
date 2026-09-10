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

/**
 * 早押しの合図。音声ファイルは持たない方針なので Web Audio で組み立てる
 * （mp3 を置くと、読み込み失敗で無音になる事故と、公開時のライセンス管理が増える）。
 *
 * 単音の矩形波だと素っ気ないので、
 *   - 上向きの2音（A5 → E6）にして「押された」勢いを出す
 *   - 各音は矩形波を芯に、1オクターブ上の正弦波を薄く重ねて明るくする
 *   - 立ち上がり8ms・減衰180msで、余韻を残さず切れよく鳴らす
 * という組み立てにしている。全体で約0.26秒。
 */
export function beep(): void {
  const ctx = audioContext;
  if (!ctx || ctx.state !== "running") return;

  try {
    const now = ctx.currentTime;
    const notes = [
      { at: 0, freq: 880 }, // A5
      { at: 0.075, freq: 1318.5 }, // E6
    ];

    for (const note of notes) {
      const t = now + note.at;

      // 音量の型。exponentialRamp は 0 を扱えないので 0.0001 から始める
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.28, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      env.connect(ctx.destination);

      const core = ctx.createOscillator();
      core.type = "square";
      core.frequency.setValueAtTime(note.freq, t);
      const coreGain = ctx.createGain();
      coreGain.gain.value = 0.5;
      core.connect(coreGain).connect(env);
      core.start(t);
      core.stop(t + 0.2);

      const shine = ctx.createOscillator();
      shine.type = "sine";
      shine.frequency.setValueAtTime(note.freq * 2, t);
      const shineGain = ctx.createGain();
      shineGain.gain.value = 0.18;
      shine.connect(shineGain).connect(env);
      shine.start(t);
      shine.stop(t + 0.2);
    }
  } catch {
    // 未解除・一時停止などで再生できない場合も、早押し処理は止めない。
  }
}

// --- 音源ファイル ---
//
// 早押しの効果音は public/sfx/buzz.mp3 を使う。new Audio() ではなく
// AudioContext に取り込んでおくのは、鳴らすまでの遅延を小さくするためと、
// 早押し連打で音が詰まらないようにするため。
//
// 読み込みに失敗しても無音にはしない。上の beep() が代わりに鳴る。

const BUZZ_URL = "/sfx/buzz.mp3";

let buzzBuffer: AudioBuffer | null = null;

/**
 * 音源を先読みしてデコードしておく。
 * 「投影を開始する」「操作をはじめる」のクリックから呼ぶ想定
 * （AudioContext はそこで初めて作られるため）。
 */
export async function preloadSfx(): Promise<void> {
  const ctx = audioContext;
  if (!ctx || buzzBuffer) return;

  try {
    const res = await fetch(BUZZ_URL);
    if (!res.ok) return;
    buzzBuffer = await ctx.decodeAudioData(await res.arrayBuffer());
  } catch {
    // 取得・デコードに失敗したら合成音へ落ちる
  }
}

/** 早押しの合図を鳴らす。音源が無ければ合成音へ落ちる */
export function playBuzz(): void {
  const ctx = audioContext;
  if (!ctx || ctx.state !== "running") return;

  if (buzzBuffer) {
    try {
      const src = ctx.createBufferSource();
      src.buffer = buzzBuffer;
      src.connect(ctx.destination);
      src.start();
      return;
    } catch {
      // 再生できなければ合成音へ落ちる
    }
  }

  beep();
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
