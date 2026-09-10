// 別々の部屋で開かれたクイズが、互いに干渉しないことを検証する。
// マルチルーム化でいちばん壊れやすいのがここ。1つでも漏れると、
// 隣の部屋の早押しで自分の部屋が止まる／答えが見える、という事故になる。
//   node scripts/roomtest.mjs [url]
import { io } from "socket.io-client";
import {
  connectHost,
  connectPlayer,
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

// --- 2部屋を用意する ---
const A = await createRoom(URL);
const B = await createRoom(URL);

check("参加コードが部屋ごとに違う", A.code !== B.code);
check("主催キーが部屋ごとに違う", A.hostKey !== B.hostKey);
check("参加コードは短くて読める形", /^[A-Z0-9]{4}$/.test(A.code));
check("主催キーは推測できない長さ", A.hostKey.length >= 16);
check("参加URLに参加コードが入る", A.joinUrl.endsWith(`/join/${A.code}`));

const hostA = await connectHost(URL, A.hostKey);
const hostB = await connectHost(URL, B.hostKey);
const a1 = await joinPlayer(URL, A.code, "えー1", "room-a-1");
const a2 = await joinPlayer(URL, A.code, "えー2", "room-a-2");
const b1 = await joinPlayer(URL, B.code, "びー1", "room-b-1");
await wait(D);

check("自分の部屋のコードが state で届く", a1.lastState.roomCode === A.code);
check("別の部屋には別のコードが届く", b1.lastState.roomCode === B.code);

// --- 参加者が混ざらない ---
check("A の参加者は2人", hostA.lastState.players.length === 2);
check("B の参加者は1人", hostB.lastState.players.length === 1);
check(
  "A の参加者一覧に B の人が居ない",
  !hostA.lastState.players.some((p) => p.name === "びー1"),
);

// --- 早押しが混ざらない ---
a1.emit("buzz");
await wait(D);
check("A で押すと A の buzzedBy が立つ", hostA.lastState.buzzedBy?.name === "えー1");
check("A の buzzed は B へ漏れない", hostB.buzzCount === 0);
check("B の buzzedBy は立たない", hostB.lastState.buzzedBy === null);
check("B の参加者に buzzed が飛んでいない", b1.buzzCount === 0);
check("A の参加者には buzzed が飛んでいる", a2.buzzCount === 1);

// B 側は独立して押せる（A が押されていても止まらない）
b1.emit("buzz");
await wait(D);
check("A が押下中でも B では押せる", hostB.lastState.buzzedBy?.name === "びー1");
check("B で押しても A の押下者は変わらない", hostA.lastState.buzzedBy?.name === "えー1");

// --- お手つきが混ざらない ---
hostA.emit("host:wrong");
await wait(D);
check("A でロックが1件付く", hostA.lastState.lockedIds.length === 1);
check("B にはロックが付かない", hostB.lastState.lockedIds.length === 0);
check("B の名前ロックも空のまま", hostB.lastState.lockedNames.length === 0);
check("B の押下は解除されていない", hostB.lastState.buzzedBy?.name === "びー1");

await wait(3200); // A のカウントダウン明け
check("A の受付が再開している", hostA.lastState.round.resumeInMs === 0);
check("B は演出の影響を受けない", hostB.lastState.round.wrongName === null);

hostB.emit("host:restartRound");
await wait(D);
check("B のラウンド初期化で A のロックが消えない", hostA.lastState.lockedIds.length === 1);

// --- 進行状態が混ざらない ---
hostA.emit("host:setSong", 3);
hostA.emit("host:setMode", "manual");
hostA.emit("host:setSuspense", 500);
hostA.emit("host:setMasterVolume", 33);
hostA.emit("host:setRunUp", false);
await wait(D);
check("A の問題番号が変わる", hostA.lastState.round.index === 3);
check("B の問題番号は変わらない", hostB.lastState.round.index === 0);
check("A のモードが変わる", hostA.lastState.mode === "manual");
check("B のモードは変わらない", hostB.lastState.mode === "youtube");
check("A の溜めが変わる", hostA.lastState.suspenseMs === 500);
check("B の溜めは変わらない", hostB.lastState.suspenseMs === 2000);
check("A の全体音量が変わる", hostA.lastState.masterVolume === 33);
check("B の全体音量は変わらない", hostB.lastState.masterVolume === 70);
check("A の助走設定が変わる", hostA.lastState.runUp === false);
check("B の助走設定は変わらない", hostB.lastState.runUp === true);

// --- 曲リストが混ざらない ---
const SECRET = "A部屋だけの曲XYZ";
const beforeB = hostB.lastState.songs.length;
hostA.emit("host:setSongs", [
  { videoId: "roomA001", title: SECRET, artist: "ア", owner: "オ", startSec: 0 },
]);
await wait(D);
check("A の曲リストが差し替わる", hostA.lastState.songs[0].title === SECRET);
check("B の曲リストは変わらない", hostB.lastState.songs.length === beforeB);
check(
  "B の通信に A の曲名が出てこない",
  !hostB.frames.join("\n").includes(SECRET),
);
check(
  "B の参加者の通信にも出てこない",
  !b1.frames.join("\n").includes(SECRET),
);

// 新しい部屋は初期リストから始まる（前の部屋の編集を引きずらない）
const C = await createRoom(URL);
const hostC = await connectHost(URL, C.hostKey);
await wait(D);
check(
  "新しい部屋は A の編集を引き継がない",
  hostC.lastState.songs.length === beforeB,
);

// --- 答えの配布は主催キーだけ ---
check("A の参加者に曲は届かない", a1.lastState.songs.length === 0);
a1.emit("role:host");
a1.emit("role:screen");
await wait(D);
check("参加コードで繋いだ相手は名乗っても曲を受け取れない", a1.lastState.songs.length === 0);

// 参加コードを主催キーの代わりに使えない
const fakeHost = await connectPlayer(URL, A.code);
await wait(D);
check("参加コードでは曲データが届かない", fakeHost.lastState.songs.length === 0);

// 別の部屋の主催キーでは、その部屋にしか入れない
const crossed = await connectHost(URL, B.hostKey);
await wait(D);
check("B の主催キーで繋ぐと B の部屋に入る", crossed.lastState.roomCode === B.code);
check("B の主催キーで A の曲は見えない", !JSON.stringify(crossed.lastState.songs).includes(SECRET));

// --- 存在しない部屋 ---
function connectRaw(auth) {
  const s = io(URL, { transports: ["websocket"], auth });
  s.missing = false;
  s.gotState = false;
  s.on("room:missing", () => (s.missing = true));
  s.on("state", () => (s.gotState = true));
  return new Promise((res, rej) => {
    s.on("connect", () => res(s));
    s.on("connect_error", rej);
  });
}

const ghostCode = await connectRaw({ room: "ZZZZ" });
const ghostKey = await connectRaw({ hostKey: "no-such-host-key-000" });
// 部屋を名乗らない接続。既定の部屋は無いので、ここも見つからない扱いになる。
const ghostBare = await connectRaw({});
await wait(D);
check("存在しない参加コードで room:missing が来る", ghostCode.missing === true);
check("存在しない参加コードでは state が来ない", ghostCode.gotState === false);
check("存在しない主催キーで room:missing が来る", ghostKey.missing === true);
check("存在しない主催キーでは state が来ない", ghostKey.gotState === false);
check("部屋を名乗らない接続も room:missing になる", ghostBare.missing === true);
check("部屋を名乗らない接続に state は来ない", ghostBare.gotState === false);

// 部屋の無い相手が何を送っても、どの部屋も動かない
const beforeGhost = JSON.stringify(hostA.lastState);
ghostCode.emit("join", { name: "幽霊", clientId: "ghost-1" });
ghostCode.emit("buzz");
ghostCode.emit("host:restartRound");
ghostCode.emit("host:setSong", 7);
await wait(D);
check("部屋の無い接続は参加者に入らない", hostA.lastState.players.length === 2);
check("部屋の無い接続が何を送っても A は動かない", JSON.stringify(hostA.lastState) === beforeGhost);

// --- HTTP も部屋を知っている ---
const qrOk = await fetch(`${URL}/qr.png?room=${A.code}`);
const qrNg = await fetch(`${URL}/qr.png?room=ZZZZ`);
const urlOk = await fetch(`${URL}/api/url?room=${A.code}`);
const urlNg = await fetch(`${URL}/api/url?room=ZZZZ`);
check("存在する部屋の QR は出る", qrOk.status === 200);
check("存在しない部屋の QR は 404", qrNg.status === 404);
check("存在しない部屋の参加URLは 404", urlNg.status === 404);
check(
  "参加URLは /join/<コード> を指す",
  (await urlOk.json()).url.endsWith(`/join/${A.code}`),
);
// 小文字で渡しても同じ部屋として扱う（口頭で伝えたコードの打ち間違い対策）
const urlLower = await fetch(`${URL}/api/url?room=${A.code.toLowerCase()}`);
check("参加コードは大文字小文字を問わない", urlLower.status === 200);

console.log(fail.length ? `\n${fail.length} 件 FAIL` : "\nすべて PASS");
[hostA, hostB, hostC, a1, a2, b1, fakeHost, crossed, ghostCode, ghostKey, ghostBare].forEach(
  (s) => s.close(),
);
process.exit(fail.length ? 1 : 0);
