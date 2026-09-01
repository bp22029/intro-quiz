// 管理画面(/host)の操作が投影画面(/screen)へ正しく伝わるかを検証する。
// 画面を分けたことで、進行状態がサーバー共有になっているのが前提。
//   node scripts/hosttest.mjs [url]
import { io } from "socket.io-client";

const URL = process.argv[2] || "http://localhost:3000";
const D = Number(process.env.D) || (URL.startsWith("https") ? 900 : 200);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = [];
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) fail.push(label);
}

function mkClient(name) {
  const s = io(URL, { transports: ["websocket"] });
  s.lastState = null;
  s.buzzCount = 0;
  s.on("state", (st) => (s.lastState = st));
  s.on("buzzed", () => s.buzzCount++);
  return new Promise((res) => s.on("connect", () => res(s)));
}

async function mkPlayer(name) {
  const s = await mkClient(name);
  await new Promise((res) => s.emit("join", name, res));
  return s;
}

// 投影画面 / 管理画面 / 参加者2人
const screen = await mkClient("screen");
const host = await mkClient("host");
const a = await mkPlayer("あきら");
const b = await mkPlayer("ばんり");
await wait(D);

check("投影画面に round が届いている", !!screen.lastState?.round);
check("初期は第1問 (index=0)", screen.lastState.round.index === 0);
check("既定モードは手動", screen.lastState.mode === "manual");

// --- 曲送りが投影画面に伝わる ---
host.emit("host:setSong", 2);
await wait(D);
check("管理画面の曲送りが投影画面に伝わる", screen.lastState.round.index === 2);
check("曲送りで答え表示が消える", screen.lastState.round.revealed === false);

// --- 答え表示が伝わる ---
host.emit("host:reveal");
await wait(D);
check("答え表示が投影画面に伝わる", screen.lastState.round.revealed === true);
check("参加者にも同じ state が届く", a.lastState.round.revealed === true);

// --- 早押しは答え表示中でも受理される（司会が誤操作した場合の復帰用）---
a.emit("buzz");
await wait(D);
check("押下が投影画面に伝わる", screen.lastState.buzzedBy?.name === "あきら");
check("投影画面が buzzed を受信（ビープ用）", screen.buzzCount === 1);
check("管理画面も buzzed を受信（手元のビープ用）", host.buzzCount === 1);

// --- お手つき ---
host.emit("host:wrong");
await wait(D);
check("お手つきで受付が再開する", screen.lastState.buzzedBy === null);
check("お手つきで答え表示が消える", screen.lastState.round.revealed === false);
check("押した本人だけロックされる", screen.lastState.lockedIds.length === 1);

b.emit("buzz");
await wait(D);
check("ロックされていない人は押せる", screen.lastState.buzzedBy?.name === "ばんり");

// --- 再生状態の同期 ---
host.emit("host:setMode", "youtube");
host.emit("host:setSong", 0);
await wait(D);
check("モード切替が投影画面に伝わる", screen.lastState.mode === "youtube");
check("曲送りで押下が解除される", screen.lastState.buzzedBy === null);

host.emit("host:play");
await wait(D);
check("再生指示が投影画面に伝わる", screen.lastState.round.playing === true);

a.emit("buzz");
await wait(D);
check("押されたら再生状態が止まる", screen.lastState.round.playing === false);

host.emit("host:pause");
await wait(D);
check("一時停止が伝わる", screen.lastState.round.playing === false);

// --- 後から参加した画面にも現在の状態が届く ---
host.emit("host:setSong", 1);
host.emit("host:reveal");
await wait(D);
const late = await mkClient("late-screen");
await wait(D);
check("後から開いた画面にも現在の問題が届く", late.lastState.round.index === 1);
check("後から開いた画面にも答え表示状態が届く", late.lastState.round.revealed === true);

// --- 不正な入力を弾く ---
host.emit("host:setSong", -5);
host.emit("host:setSong", "abc");
host.emit("host:setMode", "bogus");
await wait(D);
check("不正な曲番号を無視する", screen.lastState.round.index === 1);
check("不正なモードを無視する", screen.lastState.mode === "youtube");

console.log(fail.length ? `\n${fail.length} 件 FAIL` : "\nすべて PASS");
[screen, host, a, b, late].forEach((s) => s.close());
process.exit(fail.length ? 1 : 0);
