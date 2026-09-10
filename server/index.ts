import crypto from "crypto";
import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import QRCode from "qrcode";
import { Server, type Socket } from "socket.io";
import type {
  JoinAck,
  PlayMode,
  Player,
  Song,
  State,
} from "../src/types";
import { parseYouTubeMeta } from "../src/ytmeta";

// ---------------------------------------------------------------------------
// 状態（すべてプロセスメモリ。永続化しない。単一インスタンス前提）
//
// 主催者ごとに別々のクイズを同時に開けるよう、状態は「部屋(Room)」単位で持つ。
// 早押しの排他制御が単一プロセス前提なので、部屋を増やしてもプロセスは増やさない。
// ---------------------------------------------------------------------------

/**
 * ひとつの部屋。かつてモジュールスコープの変数群だったものが、そのまま入っている。
 * ここに無い進行状態を新しくモジュールスコープへ足さないこと（部屋をまたいで漏れる）。
 */
type Room = {
  /** 参加者に配るコード。QR とURLに載り、口頭でも読み上げられる */
  code: string;
  /** 主催者だけが持つ鍵。投影画面(/screen)と管理画面(/host)を開くのに使う */
  hostKey: string;
  createdAt: number;
  /** 最後に何か起きた時刻。誰も居ない部屋をいつ捨てるかの判断に使う */
  lastActiveAt: number;

  /** この部屋に繋がっているソケット。同報と「空か」の判定に使う */
  sockets: Set<Socket>;

  // 参加者の識別は socket.id ではなく、端末が localStorage に保持する clientId で行う。
  // socket.id はページを開き直すたびに変わるため、それを鍵にするとリロードで
  // お手つきが解除されてしまう（実際に当日そう使われた）。
  socketToClient: Map<string, string>; // socket.id -> clientId
  players: Map<string, Player>; // clientId -> Player（Player.id は clientId）
  lockedIds: Set<string>; // このラウンドで誤答した clientId
  // 名前でもロックする。clientId は localStorage 依存なので、別ブラウザで開き直すと
  // 別人になってしまう。完全な防止はログインなしには不可能だが、名前まで変えないと
  // 抜けられないようにしておく（名前の変更は投影画面に出るので周囲に気づかれる）。
  lockedNames: Set<string>;
  buzzedBy: Player | null;
  // 早押しで止める直前に鳴っていたか。お手つきの3秒カウントダウン後、
  // 曲を止めた場所から鳴らし直すために覚えておく。
  playingBeforeBuzz: boolean;

  // 進行状態。管理画面(/host)の操作を投影画面(/screen)へ伝えるためサーバーで持つ
  index: number;
  revealed: boolean;
  playing: boolean;
  // 既定は YouTube モード。プレイヤーが管理画面に来て、早押しでの自動停止・
  // サビへのジャンプ・お手つき後の再開まで効くようになったので、通常運転はこちら。
  // 手動モードは、埋め込みでは鳴らせないもの（年齢制限つき動画、埋め込み禁止、
  // YouTube 側の仕様変更）に備えた逃げ道として残す。
  mode: PlayMode;
  // 溜めのあいだに助走を鳴らすか。演出なので当日その場で切り替えられるようにする。
  runUp: boolean;
  // 全体音量。曲ごとの volume が未設定ならこの値で鳴る。
  // 100 はプレイヤーの最大値で会場では大きすぎることが多いので、控えめから始める。
  masterVolume: number;

  // 曲リスト。管理画面から編集できるようにメモリで保持する。
  // DBを持たない方針なので、部屋が消えると初期リストに戻る。
  songs: Song[];

  // お手つき演出。「不正解」を出してから受付を再開するまでの待ち時間。
  wrongName: string | null;
  resumeAt: number; // epoch ms。この時刻までは buzz を受け付けない
  resumeTimer: NodeJS.Timeout | null;

  // 正解発表の溜め。「正解は…」を出してから答えを見せるまでの間。
  // 当日その場で調整できるよう、管理画面から変更できる。
  suspenseMs: number;
  revealAt: number; // epoch ms。この時刻に revealed が true になる
  revealTimer: NodeJS.Timeout | null;
};

const rooms = new Map<string, Room>(); // code -> Room
const roomsByHostKey = new Map<string, Room>(); // hostKey -> Room

/** 「不正解」を出してから受付を再開するまでの待ち時間 */
const WRONG_COUNTDOWN_MS = 3000;

const MAX_SONGS = 50;
/** 同時に持てる部屋の数。メモリを無制限に食わせないための上限 */
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 100;
/** 誰も居なくなった部屋を捨てるまでの時間。既定2時間 */
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS) || 2 * 60 * 60 * 1000;
/** 掃除の間隔。短くできるのは検証用（scripts/sweeptest.mjs） */
const SWEEP_INTERVAL_MS = Number(process.env.SWEEP_INTERVAL_MS) || 60 * 1000;

// ---------------------------------------------------------------------------
// 曲リストの初期値
// ---------------------------------------------------------------------------

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
    // 未指定は undefined のまま（クライアント側で 100 として扱う）
    volume:
      o.volume === undefined || o.volume === null || o.volume === ""
        ? undefined
        : Math.max(0, Math.min(100, num(o.volume))),
  };
}

function loadSongsFromDisk(): Song[] {
  // ビルド後は dist/songs.json、開発時は public/songs.json にある。
  // songs.json は実名を含むためコミットしない運用なので、
  // 未作成のクローンでも起動できるよう songs.sample.json へフォールバックする。
  const candidates = [
    path.join(__dirname, "../dist/songs.json"),
    path.join(__dirname, "../public/songs.json"),
    path.join(__dirname, "../dist/songs.sample.json"),
    path.join(__dirname, "../public/songs.sample.json"),
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

/**
 * 新しい部屋に配る曲リストのひな形。起動時に1度だけ読む。
 * 部屋を作るたびに読み直さないのは、途中でファイルが差し替わって
 * 部屋ごとに中身が違う、という分かりにくい状態を作らないため。
 */
const songTemplate: Song[] = loadSongsFromDisk();

// ---------------------------------------------------------------------------
// 部屋の生成・破棄
// ---------------------------------------------------------------------------

// 紛らわしい文字（I O 0 1）を外す。読み上げと手入力を通すため。
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 4;

/** 参加コードの正規化。手入力の揺れ（小文字・空白・ハイフン）を吸収する */
function normalizeCode(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

function newRoomCode(): string | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return null; // 部屋が埋まりすぎているとき
}

function newHostKey(): string {
  return crypto.randomBytes(12).toString("base64url"); // 16文字
}

function createRoom(): Room | null {
  const code = newRoomCode();
  if (!code) return null;
  const now = Date.now();
  const room: Room = {
    code,
    hostKey: newHostKey(),
    createdAt: now,
    lastActiveAt: now,
    sockets: new Set(),
    socketToClient: new Map(),
    players: new Map(),
    lockedIds: new Set(),
    lockedNames: new Set(),
    buzzedBy: null,
    playingBeforeBuzz: false,
    index: 0,
    revealed: false,
    playing: false,
    mode: "youtube",
    runUp: true,
    masterVolume: 70,
    // ひな形は共有しない。部屋ごとに独立して編集できるよう複製する。
    songs: songTemplate.map((s) => ({ ...s })),
    wrongName: null,
    resumeAt: 0,
    resumeTimer: null,
    suspenseMs: 2000,
    revealAt: 0,
    revealTimer: null,
  };
  rooms.set(room.code, room);
  roomsByHostKey.set(room.hostKey, room);
  console.log(`[room] 作成 ${room.code} / 全${rooms.size}部屋`);
  return room;
}

/** 部屋を捨てる。予約中のタイマーを必ず解除する（消したはずの部屋が動き出すため） */
function destroyRoom(room: Room) {
  if (room.resumeTimer) clearTimeout(room.resumeTimer);
  if (room.revealTimer) clearTimeout(room.revealTimer);
  room.resumeTimer = null;
  room.revealTimer = null;
  rooms.delete(room.code);
  roomsByHostKey.delete(room.hostKey);
  console.log(`[room] 破棄 ${room.code} / 残り${rooms.size}部屋`);
}

/** 誰も居なくなって時間が経った部屋を掃除する。戻り値は捨てた数 */
function sweepRooms(): number {
  const now = Date.now();
  let removed = 0;
  for (const room of [...rooms.values()]) {
    if (room.sockets.size > 0) continue;
    if (now - room.lastActiveAt < ROOM_TTL_MS) continue;
    destroyRoom(room);
    removed++;
  }
  return removed;
}

/** 何か起きたことを記録する。掃除の基準になる */
function touch(room: Room) {
  room.lastActiveAt = Date.now();
}

/** 溜めを打ち切る */
function clearReveal(room: Room) {
  if (room.revealTimer) {
    clearTimeout(room.revealTimer);
    room.revealTimer = null;
  }
  room.revealAt = 0;
}

/** 演出を打ち切って受付中に戻す */
function clearWrong(room: Room) {
  if (room.resumeTimer) {
    clearTimeout(room.resumeTimer);
    room.resumeTimer = null;
  }
  room.wrongName = null;
  room.resumeAt = 0;
}

/** 同じ clientId で開いている接続がまだ残っているか */
function hasLiveSocket(room: Room, clientId: string): boolean {
  for (const cid of room.socketToClient.values()) {
    if (cid === clientId) return true;
  }
  return false;
}

function snapshot(room: Room): State {
  return {
    roomCode: room.code,
    buzzedBy: room.buzzedBy,
    lockedIds: [...room.lockedIds],
    lockedNames: [...room.lockedNames],
    players: [...room.players.values()],
    songs: room.songs,
    suspenseMs: room.suspenseMs,
    runUp: room.runUp,
    masterVolume: room.masterVolume,
    round: {
      index: room.index,
      revealed: room.revealed,
      playing: room.playing,
      wrongName: room.wrongName,
      // 絶対時刻ではなく残り時間で送る。端末ごとの時計のズレを持ち込まないため。
      resumeInMs: Math.max(0, room.resumeAt - Date.now()),
      revealInMs: Math.max(0, room.revealAt - Date.now()),
    },
    mode: room.mode,
  };
}

/** 参加者向け。曲名・アーティスト・推した人を落とす */
function redacted(full: State): State {
  return { ...full, songs: [] };
}

/** そのソケットに見せてよい形の state */
function stateFor(socket: Socket, room: Room): State {
  const full = snapshot(room);
  return socket.data.privileged ? full : redacted(full);
}

/**
 * 部屋の中だけに state を配る。
 * 曲データは投影画面(/screen)と管理画面(/host)にだけ渡す。
 * 参加者にも配ると、通信内容を見れば答えが分かってしまう。
 */
function broadcastState(room: Room) {
  const full = snapshot(room);
  const hidden = redacted(full);
  for (const sock of room.sockets) {
    sock.emit("state", sock.data.privileged ? full : hidden);
  }
}

/** 部屋の中だけにイベントを配る */
function emitToRoom(room: Room, event: string, ...args: unknown[]) {
  for (const sock of room.sockets) sock.emit(event, ...args);
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

/** 参加者が開くURL。QR にもこれを載せる */
function joinUrl(req: express.Request, code: string): string {
  return `${publicUrl(req)}/join/${code}`;
}

/**
 * 部屋を作る。認証は無いので、返した hostKey が主催者の唯一の資格になる。
 * これを失うと部屋には戻れない（作り直してもらう）。
 */
app.post("/api/rooms", (req, res) => {
  if (rooms.size >= MAX_ROOMS) sweepRooms();
  if (rooms.size >= MAX_ROOMS) {
    res
      .status(503)
      .json({ ok: false, error: "部屋が多すぎます。しばらく待ってください" });
    return;
  }
  const room = createRoom();
  if (!room) {
    res.status(503).json({ ok: false, error: "部屋を作れませんでした" });
    return;
  }
  res.json({
    ok: true,
    code: room.code,
    hostKey: room.hostKey,
    joinUrl: joinUrl(req, room.code),
  });
});

app.get("/qr.png", async (req, res) => {
  // 部屋の指定が無いときはトップ（ロビー）を出す。部屋があれば参加URLを出す。
  const code = normalizeCode(req.query.room);
  if (code && !rooms.has(code)) {
    res.status(404).send("room not found");
    return;
  }
  const target = code ? joinUrl(req, code) : publicUrl(req);
  try {
    const buf = await QRCode.toBuffer(target, {
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
  const code = normalizeCode(req.query.room);
  if (code && !rooms.has(code)) {
    res.status(404).json({ error: "room not found" });
    return;
  }
  res.json({ url: code ? joinUrl(req, code) : publicUrl(req) });
});

/**
 * YouTube の oEmbed を中継して、曲名とアーティスト名の下書きを返す。
 * ブラウザから直接叩かずサーバーを通すのは、CORS の可否に依存させないため。
 * 401 は「埋め込み禁止」の意味なので、そのまま編集画面へ伝える。
 */
app.get("/api/oembed", async (req, res) => {
  const id = String(req.query.v ?? "").trim();
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(id)) {
    res.status(400).json({ ok: false, error: "動画IDが不正です" });
    return;
  }

  const target =
    "https://www.youtube.com/oembed?url=" +
    encodeURIComponent("https://www.youtube.com/watch?v=" + id) +
    "&format=json";

  try {
    const r = await fetch(target);
    if (r.status === 401) {
      res.json({ ok: false, error: "この動画は埋め込みが禁止されています" });
      return;
    }
    if (r.status === 404) {
      res.json({ ok: false, error: "動画が見つかりません（IDの誤り・非公開）" });
      return;
    }
    if (!r.ok) {
      res.json({ ok: false, error: `取得に失敗しました（${r.status}）` });
      return;
    }
    const j = (await r.json()) as { title?: unknown; author_name?: unknown };
    const meta = parseYouTubeMeta(
      String(j.title ?? ""),
      String(j.author_name ?? ""),
    );
    res.json({
      ok: true,
      title: meta.title,
      artist: meta.artist,
      channel: String(j.author_name ?? ""),
    });
  } catch {
    res.json({ ok: false, error: "YouTube へ接続できませんでした" });
  }
});

const distDir = path.join(__dirname, "../dist");
app.use(express.static(distDir));
app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

io.on("connection", (socket) => {
  // どの部屋の誰として繋ぐかは、ハンドシェイクで1度だけ決める。
  // 参加者は部屋コード、主催者は hostKey。あとから名乗り直すことはできない。
  //
  // かつては接続後に "role:host" と名乗るだけで曲データが届いていた。
  // 部屋のURLを配って使う形になった以上、それでは参加コードを知っている人が
  // 同じ名乗りをするだけで答えを覗ける。権限はここで閉じる。
  const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
  const hostKey = typeof auth.hostKey === "string" ? auth.hostKey : "";
  const wantCode = normalizeCode(auth.room);

  let found: Room | null = null;
  let privileged = false;

  if (hostKey) {
    found = roomsByHostKey.get(hostKey) ?? null;
    privileged = found !== null; // 曲データを受け取れるのは主催キーを持つ側だけ
  } else if (wantCode) {
    found = rooms.get(wantCode) ?? null;
  }

  if (!found) {
    // 接続自体は受理して、部屋が無いことだけを伝える。
    // ハンドシェイクを拒否すると socket.io-client が再接続を繰り返してしまう。
    socket.data.room = null;
    socket.emit("room:missing");
    return;
  }

  /** このソケットの部屋。以下のハンドラはすべてこの部屋だけを触る */
  const R = found;
  socket.data.room = R;
  socket.data.privileged = privileged;
  R.sockets.add(socket);
  touch(R);

  // 4.5: まだ join していない相手にも接続直後に必ず1回送る
  // 名乗り出るまでは曲データを渡さない
  socket.emit("state", stateFor(socket, R));

  /**
   * 古いクライアントが送ってくる役割の申告。state を送り直すだけで、
   * 権限は一切与えない。権限はハンドシェイクの hostKey だけで決まる。
   */
  const resend = () => socket.emit("state", stateFor(socket, R));
  socket.on("role:screen", resend);
  socket.on("role:host", resend);

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

    R.socketToClient.set(socket.id, clientId);
    const player: Player = { id: clientId, name };
    R.players.set(clientId, player);

    // 押している最中の本人が名前を変えた場合に表示を合わせる
    if (R.buzzedBy && R.buzzedBy.id === clientId) R.buzzedBy = player;

    touch(R);
    console.log(`[join:${R.code}] ${name} (${clientId}) / ${R.players.size}人`);
    if (typeof ack === "function") ack({ ok: true, id: clientId, name });
    broadcastState(R);
  });

  socket.on("buzz", () => {
    // 4.4: 該当したら黙って return する（エラーを返さない）
    if (R.buzzedBy !== null) return; // 既に誰かが押している
    if (Date.now() < R.resumeAt) return; // お手つき演出中は受け付けない
    const clientId = R.socketToClient.get(socket.id);
    if (!clientId) return; // 未 join
    if (R.lockedIds.has(clientId)) return; // このラウンドで誤答済み
    const player = R.players.get(clientId);
    if (!player) return; // 未 join
    if (R.lockedNames.has(player.name)) return; // 同じ名前で誤答済み

    R.buzzedBy = player;
    R.playingBeforeBuzz = R.playing; // 受付再開時に戻せるよう、止める前の状態を控える
    R.playing = false; // 押されたら再生は止まる
    touch(R);
    console.log(`[buzz:${R.code}] ${player.name}`);
    emitToRoom(R, "buzzed", player);
    broadcastState(R);
  });

  // --- 司会操作（管理画面 /host から） ---

  socket.on("host:reset", () => {
    // 押下の取り消しのみ。ロックはしない。
    // 「押し間違いだった」という操作なので、押される直前の状態へ戻す。
    // 曲が鳴っていたなら鳴らし直す（お手つきの GO! と同じ考え方）。
    clearWrong(R);
    R.buzzedBy = null;
    if (R.playingBeforeBuzz) R.playing = true;
    R.playingBeforeBuzz = false;
    touch(R);
    console.log(`[host:${R.code}] reset${R.playing ? "・再生再開" : ""}`);
    broadcastState(R);
  });

  socket.on("host:wrong", () => {
    if (!R.buzzedBy) return; // 誰も押していなければ何もしない
    clearReveal(R);
    R.lockedIds.add(R.buzzedBy.id);
    R.lockedNames.add(R.buzzedBy.name);
    console.log(`[host:${R.code}] wrong: ${R.buzzedBy.name} をロック`);

    // 「不正解」を出し、3秒のカウントダウン後に受付を再開する
    clearWrong(R);
    R.wrongName = R.buzzedBy.name;
    R.resumeAt = Date.now() + WRONG_COUNTDOWN_MS;
    R.resumeTimer = setTimeout(() => {
      R.wrongName = null;
      R.resumeAt = 0;
      R.resumeTimer = null;
      // 「3 → 2 → 1 → GO!」は曲もここから再開するという約束なので、
      // 押される直前に鳴っていたなら鳴らし直す。止めた位置から続く。
      if (R.playingBeforeBuzz) R.playing = true;
      R.playingBeforeBuzz = false;
      console.log(`[host:${R.code}] 受付再開${R.playing ? "・再生再開" : ""}`);
      broadcastState(R);
    }, WRONG_COUNTDOWN_MS);

    R.buzzedBy = null;
    R.revealed = false;
    R.playing = false;
    touch(R);
    broadcastState(R);
  });

  socket.on("host:restartRound", () => {
    clearWrong(R);
    clearReveal(R);
    R.buzzedBy = null;
    R.lockedIds.clear();
    R.lockedNames.clear();
    R.revealed = false;
    R.playing = false;
    R.playingBeforeBuzz = false;
    touch(R);
    console.log(`[host:${R.code}] nextRound`);
    broadcastState(R);
  });

  /** 問題を選び直す。ラウンドの状態も全部リセットする */
  socket.on("host:setSong", (rawIndex: unknown) => {
    const n = Number(rawIndex);
    if (!Number.isInteger(n) || n < 0) return;
    clearWrong(R);
    clearReveal(R);
    R.index = n;
    R.revealed = false;
    R.playing = false;
    R.playingBeforeBuzz = false;
    R.buzzedBy = null;
    R.lockedIds.clear();
    R.lockedNames.clear();
    touch(R);
    console.log(`[host:${R.code}] setSong ${n}`);
    broadcastState(R);
  });

  socket.on("host:reveal", () => {
    clearWrong(R);
    clearReveal(R);
    R.revealed = false;
    // YouTubeモードで助走が有効なら、溜めのあいだから鳴らす。
    // 答えが出る瞬間にサビの頭が来るので、そこが山になる。
    // 無効なら溜めは無音のまま、答えが出てからサビへ飛ぶ。
    // 手動モードは別タブ側の都合があるので常に止めたまま。
    R.playing = R.mode === "youtube" && R.runUp;
    touch(R);
    // まず「正解は…」を出し、溜めてから答えを見せる
    if (R.suspenseMs <= 0) {
      // 溜めなし。すぐ答えを出す
      R.revealed = true;
      if (R.mode === "youtube") R.playing = true;
      console.log(`[host:${R.code}] reveal（溜めなし）`);
      broadcastState(R);
      return;
    }
    R.revealAt = Date.now() + R.suspenseMs;
    R.revealTimer = setTimeout(() => {
      R.revealed = true;
      R.revealAt = 0;
      R.revealTimer = null;
      // YouTubeモードではここからサビが鳴り出す。実際に鳴っているのに
      // playing=false のままだと、管理画面のボタン表示が実態とずれる。
      if (R.mode === "youtube") R.playing = true;
      console.log(`[host:${R.code}] reveal（答え表示）`);
      broadcastState(R);
    }, R.suspenseMs);
    console.log(`[host:${R.code}] reveal（溜め開始）`);
    broadcastState(R);
  });

  /** 司会が手動でロックを付け外しする。回避されたときの最終手段 */
  socket.on("host:toggleLock", (rawId: unknown) => {
    const cid = String(rawId ?? "");
    const player = R.players.get(cid);
    if (!player) return;
    if (R.lockedIds.has(cid)) {
      R.lockedIds.delete(cid);
      R.lockedNames.delete(player.name);
      console.log(`[host:${R.code}] unlock ${player.name}`);
    } else {
      R.lockedIds.add(cid);
      R.lockedNames.add(player.name);
      console.log(`[host:${R.code}] lock ${player.name}`);
    }
    touch(R);
    broadcastState(R);
  });

  /** 管理画面から曲リストをまるごと差し替える */
  socket.on("host:setSongs", (raw: unknown) => {
    if (!Array.isArray(raw)) return;
    const next = raw
      .slice(0, MAX_SONGS)
      .map(sanitizeSong)
      .filter((s): s is Song => s !== null);
    R.songs = next;
    // 曲が減って現在位置がはみ出した場合に備えて丸める
    if (R.index >= R.songs.length) R.index = Math.max(0, R.songs.length - 1);
    touch(R);
    console.log(`[host:${R.code}] setSongs ${R.songs.length}曲`);
    broadcastState(R);
  });

  /**
   * 参加者を全消しする。テストで入った人が残っているときの掃除用。
   * 実際にまだ繋がっている人は rejoin で戻ってくるので、
   * 「もう居ない人だけが消える」結果になる。
   */
  socket.on("host:clearPlayers", () => {
    const before = R.players.size;
    clearReveal(R);
    R.players.clear();
    R.socketToClient.clear();
    R.lockedIds.clear();
    R.lockedNames.clear();
    R.buzzedBy = null;
    clearWrong(R);
    touch(R);
    console.log(`[host:${R.code}] clearPlayers: ${before}人を消去`);
    broadcastState(R);
    emitToRoom(R, "rejoin"); // 生きている参加者には入り直してもらう
  });

  /** 「正解は…」の溜め中にサビへの助走を鳴らすか */
  socket.on("host:setRunUp", (raw: unknown) => {
    R.runUp = raw === true;
    touch(R);
    console.log(`[host:${R.code}] runUp=${R.runUp}`);
    broadcastState(R);
  });

  socket.on("host:setMasterVolume", (raw: unknown) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    R.masterVolume = Math.max(0, Math.min(100, Math.round(n)));
    touch(R);
    console.log(`[host:${R.code}] masterVolume=${R.masterVolume}`);
    broadcastState(R);
  });

  /** 「正解は…」の長さを変える。当日の進行に合わせて調整できるように */
  socket.on("host:setSuspense", (raw: unknown) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    R.suspenseMs = Math.max(0, Math.min(10000, Math.round(n)));
    touch(R);
    console.log(`[host:${R.code}] suspense=${R.suspenseMs}ms`);
    broadcastState(R);
  });

  socket.on("host:play", () => {
    R.playing = true;
    touch(R);
    broadcastState(R);
  });

  socket.on("host:pause", () => {
    R.playing = false;
    touch(R);
    broadcastState(R);
  });

  socket.on("host:setMode", (rawMode: unknown) => {
    if (rawMode !== "youtube" && rawMode !== "manual") return;
    R.mode = rawMode;
    R.playing = false;
    touch(R);
    console.log(`[host:${R.code}] mode=${R.mode}`);
    broadcastState(R);
  });

  socket.on("disconnect", () => {
    R.sockets.delete(socket);
    const clientId = R.socketToClient.get(socket.id);
    R.socketToClient.delete(socket.id);
    touch(R);

    if (!clientId) return;

    // 同じ端末が別タブ等でまだ繋がっているなら、参加者としては残す
    if (hasLiveSocket(R, clientId)) return;

    const player = R.players.get(clientId);
    R.players.delete(clientId);
    // lockedIds はあえて消さない。消すとリロードでお手つきが解除できてしまう。
    if (R.buzzedBy && R.buzzedBy.id === clientId) R.buzzedBy = null;
    if (player) console.log(`[left:${R.code}] ${player.name} / ${R.players.size}人`);
    broadcastState(R);
  });
});

setInterval(() => {
  const removed = sweepRooms();
  if (removed > 0) console.log(`[room] 掃除: ${removed}部屋を破棄`);
}, SWEEP_INTERVAL_MS);

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`introquiz server listening on :${PORT}`);
  console.log(
    `PUBLIC_URL=${process.env.PUBLIC_URL ?? "(未設定: hostヘッダから組み立て)"}`,
  );
});
