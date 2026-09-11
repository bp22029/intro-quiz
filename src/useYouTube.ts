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
  /**
   * エラー表示を消して、その曲を頭出しし直す。
   * 一度エラーが出た曲は操作を受け付けなくなるので、司会が手で戻せるようにする。
   */
  retry: (index: number) => void;
};

/**
 * プレイヤーを作ること自体に失敗したときのコード。
 * YouTube のエラーコード（2/5/100/101/150）とぶつからない値を使う。
 */
const PLAYER_INIT_FAILED = -1;

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

  /** その曲の準備完了を1度だけ数える */
  const markReady = useCallback((index: number): void => {
    if (readyFlagsRef.current[index]) return;
    readyFlagsRef.current[index] = true;
    setReadyCount((count) => count + 1);
  }, []);

  const markError = useCallback((index: number, code: number): void => {
    errorsRef.current = { ...errorsRef.current, [index]: code };
    setErrors(errorsRef.current);
  }, []);

  /**
   * その曲のエラー表示を消す。
   * エラーが出た曲は getControllablePlayer が弾くので、一度出ると
   * 曲を差し替えるまで管理画面から操作できないままになる。
   * 一時的な失敗（読み込み中の通信断など）から戻れる口をここで開ける。
   */
  const clearError = useCallback((index: number): void => {
    if (!Object.prototype.hasOwnProperty.call(errorsRef.current, index)) return;
    const next = { ...errorsRef.current };
    delete next[index];
    errorsRef.current = next;
    setErrors(next);
  }, []);

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

    const containers = songs.map((_, index) => elementsRef.current[index]);
    if (containers.some((container) => !container)) return;

    void loadYouTubeApi()
      .then(() => {
        if (cancelled || generationRef.current !== generation) return;

        playersRef.current = createdPlayers;

        songs.forEach((song, index) => {
          const container = containers[index];
          if (!container) return;

          if (!song.videoId) {
            // 動画IDが未設定の行にはプレイヤーを作らない。
            // 作ると onReady が来ないまま「準備中」で止まり、
            // その1行のせいで全曲の再生ボタンが押せなくなる。
            markReady(index);
            return;
          }

          // YouTube API は渡した要素を iframe で「置き換える」。React が持つ
          // 参照は置換前の div のまま残るので、曲を差し替えたあと同じ参照へ
          // 作り直すと、親を失った要素への置換になって例外が飛ぶ。
          // それが下の catch に飲まれて「動画を準備中… 0 / 10」から進まなく
          // なっていた。毎回ここで使い捨ての div を作り、React が中身を
          // 触らない場所（ref で受けた箱の内側）を YouTube に差し出す。
          container.replaceChildren();
          const mount = document.createElement("div");
          container.appendChild(mount);

          try {
            createdPlayers[index] = new window.YT.Player(mount, {
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

                  markReady(index);
                },
                onStateChange: (event: any) => {
                  if (cancelled || generationRef.current !== generation) return;

                  // 実際に音が出ている（PLAYING / BUFFERING）なら、前に出た
                  // エラーはもう過去のもの。埋め込みを直接クリックすれば鳴るのに
                  // 管理画面からは操作できない、という状態から戻す。
                  const state = Number(event.data);
                  if (state === 1 || state === 3) clearError(index);
                },
                onError: (event: any) => {
                  if (cancelled || generationRef.current !== generation) return;

                  markError(index, Number(event.data));
                },
              },
            });
          } catch {
            // 1曲の失敗で残りの曲まで作り損ねない。その曲だけエラーにして、
            // 他の曲の再生ボタンは押せるようにする。
            markError(index, PLAYER_INIT_FAILED);
            markReady(index);
          }
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
      // destroy() が取り残した iframe を片付ける。次の世代は空の箱から始める。
      containers.forEach((container) => container?.replaceChildren());

      if (generationRef.current === generation) {
        playersRef.current = [];
      }
    };
  }, [enabled, songsKey, refVersion, markReady, markError, clearError]);

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

  const retry = useCallback(
    (index: number): void => {
      const song = songsRef.current[index];
      const player = playersRef.current[index];
      // エラー中の曲は getControllablePlayer が弾くので、ここでは直接触る。
      if (!player || !song?.videoId) return;

      cancelFade();
      clearError(index);
      try {
        player.cueVideoById({
          videoId: song.videoId,
          startSeconds: song.startSec,
        });
        player.setVolume(volumeOf(song, masterRef.current));
      } catch {
        markError(index, PLAYER_INIT_FAILED);
      }
    },
    [cancelFade, clearError, markError],
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
    retry,
  };
}

/** エラーコードを日本語文言にする。101 と 150 は「埋め込み再生が禁止されています」 */
export function ytErrorMessage(code: number): string {
  if (code === 101 || code === 150) {
    // 埋め込み設定が禁止のときだけでなく、YouTube Premium 限定・地域制限・
    // 年齢制限でも同じコードが返る。oEmbed は埋め込み設定しか見ないので、
    // 事前チェックが 200 でもここで落ちることがある。
    // 「埋め込み禁止」と言い切ると原因を探す先を誤らせるので、断定しない。
    return "この環境では再生できません";
  }

  switch (code) {
    case PLAYER_INIT_FAILED:
      return "プレイヤーを作れませんでした";
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
