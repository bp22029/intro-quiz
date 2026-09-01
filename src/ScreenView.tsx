// 投影画面。表示専用。操作は一切受け付けない（操作は /host で行う）。
// 表示内容はサーバーの state をそのまま描くだけ。
import { useEffect, useRef, useState } from "react";
import { beep, unlockAudio } from "./beep";
import { socket } from "./socket";
import type { Song, State } from "./types";
import { useYouTube, ytErrorMessage } from "./useYouTube";

const EMPTY: State = {
  buzzedBy: null,
  lockedIds: [],
  players: [],
  round: { index: 0, revealed: false, playing: false },
  mode: "manual",
};

export default function ScreenView() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [state, setState] = useState<State>(EMPTY);
  const [url, setUrl] = useState<string>(window.location.origin);
  const [ready, setReady] = useState(false); // 「準備」クリック済みか
  const [elapsed, setElapsed] = useState(0);

  const { index, revealed, playing } = state.round;
  const mode = state.mode;
  const song = songs[index];

  const yt = useYouTube(songs, mode === "youtube");

  useEffect(() => {
    fetch("/songs.json")
      .then((r) => r.json())
      .then((d: Song[]) => setSongs(Array.isArray(d) ? d : []))
      .catch(() => setSongs([]));
    fetch("/api/url")
      .then((r) => r.json())
      .then((d: { url: string }) => d.url && setUrl(d.url))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onState = (s: State) => setState(s);
    const onBuzzed = () => beep(); // 手動モードではこれが唯一の停止トリガー
    socket.on("state", onState);
    socket.on("buzzed", onBuzzed);
    return () => {
      socket.off("state", onState);
      socket.off("buzzed", onBuzzed);
    };
  }, []);

  // --- サーバー状態に合わせて YouTube プレイヤーを追従させる ---
  const prev = useRef({ index: -1, revealed: false, playing: false });
  useEffect(() => {
    if (mode !== "youtube") return;
    const p = prev.current;

    if (p.index !== index) {
      yt.pause(p.index);
      yt.seekToStart(index);
    } else if (revealed && !p.revealed) {
      // 答えを出した瞬間にサビへ飛ぶ
      yt.seekAndPlay(index, song?.chorusSec ?? song?.startSec ?? 0);
    } else if (playing && !p.playing) {
      yt.play(index);
    } else if (!playing && p.playing) {
      yt.pause(index);
    }

    prev.current = { index, revealed, playing };
  }, [mode, index, revealed, playing, yt, song]);

  // 答えを消したときはサビも止める
  useEffect(() => {
    if (mode === "youtube" && !revealed && !playing) yt.pause(index);
  }, [revealed, playing, mode, yt, index]);

  // --- 経過秒数 ---
  useEffect(() => {
    if (!playing) {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [playing, index]);

  const currentError: number | undefined = yt.errors[index];
  const buzzed = state.buzzedBy;

  // 音を出すには1クリックが必要（ブラウザの制約）
  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-10">
        <h1 className="text-7xl font-black">イントロクイズ</h1>
        <button
          className="rounded-2xl bg-red-600 px-20 py-8 text-4xl font-bold hover:bg-red-500"
          onClick={async (e) => {
            e.currentTarget.blur();
            await unlockAudio();
            beep();
            setReady(true);
          }}
        >
          投影を開始する
        </button>
        <p className="text-xl text-neutral-500">
          クリックすると音が出せるようになります（ブラウザの制約）
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-neutral-950">
      {/* 左: QR と参加者 */}
      <aside className="flex w-[320px] shrink-0 flex-col gap-5 border-r border-neutral-800 p-6">
        <img src="/qr.png" alt="参加用QR" className="w-full rounded-xl bg-white p-2" />
        <div className="text-center text-base text-neutral-500">
          {url.replace(/^https?:\/\//, "")}
        </div>
        <div className="min-h-0 flex-1">
          <div className="pb-3 text-2xl text-neutral-400">
            参加者 {state.players.length}人
          </div>
          <ul className="flex flex-wrap gap-2">
            {state.players.map((p) => {
              const locked = state.lockedIds.includes(p.id);
              return (
                <li
                  key={p.id}
                  className={`rounded-lg px-3 py-1.5 text-2xl ${
                    locked
                      ? "bg-neutral-900 text-neutral-600"
                      : "bg-neutral-800 text-neutral-100"
                  }`}
                >
                  {p.name}
                  {locked && <span className="ml-2 text-base">お手つき</span>}
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      {/* 右: 大きく見せる領域 */}
      <main
        className={`relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden px-10 transition-colors duration-150 ${
          buzzed && !revealed ? "bg-emerald-700" : "bg-neutral-950"
        }`}
      >
        <div className="absolute left-8 top-6 text-2xl text-neutral-500">
          第 {index + 1} 問 / 全 {songs.length || "-"} 問
        </div>

        {revealed ? (
          <div className="text-center">
            <div className="mb-4 text-3xl tracking-[0.4em] text-neutral-500">
              こたえ
            </div>
            <div className="break-all text-[8vw] font-black leading-[1.05]">
              {song?.title ?? "-"}
            </div>
            <div className="mt-4 text-[4vw] font-bold leading-tight text-neutral-300">
              {song?.artist ?? ""}
            </div>
            <div className="mt-10 inline-block rounded-2xl bg-amber-400 px-10 py-4 text-[2.8vw] font-black text-neutral-900">
              {song?.owner ?? "?"} さんの推し曲
            </div>
            {buzzed && (
              <div className="mt-8 text-4xl text-emerald-400">
                正解者: {buzzed.name} さん
              </div>
            )}
          </div>
        ) : buzzed ? (
          <div className="text-center">
            <div className="mb-3 text-5xl font-bold text-emerald-100">回答者</div>
            <div className="break-all text-[13vw] font-black leading-none">
              {buzzed.name}
            </div>
          </div>
        ) : playing ? (
          <div className="text-center">
            <div className="text-[18vw] font-black leading-none tabular-nums">
              {elapsed}
            </div>
            <div className="text-5xl text-neutral-500">秒</div>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-[15vw] font-black leading-none">第 {index + 1} 問</div>
          </div>
        )}

        {/* YouTube は音源としてのみ使う。映像は出さない（MVが無い曲があるため） */}
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-0">
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

        {mode === "youtube" && currentError !== undefined && (
          <div className="absolute inset-x-10 bottom-8 rounded-xl border-2 border-red-500 bg-red-950/95 px-6 py-4 text-center text-2xl text-red-200">
            この曲は YouTube で再生できません（{ytErrorMessage(currentError)}）
          </div>
        )}
      </main>
    </div>
  );
}
