import { io } from "socket.io-client";

// 引数で接続先を指定できる: node scripts/buzztest.mjs https://xxx.onrender.com
const URL = process.argv[2] || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// リモート検証では往復が乗るので待ちを伸ばす（判定の取りこぼし防止）
const D = Number(process.env.D) || (URL.startsWith("https") ? 900 : 200);

function mk(name) {
  const s = io(URL, { transports: ["websocket"] });
  s.lastState = null;
  s.on("state", (st) => (s.lastState = st));
  return new Promise((res) => {
    s.on("connect", () => s.emit("join", name, () => res(s)));
  });
}

const fail = [];
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) fail.push(label);
}

const a = await mk("あきら");
const b = await mk("ばんり");
const c = await mk("ちひろ");
const host = io(URL, { transports: ["websocket"] });
await new Promise((r) => host.on("connect", r));
await wait(D);

check("3人 join されている", a.lastState.players.length === 3);
check("名前が12文字で切られる前提の登録", a.lastState.players.some((p) => p.name === "あきら"));

// --- 同時押し: 先に届いた1人だけが通る ---
a.emit("buzz");
b.emit("buzz");
c.emit("buzz");
await wait(D);
const winner = a.lastState.buzzedBy;
check("誰か1人だけが buzzedBy になる", winner !== null);
check("全員が同じ buzzedBy を見ている", b.lastState.buzzedBy?.id === winner.id && c.lastState.buzzedBy?.id === winner.id);

// --- 押されている間は他人が押せない ---
const others = [a, b, c].filter((s) => s.id !== winner.id);
others[0].emit("buzz");
await wait(D);
check("押下中に他人が押しても buzzedBy が変わらない", a.lastState.buzzedBy.id === winner.id);

// --- 誤答: 本人だけロック、受付再開 ---
host.emit("host:wrong");
await wait(D);
check("誤答で受付が再開する (buzzedBy=null)", a.lastState.buzzedBy === null);
check("誤答した本人だけが lockedIds に入る", a.lastState.lockedIds.length === 1 && a.lastState.lockedIds[0] === winner.id);

// --- ロックされた本人は押せない ---
const loser = [a, b, c].find((s) => s.id === winner.id);
loser.emit("buzz");
await wait(D);
check("ロック済みの本人は押せない", a.lastState.buzzedBy === null);

// --- 他人は押せる ---
others[1].emit("buzz");
await wait(D);
check("ロックされていない他人は押せる", a.lastState.buzzedBy?.id === others[1].id);

// --- reset はロックしない ---
host.emit("host:reset");
await wait(D);
check("reset で buzzedBy が消える", a.lastState.buzzedBy === null);
check("reset ではロックが増えない", a.lastState.lockedIds.length === 1);

// --- nextRound で全解除 ---
host.emit("host:nextRound");
await wait(D);
check("nextRound で lockedIds が空になる", a.lastState.lockedIds.length === 0);
loser.emit("buzz");
await wait(D);
check("nextRound 後は元ロック者も押せる", a.lastState.buzzedBy?.id === winner.id);

// --- 切断で片付けられる ---
host.emit("host:nextRound");
await wait(D);
b.close();
await wait(D);
check("切断した参加者が players から消える", a.lastState.players.length === 2);

// --- 未 join は押せない ---
const ghost = io(URL, { transports: ["websocket"] });
await new Promise((r) => ghost.on("connect", r));
ghost.emit("buzz");
await wait(D);
check("未 join のクライアントは押せない", a.lastState.buzzedBy === null);

console.log(fail.length ? `\n${fail.length} 件 FAIL` : "\nすべて PASS");
[a, c, host, ghost].forEach((s) => s.close());
process.exit(fail.length ? 1 : 0);
