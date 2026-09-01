// お手つきした人が、ページを開き直してロックを解除できないことを検証する。
// 当日に実際に使われた抜け道なので、必ず通ること。
//   node scripts/relocktest.mjs [url]
import { io } from "socket.io-client";

const URL = process.argv[2] || "http://localhost:3000";
const D = Number(process.env.D) || (URL.startsWith("https") ? 900 : 250);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = [];
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) fail.push(label);
}

/** clientId を指定して参加する。同じ clientId は「同じ端末」を意味する */
async function join(name, clientId) {
  const s = io(URL, { transports: ["websocket"] });
  s.lastState = null;
  s.on("state", (st) => (s.lastState = st));
  await new Promise((res) => s.on("connect", res));
  await new Promise((res) => s.emit("join", { name, clientId }, res));
  return s;
}

const host = io(URL, { transports: ["websocket"] });
host.lastState = null;
host.on("state", (st) => (host.lastState = st));
await new Promise((r) => host.on("connect", r));

host.emit("host:setSong", 0);
await wait(D);

const CID_A = "test-device-A";
const CID_B = "test-device-B";

let a = await join("あきら", CID_A);
const b = await join("ばんり", CID_B);
await wait(D);
check("2人が参加している", host.lastState.players.length >= 2);

// あきらが押して、お手つきにされる
a.emit("buzz");
await wait(D);
check("あきらが押せた", host.lastState.buzzedBy?.name === "あきら");

host.emit("host:wrong");
await wait(D);
check("あきらがロックされた", host.lastState.lockedIds.includes(CID_A));

await wait(3200); // カウントダウン明け

// ★ここが本題: ページを開き直す（切断 → 同じ端末で再接続）
a.close();
await wait(D);
a = await join("あきら", CID_A);
await wait(D);

check(
  "開き直してもロックが残っている",
  host.lastState.lockedIds.includes(CID_A),
);

a.emit("buzz");
await wait(D);
check("開き直しても押せない", host.lastState.buzzedBy === null);

// 名前を変えても解除されない
const a2 = await join("あきら2", CID_A);
await wait(D);
a2.emit("buzz");
await wait(D);
check("名前を変えても押せない", host.lastState.buzzedBy === null);

// 他の人は普通に押せる
b.emit("buzz");
await wait(D);
check("ロックされていない人は押せる", host.lastState.buzzedBy?.name === "ばんり");

// 次の問題へ進めば解除される
host.emit("host:setSong", 1);
await wait(D);
check("次の問題でロックが解除される", host.lastState.lockedIds.length === 0);
a2.emit("buzz");
await wait(D);
check("次の問題では元ロック者も押せる", host.lastState.buzzedBy?.name === "あきら2");

// 同じ端末を二重に開いても参加者が増えない
const dup = await join("あきら2", CID_A);
await wait(D);
const count = host.lastState.players.filter((p) => p.id === CID_A).length;
check("同じ端末を二重に開いても参加者は1人", count === 1);

console.log(fail.length ? `\n${fail.length} 件 FAIL` : "\nすべて PASS");
[a, a2, b, dup, host].forEach((s) => s.close());
process.exit(fail.length ? 1 : 0);
