// 管理画面。手元のノートPCで開き、クリックで進行する。
// ノートPCの左半分に置き、右半分で YouTube を手動再生する想定なので、
// 幅が狭くても崩れないレイアウトにしている。
import { useCallback, useEffect, useRef, useState } from "react";
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
    revealInMs: 0,
  },
  mode: "manual",
  songs: [],
  ytStatus: { ready: false, readyCount: 0, total: 0 },
  suspenseMs: 2000,
};

export default function HostView() {
  const [state, setState] = useState<State>(EMPTY);
  // 編集用の下書き。入力中にサーバーからの更新で上書きされないよう分けている。
  const [draft, setDraft] = useState<Song[] | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [armed, setArmed] = useState(false); // 音声解除済みか
  // 正解時にサビをブラウザの別タブで自動再生するか（手動モード用）
  const [autoChorus, setAutoChorus] = useState(true);
  // 曲再生用タブへの参照。window.open は必ずフォーカスを奪うので、
  // 2回目以降は開いたタブの location を差し替えて再生位置だけ移す。
  const playerWin = useRef<Window | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);
  // 予約中のサビ再生。問題を移るときに取り消さないと、次の問題で鳴り出す。
  const chorusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 「正解」を押してからサビを鳴らすまでの待ち時間（秒）。
  // YouTube の読み込みぶん早めに投げたいので、溜めとは別の値にしている。
  const [chorusDelay, setChorusDelay] = useState(() => {
    const saved = Number(localStorage.getItem(CHORUS_DELAY_KEY));
    return Number.isFinite(saved) && saved >= 0 ? saved : 2;
  });

  /** 指定秒から曲を鳴らす。既にタブがあればフォーカスを奪わない */
  const playAt = useCallback((videoId: string, sec: number) => {
    if (!videoId) return;
    const url = ytUrl(videoId, sec);
    const w = playerWin.current;
    if (w && !w.closed) {
      w.location.href = url; // タブは切り替わらない
    } else {
      playerWin.current = window.open(url, YT_TAB);
      setPlayerOpen(!!playerWin.current);
    }
    window.focus(); // 管理画面にフォーカスを戻す
  }, []);

  /**
   * 再生タブを黙らせる。予約済みのサビ再生も取り消す。
   * 別オリジンのタブは中身を触れないが location への書き込みだけは許されているので、
   * about:blank へ飛ばすのが手動モードで音を止められる唯一の手段になる。
   * タブ自体は閉じずに残すので、次の playAt はフォーカスを奪わずに使い回せる。
   */
  const stopPlayback = useCallback(() => {
    if (chorusTimer.current !== null) {
      clearTimeout(chorusTimer.current);
      chorusTimer.current = null;
    }
    const w = playerWin.current;
    if (w && !w.closed) w.location.href = "about:blank";
  }, []);

  const songs = state.songs;
  const { index, revealed, playing, wrongName, resumeInMs, revealInMs } =
    state.round;
  const suspense = revealInMs > 0 && !revealed; // 「正解は…」の溜め中
  const mode = state.mode;
  const song = songs[index];
  const buzzed = state.buzzedBy;
  const last = songs.length - 1;
  const countdown = useCountdown(resumeInMs);
  const showWrong = wrongName !== null;

  useEffect(() => {
    const onState = (s: State) => setState(s);
    const onBuzzed = () => beep(); // 手元でも鳴らす。曲を止める合図
    const onConnect = () => {
      setConnected(true);
      socket.emit("role:host"); // 曲データを受け取るために名乗る
    };
    const onDisconnect = () => setConnected(false);
    socket.on("state", onState);
    socket.on("buzzed", onBuzzed);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off("state", onState);
      socket.off("buzzed", onBuzzed);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  // 問題が変わったら再生タブを黙らせる。
  // 正解発表で鳴らしたサビが、次の問題に移っても流れ続けるのを防ぐ。
  // 「前の問題」「次の問題」「問題一覧のクリック」すべてがここを通る。
  useEffect(() => {
    stopPlayback();
  }, [index, stopPlayback]);

  // 画面を閉じるときに予約済みのサビ再生を残さない
  useEffect(
    () => () => {
      if (chorusTimer.current !== null) clearTimeout(chorusTimer.current);
    },
    [],
  );

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
          {suspense && (
            <span className="rounded bg-neutral-200 px-2 py-0.5 text-sm font-bold text-neutral-900">
              正解は… 溜め中
            </span>
          )}
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
        {song && song.videoId && (
          // 手動再生用。t= で再生開始位置を指定できるので、イントロとサビを別操作にする
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <YtBtn
              onClick={() => playAt(song.videoId, song.startSec)}
              label={`▶ イントロ (${song.startSec}秒〜)`}
            />
            <YtBtn
              onClick={() =>
                playAt(song.videoId, song.chorusSec ?? song.startSec)
              }
              label={`♪ サビ (${song.chorusSec ?? song.startSec}秒〜)`}
              accent
            />
            <span className="text-xs text-neutral-500">
              {playerOpen ? "再生タブと接続中" : "初回のみタブが切り替わります"}
            </span>
          </div>
        )}
        {song && !song.videoId && (
          <div className="mt-3 text-sm text-neutral-600">
            動画IDが未設定です（手元で曲を探して再生してください）
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
            // 未準備のまま押すと「再生中なのに音が出ない」状態になるので止める
            disabled={!state.ytStatus.ready}
          >
            {state.ytStatus.ready
              ? playing
                ? "⏸ 一時停止"
                : "▶ イントロ再生"
              : `動画を準備中… ${state.ytStatus.readyCount}/${state.ytStatus.total}`}
          </Btn>
        ) : (
          <label className="col-span-2 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-neutral-700 px-4 py-3 text-neutral-300">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={autoChorus}
              onChange={(e) => setAutoChorus(e.target.checked)}
            />
            <span className="flex-1">
              正解時にサビを別タブで自動再生する
              <span className="block text-xs text-neutral-500">
                同じタブを使い回すので、以降タブは切り替わりません
              </span>
            </span>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.currentTarget.blur();
                // 開演前に1回押しておけば、本番中にタブが切り替わらない
                playerWin.current = window.open("about:blank", YT_TAB);
                setPlayerOpen(!!playerWin.current);
                window.focus();
              }}
              className="rounded-lg border border-neutral-600 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
            >
              {playerOpen ? "再生タブ ✓" : "再生タブを用意"}
            </button>
          </label>
        )}

        <Btn
          tone="green"
          onClick={() => {
            socket.emit("host:reveal");
            if (autoChorus && mode === "manual" && song?.videoId) {
              const sec = song.chorusSec ?? song.startSec;
              const w = playerWin.current;
              const delayMs = Math.round(chorusDelay * 1000);
              if (w && !w.closed && delayMs > 0) {
                // タブが既にあれば、指定した秒数だけ待ってから鳴らす。
                // 問題を移ったときに取り消せるよう ref に持たせる。
                chorusTimer.current = setTimeout(() => {
                  chorusTimer.current = null;
                  playAt(song.videoId, sec);
                }, delayMs);
              } else {
                // タブが無いときはクリック起点でないと開けないので、すぐ開く
                playAt(song.videoId, sec);
              }
            }
          }}
          disabled={revealed || suspense}
        >
          {suspense ? "正解は…" : "○ 正解・答えを出す"}
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
        <Btn
          tone="ghost"
          onClick={() => {
            stopPlayback(); // 問題番号が変わらないので、ここで明示的に止める
            socket.emit("host:nextRound");
          }}
        >
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

      {/* 演出の調整。当日その場で耳と目を合わせられるようにする */}
      <div className="rounded-2xl bg-neutral-900 p-4">
        <div className="pb-3 text-neutral-400">演出の調整</div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <span className="text-sm text-neutral-400">「正解は…」の長さ</span>
            <input
              type="number"
              step="0.5"
              min="0"
              max="10"
              value={state.suspenseMs / 1000}
              onChange={(e) =>
                socket.emit("host:setSuspense", Number(e.target.value) * 1000)
              }
              className="w-20 rounded-lg bg-neutral-800 px-3 py-2 text-center text-neutral-100 outline-none focus:ring-2 focus:ring-sky-600"
            />
            <span className="text-sm text-neutral-500">秒</span>
          </label>

          {mode === "manual" && (
            <label className="flex items-center gap-2">
              <span className="text-sm text-neutral-400">サビを鳴らすまで</span>
              <input
                type="number"
                step="0.5"
                min="0"
                max="10"
                value={chorusDelay}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(10, Number(e.target.value)));
                  setChorusDelay(v);
                  localStorage.setItem(CHORUS_DELAY_KEY, String(v));
                }}
                className="w-20 rounded-lg bg-neutral-800 px-3 py-2 text-center text-neutral-100 outline-none focus:ring-2 focus:ring-amber-600"
              />
              <span className="text-sm text-neutral-500">秒</span>
            </label>
          )}
        </div>
        <p className="mt-2 text-xs text-neutral-600">
          どちらも「正解」を押した時点からの秒数です。YouTube の読み込みぶん音が遅れるので、
          サビは投影より早めに投げると揃います。
        </p>
      </div>

      {/* 参加者 */}
      <div className="rounded-2xl bg-neutral-900 p-4">
        <div className="flex items-center justify-between pb-1">
          <span className="text-neutral-400">参加者 {state.players.length}人</span>
          <button
            onClick={(e) => {
              e.currentTarget.blur();
              // 取り返しがつかない操作なので必ず確認する
              const ok = window.confirm(
                `参加者 ${state.players.length}人 をすべて消します。\n` +
                  `お手つきの記録も消えます。\n\n` +
                  `いま繋がっている人は自動で入り直すので、\n` +
                  `もう居ない人だけが消えます。\n\n実行しますか？`,
              );
              if (ok) socket.emit("host:clearPlayers");
            }}
            disabled={state.players.length === 0}
            className="rounded-lg border border-red-800 px-3 py-1 text-sm text-red-300 hover:bg-red-950 disabled:opacity-30"
          >
            全員クリア
          </button>
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
        <div className="flex items-center justify-between pb-2">
          <span className="text-neutral-400">問題一覧</span>
          {draft === null ? (
            <button
              className="rounded-lg border border-neutral-700 px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-800"
              onClick={(e) => {
                e.currentTarget.blur();
                setDraft(songs.map((s) => ({ ...s })));
              }}
            >
              ✎ 曲を編集
            </button>
          ) : (
            <span className="text-sm text-amber-400">編集中（未反映）</span>
          )}
        </div>

        {draft === null ? (
          <ul className="flex flex-col gap-1">
            {songs.map((s, i) => (
              <li key={i}>
                <button
                  onClick={(e) => {
                    e.currentTarget.blur();
                    socket.emit("host:setSong", i);
                  }}
                  className={`w-full rounded-lg px-3 py-2 text-left ${
                    i === index
                      ? "bg-sky-800 text-white"
                      : "text-neutral-300 hover:bg-neutral-800"
                  }`}
                >
                  <div className="truncate">
                    {i + 1}. {s.title}
                  </div>
                  <div className="truncate text-sm text-neutral-400">
                    {s.artist}
                    {s.owner ? ` — ${s.owner} さんの推し曲` : ""}
                  </div>
                </button>
              </li>
            ))}
            {songs.length === 0 && (
              <li className="text-neutral-600">
                曲がありません。「曲を編集」から追加してください
              </li>
            )}
          </ul>
        ) : (
          <SongEditor
            draft={draft}
            setDraft={setDraft}
            onApply={() => {
              socket.emit("host:setSongs", draft);
              setDraft(null);
            }}
            onCancel={() => setDraft(null)}
          />
        )}
      </div>
    </div>
  );
}

/** 指定秒から曲を鳴らすボタン。再生タブを使い回すので、2回目以降はタブが切り替わらない */
function YtBtn({
  onClick,
  label,
  accent,
}: {
  onClick: () => void;
  label: string;
  accent?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.currentTarget.blur();
        onClick();
      }}
      className={`rounded-lg px-3 py-2 text-base font-bold ${
        accent
          ? "bg-amber-500 text-neutral-900 hover:bg-amber-400"
          : "bg-sky-700 text-white hover:bg-sky-600"
      }`}
    >
      {label}
    </button>
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

/** 曲の追加・編集・並べ替え。下書きに対して操作し、「反映する」で初めてサーバーへ送る */
function SongEditor({
  draft,
  setDraft,
  onApply,
  onCancel,
}: {
  draft: Song[];
  setDraft: (s: Song[]) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const update = (i: number, patch: Partial<Song>) =>
    setDraft(draft.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.length) return;
    const next = [...draft];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  };

  const remove = (i: number) => setDraft(draft.filter((_, k) => k !== i));

  const add = () =>
    setDraft([
      ...draft,
      { videoId: "", title: "", artist: "", owner: "", startSec: 0, chorusSec: 0 },
    ]);

  return (
    <div className="flex flex-col gap-3">
      {draft.map((s, i) => (
        <div key={i} className="rounded-xl border border-neutral-700 p-3">
          <div className="flex items-center gap-2 pb-2">
            <span className="text-neutral-500">{i + 1}</span>
            <div className="flex-1" />
            <IconBtn onClick={() => move(i, -1)} disabled={i === 0} label="↑" />
            <IconBtn
              onClick={() => move(i, 1)}
              disabled={i === draft.length - 1}
              label="↓"
            />
            <IconBtn onClick={() => remove(i)} label="削除" danger />
          </div>
          <Field label="曲名" value={s.title} onChange={(v) => update(i, { title: v })} />
          <Field
            label="アーティスト"
            value={s.artist}
            onChange={(v) => update(i, { artist: v })}
          />
          <Field
            label="推した人"
            value={s.owner}
            onChange={(v) => update(i, { owner: v })}
          />
          <Field
            label="動画ID（t= 付きURLを貼るとサビ秒も取り込みます）"
            value={s.videoId}
            onChange={(v) => {
              const { videoId, t } = parseYouTube(v);
              update(i, t !== null ? { videoId, chorusSec: t } : { videoId });
            }}
          />
          <div className="flex gap-2">
            <Field
              label="イントロ開始秒"
              value={String(s.startSec)}
              numeric
              onChange={(v) => update(i, { startSec: Number(v) || 0 })}
            />
            <Field
              label="サビ開始秒"
              value={String(s.chorusSec ?? 0)}
              numeric
              onChange={(v) => update(i, { chorusSec: Number(v) || 0 })}
            />
          </div>
        </div>
      ))}

      <button
        onClick={(e) => {
          e.currentTarget.blur();
          add();
        }}
        className="rounded-xl border border-dashed border-neutral-600 py-3 text-neutral-300 hover:bg-neutral-800"
      >
        ＋ 曲を追加
      </button>

      <div className="flex gap-2">
        <button
          onClick={(e) => {
            e.currentTarget.blur();
            onApply();
          }}
          className="flex-1 rounded-xl bg-emerald-600 py-3 text-lg font-bold hover:bg-emerald-500"
        >
          反映する
        </button>
        <button
          onClick={(e) => {
            e.currentTarget.blur();
            onCancel();
          }}
          className="rounded-xl border border-neutral-700 px-5 py-3 text-neutral-300 hover:bg-neutral-800"
        >
          やめる
        </button>
      </div>

      <button
        onClick={async (e) => {
          e.currentTarget.blur();
          const json = JSON.stringify(draft, null, 2);
          try {
            await navigator.clipboard.writeText(json);
            alert(
              "JSONをコピーしました。public/songs.json に貼り付けると、サーバー再起動後も残ります。",
            );
          } catch {
            window.prompt("コピーして public/songs.json に貼り付けてください", json);
          }
        }}
        className="rounded-xl border border-neutral-700 py-2 text-sm text-neutral-400 hover:bg-neutral-800"
      >
        JSONとしてコピー（songs.json に貼れば再起動後も残ります）
      </button>
    </div>
  );
}

/**
 * URL から動画IDと再生開始位置を取り出す。
 * `?t=66` `?t=1m6s` `&start=66` に対応する。t が無ければ null。
 */
export function parseYouTube(input: string): { videoId: string; t: number | null } {
  const v = input.trim();
  const idMatch =
    v.match(/[?&]v=([A-Za-z0-9_-]{5,})/) ??
    v.match(/youtu\.be\/([A-Za-z0-9_-]{5,})/) ??
    v.match(/\/embed\/([A-Za-z0-9_-]{5,})/);
  const videoId = (idMatch ? idMatch[1] : v).slice(0, 40);

  const tMatch = v.match(/[?&](?:t|start)=([0-9hms]+)/i);
  let t: number | null = null;
  if (tMatch) {
    const raw = tMatch[1];
    if (/^\d+$/.test(raw)) {
      t = Number(raw);
    } else {
      // 1m6s / 2h3m4s のような形式
      const h = Number(raw.match(/(\d+)h/)?.[1] ?? 0);
      const m = Number(raw.match(/(\d+)m/)?.[1] ?? 0);
      const sec = Number(raw.match(/(\d+)s/)?.[1] ?? 0);
      t = h * 3600 + m * 60 + sec;
    }
  }
  return { videoId, t };
}

/** 指定秒から始まる YouTube の URL を作る */
export function ytUrl(videoId: string, sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  return `https://www.youtube.com/watch?v=${videoId}&t=${t}s&autoplay=1`;
}

/** 曲再生用のタブ。同じ名前を使うことでタブが増え続けないようにする */
const YT_TAB = "introquiz-player";

/** サビ再生までの待ち時間の保存先。端末ごとに覚えておく */
const CHORUS_DELAY_KEY = "introquiz:chorusDelay";

function Field({
  label,
  value,
  onChange,
  numeric,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
}) {
  return (
    <label className="mb-2 block">
      <span className="text-xs text-neutral-500">{label}</span>
      <input
        className="w-full rounded-lg bg-neutral-800 px-3 py-2 text-neutral-100 outline-none focus:ring-2 focus:ring-sky-600"
        value={value}
        inputMode={numeric ? "numeric" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function IconBtn({
  onClick,
  label,
  disabled,
  danger,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.currentTarget.blur();
        onClick();
      }}
      disabled={disabled}
      className={`rounded-lg border px-3 py-1 text-sm disabled:opacity-30 ${
        danger
          ? "border-red-800 text-red-300 hover:bg-red-950"
          : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
      }`}
    >
      {label}
    </button>
  );
}
