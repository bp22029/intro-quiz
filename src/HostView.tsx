// 管理画面。手元のノートPCで開き、クリックで進行する。
// ノートPCの左半分に置き、右半分で YouTube を手動再生する想定なので、
// 幅が狭くても崩れないレイアウトにしている。
import { useEffect, useState } from "react";
import { beep, unlockAudio } from "./beep";
import { socket } from "./socket";
import { useCountdown } from "./useCountdown";
import type { PlayMode, Song, State } from "./types";

const EMPTY: State = {
  buzzedBy: null,
  lockedIds: [],
  lockedNames: [],
  players: [],
  round: {
    index: 0,
    revealed: false,
    playing: false,
    wrongName: null,
    resumeInMs: 0,
  },
  mode: "manual",
};

export default function HostView() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [state, setState] = useState<State>(EMPTY);
  const [connected, setConnected] = useState(socket.connected);
  const [armed, setArmed] = useState(false); // 音声解除済みか

  const { index, revealed, playing, wrongName, resumeInMs } = state.round;
  const mode = state.mode;
  const song = songs[index];
  const buzzed = state.buzzedBy;
  const last = songs.length - 1;
  const countdown = useCountdown(resumeInMs);
  const showWrong = wrongName !== null;

  useEffect(() => {
    fetch("/songs.json")
      .then((r) => r.json())
      .then((d: Song[]) => setSongs(Array.isArray(d) ? d : []))
      .catch(() => setSongs([]));
  }, []);

  useEffect(() => {
    const onState = (s: State) => setState(s);
    const onBuzzed = () => beep(); // 手元でも鳴らす。曲を止める合図
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("state", onState);
    socket.on("buzzed", onBuzzed);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("state", onState);
      socket.off("buzzed", onBuzzed);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  if (!armed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <h1 className="text-4xl font-black">管理画面</h1>
        <button
          className="rounded-2xl bg-red-600 px-12 py-6 text-3xl font-bold hover:bg-red-500"
          onClick={async (e) => {
            e.currentTarget.blur();
            await unlockAudio();
            beep();
            setArmed(true);
          }}
        >
          操作をはじめる
        </button>
        <p className="max-w-md text-center text-neutral-400">
          クリックすると早押しのビープ音が鳴らせるようになります。
          投影用の画面は別ウィンドウで <code className="text-neutral-200">/screen</code> を開いてください。
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-neutral-950 p-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between text-sm">
        <span className={connected ? "text-green-500" : "text-yellow-500"}>
          {connected ? "● 接続中" : "○ 再接続中…"}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-neutral-500">再生モード</span>
          <ModeToggle mode={mode} />
        </div>
      </div>

      {/* 早押し状況 */}
      <div
        className={`rounded-2xl px-5 py-6 text-center ${
          showWrong ? "bg-red-800" : buzzed ? "bg-emerald-700" : "bg-neutral-900"
        }`}
      >
        {showWrong ? (
          <>
            <div className="text-4xl font-black">不正解 — {wrongName} さん</div>
            <div className="mt-1 text-2xl text-red-100">
              {countdown > 0 ? `受付再開まで ${countdown}` : "受付を再開しました"}
            </div>
          </>
        ) : buzzed ? (
          <>
            <div className="text-lg text-emerald-100">回答者</div>
            <div className="break-all text-5xl font-black leading-tight">
              {buzzed.name}
            </div>
          </>
        ) : (
          <div className="text-3xl font-bold text-neutral-500">受付中</div>
        )}
      </div>

      {/* 現在の問題（答えが見える。投影には出ない） */}
      <div className="rounded-2xl bg-neutral-900 p-5">
        <div className="flex items-center justify-between">
          <span className="text-lg text-neutral-400">
            第 {index + 1} 問 / 全 {songs.length || "-"} 問
          </span>
          {revealed && (
            <span className="rounded bg-amber-400 px-2 py-0.5 text-sm font-bold text-neutral-900">
              答え表示中
            </span>
          )}
        </div>
        <div className="mt-2 break-all text-3xl font-black leading-tight">
          {song?.title ?? "（曲データなし）"}
        </div>
        <div className="text-xl text-neutral-300">{song?.artist ?? ""}</div>
        <div className="mt-1 text-lg text-amber-300">
          {song?.owner ? `${song.owner} さんの推し曲` : ""}
        </div>
        {song && (
          <div className="mt-3 flex gap-4 text-sm text-neutral-500">
            <span>イントロ {song.startSec}秒〜</span>
            <span>サビ {song.chorusSec ?? song.startSec}秒〜</span>
            {mode === "manual" && (
              <a
                className="text-sky-400 underline"
                href={`https://www.youtube.com/watch?v=${song.videoId}`}
                target="_blank"
                rel="noreferrer"
              >
                YouTubeで開く
              </a>
            )}
          </div>
        )}
      </div>

      {/* 操作ボタン */}
      <div className="grid grid-cols-2 gap-3">
        {mode === "youtube" ? (
          <Btn
            tone={playing ? "amber" : "blue"}
            onClick={() => socket.emit(playing ? "host:pause" : "host:play")}
            className="col-span-2"
          >
            {playing ? "⏸ 一時停止" : "▶ イントロ再生"}
          </Btn>
        ) : (
          <div className="col-span-2 rounded-xl border border-dashed border-neutral-700 px-4 py-3 text-center text-neutral-500">
            曲は右half の YouTube で手動再生してください
          </div>
        )}

        <Btn
          tone="green"
          onClick={() => socket.emit("host:reveal")}
          disabled={revealed}
        >
          ○ 正解・答えを出す
        </Btn>
        <Btn
          tone="red"
          onClick={() => socket.emit("host:wrong")}
          disabled={!buzzed}
        >
          × お手つき
        </Btn>

        <Btn
          tone="ghost"
          onClick={() => socket.emit("host:reset")}
          disabled={!buzzed}
        >
          押し直し
        </Btn>
        <Btn tone="ghost" onClick={() => socket.emit("host:nextRound")}>
          この問題をやり直す
        </Btn>

        <Btn
          tone="ghost"
          onClick={() => socket.emit("host:setSong", index - 1)}
          disabled={index <= 0}
        >
          ‹ 前の問題
        </Btn>
        <Btn
          tone="blue"
          onClick={() => socket.emit("host:setSong", index + 1)}
          disabled={index >= last}
        >
          次の問題 ›
        </Btn>
      </div>

      {/* 参加者 */}
      <div className="rounded-2xl bg-neutral-900 p-4">
        <div className="pb-1 text-neutral-400">
          参加者 {state.players.length}人
        </div>
        <div className="pb-2 text-xs text-neutral-600">
          名前をクリックするとお手つきを付け外しできます（別ブラウザで参加し直した人への対処用）
        </div>
        <ul className="flex flex-wrap gap-2">
          {state.players.map((p) => {
            const locked =
                state.lockedIds.includes(p.id) ||
                state.lockedNames.includes(p.name);
            return (
              <li key={p.id}>
                <button
                  onClick={(e) => {
                    e.currentTarget.blur();
                    socket.emit("host:toggleLock", p.id);
                  }}
                  title={locked ? "お手つきを解除する" : "お手つきにする" }
                  className={`rounded-lg px-2.5 py-1 ${
                    locked
                      ? "bg-neutral-950 text-neutral-600 line-through"
                      : "bg-neutral-800 text-neutral-100 hover:bg-neutral-700"
                  }`}
                >
                  {p.name}
                  {locked && <span className="ml-1 text-xs no-underline">お手つき</span>}
                </button>
              </li>
            );
          })}
          {state.players.length === 0 && (
            <li className="text-neutral-600">まだ誰も参加していません</li>
          )}
        </ul>
      </div>

      {/* 曲の一覧。飛びたい問題を直接選べる */}
      <div className="rounded-2xl bg-neutral-900 p-4">
        <div className="pb-2 text-neutral-400">問題一覧</div>
        <ul className="flex flex-col gap-1">
          {songs.map((s, i) => (
            <li key={i}>
              <button
                onClick={(e) => {
                  e.currentTarget.blur();
                  socket.emit("host:setSong", i);
                }}
                className={`w-full truncate rounded-lg px-3 py-2 text-left ${
                  i === index
                    ? "bg-sky-800 text-white"
                    : "text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                {i + 1}. {s.title} / {s.artist}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ModeToggle({ mode }: { mode: PlayMode }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-neutral-700">
      {(["manual", "youtube"] as PlayMode[]).map((m) => (
        <button
          key={m}
          onClick={(e) => {
            e.currentTarget.blur();
            socket.emit("host:setMode", m);
          }}
          className={`px-3 py-1 ${
            mode === m
              ? "bg-neutral-200 text-neutral-900"
              : "text-neutral-400 hover:bg-neutral-800"
          }`}
        >
          {m === "manual" ? "手動" : "YouTube"}
        </button>
      ))}
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  tone = "ghost",
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "green" | "red" | "blue" | "amber" | "ghost";
  className?: string;
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
      className={`rounded-xl px-4 py-4 text-xl font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}
