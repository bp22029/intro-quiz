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

          const player = new window.YT.Player(element, {
            playerVars: {
              controls: 0,
              disablekb: 1,
              rel: 0,
              modestbranding: 1,
              playsinline: 1,
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

  const play = useCallback(
    (index: number): void => {
      const player = getControllablePlayer(index);
      if (!player) return;

      try {
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
        player.setVolume(volumeOf(songsRef.current[index], masterRef.current));
        player.seekTo(Math.max(0, sec), true);
        player.playVideo();
      } catch {
        // 未準備などのAPI例外は画面操作へ波及させない。
      }
    },
    [getControllablePlayer],
  );

  const setVolume = useCallback(
    (index: number, value: number): void => {
      const player = getControllablePlayer(index);
      if (!player) return;

      try {
        player.setVolume(Math.max(0, Math.min(100, Math.round(value))));
      } catch {
        // 未準備などのAPI例外は画面操作へ波及させない。
      }
    },
    [getControllablePlayer],
  );

  const seekToStart = useCallback(
    (index: number): void => {
      const player = getControllablePlayer(index);
      if (!player) return;

      try {
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
  };
}

/** エラーコードを日本語文言にする。101 と 150 は「埋め込み再生が禁止されています」 */
export function ytErrorMessage(code: number): string {
  if (code === 101 || code === 150) {
    return "埋め込み再生が禁止されています";
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
