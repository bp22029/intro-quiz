// 管理画面。手元のノートPCで開き、クリックで進行する。
// ノートPCの左半分に置き、右半分で YouTube を手動再生する想定なので、
// 幅が狭くても崩れないレイアウトにしている。
//
// YouTubeモードの曲もこの画面が鳴らす。投影画面や別窓ではなくここに置くのは、
// Chrome が「隠れている画面で始めた再生」を前面に来るまで延期するため
// (https://www.chromium.org/audio-video/autoplay/)。
// 再生ボタンを押す瞬間、この画面は必ず前面にあるので、延期される条件が
// 原理的に成立しない。別窓に分けると並べて配置し続ける必要が出てしまう。
import { useCallback, useEffect, useRef, useState } from "react";
import { beep, playBuzz, preloadSfx, unlockAudio } from "./beep";
import { RoomMissing, useRoomMissing } from "./RoomMissing";
import { hostPath, roomRef, screenPath } from "./room";
import { socket, syncState } from "./socket";
import { useCountdown } from "./useCountdown";
import type { PlayMode, Song, State } from "./types";
import { useYouTube, ytErrorMessage } from "./useYouTube";
import { parseYouTube, ytUrl } from "./yturl";

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
 * ボタンの記号。文字（▶ ● ○ × ✎）は使わない。
 * 環境によっては絵文字の字形で出てしまい、色も大きさも制御できなくなる。
 * 色はボタンの文字色を継ぐ（currentColor）。
 */
const Ico = {
  play: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0 fill-current">
      <path d="M8.4 5.2a1 1 0 0 1 1.5-.9l9.2 6.8a1 1 0 0 1 0 1.8l-9.2 6.8a1 1 0 0 1-1.5-.9z" />
    </svg>
  ),
  pause: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0 fill-current">
      <path d="M8 5h3.2v14H8zM12.8 5H16v14h-3.2z" />
    </svg>
  ),
  circle: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="8" />
    </svg>
  ),
  cross: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true" className="shrink-0">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  pencil: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M4 20h4L20 8l-4-4L4 16z" />
    </svg>
  ),
  note: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0 fill-current">
      <path d="M11 4v10.2a3.2 3.2 0 1 0 2 2.96V8h5V4z" />
    </svg>
  ),
  check: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M4 12l6 6L20 6" />
    </svg>
  ),
  dot: (filled: boolean) => (
    <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      <circle cx="6" cy="6" r="5" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
};

export default function HostView() {
  const [state, setState] = useState<State>(EMPTY);
  // 編集用の下書き。入力中にサーバーからの更新で上書きされないよう分けている。
  const [draft, setDraft] = useState<Song[] | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [armed, setArmed] = useState(false); // 音声解除済みか
  const roomMissing = useRoomMissing();
  // この画面のURLに入っている主催キー。投影画面を開くのに使う。
  // main.tsx がこの kind のときだけ HostView を描くので、必ず入っている。
  const hostKey = roomRef.kind === "host" ? roomRef.hostKey : "";
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
  const runUp = state.runUp; // 溜め中にサビへの助走を鳴らすか
  const mode = state.mode;
  const song = songs[index];
  const buzzed = state.buzzedBy;
  const last = songs.length - 1;
  const countdown = useCountdown(resumeInMs);
  const showWrong = wrongName !== null;

  // YouTubeモードのときだけプレイヤーを作る（手動モードでは1つも作らない）
  const masterVolume = state.masterVolume;
  const yt = useYouTube(songs, mode === "youtube", masterVolume);
  const ytError: number | undefined = yt.errors[index];
  // 前回この端末で使った曲リスト。サーバーが初期値に戻っていたら復元を勧める。
  const [saved] = useState<Song[] | null>(() => loadSavedSongs());
  const [dismissRestore, setDismissRestore] = useState(false);
  const canRestore =
    saved !== null &&
    !dismissRestore &&
    songs.length > 0 && // サーバーの状態が届く前は出さない
    !sameSongs(saved, songs);

  /**
   * 「正解・答えを出す」の2度押し。
   *
   * 問題を送った直後は誰も押していないのに、このボタンだけは押せる状態にある。
   * ここで手が滑ると客席に答えが出てしまい、取り返しがつかない
   * （「この問題をやり直す」で状態は戻せても、見られた事実は戻らない）。
   * 誰も押していないときだけ1回目を確認にする。
   * 回答者が出ているときは一刻を争うので1回のままにする。毎回2度押しにすると
   * 司会が反射で2回叩くようになり、確認の意味が無くなる。
   */
  const [armReveal, setArmReveal] = useState(false);

  // 音量スライダーの下書き。離した時点で songs へ保存する。
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  // この曲だけの設定があるか。無ければ全体音量に従う。
  const hasOwnVolume = song?.volume !== undefined;
  const shownVolume = volumeDraft ?? song?.volume ?? masterVolume;

  /** 音量の下書きを songs へ書き戻す。スライダーを離したときだけ呼ぶ */
  const saveVolume = useCallback(() => {
    setVolumeDraft((draft) => {
      if (draft === null) return null;
      const next = songs.map((s, i) =>
        i === index ? { ...s, volume: draft } : s,
      );
      socket.emit("host:setSongs", next);
      return null;
    });
  }, [songs, index]);

  /** この曲だけの設定を捨てて、全体音量に従わせる */
  const clearOwnVolume = useCallback(() => {
    setVolumeDraft(null);
    const next = songs.map((s, i) =>
      i === index ? { ...s, volume: undefined } : s,
    );
    socket.emit("host:setSongs", next);
    yt.setVolume(index, masterVolume);
  }, [songs, index, masterVolume, yt]);

  useEffect(() => {
    const onState = (s: State) => setState(s);
    // ここではビープを鳴らさない。投影画面(/screen)が鳴らすので、同じPCで
    // 両方を開いていると同じスピーカーから2つ鳴り、重なって聞こえる。
    // 早押しは画面表示（回答者名）でも分かるので、音は投影側に一本化する。
    //
    // 曲データを受け取れるかどうかは、ハンドシェイクで渡した主催キーで決まる。
    // 繋がり直しても役割を名乗る必要はない（名乗りで権限が付くと参加者に真似される）。
    const onConnect = () => {
      setConnected(true);
      syncState();
    };
    const onDisconnect = () => setConnected(false);
    socket.on("state", onState);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) onConnect();
    else syncState(); // 繋がる前に頼んでおく。socket.io が接続時に送ってくれる
    return () => {
      socket.off("state", onState);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  // 確認待ちを持ち越さない。問題が変わった / 誰かが押した / 答えが出た、
  // のいずれでも解除する。押しっぱなしのまま次の問題へ入ると意味が無くなる。
  useEffect(() => {
    setArmReveal(false);
  }, [index, revealed, buzzed?.id]);

  // 放っておいても解除する。だいぶ経ってからの1押しで答えが出るのは事故のもと。
  useEffect(() => {
    if (!armReveal) return;
    const t = setTimeout(() => setArmReveal(false), 4000);
    return () => clearTimeout(t);
  }, [armReveal]);

  // 問題が変わったら再生タブを黙らせる。
  // 正解発表で鳴らしたサビが、次の問題に移っても流れ続けるのを防ぐ。
  // 「前の問題」「次の問題」「問題一覧のクリック」すべてがここを通る。
  useEffect(() => {
    stopPlayback();
    setVolumeDraft(null); // 別の曲の音量を引きずらない
  }, [index, stopPlayback]);

  // 画面を閉じるときに予約済みのサビ再生を残さない
  useEffect(
    () => () => {
      if (chorusTimer.current !== null) clearTimeout(chorusTimer.current);
    },
    [],
  );

  // --- ここから YouTubeモードの再生制御 ---

  // 準備が整う前に再生を要求されていた場合、整った時点で鳴らし直す。
  // これがないと「サーバーは再生中なのに音が出ない」状態のままになる。
  //
  // 溜め中は対象外にする。溜めに入った瞬間は playing=true / revealed=false に
  // なるのでこの条件に合ってしまうが、ここで play() すると「止めた位置から」
  // 再生が始まり、直後に走る助走のシークがその読み込みに飲まれて効かない。
  // 溜め中の再生は下の追従効果（助走）に任せる。
  useEffect(() => {
    if (mode === "youtube" && playing && yt.ready && !revealed && !suspense) {
      yt.play(index);
    }
  }, [yt.ready, mode, playing, revealed, suspense, index, yt]);

  // サーバー状態に合わせてプレイヤーを追従させる
  const prevPlay = useRef({
    index: -1,
    revealed: false,
    playing: false,
    suspense: false,
    ready: false,
  });
  // この問題で助走を鳴らしたか。鳴らしたなら答え表示でサビへ飛ばさない
  // （飛ばすと助走ぶん巻き戻ってしまう）。
  const ranUp = useRef(false);
  useEffect(() => {
    if (mode !== "youtube") return;
    const p = prevPlay.current;
    const chorus = song?.chorusSec ?? song?.startSec ?? 0;
    // 答えも溜めも出ていない状態に戻ったら、助走の記録を捨てる
    if (!revealed && !suspense) ranUp.current = false;

    if (p.index !== index) {
      yt.pause(p.index);
      yt.seekToStart(index);
      ranUp.current = false;
    } else if (runUp && suspense && yt.ready && (!p.suspense || !p.ready)) {
      // 「正解は…」の溜めに入った。溜めの長さぶん手前から、音量を上げながら鳴らす。
      // 溜めが明けて答えが出る瞬間に、ちょうどサビの頭が来る。
      // 準備前に「正解」を押された場合に備え、準備が整った時点でも拾う。
      yt.fadeInAndPlay(
        index,
        Math.max(0, chorus - state.suspenseMs / 1000),
        state.suspenseMs,
      );
      ranUp.current = true;
    } else if (revealed && !p.revealed && !ranUp.current) {
      // 助走を鳴らしていない場合だけ、ここでサビへ飛ぶ。
      // 助走中に飛ばすと、上がってきた音がその分巻き戻ってしまう。
      yt.seekAndPlay(index, chorus);
    } else if (playing && !p.playing) {
      yt.play(index);
    } else if (!playing && p.playing) {
      yt.pause(index);
    }

    prevPlay.current = { index, revealed, playing, suspense, ready: yt.ready };
  }, [
    mode,
    index,
    revealed,
    playing,
    suspense,
    runUp,
    state.suspenseMs,
    yt,
    song,
  ]);

  // 答えを消したときはサビも止める。溜め中は鳴らしているので対象外。
  useEffect(() => {
    if (mode === "youtube" && !revealed && !playing && !suspense) {
      yt.pause(index);
    }
  }, [revealed, playing, suspense, mode, yt, index]);

  if (roomMissing) return <RoomMissing what="管理画面のURL" />;

  if (!armed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <h1 className="text-4xl font-black">管理画面</h1>
        <button
          className="rounded-full bg-gold px-12 py-6 text-3xl font-black text-ground hover:bg-gold-bright"
          onClick={async (e) => {
            e.currentTarget.blur();
            await unlockAudio();
            beep();
            void preloadSfx(); // 試聴に使う。本番中の読み込み待ちも防ぐ
            setArmed(true);
          }}
        >
          操作をはじめる
        </button>
        <p className="max-w-md text-center text-ink-3">
          クリックすると早押しのビープ音が鳴らせるようになります。
          投影用の画面は、この先の「投影画面を開く」から開けます。
        </p>
        {/*
          開演前に必ず通る画面なので、ここに置く。
          Chrome のプロファイルを取り違えると、事前チェックが全部通っていても
          本番で YouTube Premium 限定の曲だけが鳴らない。原因に辿り着きにくい。
        */}
        <p className="max-w-md rounded-r2 border border-gold-dim bg-panel px-4 py-3 text-center text-sm leading-relaxed text-gold-bright">
          このブラウザのGoogleアカウントが、本番で使うものか確認してください。
          YouTube Premium 限定の曲は、アカウントが違うと鳴りません。
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-ground p-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between text-sm">
        <span
          className={`inline-flex items-center gap-1.5 ${connected ? "text-ok" : "text-gold"}`}
        >
          {Ico.dot(connected)}
          {connected ? "接続中" : "再接続中…"}
        </span>
        <div className="flex items-center gap-3">
          {/*
            投影画面を開く。司会と投影の担当が同じ人であることが多いので、
            URLを手で打たずに出せるようにする。同じ名前の窓を使うので増えない。
            投影用ディスプレイへ移してから全画面にする想定。
          */}
          <button
            onClick={(e) => {
              e.currentTarget.blur();
              window.open(screenPath(hostKey), SCREEN_WIN);
              window.focus(); // 操作は管理画面に戻す
            }}
            className="rounded-r1 border border-chip px-3 py-1 text-ink-2 hover:bg-sink"
          >
            投影画面を開く
          </button>
          <span className="text-ink-3">再生モード</span>
          <ModeToggle mode={mode} onChange={stopPlayback} />
        </div>
      </div>

      <RoomBar roomCode={state.roomCode} hostKey={hostKey} />

      {canRestore && saved && (
        <div className="rounded-r2 border-2 border-gold bg-panel p-4 text-ink">
          <div className="font-bold">
            前回この端末で使った曲リストがあります（{saved.length}曲）
          </div>
          <div className="mt-1 text-sm text-ink-2">
            サーバーを再起動すると曲は初期値に戻ります。今のリスト（
            {songs.length}曲）と違うので、必要なら戻せます。
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                socket.emit("host:setSongs", saved);
                setDismissRestore(true);
              }}
              className="rounded-r1 bg-gold px-4 py-2 font-bold text-ground hover:bg-gold-bright"
            >
              前回のリストに戻す
            </button>
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                setDismissRestore(true);
              }}
              className="rounded-r1 border border-gold px-4 py-2 text-ink-2 hover:bg-panel"
            >
              今のままでよい
            </button>
          </div>
        </div>
      )}

      {/*
        1画面で回すために2列にする。左が「押す」、右が「見て選ぶ」。
        縦1列のままだと、本番中に操作を探してスクロールすることになる。
        xl 未満（ノートPCを半分に割ったときなど）は従来どおり縦1列へ戻す。
      */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        {/* 左列: 本番中に押すものだけ。スクロールせずに全部見えることを優先する */}
        <div className="flex flex-col gap-3 xl:w-[44rem] xl:shrink-0">
          {/* 早押し状況 */}
          <div
            className={`rounded-r2 px-5 py-6 text-center ${showWrong ? "bg-miss" : buzzed ? "bg-win" : "bg-panel"
              }`}
          >
            {showWrong ? (
              <>
                <div className="text-4xl font-black">不正解 — {wrongName} さん</div>
                <div className="mt-1 text-2xl text-miss-ink">
                  {countdown > 0 ? `受付再開まで ${countdown}` : "受付を再開しました"}
                </div>
              </>
            ) : buzzed ? (
              <>
                <div className="text-lg text-gold-bright">回答者</div>
                <div className="break-all text-5xl font-black leading-tight">
                  {buzzed.name}
                </div>
              </>
            ) : (
              <div className="text-3xl font-bold text-ink-3">受付中</div>
            )}
          </div>

          {/* 現在の問題（答えが見える。投影には出ない） */}
          <div className="rounded-r2 bg-panel p-5">
            <div className="flex items-center justify-between">
              <span className="text-lg text-ink-3">
                第 {index + 1} 問 / 全 {songs.length || "-"} 問
              </span>
              {suspense && (
                <span className="rounded bg-ink px-2 py-0.5 text-sm font-bold text-ground">
                  正解は… 溜め中
                </span>
              )}
              {revealed && (
                <span className="rounded bg-gold-bright px-2 py-0.5 text-sm font-bold text-ground">
                  答え表示中
                </span>
              )}
            </div>
            <div className="mt-2 break-all text-3xl font-black leading-tight">
              {song?.title ?? "（曲データなし）"}
            </div>
            <div className="text-xl text-ink-2">{song?.artist ?? ""}</div>
            {song?.owner && (
              <div className="mt-1 text-lg text-gold-bright">
                {song.owner} さんの推し曲
              </div>
            )}
            {mode === "manual" && song && song.videoId && (
              // 手動モード専用。外部の YouTube タブを t= 付きで開く。
              // YouTubeモードでは画面内のプレイヤーが鳴らすので出さない。
              // 両方出すと、どちらが鳴るのか分からず二重再生の元になる。
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <YtBtn
                  onClick={() => playAt(song.videoId, song.startSec)}
                  label={<>{Ico.play()}イントロ ({song.startSec}秒〜)</>}
                />
                <YtBtn
                  onClick={() =>
                    playAt(song.videoId, song.chorusSec ?? song.startSec)
                  }
                  label={<>{Ico.note()}サビ ({song.chorusSec ?? song.startSec}秒〜)</>}
                  accent
                />
                <span className="text-xs text-ink-3">
                  {playerOpen ? "再生タブと接続中" : "初回のみタブが切り替わります"}
                </span>
              </div>
            )}
            {mode === "manual" && song && !song.videoId && (
              <div className="mt-3 text-sm text-chip-ink">
                動画IDが未設定です（手元で曲を探して再生してください）
              </div>
            )}
          </div>

          {/*
            プレイヤー。YouTubeモードのときだけ作る。
            映像は隠さない（埋め込みプレーヤーは可視であることが求められる）。
            現在の曲だけを枠内に置き、他は枠外へ逃がす。
          */}
          {mode === "youtube" && (
            <div
              // 高さに上限を置く。ここは音を出すための枠で、映像は見なくてよい。
              // 16:9 のまま伸ばすと、本番中に押すボタンが画面の下へ追い出される。
              className="relative aspect-video max-h-[13rem] w-full overflow-hidden rounded-r2 bg-black"
            >
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

              {!yt.ready && (
                <div className="absolute inset-0 flex items-center justify-center bg-ground/90 text-ink-2">
                  動画を準備中… {yt.readyCount} / {yt.total}
                </div>
              )}

              {ytError !== undefined && (
                <div className="absolute inset-x-4 bottom-4 rounded-r2 border-2 border-miss-border bg-miss-deep/95 px-4 py-3 text-center text-miss-ink">
                  この曲は再生できません（{ytErrorMessage(ytError)}）
                  <div className="mt-1 text-sm text-miss-ink2">
                    {ytError === 101 || ytError === 150
                      ? "まず、このブラウザのGoogleアカウントが本番で使うものか確認してください（YouTube Premium 限定の曲は別アカウントだと鳴りません）。それでも駄目なら埋め込み禁止・地域・年齢の制限です。手動モードへ切り替えるか、別の動画に差し替えてください"
                      : "「もう一度読み込む」で直ることがあります。駄目なら手動モードへ切り替えてください"}
                  </div>
                  {/*
                    エラーが出た曲は操作を受け付けなくなる。通信が一瞬切れた
                    だけでも同じ状態になり、曲を差し替えるまで戻れなかった。
                    司会が自分で戻せる口をここに置く。
                  */}
                  <button
                    onClick={(e) => {
                      e.currentTarget.blur();
                      yt.retry(index);
                    }}
                    className="mt-2 rounded-full border border-miss-border px-4 py-1 text-sm text-miss-ink hover:bg-miss-deep"
                  >
                    もう一度読み込む
                  </button>
                </div>
              )}
            </div>
          )}

          {/*
            曲ごとの音量。YouTube のラウドネス正規化は大きい音を下げるだけで
            小さい音を持ち上げないため、アートトラック(〇〇 - Topic)とMVを混ぜると
            音量差が残る。鳴らしながら合わせて、離した時点で songs へ保存する。
          */}
          {mode === "youtube" && song && (
            <div className="rounded-r2 bg-panel px-4 py-3">
              <label className="flex items-center gap-3">
                <span className="shrink-0 text-sm text-ink-3">この曲</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={shownVolume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVolumeDraft(v);
                    yt.setVolume(index, v); // 鳴っていれば即座に反映される
                  }}
                  onPointerUp={() => saveVolume()}
                  onKeyUp={() => saveVolume()}
                  onBlur={() => saveVolume()}
                  className="h-2 w-full cursor-pointer accent-gold"
                />
                <span className="w-10 shrink-0 text-right tabular-nums text-ink-2">
                  {shownVolume}
                </span>
              </label>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-ink-3">
                  {hasOwnVolume
                    ? "この曲だけの設定"
                    : `全体音量に従っています（${masterVolume}）`}
                </span>
                {hasOwnVolume && (
                  <button
                    onClick={(e) => {
                      e.currentTarget.blur();
                      clearOwnVolume();
                    }}
                    className="rounded border border-chip px-2 py-0.5 text-ink-3 hover:bg-sink"
                  >
                    全体に戻す
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 操作ボタン */}
          <div className="grid grid-cols-2 gap-3">
            {mode === "youtube" ? (
              <Btn
                tone={playing ? "playing" : "play"}
                onClick={() => socket.emit(playing ? "host:pause" : "host:play")}
                className="col-span-2"
                // 未準備のまま押すと「再生中なのに音が出ない」状態になるので止める。
                // 曲が0件だと ready は真になってしまうので、そこも弾く。
                disabled={!yt.ready || songs.length === 0}
              >
                {!yt.ready
                  ? `動画を準備中… ${yt.readyCount}/${yt.total}`
                  : revealed
                    ? // 答えを出した後に鳴っているのはサビ。文言を実態に合わせる
                    playing
                      ? <>{Ico.pause()}サビを止める</>
                      : <>{Ico.play()}サビを再生</>
                    : playing
                      ? <>{Ico.pause()}一時停止</>
                      : <>{Ico.play()}イントロ再生</>}
              </Btn>
            ) : (
              <label className="col-span-2 flex cursor-pointer items-center gap-3 rounded-r2 border border-dashed border-chip px-4 py-3 text-ink-2">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-gold"
                  checked={autoChorus}
                  onChange={(e) => setAutoChorus(e.target.checked)}
                />
                <span className="flex-1">
                  正解時にサビを別タブで自動再生する
                  <span className="block text-xs text-ink-3">
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
                  className="rounded-r1 border border-chip px-3 py-2 text-sm text-ink-2 hover:bg-sink"
                >
                  {playerOpen ? <>{Ico.check()}再生タブ</> : "再生タブを用意"}
                </button>
              </label>
            )}

            <Btn
              tone={armReveal ? "confirm" : "primary"}
              onClick={() => {
                // 誰も押していないなら、1回目は確認にとどめる
                if (!buzzed && !armReveal) {
                  setArmReveal(true);
                  return;
                }
                setArmReveal(false);
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
              {suspense ? (
                "正解は…"
              ) : armReveal ? (
                <>{Ico.circle()}もう一度押すと答えが出ます</>
              ) : (
                <>{Ico.circle()}正解・答えを出す</>
              )}
            </Btn>
            <Btn
              tone="danger"
              onClick={() => socket.emit("host:wrong")}
              disabled={!buzzed}
            >
              {Ico.cross()}お手つき
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
                // 問題番号が変わらないので、問題を移ったときの処理が走らない。
                // 「やり直す」なら曲も頭に戻っていないとおかしいので、ここで明示的に行う。
                stopPlayback(); // 手動モード: 再生タブを黙らせる
                yt.seekToStart(index); // YouTubeモード: イントロの頭で止め直す
                socket.emit("host:restartRound");
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
              tone="play"
              onClick={() => socket.emit("host:setSong", index + 1)}
              disabled={index >= last}
            >
              次の問題 ›
            </Btn>
          </div>

        </div>

        {/* 右列: 見るものと、開演前に決めるもの。進行中はほとんど触らない */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* 参加者 */}
          <div className="rounded-r2 bg-panel p-4">
            <div className="flex items-center justify-between pb-1">
              <span className="text-ink-3">参加者 {state.players.length}人</span>
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
                className="rounded-r1 border border-miss-border px-3 py-1 text-sm text-miss-ink2 hover:bg-miss-deep disabled:opacity-30"
              >
                全員クリア
              </button>
            </div>
            <div className="pb-2 text-xs text-chip-ink">
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
                      title={locked ? "お手つきを解除する" : "お手つきにする"}
                      className={`rounded-r1 px-2.5 py-1 ${locked
                          ? "bg-ground text-chip-ink line-through"
                          : "bg-sink text-ink hover:bg-rule"
                        }`}
                    >
                      {p.name}
                      {locked && <span className="ml-1 text-xs no-underline">お手つき</span>}
                    </button>
                  </li>
                );
              })}
              {state.players.length === 0 && (
                <li className="text-chip-ink">まだ誰も参加していません</li>
              )}
            </ul>
          </div>

          {/* 曲の一覧。飛びたい問題を直接選べる */}
          <div className="rounded-r2 bg-panel p-4">
            <div className="flex items-center justify-between pb-2">
              <span className="text-ink-3">問題一覧</span>
              {draft === null ? (
                <button
                  className="inline-flex items-center gap-1.5 rounded-full border border-chip px-3.5 py-1 text-sm text-ink-2 hover:bg-sink"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setDraft(songs.map((s) => ({ ...s })));
                  }}
                >
                  {Ico.pencil()}曲を編集
                </button>
              ) : (
                <span className="text-sm text-gold">編集中（未反映）</span>
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
                      className={`w-full rounded-r1 px-3 py-2 text-left ${i === index
                          ? "bg-panel text-ink"
                          : "text-ink-2 hover:bg-sink"
                        }`}
                    >
                      <div className="truncate">
                        {i + 1}. {s.title}
                      </div>
                      <div className="truncate text-sm text-ink-3">
                        {s.artist}
                        {s.owner ? ` — ${s.owner} さんの推し曲` : ""}
                      </div>
                    </button>
                  </li>
                ))}
                {songs.length === 0 && (
                  <li className="text-chip-ink">
                    曲がありません。「曲を編集」から追加してください
                  </li>
                )}
              </ul>
            ) : (
              <SongEditor
                draft={draft}
                // 更新関数を受け取れる形にする。曲名の取得は非同期なので、
                // 呼び出し時点の draft を掴んだまま書き戻すと、その間の編集が消える。
                setDraft={(next) =>
                  setDraft((prev) => (prev === null ? prev : next(prev)))
                }
                onApply={() => {
                  socket.emit("host:setSongs", draft);
                  saveSongs(draft); // サーバーが再起動しても取り戻せるようにする
                  setDraft(null);
                }}
                onCancel={() => setDraft(null)}
              />
            )}
          </div>

          {/* 演出の調整。当日その場で耳と目を合わせられるようにする */}
          <div className="rounded-r2 bg-panel p-4">
            <div className="pb-3 text-ink-3">演出の調整</div>

            {/*
              全体音量。曲ごとに設定していない曲はすべてこの値で鳴る。
              まずここで会場に合わせ、目立つ曲だけ上の「この曲」で直す。
            */}
            {mode === "youtube" && (
              <label className="mb-4 flex items-center gap-3">
                <span className="shrink-0 text-sm text-ink-3">全体音量</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={masterVolume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    socket.emit("host:setMasterVolume", v);
                    // 個別設定の無い曲は即座に反映する
                    if (!hasOwnVolume) yt.setVolume(index, v);
                  }}
                  className="h-2 w-full cursor-pointer accent-gold"
                />
                <span className="w-10 shrink-0 text-right tabular-nums text-ink-2">
                  {masterVolume}
                </span>
              </label>
            )}

            {mode === "youtube" && (
              <label className="mb-4 flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 accent-gold"
                  checked={runUp}
                  onChange={(e) => socket.emit("host:setRunUp", e.target.checked)}
                />
                <span className="flex-1 text-ink-2">
                  「正解は…」の溜めから助走を鳴らす
                  <span className="block text-xs text-ink-3">
                    溜めの長さぶんサビの手前から、音量を上げながら再生します。答えが出る
                    瞬間にサビの頭が来ます。切ると溜めは無音になり、答えが出てから
                    サビへ飛びます。
                  </span>
                </span>
              </label>
            )}

            {/*
              早押しの音の確認。鳴らすのは投影画面だが、参加者に押してもらわずに
              音が出るか確かめられるよう、ここから試聴できるようにしておく。
            */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="text-sm text-ink-3">早押しの音</span>
              <button
                onClick={(e) => {
                  e.currentTarget.blur();
                  playBuzz();
                }}
                className="rounded-r1 border border-chip px-3 py-2 text-sm text-ink-2 hover:bg-sink"
              >
                試聴
              </button>
              <span className="text-xs text-ink-3">
                本番は投影画面から鳴ります
              </span>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                <span className="text-sm text-ink-3">「正解は…」の長さ</span>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="10"
                  value={state.suspenseMs / 1000}
                  onChange={(e) =>
                    socket.emit("host:setSuspense", Number(e.target.value) * 1000)
                  }
                  className="w-20 rounded-r1 bg-sink px-3 py-2 text-center text-ink outline-none focus:ring-2 focus:ring-gold"
                />
                <span className="text-sm text-ink-3">秒</span>
              </label>

              {mode === "manual" && (
                <label className="flex items-center gap-2">
                  <span className="text-sm text-ink-3">サビを鳴らすまで</span>
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
                    className="w-20 rounded-r1 bg-sink px-3 py-2 text-center text-ink outline-none focus:ring-2 focus:ring-gold"
                  />
                  <span className="text-sm text-ink-3">秒</span>
                </label>
              )}
            </div>
            <p className="mt-2 text-xs text-chip-ink">
              どちらも「正解」を押した時点からの秒数です。YouTube の読み込みぶん音が遅れるので、
              サビは投影より早めに投げると揃います。
            </p>
          </div>
        </div>
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
  label: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.currentTarget.blur();
        onClick();
      }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-r1 px-3 py-2 text-base font-bold ${accent
          ? "bg-gold text-ground hover:bg-gold-bright"
          : "bg-sink text-ink hover:bg-gold"
        }`}
    >
      {label}
    </button>
  );
}

/**
 * 部屋の案内。参加コード・参加URL・QR と、この管理画面へ戻るためのURL。
 *
 * ログインが無いので、管理URL（主催キー入り）を失うと部屋に戻る手段が無い。
 * そこを画面の上に置いて、コピーできるようにしておく。
 * QR は準備中しか要らないので、既定では畳んでおく。
 */
function RoomBar({ roomCode, hostKey }: { roomCode: string; hostKey: string }) {
  const [joinUrl, setJoinUrl] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    if (!roomCode) return;
    fetch(`/api/url?room=${encodeURIComponent(roomCode)}`)
      .then((r) => r.json())
      .then((d: { url?: string }) => d.url && setJoinUrl(d.url))
      .catch(() => { });
  }, [roomCode]);

  const hostUrl = window.location.origin + hostPath(hostKey);

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // クリップボードが使えない環境（http の実機など）では、選択してもらう
      window.prompt("コピーしてください", text);
    }
  }

  if (!roomCode) return null;

  return (
    <div className="rounded-r2 border border-rule bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <span className="pr-2 text-sm text-ink-3">参加コード</span>
          <span className="text-2xl font-black tracking-[0.2em]">{roomCode}</span>
        </div>
        <button
          onClick={(e) => {
            e.currentTarget.blur();
            void copy("join", joinUrl || window.location.origin);
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-chip px-3.5 py-1 text-sm text-ink-2 hover:bg-sink"
        >
          {copied === "join" ? "コピーしました" : "参加URLをコピー"}
        </button>
        <button
          onClick={(e) => {
            e.currentTarget.blur();
            setShowQr((v) => !v);
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-chip px-3.5 py-1 text-sm text-ink-2 hover:bg-sink"
        >
          {showQr ? "QRを隠す" : "QRを出す"}
        </button>
        <div className="flex-1" />
        <button
          onClick={(e) => {
            e.currentTarget.blur();
            void copy("host", hostUrl);
          }}
          className="rounded-r1 border border-gold px-3 py-1 text-sm text-gold-bright hover:bg-panel"
        >
          {copied === "host" ? "コピーしました" : "管理URLをコピー"}
        </button>
      </div>
      <p className="pt-2 text-xs text-ink-3">
        参加者に配るのは
        <span className="px-1 text-ink-2">{joinUrl || "参加URL"}</span>
        だけ。管理URLは答えが見えるので渡さないこと。
        <strong className="pl-1 text-gold-bright">
          管理URLを控えておかないと、この部屋には戻れません。
        </strong>
      </p>
      {showQr && (
        <img
          src={`/qr.png?room=${encodeURIComponent(roomCode)}`}
          alt="参加用QR"
          className="mt-3 w-48 rounded-r2 bg-ink p-2"
        />
      )}
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: PlayMode;
  onChange: () => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-r1 border border-chip">
      {(["manual", "youtube"] as PlayMode[]).map((m) => (
        <button
          key={m}
          onClick={(e) => {
            e.currentTarget.blur();
            if (m === mode) return;
            // 切り替える前に、今のモードで鳴っているものを黙らせる。
            // 手動タブが鳴ったまま YouTube モードへ移ると二重に鳴る。
            onChange();
            socket.emit("host:setMode", m);
          }}
          className={`px-3 py-1 ${mode === m
              ? "bg-gold font-bold text-ground"
              : "text-ink-3 hover:bg-sink"
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
  tone?: "primary" | "danger" | "play" | "playing" | "confirm" | "ghost";
  className?: string;
}) {
  const tones: Record<string, string> = {
    // 唯一の「進める」操作なので、ここだけ金で塗る
    primary: "bg-gold hover:bg-gold-bright text-ground",
    danger: "bg-miss-deep hover:bg-miss text-miss-ink border border-miss-border",
    play: "bg-sink hover:bg-panel text-ink border border-chip",
    // 鳴っている最中。塗りにすると「正解」と見分けがつかないので枠だけにする
    playing: "border border-gold text-gold hover:bg-panel",
    // 2度押しの1回目。塗りを外して、まだ出ていないことを一目で分かるようにする
    confirm: "border-2 border-gold text-gold hover:bg-panel",
    ghost: "bg-sink hover:bg-panel text-ink-2 border border-chip",
  };
  return (
    <button
      onClick={(e) => {
        e.currentTarget.blur();
        onClick();
      }}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 rounded-r2 px-4 py-4 text-xl font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${tones[tone]} ${className}`}
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
  /** 必ず前の値から作る。非同期の書き戻しで編集を消さないため */
  setDraft: (next: (prev: Song[]) => Song[]) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  // 行ごとの取得状態。"…取得中" と失敗理由を出すために持つ。
  const [meta, setMeta] = useState<Record<number, string>>({});
  // JSON読み込み欄
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");

  const update = (i: number, patch: Partial<Song>) =>
    setDraft((prev) => prev.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  /**
   * 動画IDから曲名とアーティストを取り込む。
   * force=false のときは、空欄だけを埋める（貼り付け直後の自動補完用）。
   * 取れるのは下書きなので、司会が直す前提。
   */
  const fetchMeta = async (i: number, videoId: string, force: boolean) => {
    if (!/^[A-Za-z0-9_-]{5,40}$/.test(videoId)) return;
    setMeta((m) => ({ ...m, [i]: "取得中…" }));
    try {
      const r = await fetch(`/api/oembed?v=${encodeURIComponent(videoId)}`);
      const j = (await r.json()) as {
        ok: boolean;
        title?: string;
        artist?: string;
        channel?: string;
        error?: string;
      };
      if (!j.ok) {
        setMeta((m) => ({ ...m, [i]: j.error ?? "取得できませんでした" }));
        return;
      }
      // ここは応答が返ってきた後なので、必ず最新の draft から作り直す。
      // 呼び出し時点の draft を使うと、貼り付けた動画IDやサビ秒が巻き戻る。
      setDraft((prev) =>
        prev.map((s, k) => {
          if (k !== i) return s;
          return {
            ...s,
            title: force || !s.title ? (j.title ?? s.title) : s.title,
            artist: force || !s.artist ? (j.artist ?? s.artist) : s.artist,
          };
        }),
      );
      setMeta((m) => ({ ...m, [i]: `${j.channel ?? ""} から取り込みました` }));
    } catch {
      setMeta((m) => ({ ...m, [i]: "取得できませんでした" }));
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.length) return;
    setDraft((prev) => {
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const remove = (i: number) =>
    setDraft((prev) => prev.filter((_, k) => k !== i));

  const add = () =>
    setDraft((prev) => [
      ...prev,
      { videoId: "", title: "", artist: "", owner: "", startSec: 0, chorusSec: 0 },
    ]);

  return (
    <div className="flex flex-col gap-3">
      {draft.map((s, i) => (
        <div key={i} className="rounded-r2 border border-chip p-3">
          <div className="flex items-center gap-2 pb-2">
            <span className="text-ink-3">{i + 1}</span>
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
              // 曲名もアーティストも空なら、貼った直後に埋めてしまう。
              // 入力済みの内容は勝手に上書きしない。
              if (!s.title && !s.artist) void fetchMeta(i, videoId, false);
            }}
          />
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                void fetchMeta(i, s.videoId, true);
              }}
              disabled={!s.videoId}
              className="rounded-r1 border border-chip px-3 py-1.5 text-sm text-ink-2 hover:bg-sink disabled:border-rule disabled:text-chip-ink"
            >
              YouTubeから曲名を取得
            </button>
            <span className="text-xs text-ink-3">{meta[i] ?? ""}</span>
          </div>
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
        className="rounded-r2 border border-dashed border-chip py-3 text-ink-2 hover:bg-sink"
      >
        ＋ 曲を追加
      </button>

      <div className="flex gap-2">
        <button
          onClick={(e) => {
            e.currentTarget.blur();
            onApply();
          }}
          className="flex-1 rounded-r2 bg-gold py-3 text-lg font-bold text-ground hover:bg-gold-bright"
        >
          反映する
        </button>
        <button
          onClick={(e) => {
            e.currentTarget.blur();
            onCancel();
          }}
          className="rounded-r2 border border-chip px-5 py-3 text-ink-2 hover:bg-sink"
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
              "JSONをコピーしました。テキストとして保存しておけば、別のPCからでも読み込めます。手元で動かしているなら public/songs.json に貼ると初期値にできます。",
            );
          } catch {
            window.prompt("コピーして保存してください", json);
          }
        }}
        className="rounded-r2 border border-chip py-2 text-sm text-ink-3 hover:bg-sink"
      >
        JSONとして書き出す
      </button>

      {/*
        読み込み。書き出しだけあって読み込みが無いと、別のPCへ曲リストを
        持ち込めない。サーバーは曲を保存しないので、ここが実質の持ち運び手段になる。
      */}
      {importOpen ? (
        <div className="flex flex-col gap-2 rounded-r2 border border-chip p-3">
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='[{"videoId":"...","title":"...","artist":"...","owner":"","startSec":0,"chorusSec":43}]'
            rows={6}
            className="w-full rounded-r1 bg-sink p-2 font-mono text-xs text-ink outline-none focus:ring-2 focus:ring-gold"
          />
          {importError && (
            <div className="text-sm text-miss-ink2">{importError}</div>
          )}
          <div className="flex gap-2">
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                const r = parseSongsJson(importText);
                if (!r.ok) {
                  setImportError(r.error);
                  return;
                }
                setDraft(() => r.songs); // 下書きに入れる。「反映する」で確定
                setImportOpen(false);
                setImportText("");
                setImportError("");
              }}
              className="flex-1 rounded-r1 bg-gold py-2 font-bold text-ground hover:bg-gold-bright"
            >
              読み込む（まだ反映されません）
            </button>
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                setImportOpen(false);
                setImportError("");
              }}
              className="rounded-r1 border border-chip px-4 text-ink-2 hover:bg-sink"
            >
              やめる
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={(e) => {
            e.currentTarget.blur();
            setImportOpen(true);
          }}
          className="rounded-r2 border border-chip py-2 text-sm text-ink-3 hover:bg-sink"
        >
          JSONから読み込む
        </button>
      )}
    </div>
  );
}

/** 曲再生用のタブ。同じ名前を使うことでタブが増え続けないようにする */
const YT_TAB = "introquiz-player";

/** 投影画面の窓。同じ名前を使うので、何度押しても窓は増えない */
const SCREEN_WIN = "introquiz-screen";

/**
 * 曲リストの控え。サーバーはメモリにしか持たないので、再起動すると初期値へ戻る。
 * DBを持たない方針は変えたくないので、代わりに操作した本人のブラウザに残す。
 * 参加者の識別に localStorage を使っているのと同じ考え方。
 */
const SONGS_KEY = "introquiz:songs";

/** 保存された曲リストを読む。壊れていたら黙って捨てる */
function loadSavedSongs(): Song[] | null {
  try {
    const raw = localStorage.getItem(SONGS_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length > 0 ? (arr as Song[]) : null;
  } catch {
    return null;
  }
}

function saveSongs(songs: Song[]): void {
  try {
    localStorage.setItem(SONGS_KEY, JSON.stringify(songs));
  } catch {
    // 容量超過やプライベートモードでは諦める。進行は止めない。
  }
}

/** 中身が同じ曲リストか。復元を勧めるかどうかの判定に使う */
function sameSongs(a: Song[], b: Song[]): boolean {
  const key = (list: Song[]) =>
    JSON.stringify(
      list.map((s) => [
        s.videoId,
        s.title,
        s.artist,
        s.owner,
        s.startSec,
        s.chorusSec ?? null,
        s.volume ?? null,
      ]),
    );
  return key(a) === key(b);
}

/** 貼り付けられた JSON を曲リストにする。失敗したら理由を返す */
export function parseSongsJson(
  text: string,
): { ok: true; songs: Song[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSONとして読めません（括弧やカンマを確認）" };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "配列ではありません（[ ] で囲まれている必要があります）" };
  }
  const songs: Song[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    };
    const title = String(o.title ?? "").trim();
    const videoId = String(o.videoId ?? "").trim();
    if (!title && !videoId) continue; // 空行は捨てる
    songs.push({
      videoId,
      title,
      artist: String(o.artist ?? "").trim(),
      owner: String(o.owner ?? "").trim(),
      startSec: num(o.startSec),
      chorusSec: o.chorusSec === undefined || o.chorusSec === null ? undefined : num(o.chorusSec),
      volume: o.volume === undefined || o.volume === null ? undefined : num(o.volume),
    });
  }
  if (songs.length === 0) {
    return { ok: false, error: "曲が1つも見つかりません" };
  }
  return { ok: true, songs };
}

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
      <span className="text-xs text-ink-3">{label}</span>
      <input
        className="w-full rounded-r1 bg-sink px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-gold"
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
      className={`rounded-r1 border px-3 py-1 text-sm disabled:opacity-30 ${danger
          ? "border-miss-border text-miss-ink2 hover:bg-miss-deep"
          : "border-chip text-ink-2 hover:bg-sink"
        }`}
    >
      {label}
    </button>
  );
}
