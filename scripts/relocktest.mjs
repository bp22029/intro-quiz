// お手つきした人が、ページを開き直してロックを解除できないことを検証する。
// 当日に実際に使われた抜け道なので、必ず通ること。
//   node scripts/relocktest.mjs [url]
import {
  connectHost,
  createRoom,
  delayFor,
  joinPlayer,
  wait,
} from "./roomlib.mjs";

const URL = process.argv[2] || "http://localhost:3000";
const D = delayFor(URL);

const fail = [];
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) fail.push(label);
}

const room = await createRoom(URL);

/** clientId を指定して参加する。同じ clientId は「同じ端末」を意味する */
const join = (name, clientId) => joinPlayer(URL, room.code, name, clientId);

const host = await connectHost(URL, room.hostKey);

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

// ★別ブラウザ相当: clientId が全く違っても、同じ名前なら弾く
const otherBrowser = await join("あきら", "test-device-A-safari");
await wait(D);
otherBrowser.emit("buzz");
await wait(D);
check(
  "別ブラウザ(別clientId)でも同じ名前なら押せない",
  host.lastState.buzzedBy === null,
);

// 司会が手動でロックを解除できる（最終手段）
host.emit("host:toggleLock", CID_A);
await wait(D);
check("司会が手動でロックを解除できる", !host.lastState.lockedIds.includes(CID_A));
a.emit("buzz");
await wait(D);
check("手動解除後は押せる", host.lastState.buzzedBy?.id === CID_A);

// 司会が手動でロックを掛け直せる
host.emit("host:reset");
await wait(D);
host.emit("host:toggleLock", CID_A);
await wait(D);
check("司会が手動でロックを掛けられる", host.lastState.lockedIds.includes(CID_A));
a.emit("buzz");
await wait(D);
check("手動ロック後は押せない", host.lastState.buzzedBy === null);

otherBrowser.close();

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
