// 再生窓。YouTube モードで曲を鳴らす専用の画面。
//
// 投影画面(/screen)ではなくこの窓が鳴らす理由:
//   - どのマシンで開くかを選べる（手元でも投影側でも音を出せる）
//   - 映像を隠さないので YouTube の埋め込みポリシーに沿う
//   - 投影画面から iframe が消え、いちばん壊れてほしくない画面が軽くなる
//
// 手元PCで /host の隣に並べて置く想定。表示専用で、操作は一切受け付けない。
import { useEffect, useRef, useState } from "react";
import { unlockAudio } from "./beep";
import { socket } from "./socket";
import type { State } from "./types";
import { useYouTube, ytErrorMessage } from "./useYouTube";

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
    revealInMs: 0,
  },
  mode: "manual",
  songs: [],
  ytStatus: { ready: false, readyCount: 0, total: 0, connected: false },
  suspenseMs: 2000,
};

export default function SoundView() {
  const [state, setState] = useState<State>(EMPTY);
  const [armed, setArmed] = useState(false); // 「再生を開始する」クリック済みか
  const [connected, setConnected] = useState(socket.connected);

  const { index, revealed, playing } = state.round;
  const mode = state.mode;
  const songs = state.songs;
  const song = songs[index];

  const yt = useYouTube(songs, mode === "youtube");

  useEffect(() => {
    const onState = (s: State) => setState(s);
    // 曲データは名乗り出た画面にだけ配られる。繋がり直すたびに名乗る。
    const onConnect = () => {
      setConnected(true);
      socket.emit("role:sound");
    };
    const onDisconnect = () => setConnected(false);
    socket.on("state", onState);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off("state", onState);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  // プレイヤーの準備状況を管理画面へ知らせる（未準備のまま再生させないため）
  useEffect(() => {
    socket.emit("sound:yt", {
      ready: yt.ready,
      readyCount: yt.readyCount,
      total: yt.total,
    });
  }, [yt.ready, yt.readyCount, yt.total]);

  // 準備が整う前に再生を要求されていた場合、整った時点で鳴らし直す。
  // これがないと「管理画面は再生中なのに音が出ない」状態のままになる。
  useEffect(() => {
    if (mode === "youtube" && playing && yt.ready && !revealed) {
      yt.play(index);
    }
  }, [yt.ready, mode, playing, revealed, index, yt]);

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

  const currentError: number | undefined = yt.errors[index];

  // 音を出すには1クリックが必要（ブラウザの制約）。
  // このクリックでこの窓に操作許可が固定されるので、以後は背面に回しても鳴る。
  if (!armed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-neutral-950 p-8">
        <h1 className="text-4xl font-black">再生窓</h1>
        <button
          className="rounded-2xl bg-red-600 px-12 py-6 text-3xl font-bold hover:bg-red-500"
          onClick={async (e) => {
            e.currentTarget.blur();
            await unlockAudio();
            setArmed(true);
          }}
        >
          再生を開始する
        </button>
        <p className="max-w-md text-center text-neutral-400">
          この窓が曲を鳴らします。管理画面の隣に置いてください。
          クリックすると、背面に回しても再生できるようになります（ブラウザの制約）。
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-neutral-950 p-4">
      <div className="flex items-center justify-between pb-3 text-sm">
        <span className={connected ? "text-green-500" : "text-yellow-500"}>
          {connected ? "● 接続中" : "○ 再接続中…"}
        </span>
        <span className="text-neutral-500">
          {mode === "youtube"
            ? yt.ready
              ? `第 ${index + 1} 問 / 全曲 準備完了`
              : `準備中 ${yt.readyCount} / ${yt.total} 曲`
            : "手動モード（この窓は鳴りません）"}
        </span>
      </div>

      {mode === "manual" ? (
        <div className="flex flex-1 items-center justify-center text-center text-neutral-500">
          <div>
            <div className="text-2xl font-bold">手動モードです</div>
            <div className="mt-2">
              管理画面で YouTube モードに切り替えると、この窓が鳴らします。
            </div>
          </div>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
          {/* 現在の曲だけを画面内に置き、他は画面外へ逃がす。
              映像は隠さない（埋め込みプレーヤーは可視であることが求められる）。 */}
          {songs.map((_, i) => (
            <div
              key={i}
              className="absolute h-full w-full"
              style={
                i === index ? { left: 0, top: 0 } : { left: "-200vw", top: 0 }
              }
            >
              <div className="h-full w-full" ref={yt.registerRef(i)} />
            </div>
          ))}

          {currentError !== undefined && (
            <div className="absolute inset-x-6 bottom-6 rounded-xl border-2 border-red-500 bg-red-950/95 px-5 py-4 text-center text-xl text-red-200">
              この曲は再生できません（{ytErrorMessage(currentError)}）
              <div className="mt-1 text-base text-red-300">
                管理画面を手動モードへ切り替えてください
              </div>
            </div>
          )}
        </div>
      )}

      <div className="pt-3 text-center text-sm text-neutral-600">
        {song ? `第 ${index + 1} 問` : "曲データがありません"}
      </div>
    </div>
  );
}
