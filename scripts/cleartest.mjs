// 「参加者を全員クリア」の挙動を検証する。
// 期待: もう居ない人は消え、まだ繋がっている人は自動で戻ってくる。
//   node scripts/cleartest.mjs [url]
import { io } from "socket.io-client";

const URL = process.argv[2] || "http://localhost:3000";
const D = Number(process.env.D) || (URL.startsWith("https") ? 900 : 300);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = [];
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) fail.push(label);
}

/** 参加者クライアント。実機と同じく rejoin に反応して入り直す */
async function player(name, clientId) {
  const s = io(URL, { transports: ["websocket"] });
  s.lastState = null;
  s.on("state", (st) => (s.lastState = st));
  s.on("rejoin", () => s.emit("join", { name, clientId }));
  await new Promise((res) => s.on("connect", res));
  await new Promise((res) => s.emit("join", { name, clientId }, res));
  return s;
}

const host = io(URL, { transports: ["websocket"] });
host.lastState = null;
host.on("state", (st) => (host.lastState = st));
await new Promise((r) => host.on("connect", r));
host.emit("role:host");
host.emit("host:clearPlayers"); // 前回の残りを掃除してから始める
await wait(D);

const stay = await player("居残り", "clear-stay");
const gone1 = await player("テスト", "clear-gone1");
const gone2 = await player("テスト2", "clear-gone2");
await wait(D);
check("3人が参加している", host.lastState.players.length === 3);

// お手つきも付けておく（一緒に消えることの確認用）
gone1.emit("buzz");
await wait(D);
host.emit("host:wrong");
await wait(D);
check("お手つきが記録されている", host.lastState.lockedIds.length === 1);
await wait(3200);

// テスト用の2人はブラウザを閉じた想定にする
gone1.close();
gone2.close();
await wait(D);

// ★ 全員クリア
host.emit("host:clearPlayers");
await wait(D * 3); // rejoin の往復を待つ

const names = host.lastState.players.map((p) => p.name);
check("居なくなった人は消える", !names.includes("テスト") && !names.includes("テスト2"));
check("繋がっている人は戻ってくる", names.includes("居残り"));
check("参加者は1人になる", host.lastState.players.length === 1);
check("お手つきの記録も消える", host.lastState.lockedIds.length === 0);
check("名前のロックも消える", host.lastState.lockedNames.length === 0);
check("押下状態も解除される", host.lastState.buzzedBy === null);

// クリア後も普通に押せる
stay.emit("buzz");
await wait(D);
check("クリア後も早押しできる", host.lastState.buzzedBy?.name === "居残り");

// 後片付け
host.emit("host:nextRound");
await wait(D);
stay.close();
host.emit("host:clearPlayers");
await wait(D);

console.log(fail.length ? `\n${fail.length} 件 FAIL` : "\nすべて PASS");
host.close();
process.exit(fail.length ? 1 : 0);
