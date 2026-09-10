import {
  connectHost,
  connectPlayer,
  createRoom,
  delayFor,
  joinPlayer,
  wait,
} from "./roomlib.mjs";

// 引数で接続先を指定できる: node scripts/buzztest.mjs https://xxx.onrender.com
const URL = process.argv[2] || "http://localhost:3000";
// リモート検証では往復が乗るので待ちを伸ばす（判定の取りこぼし防止）
const D = delayFor(URL);

// 自分専用の部屋で検証する。他の部屋の参加者は数にも判定にも入らない。
const room = await createRoom(URL);

let cidSeq = 0;
function mk(name) {
  // 参加者の identity は socket.id ではなく clientId。テストでも同じ形で送る。
  return joinPlayer(URL, room.code, name, `buzztest-${Date.now()}-${cidSeq++}`);
}

const fail = [];
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) fail.push(label);
}

const a = await mk("あきら");
const b = await mk("ばんり");
const c = await mk("ちひろ");
const host = await connectHost(URL, room.hostKey);
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
const others = [a, b, c].filter((s) => s.cid !== winner.id);
others[0].emit("buzz");
await wait(D);
check("押下中に他人が押しても buzzedBy が変わらない", a.lastState.buzzedBy.id === winner.id);

// --- 誤答: 本人だけロック、受付再開 ---
host.emit("host:wrong");
await wait(D);
check("誤答で受付が再開する (buzzedBy=null)", a.lastState.buzzedBy === null);
check("誤答した本人だけが lockedIds に入る", a.lastState.lockedIds.length === 1 && a.lastState.lockedIds[0] === winner.id);

// お手つき後は3秒のカウントダウンが入る。明けるまで誰も押せない。
await wait(3200);

// --- ロックされた本人は押せない ---
const loser = [a, b, c].find((s) => s.cid === winner.id);
loser.emit("buzz");
await wait(D);
check("ロック済みの本人は押せない", a.lastState.buzzedBy === null);

// --- 他人は押せる ---
others[1].emit("buzz");
await wait(D);
check("ロックされていない他人は押せる", a.lastState.buzzedBy?.id === others[1].cid);

// --- reset はロックしない ---
host.emit("host:reset");
await wait(D);
check("reset で buzzedBy が消える", a.lastState.buzzedBy === null);
check("reset ではロックが増えない", a.lastState.lockedIds.length === 1);

// --- nextRound で全解除 ---
host.emit("host:restartRound");
await wait(D);
check("nextRound で lockedIds が空になる", a.lastState.lockedIds.length === 0);
loser.emit("buzz");
await wait(D);
check("nextRound 後は元ロック者も押せる", a.lastState.buzzedBy?.id === winner.id);

// --- 切断で片付けられる ---
host.emit("host:restartRound");
await wait(D);
b.close();
await wait(D);
check("切断した参加者が players から消える", a.lastState.players.length === 2);

// --- 未 join は押せない ---
const ghost = await connectPlayer(URL, room.code);
ghost.emit("buzz");
await wait(D);
check("未 join のクライアントは押せない", a.lastState.buzzedBy === null);

console.log(fail.length ? `\n${fail.length} 件 FAIL` : "\nすべて PASS");
[a, c, host, ghost].forEach((s) => s.close());
process.exit(fail.length ? 1 : 0);
