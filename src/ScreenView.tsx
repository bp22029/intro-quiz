// 投影画面。表示専用。操作は一切受け付けない（操作は /host で行う）。
// 表示内容はサーバーの state をそのまま描くだけ。
// 曲は鳴らさない。YouTubeモードの再生は管理画面(/host)が担当する。
// ここに iframe を置かないことで、いちばん壊れてほしくない画面を軽く保つ。
//
// 文字の大きさはすべて vw で置く。会場のプロジェクターは 1280 とも 1920 とも
// 限らないので、px で置くと解像度によって「後ろの席から読めない」が起きる。
// 設計時の基準は 1280×720（1px = 0.078vw）。
import { useEffect, useState } from "react";
import { beep, playBuzz, preloadSfx, unlockAudio } from "./beep";
import { RoomMissing, useRoomMissing } from "./RoomMissing";
import { socket, syncState } from "./socket";
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

/**
 * サイドバーに並べる参加者の上限。溢れたぶんは「ほか N 人」に畳む。
 * 畳み先を用意しないと、人数が増えた当日に下の数人が無言で見切れる
 * （枠に overflow-hidden が要るので、はみ出しても誰も気づかない）。
 */
const MAX_CHIPS = 15;

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
    socket.on("connect", syncState);
    syncState(); // 既に繋がっていた場合の取りこぼしを拾う
    return () => {
      socket.off("state", onState);
      socket.off("buzzed", onBuzzed);
      socket.off("connect", syncState);
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
      <div className="flex h-full flex-col items-center justify-center gap-10 bg-ground">
        <div className="flex items-center gap-6">
          <div className="h-px w-24 bg-gold opacity-60" />
          <div className="text-2xl tracking-[0.5em] text-gold">
            <span className="pl-[0.5em]">イントロクイズ</span>
          </div>
          <div className="h-px w-24 bg-gold opacity-60" />
        </div>
        {roomCode && (
          <div className="font-disp text-8xl tracking-[0.04em] text-gold-bright">
            {roomCode}
          </div>
        )}
        <button
          className="rounded-full bg-gold px-20 py-6 text-4xl font-black text-ground hover:bg-gold-bright"
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
        <p className="text-center text-xl leading-loose text-ink-3">
          クリックすると音が出せるようになります（ブラウザの制約）
          <br />
          プロジェクターへ移して全画面にしてから押してください
        </p>
      </div>
    );
  }

  const shown = state.players.slice(0, MAX_CHIPS);
  const folded = state.players.length - shown.length;

  return (
    <div className="flex h-full bg-ground">
      {/*
        左: QR と参加者。ここは全状態で位置も見た目も動かさない。
        客席が「どこを見ればいいか」を覚え直さずに済む。
      */}
      <aside className="flex w-[25vw] min-w-[280px] max-w-[440px] shrink-0 flex-col gap-[1.6vw] border-r border-rule bg-sink p-[2.2vw]">
        {/*
          state が届くまでは出さない。部屋を指さないQR（＝ロビーのQR）が
          一瞬でもプロジェクターに出ると、読んだ人が別の場所へ行ってしまう。
        */}
        {roomCode ? (
          <img
            src={`/qr.png?room=${encodeURIComponent(roomCode)}`}
            alt="参加用QR"
            className="w-full self-center rounded-r3 bg-ink p-[1vw]"
          />
        ) : (
          <div className="aspect-square w-full rounded-r3 bg-panel" />
        )}
        <div className="flex flex-col items-center gap-1">
          <div className="font-disp text-[3.9vw] leading-none tracking-[0.12em] text-gold-bright">
            {roomCode}
          </div>
          <div className="text-[1.17vw] text-ink-3">
            {url.replace(/^https?:\/\//, "")}
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-gold to-transparent opacity-55" />
        <div className="flex min-h-0 flex-1 flex-col gap-[0.9vw]">
          <div className="shrink-0 text-[1.25vw] tracking-[0.18em] text-gold">
            参加者 {state.players.length}人
          </div>
          <ul className="flex min-h-0 flex-1 flex-wrap content-start gap-[0.55vw] overflow-hidden">
            {shown.map((p) => {
              const locked =
                state.lockedIds.includes(p.id) ||
                state.lockedNames.includes(p.name);
              return (
                <li
                  key={p.id}
                  className={`flex items-baseline gap-2 rounded-full border px-[1.1vw] py-[0.4vw] text-[1.4vw] ${
                    locked
                      ? "border-chip-locked text-chip-ink"
                      : "border-chip text-ink"
                  }`}
                >
                  <span>{p.name}</span>
                  {locked && (
                    <span className="text-[0.95vw] tracking-[0.08em] text-gold-dim">
                      お手つき
                    </span>
                  )}
                </li>
              );
            })}
            {folded > 0 && (
              <li className="rounded-full border border-dashed border-gold-dim px-[1.1vw] py-[0.4vw] text-[1.4vw] text-gold">
                ほか {folded} 人
              </li>
            )}
          </ul>
        </div>
      </aside>

      {/* 右: 大きく見せる領域。状態で変わるのはこの面だけ */}
      <main
        className={`relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden px-10 transition-colors duration-150 ${
          showWrong
            ? "bg-[radial-gradient(120%_90%_at_50%_40%,theme(colors.miss.glow)_0%,theme(colors.miss.DEFAULT)_68%)]"
            : suspense
              ? "bg-[radial-gradient(120%_90%_at_50%_45%,theme(colors.hush.glow)_0%,theme(colors.hush.DEFAULT)_70%)]"
              : buzzed && !revealed
                ? "bg-[radial-gradient(120%_90%_at_50%_40%,theme(colors.win.glow)_0%,theme(colors.win.DEFAULT)_66%)]"
                : "bg-[radial-gradient(120%_90%_at_50%_38%,#16203a_0%,theme(colors.ground)_64%)]"
        }`}
      >
        {/*
          全問数は出さない。あと何問あるかを客席に見せないため。
          受付中は真ん中に大きく出るので、隅には出さない（重複するため）。
        */}
        {(revealed || showWrong || buzzed || suspense) && (
          <div
            className={`absolute left-[3vw] top-[3.5vh] font-disp text-[1.64vw] tracking-[0.1em] ${
              showWrong
                ? "text-miss-corner"
                : buzzed && !revealed
                  ? "text-win-corner"
                  : "text-ink-4"
            }`}
          >
            第 {index + 1} 問
          </div>
        )}

        {suspense ? (
          <div className="flex flex-col items-center">
            <div className="text-[10.3vw] font-black leading-none tracking-[0.06em] text-gold-bright">
              正解は…
            </div>
            <div className="flex gap-3 pt-[4vw]">
              <div className="h-[0.45vw] w-[4vw] rounded-full bg-gold" />
              <div className="h-[0.45vw] w-[4vw] rounded-full bg-gold opacity-45" />
              <div className="h-[0.45vw] w-[4vw] rounded-full bg-gold opacity-[0.15]" />
            </div>
          </div>
        ) : showWrong ? (
          <div className="flex flex-col items-center">
            <div className="text-[9vw] font-black leading-none tracking-[0.04em] text-miss-ink">
              不正解
            </div>
            <div className="pt-[0.8vw] text-[3.1vw] text-miss-ink2">
              {wrongName} さん
            </div>
            <div className="mt-[3.3vw] h-px w-[20vw] bg-miss-ink opacity-35" />
            <div className="pt-[2vw] text-[2vw] tracking-[0.16em] text-miss-ink2">
              {countdown > 0 ? "まもなく再開" : "受付を再開しました"}
            </div>
            <div className="font-disp text-[11.7vw] leading-none tabular-nums text-ink">
              {countdown > 0 ? countdown : "GO!"}
            </div>
          </div>
        ) : revealed ? (
          // key に問題番号を入れて、曲が変わるたびにアニメーションをやり直させる
          <div className="flex flex-col items-center" key={`answer-${index}`}>
            <div className="rise rise-1 flex w-full items-center justify-center gap-4 pb-[2vw]">
              <div className="h-px w-[6.9vw] bg-gold opacity-60" />
              <div className="text-[1.64vw] tracking-[0.55em] text-gold">
                <span className="pl-[0.55em]">答え</span>
              </div>
              <div className="h-px w-[6.9vw] bg-gold opacity-60" />
            </div>
            <div className="rise rise-2 text-balance text-center text-[7.8vw] font-black leading-[1.06] tracking-[0.02em]">
              {song?.title ?? "-"}
            </div>
            <div className="rise rise-3 pt-[1.2vw] text-[3vw] font-medium leading-tight text-ink-2">
              {song?.artist ?? ""}
            </div>
            <div className="rise rise-4 flex items-center gap-[2vw] pt-[3.4vw]">
              {/* 推した人が空なら帯ごと出さない。持ち寄りでない曲もあるため */}
              {song?.owner && (
                <div className="rounded-full bg-gold px-[2.5vw] py-[1vw] font-disp text-[1.95vw] text-ground">
                  {song.owner} さんの推し曲
                </div>
              )}
              {buzzed && (
                <div className="text-[1.95vw] text-gold-bright">
                  正解&emsp;{buzzed.name} さん
                </div>
              )}
            </div>
          </div>
        ) : buzzed ? (
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-4 pb-[1.4vw]">
              <div className="h-px w-[5vw] bg-gold-bright opacity-70" />
              <div className="text-[1.9vw] tracking-[0.5em] text-gold-bright">
                <span className="pl-[0.5em]">回答者</span>
              </div>
              <div className="h-px w-[5vw] bg-gold-bright opacity-70" />
            </div>
            <div className="break-all text-center text-[11.7vw] font-black leading-[1.02] tracking-[0.02em]">
              {buzzed.name}
            </div>
          </div>
        ) : (
          // 受付中。上演時間の8割はこの状態なので、いちばん静かにしておく
          <div className="flex flex-col items-center">
            <div className="flex items-baseline gap-[2vw]">
              <div className="text-[5vw] font-medium text-gold">第</div>
              <div className="font-disp text-[17.5vw] leading-none text-gold-bright">
                {index + 1}
              </div>
              <div className="text-[5vw] font-medium text-gold">問</div>
            </div>
            <div className="mt-[3.4vw] h-px w-[15.6vw] bg-gradient-to-r from-transparent via-gold to-transparent" />
            <div className="pt-[1.7vw] text-[2vw] tracking-[0.1em] text-ink-3">
              わかったら押してください
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
