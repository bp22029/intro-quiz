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
// 効果音は public/sfx/ のファイルを使う。new Audio() ではなく AudioContext に
// 取り込んでおくのは、鳴らすまでの遅延を小さくするためと、連打で音が詰まらない
// ようにするため。
//
// 読み込みに失敗しても無音にはしない。合成音が代わりに鳴る。

const SFX_URL = {
  buzz: "/sfx/buzz.mp3", // 早押し
  wrong: "/sfx/wrong.mp3", // お手つき（不正解）
} as const;

type SfxName = keyof typeof SFX_URL;

const buffers = new Map<SfxName, AudioBuffer>();

/**
 * 音源を先読みしてデコードしておく。
 * 「投影を開始する」「操作をはじめる」のクリックから呼ぶ想定
 * （AudioContext はそこで初めて作られるため）。
 */
export async function preloadSfx(): Promise<void> {
  const ctx = audioContext;
  if (!ctx) return;

  await Promise.all(
    (Object.keys(SFX_URL) as SfxName[]).map(async (name) => {
      if (buffers.has(name)) return;
      try {
        const res = await fetch(SFX_URL[name]);
        if (!res.ok) return;
        buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
      } catch {
        // 取得・デコードに失敗した音は諦める。合成音へ落ちる。
      }
    }),
  );
}

/** 音源を鳴らす。鳴らせたら true。無ければ false を返して呼び元が合成音へ落とす */
function playFile(name: SfxName): boolean {
  const ctx = audioContext;
  if (!ctx || ctx.state !== "running") return false;

  const buffer = buffers.get(name);
  if (!buffer) return false;

  try {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
    return true;
  } catch {
    return false;
  }
}

/** 早押しの合図。音源が無ければ合成音へ落ちる */
export function playBuzz(): void {
  if (audioContext?.state !== "running") return;
  if (!playFile("buzz")) beep();
}

/** お手つきの合図。音源が無ければ合成音へ落ちる */
export function playWrong(): void {
  if (audioContext?.state !== "running") return;
  if (!playFile("wrong")) wrongBeep();
}

/**
 * お手つきの合成音。早押し音と取り違えないよう、性格を逆にしてある。
 *   - 下向きの2音（A3 → E3）。早押しは上向きなので、聞けば区別できる
 *   - のこぎり波で濁らせ、減衰を長めにして「ブブー」に寄せる
 */
function wrongBeep(): void {
  const ctx = audioContext;
  if (!ctx || ctx.state !== "running") return;

  try {
    const now = ctx.currentTime;
    const notes = [
      { at: 0, freq: 220 }, // A3
      { at: 0.16, freq: 164.8 }, // E3
    ];

    for (const note of notes) {
      const t = now + note.at;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.3, t + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      env.connect(ctx.destination);

      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(note.freq, t);
      osc.connect(env);
      osc.start(t);
      osc.stop(t + 0.32);
    }
  } catch {
    // 鳴らせなくても進行は止めない。
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
