import { useCallback, useEffect, useRef, useState } from "react";
import { beep, isAudioUnlocked, unlockAudio } from "./beep";
import { socket } from "./socket";
import type { PlayMode, Player, Song, State } from "./types";
import { useYouTube, ytErrorMessage } from "./useYouTube";

const EMPTY: State = { buzzedBy: null, lockedIds: [], players: [] };

export default function ScreenView() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [state, setState] = useState<State>(EMPTY);
  const [url, setUrl] = useState<string>(window.location.origin);

  const [started, setStarted] = useState(false); // 「準備完了」を押したか
  const [unlocking, setUnlocking] = useState(false);
  const [mode, setMode] = useState<PlayMode>("youtube");
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false); // 答え表示中
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const [toast, setToast] = useState<string | null>(null);

  const yt = useYouTube(songs, mode === "youtube");

  // キーボードハンドラから常に最新値を読むための ref
  const r = useRef({
    mode,
    index,
    playing,
    revealed,
    songs,
    yt,
    started,
    buzzedBy: state.buzzedBy,
  });
  r.current = {
    mode,
    index,
    playing,
    revealed,
    songs,
    yt,
    started,
    buzzedBy: state.buzzedBy,
  };

  // キー操作のフィードバック。押したのに何も起きないと当日操作を見失う。
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);

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
      // YouTube モードなら曲を止める
      if (r.current.mode === "youtube") {
        r.current.yt.pause(r.current.index);
        setPlaying(false);
      }
    };
    socket.on("state", onState);
    socket.on("buzzed", onBuzzed);
    return () => {
      socket.off("state", onState);
      socket.off("buzzed", onBuzzed);
    };
  }, []);

  // --- 経過秒数 ---
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [playing]);

  // --- 操作 ---

  const goToSong = useCallback(
    (next: number) => {
      const { songs: ss, mode: m, yt: y, index: cur } = r.current;
      if (ss.length === 0) return;
      const clamped = Math.max(0, Math.min(ss.length - 1, next));
      if (m === "youtube") {
        y.pause(cur);
        y.seekToStart(clamped);
      }
      setIndex(clamped);
      setRevealed(false);
      setPlaying(false);
      setElapsed(0);
      socket.emit("host:nextRound");
      flash(`第${clamped + 1}問へ（お手つき全解除）`);
    },
    [flash],
  );

  const togglePlay = useCallback(() => {
    // 手動モードでは再生位置に関する処理をすべて無効化する
    if (r.current.mode !== "youtube") {
      flash("手動モードでは再生操作は効きません");
      return;
    }
    const { yt: y, index: i, playing: p } = r.current;
    if (p) {
      y.pause(i);
      setPlaying(false);
      flash("一時停止");
    } else {
      y.play(i);
      setPlaying(true);
      flash("再生");
    }
  }, [flash]);

  const markCorrect = useCallback(() => {
    if (r.current.mode === "youtube") {
      r.current.yt.pause(r.current.index);
    }
    setPlaying(false);
    setRevealed(true); // カバーを外して映像を見せる
    flash("正解！ 答えを表示");
  }, [flash]);

  const markWrong = useCallback(() => {
    // 誰も押していないときに誤答を出しても、サーバーは誰もロックしない。
    // 画面が何も変わらず「無反応」に見えるので、ここで明示する。
    const target = r.current.buzzedBy;
    if (!target) {
      flash("まだ誰も押していません");
      return;
    }
    // 既に答えを出してしまった後は、曲を鳴らし直しても問題として成立しない。
    // 受付だけ戻し、再生は再開しない。
    const afterReveal = r.current.revealed;
    socket.emit("host:wrong");
    setRevealed(false);
    if (r.current.mode === "youtube" && !afterReveal) {
      r.current.yt.play(r.current.index); // 続きから再生再開
      setPlaying(true);
    }
    flash(
      afterReveal
        ? `お手つき: ${target.name} さん（答え表示済みのため再生は再開しません）`
        : `お手つき: ${target.name} さん（受付再開）`,
    );
  }, [flash]);

  // --- キーボード（投影画面のみ） ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // M（モード切替）だけは準備画面でも効かせる。手動に逃げる導線を塞がない。
      if (e.key === "m" || e.key === "M") {
        setMode((m) => {
          const next = m === "youtube" ? "manual" : "youtube";
          flash(next === "manual" ? "手動モードに切替" : "YouTubeモードに切替");
          return next;
        });
        setPlaying(false);
        return;
      }
      if (!r.current.started) return;
      switch (e.key) {
        case " ":
          e.preventDefault(); // ブラウザのスクロールを止める
          togglePlay();
          break;
        case "1":
          markCorrect();
          break;
        case "2":
          markWrong();
          break;
        case "r":
        case "R":
          socket.emit("host:reset");
          flash("押下を取り消しました（ロックなし）");
          break;
        case "n":
        case "N":
          goToSong(r.current.index + 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          goToSong(r.current.index - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          goToSong(r.current.index + 1);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, markCorrect, markWrong, goToSong, flash]);

  const song = songs[index];
  const errorCodes = Object.entries(yt.errors);

  // -------------------------------------------------------------------------
  // 準備完了ゲート（両モードで出す。AudioContext の解除に1クリックが必須）
  // -------------------------------------------------------------------------
  if (!started) {
    const waitingYT = mode === "youtube" && !yt.ready && songs.length > 0;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-8 p-10">
        <h1 className="text-6xl font-black">イントロクイズ</h1>
        {!unlocking ? (
          <button
            className="rounded-2xl bg-red-600 px-16 py-8 text-4xl font-bold hover:bg-red-500"
            onClick={async () => {
              setUnlocking(true);
              await unlockAudio();
              beep(); // 実際に鳴るか、この場で耳で確認する
            }}
          >
            準備完了
          </button>
        ) : (
          <>
            <div className="text-3xl text-neutral-300">
              {mode === "youtube"
                ? `動画の準備 ${yt.readyCount} / ${yt.total} 曲`
                : "手動モード（YouTubeプレイヤーは使いません）"}
            </div>
            <div className="text-xl text-neutral-500">
              音声解除: {isAudioUnlocked() ? "OK（ビープが鳴りましたか？）" : "失敗"}
            </div>
            {errorCodes.length > 0 && (
              <div className="rounded-xl bg-red-950 p-5 text-xl text-red-300">
                {errorCodes.map(([i, code]) => (
                  <div key={i}>
                    第{Number(i) + 1}問: {ytErrorMessage(Number(code))}（コード {code}）
                  </div>
                ))}
              </div>
            )}
            <button
              className="rounded-2xl bg-green-600 px-16 py-8 text-4xl font-bold hover:bg-green-500"
              onClick={() => setStarted(true)}
            >
              {waitingYT ? "準備を待たずに開始する" : "開始する"}
            </button>
            {waitingYT && (
              <p className="max-w-2xl text-center text-lg text-neutral-500">
                動画の準備が揃っていません。埋め込み禁止の曲がある場合は揃いません。
                その場合は開始後に <kbd>M</kbd> で手動モードに切り替えてください。
              </p>
            )}
          </>
        )}
        <p className="text-lg text-neutral-500">
          モード切替は <kbd className="rounded bg-neutral-800 px-2">M</kbd>（現在: {mode}）
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // 本編
  // -------------------------------------------------------------------------
  const buzzed = state.buzzedBy;

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {/* 左カラム（狭い）: QR / URL / 参加者一覧 */}
        <aside className="flex w-[22%] min-w-[240px] flex-col gap-4 border-r border-neutral-800 p-5">
          <img
            src="/qr.png"
            alt="参加用QRコード"
            className="w-full rounded-xl bg-white p-2"
          />
          <div className="break-all text-center text-lg text-neutral-300">{url}</div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="pb-2 text-xl text-neutral-400">
              参加者 {state.players.length}人
            </div>
            <ul className="flex flex-wrap gap-2">
              {state.players.map((p) => (
                <li
                  key={p.id}
                  className={`rounded-lg px-3 py-1 text-xl ${
                    state.lockedIds.includes(p.id)
                      ? "bg-neutral-800 text-neutral-500 line-through"
                      : "bg-neutral-700"
                  }`}
                >
                  {p.name}
                  {state.lockedIds.includes(p.id) && (
                    <span className="ml-1 text-sm no-underline">お手つき</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* 右カラム（広い） */}
        <main
          className={`relative flex min-w-0 flex-1 flex-col items-center justify-center p-6 transition-colors ${
            buzzed && !revealed ? "bg-green-800" : ""
          }`}
        >
          {/* 再生モード表示（隅に常時） */}
          <div className="absolute right-4 top-3 z-30 text-lg text-neutral-400">
            {mode === "youtube" ? "YouTube モード" : "手動モード"}
            {mode === "youtube" &&
              !yt.ready &&
              ` (動画準備 ${yt.readyCount}/${yt.total}曲)`}
          </div>
          <div className="absolute left-4 top-3 z-30 text-lg text-neutral-400">
            第{index + 1}問 / {songs.length || "-"}
          </div>

          {/* --- レイヤー0: YouTube プレイヤー。display:none にはしない（6.4） --- */}
          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
            {songs.map((_, i) => (
              <div
                key={i}
                className="yt-slot absolute h-full w-full"
                style={
                  i === index && mode === "youtube"
                    ? { left: 0, top: 0 }
                    : { left: "-200vw", top: 0 } // 画面外に置く
                }
              >
                <div className="h-full w-full" ref={yt.registerRef(i)} />
              </div>
            ))}
          </div>

          {/* --- レイヤー1: 目隠しカバー。正解表示（1キー）で外す --- */}
          {!revealed && (
            <div className="pointer-events-none absolute inset-0 z-10 bg-neutral-950" />
          )}

          {/* --- レイヤー2: 表示内容 --- */}
          {revealed ? (
            // カバーを外して映像を見せる。答えは下部の帯に重ねる。
            <div className="absolute inset-x-0 bottom-0 z-20 bg-black/75 px-8 py-6">
              <Answer song={song} buzzed={buzzed} />
            </div>
          ) : buzzed ? (
            <div className="relative z-20 text-center">
              <div className="text-4xl text-green-200">回答者</div>
              <div className="break-all text-[11vw] font-black leading-none">
                {buzzed.name}
              </div>
            </div>
          ) : playing ? (
            <div className="relative z-20 text-center">
              <div className="text-[14vw] font-black leading-none tabular-nums">
                {elapsed}
              </div>
              <div className="text-4xl text-neutral-400">秒経過</div>
            </div>
          ) : (
            <div className="relative z-20 text-center">
              <div className="text-[14vw] font-black leading-none">
                第{index + 1}問
              </div>
              {mode === "manual" && (
                <div className="mt-4 text-3xl text-neutral-400">
                  手動で再生してください
                </div>
              )}
            </div>
          )}

          {errorCodes.length > 0 && (
            <div className="absolute bottom-3 right-4 z-30 rounded-lg bg-red-950 px-4 py-2 text-lg text-red-300">
              {errorCodes.map(([i, code]) => (
                <div key={i}>
                  第{Number(i) + 1}問: {ytErrorMessage(Number(code))}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* 直前の操作の表示。押しても何も起きないと当日操作を見失うため */}
      {toast && (
        <div className="pointer-events-none fixed bottom-16 left-1/2 -translate-x-1/2 rounded-xl bg-neutral-100 px-8 py-3 text-3xl font-bold text-neutral-900 shadow-lg">
          {toast}
        </div>
      )}

      {/* キー割り当て（常時表示） */}
      <footer className="flex flex-wrap justify-center gap-5 border-t border-neutral-800 px-4 py-2 text-base text-neutral-500">
        <Key k="Space" v="再生/一時停止" />
        <Key k="1" v="正解→答え表示" />
        <Key k="2" v="誤答→再開" />
        <Key k="R" v="押下取消" />
        <Key k="N" v="次の曲" />
        <Key k="←→" v="曲選択" />
        <Key k="M" v="モード切替" />
      </footer>
    </div>
  );
}

function Answer({
  song,
  buzzed,
}: {
  song: Song | undefined;
  buzzed: Player | null;
}) {
  if (!song) return <div className="text-6xl">曲データがありません</div>;
  return (
    <div className="text-center">
      <div className="text-3xl text-neutral-400">正解</div>
      <div className="break-all text-[7vw] font-black leading-tight">{song.title}</div>
      <div className="text-[3.5vw] text-neutral-300">{song.artist}</div>
      <div className="mt-4 text-[2.5vw] text-yellow-300">
        {song.owner} さんの推し曲
      </div>
      {buzzed && (
        <div className="mt-3 text-3xl text-green-300">回答者: {buzzed.name}</div>
      )}
    </div>
  );
}

function Key({ k, v }: { k: string; v: string }) {
  return (
    <span>
      <kbd className="rounded bg-neutral-800 px-2 py-0.5 text-neutral-300">{k}</kbd>{" "}
      {v}
    </span>
  );
}
