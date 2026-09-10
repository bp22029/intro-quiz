import { useCallback, useEffect, useRef, useState } from "react";
import type { Song } from "./types";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export type YouTubeController = {
  /** 全プレイヤーの onReady が揃ったか */
  ready: boolean;
  /** 進捗表示用。「3 / 4 準備完了」 */
  readyCount: number;
  total: number;
  /** 曲index -> YouTube エラーコード。onError で埋める */
  errors: Record<number, number>;

  /** 各曲の <div> に付ける ref コールバックを返す。<div ref={ctrl.registerRef(i)} /> */
  registerRef: (index: number) => (el: HTMLDivElement | null) => void;

  play: (index: number) => void;
  pause: (index: number) => void;
  /** songs[index].startSec に頭出しして一時停止状態に戻す */
  seekToStart: (index: number) => void;
  /** 指定秒へジャンプしてそのまま再生する（サビ再生用） */
  seekAndPlay: (index: number, sec: number) => void;
  /** 曲ごとの音量を即座に反映する（0-100）。スライダー用 */
  setVolume: (index: number, value: number) => void;
  /**
   * 指定秒へジャンプし、小さい音量から ms ミリ秒かけて本来の音量まで上げながら再生する。
   * 「正解は…」の溜めのあいだの助走に使う。曲がぬるっと立ち上がってくる。
   */
  fadeInAndPlay: (index: number, sec: number, ms: number) => void;
};

/** その曲を鳴らす音量。曲に設定が無ければ全体音量に従う */
function volumeOf(song: Song | undefined, master: number): number {
  const v = Number(song?.volume);
  const base = Number.isFinite(v) ? v : master;
  return Math.max(0, Math.min(100, Number.isFinite(base) ? base : 100));
}

let apiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject();
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>((resolve, reject) => {
    const previousReadyHandler = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      try {
        if (typeof previousReadyHandler === "function") {
          previousReadyHandler();
        }
      } finally {
        resolve();
      }
    };

    let script = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );

    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }

    script.addEventListener(
      "error",
      () => {
        apiPromise = null;
        reject();
      },
      { once: true },
    );
  });

  return apiPromise;
}

/** enabled=false（手動モード）のときはプレイヤーを一切作らない */
export function useYouTube(
  songs: Song[],
  enabled: boolean,
  masterVolume: number,
): YouTubeController {
  const elementsRef = useRef<Array<HTMLDivElement | null>>([]);
  const refCallbacksRef = useRef(
    new Map<number, (el: HTMLDivElement | null) => void>(),
  );
  const playersRef = useRef<any[]>([]);
  const readyFlagsRef = useRef<boolean[]>([]);
  const errorsRef = useRef<Record<number, number>>({});
  const enabledRef = useRef(enabled);
  const songsRef = useRef(songs);
  // 再生のたびに最新の値を読む。ここが変わってもプレイヤーは作り直さない。
  const masterRef = useRef(masterVolume);
  // フェードイン中のタイマー。別の操作が入ったら必ず止める。
  const fadeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);

  const [refVersion, setRefVersion] = useState(0);
  const [readyCount, setReadyCount] = useState(0);
  const [errors, setErrors] = useState<Record<number, number>>({});

  enabledRef.current = enabled;
  songsRef.current = songs;
  masterRef.current = masterVolume;

  const registerRef = useCallback(
    (index: number): ((el: HTMLDivElement | null) => void) => {
      let callback = refCallbacksRef.current.get(index);

      if (!callback) {
        callback = (el: HTMLDivElement | null) => {
          if (elementsRef.current[index] === el) return;
          elementsRef.current[index] = el;
          setRefVersion((version) => version + 1);
        };
        refCallbacksRef.current.set(index, callback);
      }

      return callback;
    },
    [],
  );

  const songsKey = songs
    .map(
      ({ videoId, startSec }) =>
        `${videoId.length}:${videoId}:${String(startSec)}`,
    )
    .join("|");

  useEffect(() => {
    const generation = ++generationRef.current;
    const createdPlayers: any[] = [];
    let cancelled = false;

    playersRef.current = [];
    readyFlagsRef.current = Array(songs.length).fill(false);
    errorsRef.current = {};
    setReadyCount(0);
    setErrors({});

    if (!enabled) return;

    const elements = songs.map((_, index) => elementsRef.current[index]);
    if (elements.some((element) => !element)) return;

    void loadYouTubeApi()
      .then(() => {
        if (cancelled || generationRef.current !== generation) return;

        playersRef.current = createdPlayers;

        songs.forEach((song, index) => {
          const element = elements[index];
          if (!element) return;

          if (!song.videoId) {
            // 動画IDが未設定の行にはプレイヤーを作らない。
            // 作ると onReady が来ないまま「準備中」で止まり、
            // その1行のせいで全曲の再生ボタンが押せなくなる。
            if (!readyFlagsRef.current[index]) {
              readyFlagsRef.current[index] = true;
              setReadyCount((count) => count + 1);
            }
            return;
          }

          const player = new window.YT.Player(element, {
            playerVars: {
              controls: 0,
              disablekb: 1,
              rel: 0,
              modestbranding: 1,
              playsinline: 1,
              // 字幕とアノテーションを出さない。歌詞の字幕が出ると答えが見えるうえ、
              // 小さい枠では画面の半分を覆ってしまう。
              // なお視聴者のアカウントが「字幕を常に表示」になっている場合は、
              // ここでは抑えきれない（YouTube 側の設定が優先される）。
              cc_load_policy: 0,
              iv_load_policy: 3,
            },
            events: {
              onReady: (event: any) => {
                if (cancelled || generationRef.current !== generation) return;

                event.target.cueVideoById({
                  videoId: song.videoId,
                  startSeconds: song.startSec,
                });
                event.target.setVolume(
                  volumeOf(songsRef.current[index], masterRef.current),
                );

                if (!readyFlagsRef.current[index]) {
                  readyFlagsRef.current[index] = true;
                  setReadyCount((count) => count + 1);
                }
              },
              onError: (event: any) => {
                if (cancelled || generationRef.current !== generation) return;

                const code = Number(event.data);
                errorsRef.current = {
                  ...errorsRef.current,
                  [index]: code,
                };
                setErrors(errorsRef.current);
              },
            },
          });

          createdPlayers[index] = player;
        });
      })
      .catch(() => {
        // API自体を読み込めない場合は未準備のままにし、操作をno-opにする。
      });

    return () => {
      cancelled = true;
      if (fadeTimer.current !== null) {
        clearInterval(fadeTimer.current);
        fadeTimer.current = null;
      }
      createdPlayers.forEach((player) => {
        try {
          player?.destroy();
        } catch {
          // 破棄済みでも後続のクリーンアップを続ける。
        }
      });

      if (generationRef.current === generation) {
        playersRef.current = [];
      }
    };
  }, [enabled, songsKey, refVersion]);

  const getControllablePlayer = useCallback((index: number): any | null => {
    if (!enabledRef.current || !Number.isInteger(index)) return null;
    if (index < 0 || index >= songsRef.current.length) return null;
    if (!readyFlagsRef.current[index]) return null;
    if (Object.prototype.hasOwnProperty.call(errorsRef.current, index)) {
      return null;
    }
    return playersRef.current[index] ?? null;
  }, []);

  /** フェードインを打ち切る。別の再生操作が入るたびに呼ぶ */
  const cancelFade = useCallback((): void => {
    if (fadeTimer.current !== null) {
      clearInterval(fadeTimer.current);
      fadeTimer.current = null;
    }
  }, []);

  const play = useCallback(
    (index: number): void => {
      const player = getControllablePlayer(index);
      if (!player) return;

      try {
        cancelFade(); // 上げ途中で放置しない
        player.setVolume(volumeOf(songsRef.current[index], masterRef.current));
        player.playVideo();
      } catch {
        // 未準備などのAPI例外は画面操作へ波及させない。
      }
    },
    [getControllablePlayer],
  );

  const pause = useCallback(
    (index: number): void => {
      const player = getControllablePlayer(index);
      if (!player) return;

      try {
        cancelFade();
        player.pauseVideo();
      } catch {
        // 未準備などのAPI例外は画面操作へ波及させない。
      }
    },
    [getControllablePlayer],
  );

  const seekAndPlay = useCallback(
    (index: number, sec: number): void => {
      const player = getControllablePlayer(index);
      if (!player) return;

      try {
        cancelFade();
        player.setVolume(volumeOf(songsRef.current[index], masterRef.current));
        player.seekTo(Math.max(0, sec), true);
        player.playVideo();
      } catch {
        // 未準備などのAPI例外は画面操作へ波及させない。
      }
    },
    [getControllablePlayer],
  );

  const fadeInAndPlay = useCallback(
    (index: number, sec: number, ms: number): void => {
      const player = getControllablePlayer(index);
      if (!player) return;

      cancelFade();
      const target = volumeOf(songsRef.current[index], masterRef.current);
      // 完全な無音から始めると出だしが聞こえないので、少し残して始める
      const from = Math.round(target * 0.15);
      const stepMs = 100;
      const steps = Math.max(1, Math.round(ms / stepMs));

      try {
        player.setVolume(from);
        player.seekTo(Math.max(0, sec), true);
        player.playVideo();
      } catch {
        return; // 未準備などはここで諦める
      }

      let done = 0;
      fadeTimer.current = setInterval(() => {
        done++;
        const v = Math.round(from + (target - from) * (done / steps));
        try {
          player.setVolume(Math.min(target, Math.max(0, v)));
        } catch {
          cancelFade();
          return;
        }
        if (done >= steps) cancelFade();
      }, stepMs);
    },
    [getControllablePlayer, cancelFade],
  );

  const setVolume = useCallback(
    (index: number, value: number): void => {
      const player = getControllablePlayer(index);
      if (!player) return;

      try {
        cancelFade(); // スライダーを触ったらフェードより手動を優先する
        player.setVolume(Math.max(0, Math.min(100, Math.round(value))));
      } catch {
        // 未準備などのAPI例外は画面操作へ波及させない。
      }
    },
    [getControllablePlayer, cancelFade],
  );

  const seekToStart = useCallback(
    (index: number): void => {
      const player = getControllablePlayer(index);
      if (!player) return;

      try {
        cancelFade();
        player.setVolume(volumeOf(songsRef.current[index], masterRef.current));
        player.seekTo(songsRef.current[index].startSec, true);
        player.pauseVideo();
      } catch {
        // 未準備などのAPI例外は画面操作へ波及させない。
      }
    },
    [getControllablePlayer],
  );

  const visibleReadyCount = enabled ? readyCount : 0;

  return {
    ready: enabled && visibleReadyCount === songs.length,
    readyCount: visibleReadyCount,
    total: songs.length,
    errors: enabled ? errors : {},
    registerRef,
    play,
    pause,
    seekToStart,
    seekAndPlay,
    setVolume,
    fadeInAndPlay,
  };
}

/** エラーコードを日本語文言にする。101 と 150 は「埋め込み再生が禁止されています」 */
export function ytErrorMessage(code: number): string {
  if (code === 101 || code === 150) {
    // 埋め込み設定が禁止のときだけでなく、Music Premium 限定・地域制限・
    // 年齢制限でも同じコードが返る。oEmbed は埋め込み設定しか見ないので、
    // 事前チェックが 200 でもここで落ちることがある。
    // 「埋め込み禁止」と言い切ると原因を探す先を誤らせるので、断定しない。
    return "この環境では再生できません";
  }

  switch (code) {
    case 2:
      return "動画IDまたはリクエストが不正です";
    case 5:
      return "HTML5プレイヤーで再生できません";
    case 100:
      return "動画が見つからないか、非公開です";
    default:
      return `YouTubeエラー（コード: ${code}）`;
  }
}
