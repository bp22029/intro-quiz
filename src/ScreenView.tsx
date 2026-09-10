// 投影画面。表示専用。操作は一切受け付けない（操作は /host で行う）。
// 表示内容はサーバーの state をそのまま描くだけ。
// 曲は鳴らさない。YouTubeモードの再生は管理画面(/host)が担当する。
// ここに iframe を置かないことで、いちばん壊れてほしくない画面を軽く保つ。
import { useEffect, useState } from "react";
import { beep, playBuzz, preloadSfx, unlockAudio } from "./beep";
import { RoomMissing, useRoomMissing } from "./RoomMissing";
import { socket } from "./socket";
import type { State } from "./types";
import { useCountdown } from "./useCountdown";

const EMPTY: State = {
  roomCode: "",
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
  mode: "youtube",
  songs: [],
  suspenseMs: 2000,
  runUp: true,
  masterVolume: 70,
};

export default function ScreenView() {
  const [state, setState] = useState<State>(EMPTY);
  const [url, setUrl] = useState<string>("");
  const [ready, setReady] = useState(false); // 「準備」クリック済みか
  const roomMissing = useRoomMissing();

  // playing は投影画面では使わない（曲は管理画面が鳴らし、秒数表示も廃止した）
  const { index, revealed, wrongName, resumeInMs, revealInMs } = state.round;
  const songs = state.songs;
  const song = songs[index];
  // どの部屋の参加URLを出すかはサーバーが state で教えてくる。
  // 投影画面のURLには主催キーしか入っていないので、ここからは分からない。
  const roomCode = state.roomCode;

  useEffect(() => {
    if (!roomCode) return;
    fetch(`/api/url?room=${encodeURIComponent(roomCode)}`)
      .then((r) => r.json())
      .then((d: { url?: string }) => d.url && setUrl(d.url))
      .catch(() => {});
  }, [roomCode]);

  useEffect(() => {
    const onState = (s: State) => setState(s);
    // 早押しの合図。この画面だけが鳴らす（管理画面と二重に鳴らさないため）
    const onBuzzed = () => playBuzz();
    // 曲データを受け取れるかどうかは、ハンドシェイクで渡した主催キーで決まる。
    // ここで役割を名乗る必要はない（名乗りで権限が付くと参加者に真似される）。
    socket.on("state", onState);
    socket.on("buzzed", onBuzzed);
    return () => {
      socket.off("state", onState);
      socket.off("buzzed", onBuzzed);
    };
  }, []);

  const buzzed = state.buzzedBy;
  const countdown = useCountdown(resumeInMs);
  const showWrong = wrongName !== null;
  // 「正解は…」の溜め中
  const suspense = revealInMs > 0 && !revealed;

  if (roomMissing) return <RoomMissing what="投影画面のURL" />;

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
            void preloadSfx(); // 本番中に読み込み待ちを起こさない
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
        {/*
          state が届くまでは出さない。部屋を指さないQR（＝ロビーのQR）が
          一瞬でもプロジェクターに出ると、読んだ人が別の場所へ行ってしまう。
        */}
        {roomCode ? (
          <img
            src={`/qr.png?room=${encodeURIComponent(roomCode)}`}
            alt="参加用QR"
            className="w-full rounded-xl bg-white p-2"
          />
        ) : (
          <div className="aspect-square w-full rounded-xl bg-neutral-900" />
        )}
        {/* QRが読めない席のために、コードを大きく出す。口頭でも読み上げられる形 */}
        <div className="text-center text-4xl font-black tracking-[0.2em]">
          {roomCode}
        </div>
        <div className="text-center text-base text-neutral-500">
          {url.replace(/^https?:\/\//, "")}
        </div>
        <div className="min-h-0 flex-1">
          <div className="pb-3 text-2xl text-neutral-400">
            参加者 {state.players.length}人
          </div>
          <ul className="flex flex-wrap gap-2">
            {state.players.map((p) => {
              const locked =
                state.lockedIds.includes(p.id) ||
                state.lockedNames.includes(p.name);
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
          showWrong
            ? "bg-red-800"
            : suspense
              ? "bg-neutral-900"
              : buzzed && !revealed
              ? "bg-emerald-700"
              : "bg-neutral-950"
        }`}
      >
        {/* 全問数は出さない。あと何問あるかを客席に見せないため */}
        <div className="absolute left-8 top-6 text-2xl text-neutral-500">
          第 {index + 1} 問
        </div>

        {suspense ? (
          <div className="text-center">
            <div className="text-[11vw] font-black leading-none">正解は…</div>
          </div>
        ) : showWrong ? (
          <div className="text-center">
            <div className="text-[13vw] font-black leading-none">不正解</div>
            <div className="mt-2 text-4xl text-red-100">{wrongName} さん</div>
            <div className="mt-10 text-3xl text-red-100">
              {countdown > 0 ? "まもなく再開" : "受付を再開しました"}
            </div>
            <div className="text-[12vw] font-black leading-none tabular-nums">
              {countdown > 0 ? countdown : "GO!"}
            </div>
          </div>
        ) : revealed ? (
          // key に問題番号を入れて、曲が変わるたびにアニメーションをやり直させる
          <div className="text-center" key={`answer-${index}`}>
            <div className="rise rise-1 mb-4 text-3xl tracking-[0.4em] text-neutral-500">
              答え
            </div>
            <div className="rise rise-2 break-all text-[8vw] font-black leading-[1.05]">
              {song?.title ?? "-"}
            </div>
            <div className="rise rise-3 mt-4 text-[4vw] font-bold leading-tight text-neutral-300">
              {song?.artist ?? ""}
            </div>
            {/* 推した人が空なら帯ごと出さない。持ち寄りでない曲もあるため */}
            {song?.owner && (
              <div className="rise rise-4 mt-10 inline-block rounded-2xl bg-amber-400 px-10 py-4 text-[2.8vw] font-black text-neutral-900">
                {song.owner} さんの推し曲
              </div>
            )}
            {buzzed && (
              <div className="rise rise-4 mt-8 text-4xl text-emerald-400">
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
        ) : (
          // 回答者も答えも出ていない間は、問題番号を出し続ける。
          // 経過秒数を出していたが、何の時間か伝わらず、
          // お手つき後の再開で0へ戻るのも意味を持たないので廃止した。
          <div className="text-center">
            <div className="text-[15vw] font-black leading-none">第 {index + 1} 問</div>
          </div>
        )}

      </main>
    </div>
  );
}
