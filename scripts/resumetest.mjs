// お手つき後に曲が再開するかを検証する。
// 「3 → 2 → 1 → GO!」は曲もここから再開するという約束なので、
// 司会が毎回「▶ イントロ再生」を押し直さなくてよいことを確かめる。
//   node scripts/resumetest.mjs [url]
import { io } from "socket.io-client";

const URL = process.argv[2] || "http://localhost:3000";
const D = Number(process.env.D) || (URL.startsWith("https") ? 900 : 300);
const WRONG_COUNTDOWN_MS = 3000; // server/index.ts と同じ値
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let ng = 0;
function check(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) ng++;
}

function connect() {
  return io(URL, { transports: ["websocket"] });
}

/** 最新の state を持ち続けるクライアントを作る */
function watcher(sock) {
  const box = { state: null };
  sock.on("state", (s) => (box.state = s));
  return box;
}

const host = connect();
const hostState = watcher(host);
host.emit("role:host");

const player = connect();
const playerState = watcher(player);
player.emit("join", { name: "そら", clientId: "resume-test-1" });

await wait(D);
check("管理画面に曲データが配られる", Array.isArray(hostState.state?.songs));
check(
  "参加者には曲データが配られない",
  Array.isArray(playerState.state?.songs) &&
    playerState.state.songs.length === 0,
);

host.emit("host:setMode", "youtube");
host.emit("host:setSong", 0);
await wait(D);
check("YouTubeモードになる", hostState.state?.mode === "youtube");

// --- 鳴っている最中のお手つき → カウントダウン後に再開する ---
host.emit("host:play");
await wait(D);
check("再生中になる", hostState.state?.round?.playing === true);

player.emit("buzz");
await wait(D);
check("早押しで再生が止まる", hostState.state?.round?.playing === false);
check("押した人が記録される", hostState.state?.buzzedBy?.name === "そら");

host.emit("host:wrong");
await wait(D);
check("お手つき演出中は再生しない", hostState.state?.round?.playing === false);
check("不正解が出ている", hostState.state?.round?.wrongName === "そら");

await wait(WRONG_COUNTDOWN_MS + D * 2);
check("カウントダウン後に曲が再開する", hostState.state?.round?.playing === true);
check("不正解表示は消えている", hostState.state?.round?.wrongName === null);

// --- 鳴っていなかったなら、勝手に鳴り出さない ---
host.emit("host:setSong", 0); // 状態を戻す（playing=false になる）
await wait(D);
check("問題を選び直すと停止する", hostState.state?.round?.playing === false);

player.emit("buzz");
await wait(D);
host.emit("host:wrong");
await wait(WRONG_COUNTDOWN_MS + D * 2);
check("止まっていた曲は再開しない", hostState.state?.round?.playing === false);

// --- 演出を途中で打ち切ったら、再開もしない ---
host.emit("host:setSong", 0);
await wait(D);
host.emit("host:play");
await wait(D);
player.emit("buzz");
await wait(D);
host.emit("host:wrong");
await wait(D);
host.emit("host:nextRound"); // 「この問題をやり直す」で演出を打ち切る
await wait(WRONG_COUNTDOWN_MS + D * 2);
check(
  "演出を打ち切ったら再開しない",
  hostState.state?.round?.playing === false,
);
check("打ち切りで不正解表示も消える", hostState.state?.round?.wrongName === null);

host.emit("host:setMode", "manual");
host.emit("host:setSong", 0);
await wait(D);

host.close();
player.close();

console.log(ng === 0 ? "\nすべて PASS" : `\n${ng}件 FAIL`);
process.exit(ng === 0 ? 0 : 1);
