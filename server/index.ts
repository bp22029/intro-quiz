import express from "express";
import http from "http";
import path from "path";
import QRCode from "qrcode";
import { Server } from "socket.io";
import type { JoinAck, PlayMode, Player, State } from "../src/types";

// ---------------------------------------------------------------------------
// 状態（すべてプロセスメモリ。永続化しない。単一インスタンス前提）
// ---------------------------------------------------------------------------

const players = new Map<string, Player>(); // socket.id -> Player
const lockedIds = new Set<string>(); // このラウンドで誤答した socket.id
let buzzedBy: Player | null = null;

// 進行状態。管理画面(/host)の操作を投影画面(/screen)へ伝えるためサーバーで持つ
let index = 0;
let revealed = false;
let playing = false;
let mode: PlayMode = "manual";

function snapshot(): State {
  return {
    buzzedBy,
    lockedIds: [...lockedIds],
    players: [...players.values()],
    round: { index, revealed, playing },
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

function broadcastState() {
  io.emit("state", snapshot());
}

io.on("connection", (socket) => {
  // 4.5: まだ join していない相手にも接続直後に必ず1回送る
  socket.emit("state", snapshot());

  socket.on("join", (rawName: unknown, ack?: (r: JoinAck) => void) => {
    const name =
      String(rawName ?? "")
        .trim()
        .slice(0, 12) || "名無し";
    const player: Player = { id: socket.id, name };
    players.set(socket.id, player);
    console.log(`[join] ${name} (${socket.id}) / ${players.size}人`);
    if (typeof ack === "function") ack({ ok: true, id: socket.id, name });
    broadcastState();
  });

  socket.on("buzz", () => {
    // 4.4: 該当したら黙って return する（エラーを返さない）
    if (buzzedBy !== null) return; // 既に誰かが押している
    if (lockedIds.has(socket.id)) return; // このラウンドで誤答済み
    const player = players.get(socket.id);
    if (!player) return; // 未 join

    buzzedBy = player;
    playing = false; // 押されたら再生は止まる
    console.log(`[buzz] ${player.name}`);
    io.emit("buzzed", player);
    broadcastState();
  });

  // --- 司会操作（管理画面 /host から） ---

  socket.on("host:reset", () => {
    // 押下の取り消しのみ。ロックはしない
    buzzedBy = null;
    console.log("[host] reset");
    broadcastState();
  });

  socket.on("host:wrong", () => {
    if (buzzedBy) {
      lockedIds.add(buzzedBy.id);
      console.log(`[host] wrong: ${buzzedBy.name} をロック`);
    }
    buzzedBy = null;
    revealed = false;
    broadcastState();
  });

  socket.on("host:nextRound", () => {
    buzzedBy = null;
    lockedIds.clear();
    revealed = false;
    playing = false;
    console.log("[host] nextRound");
    broadcastState();
  });

  /** 問題を選び直す。ラウンドの状態も全部リセットする */
  socket.on("host:setSong", (rawIndex: unknown) => {
    const n = Number(rawIndex);
    if (!Number.isInteger(n) || n < 0) return;
    index = n;
    revealed = false;
    playing = false;
    buzzedBy = null;
    lockedIds.clear();
    console.log(`[host] setSong ${n}`);
    broadcastState();
  });

  socket.on("host:reveal", () => {
    revealed = true;
    playing = false; // 投影画面側がサビ再生に切り替える
    console.log("[host] reveal");
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
    const player = players.get(socket.id);
    players.delete(socket.id);
    lockedIds.delete(socket.id);
    if (buzzedBy && buzzedBy.id === socket.id) buzzedBy = null;
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
