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
  // 曲データは投影画面と管理画面にだけ配られるので、役割を名乗る
  return new Promise((res) =>
    s.on("connect", () => {
      s.emit("role:host");
      res(s);
    }),
  );
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

// サーバーはメモリ上に状態を持ち続けるので、既知の状態に揃えてから検証する
host.emit("host:setSong", 0);
host.emit("host:setMode", "manual");
await wait(D);
check("第1問に戻せる (index=0)", screen.lastState.round.index === 0);
check("手動モードに設定できる", screen.lastState.mode === "manual");

// --- 曲送りが投影画面に伝わる ---
host.emit("host:setSong", 2);
await wait(D);
check("管理画面の曲送りが投影画面に伝わる", screen.lastState.round.index === 2);
check("曲送りで答え表示が消える", screen.lastState.round.revealed === false);

// --- 溜めの長さを変えられる ---
host.emit("host:setSuspense", 500);
await wait(D);
check("溜めの長さを変えられる", screen.lastState.suspenseMs === 500);
host.emit("host:reveal");
await wait(900);
check("短い溜めなら早く答えが出る", screen.lastState.round.revealed === true);

host.emit("host:setSuspense", 0);
await wait(D);
host.emit("host:setSong", 2);
await wait(D);
host.emit("host:reveal");
await wait(D);
check("0秒なら溜めずにすぐ答えが出る", screen.lastState.round.revealed === true);

host.emit("host:setSuspense", 99999);
await wait(D);
check("上限を超える値は丸められる", screen.lastState.suspenseMs === 10000);
host.emit("host:setSuspense", -100);
await wait(D);
check("負の値は0に丸められる", screen.lastState.suspenseMs === 0);
host.emit("host:setSuspense", "abc");
await wait(D);
check("数値でない値は無視される", screen.lastState.suspenseMs === 0);

// 既定の2秒に戻して以降のテストを続ける
host.emit("host:setSuspense", 2000);
host.emit("host:setSong", 2);
await wait(D);

// --- 正解発表の溜め（「正解は…」）と答え表示 ---
host.emit("host:reveal");
await wait(D);
check("溜めの残り時間が配信される", screen.lastState.round.revealInMs > 500);
check("溜め中はまだ答えを出さない", screen.lastState.round.revealed === false);
check("参加者にも溜めが伝わる", a.lastState.round.revealInMs > 0);

await wait(2200); // 溜め明け
check("答え表示が投影画面に伝わる", screen.lastState.round.revealed === true);
check("参加者にも同じ state が届く", a.lastState.round.revealed === true);
check("溜めの残り時間は0になる", screen.lastState.round.revealInMs === 0);

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

// お手つき後は3秒のカウントダウンが入る。明けてから押せるようになる。
await wait(3200);
b.emit("buzz");
await wait(D);
check("カウントダウン明けにロックされていない人は押せる", screen.lastState.buzzedBy?.name === "ばんり");

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
await wait(2200); // 溜めが明けてから
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


// --- お手つき演出（不正解表示 + 3秒カウントダウン） ---
host.emit("host:setSong", 0);
await wait(D);
a.emit("buzz");
await wait(D);
check("演出テスト前提: あきらが押せている", screen.lastState.buzzedBy?.name === "あきら");

host.emit("host:wrong");
await wait(D);
check("不正解の相手名が全画面に配信される", screen.lastState.round.wrongName === "あきら");
check("カウントダウンの残り時間が配信される", screen.lastState.round.resumeInMs > 1000);
check("演出中は押下が解除されている", screen.lastState.buzzedBy === null);

b.emit("buzz");
await wait(D);
check("カウントダウン中は誰も押せない", screen.lastState.buzzedBy === null);

await wait(3200);
check("カウントダウン後に不正解表示が消える", screen.lastState.round.wrongName === null);
check("カウントダウン後に残り時間が0になる", screen.lastState.round.resumeInMs === 0);
b.emit("buzz");
await wait(D);
check("受付再開後は押せる", screen.lastState.buzzedBy?.name === "ばんり");

// 演出中に司会が次の問題へ進めたら、演出を打ち切って即座に受付に戻る
host.emit("host:wrong");
await wait(D);
check("再度お手つき演出に入る", screen.lastState.round.wrongName === "ばんり");
host.emit("host:setSong", 1);
await wait(D);
check("曲送りで演出が打ち切られる", screen.lastState.round.wrongName === null);
check("曲送りでカウントダウンも解除される", screen.lastState.round.resumeInMs === 0);
a.emit("buzz");
await wait(D);
check("打ち切り後はすぐ押せる", screen.lastState.buzzedBy?.name === "あきら");

// --- 溜めの途中で進行を変えたら演出を打ち切る ---
host.emit("host:reveal");
await wait(D);
check("溜めに入っている", screen.lastState.round.revealInMs > 0);
host.emit("host:setSong", 0);
await wait(D);
check("曲送りで溜めが打ち切られる", screen.lastState.round.revealInMs === 0);
check("打ち切られたら答えは出ない", screen.lastState.round.revealed === false);
await wait(2200);
check("打ち切り後に遅れて答えが出たりしない", screen.lastState.round.revealed === false);

host.emit("host:restartRound");
await wait(D);
a.emit("buzz");
await wait(D);
host.emit("host:reveal");
await wait(D);
host.emit("host:wrong");
await wait(D);
check("お手つきでも溜めが打ち切られる", screen.lastState.round.revealInMs === 0);
await wait(3400);
check("お手つき後に答えが出たりしない", screen.lastState.round.revealed === false);

console.log(fail.length ? `\n${fail.length} 件 FAIL` : "\nすべて PASS");
[screen, host, a, b, late].forEach((s) => s.close());
process.exit(fail.length ? 1 : 0);
