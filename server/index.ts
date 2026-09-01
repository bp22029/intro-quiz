import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import QRCode from "qrcode";
import { Server } from "socket.io";
import type { JoinAck, PlayMode, Player, Song, State } from "../src/types";

// ---------------------------------------------------------------------------
// 状態（すべてプロセスメモリ。永続化しない。単一インスタンス前提）
// ---------------------------------------------------------------------------

// 参加者の識別は socket.id ではなく、端末が localStorage に保持する clientId で行う。
// socket.id はページを開き直すたびに変わるため、それを鍵にするとリロードで
// お手つきが解除されてしまう（実際に当日そう使われた）。
const socketToClient = new Map<string, string>(); // socket.id -> clientId
const players = new Map<string, Player>(); // clientId -> Player（Player.id は clientId）
const lockedIds = new Set<string>(); // このラウンドで誤答した clientId
// 名前でもロックする。clientId は localStorage 依存なので、別ブラウザで開き直すと
// 別人になってしまう。完全な防止はログインなしには不可能だが、名前まで変えないと
// 抜けられないようにしておく（名前の変更は投影画面に出るので周囲に気づかれる）。
const lockedNames = new Set<string>();
let buzzedBy: Player | null = null;

/** 同じ clientId で開いている接続がまだ残っているか */
function hasLiveSocket(clientId: string): boolean {
  for (const cid of socketToClient.values()) if (cid === clientId) return true;
  return false;
}

// 進行状態。管理画面(/host)の操作を投影画面(/screen)へ伝えるためサーバーで持つ
let index = 0;
let revealed = false;
let playing = false;
let mode: PlayMode = "manual";

// 曲リスト。管理画面から編集できるようにメモリで保持する。
// DBを持たない方針なので、プロセスが再起動すると songs.json の内容に戻る。
const MAX_SONGS = 50;

function sanitizeSong(raw: unknown): Song | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };
  const title = str(o.title, 60);
  const videoId = str(o.videoId, 40);
  if (!title && !videoId) return null; // 空行は捨てる
  return {
    videoId,
    title: title || "（曲名未設定）",
    artist: str(o.artist, 60),
    owner: str(o.owner, 30),
    startSec: num(o.startSec),
    // 未指定は undefined のままにする。0 にすると「サビ＝曲頭」になり、
    // クライアント側の startSec へのフォールバックが効かなくなる。
    chorusSec:
      o.chorusSec === undefined || o.chorusSec === null || o.chorusSec === ""
        ? undefined
        : num(o.chorusSec),
  };
}

function loadSongsFromDisk(): Song[] {
  // ビルド後は dist/songs.json、開発時は public/songs.json にある
  const candidates = [
    path.join(__dirname, "../dist/songs.json"),
    path.join(__dirname, "../public/songs.json"),
  ];
  for (const file of candidates) {
    try {
      const arr = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(arr)) {
        const songs = arr.map(sanitizeSong).filter((s): s is Song => s !== null);
        console.log(`[songs] ${file} から ${songs.length}曲 読み込み`);
        return songs.slice(0, MAX_SONGS);
      }
    } catch {
      // 次の候補を試す
    }
  }
  console.warn("[songs] songs.json を読み込めませんでした");
  return [];
}

let songs: Song[] = loadSongsFromDisk();

// 投影画面が報告する YouTube プレイヤーの準備状況。
// 未準備のまま再生を要求すると「サーバーは再生中なのに音が出ない」状態になるため、
// 管理画面がこれを見て再生ボタンを止められるようにする。
let ytStatus = { ready: false, readyCount: 0, total: 0 };

// お手つき演出。「不正解」を出してから受付を再開するまでの待ち時間。
const WRONG_COUNTDOWN_MS = 3000;
let wrongName: string | null = null;
let resumeAt = 0; // epoch ms。この時刻までは buzz を受け付けない
let resumeTimer: NodeJS.Timeout | null = null;

/** 演出を打ち切って受付中に戻す */
function clearWrong() {
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
  wrongName = null;
  resumeAt = 0;
}

function snapshot(): State {
  return {
    buzzedBy,
    lockedIds: [...lockedIds],
    lockedNames: [...lockedNames],
    players: [...players.values()],
    songs,
    ytStatus,
    round: {
      index,
      revealed,
      playing,
      wrongName,
      // 絶対時刻ではなく残り時間で送る。端末ごとの時計のズレを持ち込まないため。
      resumeInMs: Math.max(0, resumeAt - Date.now()),
    },
    mode,
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Render 等のリバースプロキシ配下で req.protocol を正しく取るため
app.set("trust proxy", true);

/** 参加者に配る接続先URL。PUBLIC_URL があればそれを優先する */
function publicUrl(req: express.Request): string {
  const fromEnv = process.env.PUBLIC_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return `${req.protocol}://${req.headers.host}`;
}

app.get("/qr.png", async (req, res) => {
  try {
    const buf = await QRCode.toBuffer(publicUrl(req), {
      width: 600,
      margin: 2,
      errorCorrectionLevel: "M",
    });
    res.type("png");
    res.setHeader("Cache-Control", "no-store");
    res.send(buf);
  } catch (e) {
    console.error("[qr] failed", e);
    res.status(500).send("qr error");
  }
});

/** 投影画面が URL テキストを出すために使う */
app.get("/api/url", (req, res) => {
  res.json({ url: publicUrl(req) });
});

const distDir = path.join(__dirname, "../dist");
app.use(express.static(distDir));
app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

// 投影画面(/screen)と管理画面(/host)だけが曲データを受け取る。
// 参加者にも配ると、通信内容を見れば答えが分かってしまう。
const privileged = new Set<string>();

/** 参加者向け。曲名・アーティスト・推した人を落とす */
function redacted(full: State): State {
  return { ...full, songs: [] };
}

function broadcastState() {
  const full = snapshot();
  const hidden = redacted(full);
  for (const [id, sock] of io.sockets.sockets) {
    sock.emit("state", privileged.has(id) ? full : hidden);
  }
}

io.on("connection", (socket) => {
  // 4.5: まだ join していない相手にも接続直後に必ず1回送る
  // 名乗り出るまでは曲データを渡さない
  socket.emit("state", redacted(snapshot()));

  /** 投影画面・管理画面が自分の役割を申告する。曲データはこの2つにだけ配る */
  socket.on("role:screen", () => {
    privileged.add(socket.id);
    socket.emit("state", snapshot());
  });
  socket.on("role:host", () => {
    privileged.add(socket.id);
    socket.emit("state", snapshot());
  });

  /** 投影画面が YouTube プレイヤーの準備状況を知らせる */
  socket.on("screen:yt", (raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const o = raw as { ready?: unknown; readyCount?: unknown; total?: unknown };
    ytStatus = {
      ready: o.ready === true,
      readyCount: Number(o.readyCount) || 0,
      total: Number(o.total) || 0,
    };
    broadcastState();
  });

  socket.on("join", (payload: unknown, ack?: (r: JoinAck) => void) => {
    // 参加者は { name, clientId } を送る。テスト用に文字列だけの形も受ける。
    let rawName: unknown = payload;
    let clientId = "";
    if (payload && typeof payload === "object") {
      rawName = (payload as { name?: unknown }).name;
      const c = (payload as { clientId?: unknown }).clientId;
      if (typeof c === "string" && c.length > 0 && c.length <= 64) clientId = c;
    }
    if (!clientId) clientId = `sock:${socket.id}`; // clientId を送ってこない相手の保険

    const name =
      String(rawName ?? "")
        .trim()
        .slice(0, 12) || "名無し";

    socketToClient.set(socket.id, clientId);
    const player: Player = { id: clientId, name };
    players.set(clientId, player);

    // 押している最中の本人が名前を変えた場合に表示を合わせる
    if (buzzedBy && buzzedBy.id === clientId) buzzedBy = player;

    console.log(`[join] ${name} (${clientId}) / ${players.size}人`);
    if (typeof ack === "function") ack({ ok: true, id: clientId, name });
    broadcastState();
  });

  socket.on("buzz", () => {
    // 4.4: 該当したら黙って return する（エラーを返さない）
    if (buzzedBy !== null) return; // 既に誰かが押している
    if (Date.now() < resumeAt) return; // お手つき演出中は受け付けない
    const clientId = socketToClient.get(socket.id);
    if (!clientId) return; // 未 join
    if (lockedIds.has(clientId)) return; // このラウンドで誤答済み
    const player = players.get(clientId);
    if (!player) return; // 未 join
    if (lockedNames.has(player.name)) return; // 同じ名前で誤答済み

    buzzedBy = player;
    playing = false; // 押されたら再生は止まる
    console.log(`[buzz] ${player.name}`);
    io.emit("buzzed", player);
    broadcastState();
  });

  // --- 司会操作（管理画面 /host から） ---

  socket.on("host:reset", () => {
    // 押下の取り消しのみ。ロックはしない
    clearWrong();
    buzzedBy = null;
    console.log("[host] reset");
    broadcastState();
  });

  socket.on("host:wrong", () => {
    if (!buzzedBy) return; // 誰も押していなければ何もしない
    lockedIds.add(buzzedBy.id);
    lockedNames.add(buzzedBy.name);
    console.log(`[host] wrong: ${buzzedBy.name} をロック`);

    // 「不正解」を出し、3秒のカウントダウン後に受付を再開する
    clearWrong();
    wrongName = buzzedBy.name;
    resumeAt = Date.now() + WRONG_COUNTDOWN_MS;
    resumeTimer = setTimeout(() => {
      wrongName = null;
      resumeAt = 0;
      resumeTimer = null;
      console.log("[host] 受付再開");
      broadcastState();
    }, WRONG_COUNTDOWN_MS);

    buzzedBy = null;
    revealed = false;
    playing = false;
    broadcastState();
  });

  socket.on("host:nextRound", () => {
    clearWrong();
    buzzedBy = null;
    lockedIds.clear();
    lockedNames.clear();
    revealed = false;
    playing = false;
    console.log("[host] nextRound");
    broadcastState();
  });

  /** 問題を選び直す。ラウンドの状態も全部リセットする */
  socket.on("host:setSong", (rawIndex: unknown) => {
    const n = Number(rawIndex);
    if (!Number.isInteger(n) || n < 0) return;
    clearWrong();
    index = n;
    revealed = false;
    playing = false;
    buzzedBy = null;
    lockedIds.clear();
    lockedNames.clear();
    console.log(`[host] setSong ${n}`);
    broadcastState();
  });

  socket.on("host:reveal", () => {
    clearWrong();
    revealed = true;
    playing = false; // 投影画面側がサビ再生に切り替える
    console.log("[host] reveal");
    broadcastState();
  });

  /** 司会が手動でロックを付け外しする。回避されたときの最終手段 */
  socket.on("host:toggleLock", (rawId: unknown) => {
    const cid = String(rawId ?? "");
    const player = players.get(cid);
    if (!player) return;
    if (lockedIds.has(cid)) {
      lockedIds.delete(cid);
      lockedNames.delete(player.name);
      console.log(`[host] unlock ${player.name}`);
    } else {
      lockedIds.add(cid);
      lockedNames.add(player.name);
      console.log(`[host] lock ${player.name}`);
    }
    broadcastState();
  });

  /** 管理画面から曲リストをまるごと差し替える */
  socket.on("host:setSongs", (raw: unknown) => {
    if (!Array.isArray(raw)) return;
    const next = raw
      .slice(0, MAX_SONGS)
      .map(sanitizeSong)
      .filter((s): s is Song => s !== null);
    songs = next;
    // 曲が減って現在位置がはみ出した場合に備えて丸める
    if (index >= songs.length) index = Math.max(0, songs.length - 1);
    console.log(`[host] setSongs ${songs.length}曲`);
    broadcastState();
  });

  socket.on("host:play", () => {
    playing = true;
    broadcastState();
  });

  socket.on("host:pause", () => {
    playing = false;
    broadcastState();
  });

  socket.on("host:setMode", (rawMode: unknown) => {
    if (rawMode !== "youtube" && rawMode !== "manual") return;
    mode = rawMode;
    playing = false;
    console.log(`[host] mode=${mode}`);
    broadcastState();
  });

  socket.on("disconnect", () => {
    const clientId = socketToClient.get(socket.id);
    privileged.delete(socket.id);
    socketToClient.delete(socket.id);
    if (!clientId) return;

    // 同じ端末が別タブ等でまだ繋がっているなら、参加者としては残す
    if (hasLiveSocket(clientId)) return;

    const player = players.get(clientId);
    players.delete(clientId);
    // lockedIds はあえて消さない。消すとリロードでお手つきが解除できてしまう。
    if (buzzedBy && buzzedBy.id === clientId) buzzedBy = null;
    if (player) console.log(`[left] ${player.name} / ${players.size}人`);
    broadcastState();
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`introquiz server listening on :${PORT}`);
  console.log(
    `PUBLIC_URL=${process.env.PUBLIC_URL ?? "(未設定: hostヘッダから組み立て)"}`,
  );
});
