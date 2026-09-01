import { useCallback, useEffect, useRef, useState } from "react";
import { beep, isAudioUnlocked, unlockAudio } from "./beep";
import { socket } from "./socket";
import type { PlayMode, Player, Song, State } from "./types";
import { useYouTube, ytErrorMessage } from "./useYouTube";

const EMPTY: State = { buzzedBy: null, lockedIds: [], players: [] };

/** クリック後にフォーカスを外す。Space/Enter で意図せず再発火するのを防ぐ */
function blur(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.blur();
}

export default function ScreenView() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [state, setState] = useState<State>(EMPTY);
  const [url, setUrl] = useState<string>(window.location.origin);

  const [started, setStarted] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [mode, setMode] = useState<PlayMode>("youtube");
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // この問題で一度でも曲を鳴らしたか。鳴らす前に答えを出せてしまう事故を防ぐ
  const [hasPlayed, setHasPlayed] = useState(false);

  const yt = useYouTube(songs, mode === "youtube");

  // buzzed 受信時に常に最新の値を読むための ref
  const ytRef = useRef(yt);
  ytRef.current = yt;
  const liveRef = useRef({ mode, index });
  liveRef.current = { mode, index };

  // --- データ読み込み ---
  useEffect(() => {
    fetch("/songs.json")
      .then((res) => res.json())
      .then((data: Song[]) => setSongs(Array.isArray(data) ? data : []))
      .catch(() => setSongs([]));
    fetch("/api/url")
      .then((res) => res.json())
      .then((d: { url: string }) => d.url && setUrl(d.url))
      .catch(() => {});
  }, []);

  // --- Socket ---
  useEffect(() => {
    const onState = (s: State) => setState(s);
    const onBuzzed = (_p: Player) => {
      // 両モード必須。手動モードではこれが唯一の停止トリガーになる。
      beep();
      if (liveRef.current.mode === "youtube") {
        ytRef.current.pause(liveRef.current.index);
      }
    };
    socket.on("state", onState);
    socket.on("buzzed", onBuzzed);
    return () => {
      socket.off("state", onState);
      socket.off("buzzed", onBuzzed);
    };
  }, []);

  // 押されたら再生表示を止める
  useEffect(() => {
    if (state.buzzedBy) setPlaying(false);
  }, [state.buzzedBy]);

  // --- 経過秒数 ---
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [playing]);

  const song = songs[index];

  // --- 操作 ---

  const goToSong = useCallback(
    (next: number) => {
      if (songs.length === 0) return;
      const clamped = Math.max(0, Math.min(songs.length - 1, next));
      if (mode === "youtube") {
        yt.pause(index);
        yt.seekToStart(clamped);
      }
      setIndex(clamped);
      setRevealed(false);
      setPlaying(false);
      setHasPlayed(false);
      setElapsed(0);
      socket.emit("host:nextRound");
    },
    [songs.length, mode, yt, index],
  );

  const togglePlay = useCallback(() => {
    if (mode !== "youtube") return;
    if (playing) {
      yt.pause(index);
      setPlaying(false);
    } else {
      yt.play(index);
      setPlaying(true);
      setHasPlayed(true);
    }
  }, [mode, playing, yt, index]);

  const markCorrect = useCallback(() => {
    setRevealed(true);
    setPlaying(false);
    // テレビ番組と同じく、答えを出した瞬間にサビを鳴らす
    if (mode === "youtube" && song) {
      yt.seekAndPlay(index, song.chorusSec ?? song.startSec);
    }
  }, [mode, song, yt, index]);

  const markWrong = useCallback(() => {
    if (!state.buzzedBy) return;
    const afterReveal = revealed;
    socket.emit("host:wrong");
    setRevealed(false);
    // 答えを出した後は曲を鳴らし直しても問題として成立しないので再開しない
    if (mode === "youtube" && !afterReveal) {
      yt.play(index);
      setPlaying(true);
    } else if (mode === "youtube") {
      yt.pause(index);
    }
  }, [state.buzzedBy, revealed, mode, yt, index]);

  const stopChorus = useCallback(() => {
    if (mode === "youtube") yt.pause(index);
  }, [mode, yt, index]);

  const errorCodes = Object.entries(yt.errors);
  const buzzed = state.buzzedBy;
  // 現在の曲が YouTube 側で再生できない状態か
  const currentError: number | undefined = yt.errors[index];
  // 曲を鳴らす前に答えを出せてしまうと問題が成立しない。
  // 手動モードは再生をアプリが把握できないので、この制限をかけない。
  const canReveal =
    !revealed && (mode === "manual" || hasPlayed || !!buzzed || !!currentError);

  // -------------------------------------------------------------------------
  // 準備画面
  // -------------------------------------------------------------------------
  if (!started) {
    const waitingYT = mode === "youtube" && !yt.ready && songs.length > 0;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-10 p-10">
        <h1 className="text-7xl font-black tracking-tight">イントロクイズ</h1>

        {!unlocking ? (
          <button
            className="rounded-2xl bg-red-600 px-20 py-8 text-4xl font-bold hover:bg-red-500"
            onClick={async (e) => {
              blur(e);
              setUnlocking(true);
              await unlockAudio();
              beep();
            }}
          >
            準備をはじめる
          </button>
        ) : (
          <>
            <div className="flex items-center gap-8 text-3xl">
              <StatusDot ok={isAudioUnlocked()} />
              <span>音声{isAudioUnlocked() ? "OK（ピッと鳴りましたか？）" : "未解除"}</span>
            </div>
            {mode === "youtube" ? (
              <div className="flex items-center gap-8 text-3xl">
                <StatusDot ok={yt.ready} />
                <span>
                  曲の読み込み {yt.readyCount} / {yt.total} 曲
                </span>
              </div>
            ) : (
              <div className="text-3xl text-neutral-400">
                手動モード（曲は手元で再生します）
              </div>
            )}

            {errorCodes.length > 0 && (
              <div className="rounded-xl bg-red-950 px-8 py-5 text-2xl text-red-300">
                {errorCodes.map(([i, code]) => (
                  <div key={i}>
                    第{Number(i) + 1}問: {ytErrorMessage(Number(code))}
                  </div>
                ))}
              </div>
            )}

            <button
              className="rounded-2xl bg-green-600 px-20 py-8 text-4xl font-bold hover:bg-green-500"
              onClick={(e) => {
                blur(e);
                setStarted(true);
              }}
            >
              {waitingYT ? "読み込みを待たずに開始" : "開始する"}
            </button>
          </>
        )}

        <button
          className="rounded-xl border border-neutral-700 px-8 py-3 text-xl text-neutral-400 hover:bg-neutral-800"
          onClick={(e) => {
            blur(e);
            setMode((m) => (m === "youtube" ? "manual" : "youtube"));
          }}
        >
          再生モード: {mode === "youtube" ? "YouTube" : "手動"}（切り替える）
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // 本編
  // -------------------------------------------------------------------------
  return (
    <div className="flex h-full flex-col bg-neutral-950">
      <div className="flex min-h-0 flex-1">
        {/* 左: QR と参加者 */}
        <aside className="flex w-[300px] shrink-0 flex-col gap-5 border-r border-neutral-800 p-6">
          <img src="/qr.png" alt="参加用QR" className="w-full rounded-xl bg-white p-2" />
          <div className="text-center text-base leading-tight text-neutral-500">
            {url.replace(/^https?:\/\//, "")}
          </div>
          <div className="min-h-0 flex-1">
            <div className="pb-3 text-xl text-neutral-500">
              参加者 {state.players.length}人
            </div>
            <ul className="flex flex-wrap gap-2">
              {state.players.map((p) => {
                const locked = state.lockedIds.includes(p.id);
                return (
                  <li
                    key={p.id}
                    className={`rounded-lg px-3 py-1.5 text-xl ${
                      locked
                        ? "bg-neutral-900 text-neutral-600"
                        : "bg-neutral-800 text-neutral-100"
                    }`}
                  >
                    {p.name}
                    {locked && <span className="ml-2 text-sm">お手つき</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        {/* 右: メイン表示 */}
        <main
          className={`relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden px-8 transition-colors duration-150 ${
            buzzed && !revealed ? "bg-emerald-700" : "bg-neutral-950"
          }`}
        >
          <div className="absolute left-6 top-5 text-xl text-neutral-500">
            第 {index + 1} 問 / 全 {songs.length || "-"} 問
          </div>
          <div className="absolute right-6 top-5 text-xl text-neutral-500">
            {mode === "youtube" ? "YouTube" : "手動"}
          </div>

          {revealed ? (
            <div className="text-center">
              <div className="mb-3 text-3xl tracking-[0.3em] text-neutral-500">
                こたえ
              </div>
              <div className="break-all text-[8vw] font-black leading-[1.05]">
                {song?.title ?? "-"}
              </div>
              <div className="mt-3 text-[4vw] font-bold leading-tight text-neutral-300">
                {song?.artist ?? ""}
              </div>
              <div className="mt-8 inline-block rounded-2xl bg-amber-400 px-8 py-3 text-[2.6vw] font-black text-neutral-900">
                {song?.owner ?? "?"} さんの推し曲
              </div>
              {buzzed && (
                <div className="mt-6 text-3xl text-emerald-400">
                  正解者: {buzzed.name} さん
                </div>
              )}
            </div>
          ) : buzzed ? (
            <div className="text-center">
              <div className="mb-2 text-4xl font-bold text-emerald-100">
                回答者
              </div>
              <div className="break-all text-[12vw] font-black leading-none">
                {buzzed.name}
              </div>
            </div>
          ) : playing ? (
            <div className="text-center">
              <div className="text-[16vw] font-black leading-none tabular-nums">
                {elapsed}
              </div>
              <div className="text-4xl text-neutral-500">秒</div>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-[14vw] font-black leading-none">
                第 {index + 1} 問
              </div>
              <div className="mt-6 text-3xl text-neutral-500">
                {mode === "youtube" ? "「再生」で開始" : "手元で曲を再生してください"}
              </div>
            </div>
          )}

          {/* YouTube プレイヤーは音源としてのみ使う。映像は常に隠す（MVが無い曲があるため） */}
          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-0">
            {songs.map((_, i) => (
              <div
                key={i}
                className="yt-slot absolute h-full w-full"
                style={i === index ? { left: 0, top: 0 } : { left: "-200vw", top: 0 }}
              >
                <div className="h-full w-full" ref={yt.registerRef(i)} />
              </div>
            ))}
          </div>

          {currentError !== undefined && (
            <div className="absolute inset-x-8 bottom-6 rounded-xl border-2 border-red-500 bg-red-950/95 px-6 py-4 text-center">
              <div className="text-3xl font-bold text-red-200">
                この曲は YouTube で再生できません
              </div>
              <div className="mt-1 text-xl text-red-300">
                {ytErrorMessage(currentError)} — 「モード: 手動」に切り替えて、
                手元で曲を再生してください
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 操作バー（クリック操作） */}
      <footer className="flex shrink-0 items-center gap-3 border-t border-neutral-800 bg-neutral-900 px-5 py-3">
        <Btn
          onClick={() => goToSong(index - 1)}
          disabled={index === 0}
          tone="ghost"
        >
          ‹ 前
        </Btn>

        {mode === "youtube" ? (
          <Btn
            onClick={togglePlay}
            tone={playing ? "amber" : "blue"}
            wide
            disabled={currentError !== undefined}
          >
            {playing ? "⏸ 一時停止" : "▶ 再生"}
          </Btn>
        ) : (
          <div className="px-4 text-lg text-neutral-500">手元で再生</div>
        )}

        <div className="mx-2 h-10 w-px bg-neutral-700" />

        <Btn onClick={markCorrect} tone="green" wide disabled={!canReveal}>
          ○ 正解（答えを出す）
        </Btn>
        <Btn onClick={markWrong} tone="red" wide disabled={!buzzed}>
          × お手つき
        </Btn>
        <Btn
          onClick={() => socket.emit("host:reset")}
          tone="ghost"
          disabled={!buzzed}
        >
          押し直し
        </Btn>

        {revealed && mode === "youtube" && (
          <Btn onClick={stopChorus} tone="ghost">
            ♪ 止める
          </Btn>
        )}

        <div className="flex-1" />

        <Btn
          onClick={() => setMode((m) => (m === "youtube" ? "manual" : "youtube"))}
          tone="ghost"
        >
          モード: {mode === "youtube" ? "YouTube" : "手動"}
        </Btn>
        <Btn
          onClick={() => goToSong(index + 1)}
          disabled={index >= songs.length - 1}
          tone="blue"
          wide
        >
          次の問題 ›
        </Btn>
      </footer>
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-5 w-5 rounded-full ${
        ok ? "bg-green-500" : "bg-neutral-600"
      }`}
    />
  );
}

function Btn({
  children,
  onClick,
  disabled,
  tone = "ghost",
  wide,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "green" | "red" | "blue" | "amber" | "ghost";
  wide?: boolean;
}) {
  const tones: Record<string, string> = {
    green: "bg-emerald-600 hover:bg-emerald-500 text-white",
    red: "bg-red-600 hover:bg-red-500 text-white",
    blue: "bg-sky-700 hover:bg-sky-600 text-white",
    amber: "bg-amber-600 hover:bg-amber-500 text-white",
    ghost:
      "bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700",
  };
  return (
    <button
      onClick={(e) => {
        e.currentTarget.blur();
        onClick();
      }}
      disabled={disabled}
      className={`rounded-xl font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        tones[tone]
      } ${wide ? "px-7 py-3.5 text-2xl" : "px-5 py-3 text-lg"}`}
    >
      {children}
    </button>
  );
}
