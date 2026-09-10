// URL から「どの部屋の、どの立場で開いたか」を読む処理の検証。
// ここを間違えると全画面が同時に壊れる（参加者画面が管理画面として開く等）。
// 実装をそのまま import するので、tsx で実行する:
//   npx tsx scripts/routetest.ts
// サーバーは不要（通信しない）。
import { handshakeAuth, normalizeCode, parseRoomRef } from "../src/room";

let ng = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${
      ok
        ? ""
        : `\n      得: ${JSON.stringify(got)}\n      期: ${JSON.stringify(want)}`
    }`,
  );
  if (!ok) ng++;
}

// --- 参加コードの正規化。口頭で伝えたコードの打ち間違いを吸収する ---
eq("小文字を大文字にする", normalizeCode("abcd"), "ABCD");
eq("空白を落とす", normalizeCode(" ab cd "), "ABCD");
eq("ハイフンを落とす", normalizeCode("AB-CD"), "ABCD");
eq("記号だけなら空", normalizeCode("---"), "");
eq("長すぎる入力は切る", normalizeCode("ABCDEFGHIJKL"), "ABCDEFGH");

// --- 部屋を指していないURL ---
eq("トップはロビー", parseRoomRef("/"), { kind: "lobby" });
eq("空文字もロビー", parseRoomRef(""), { kind: "lobby" });
eq("キーの無い /host はロビー", parseRoomRef("/host"), { kind: "lobby" });
eq("キーの無い /screen はロビー", parseRoomRef("/screen"), { kind: "lobby" });
eq("知らないパスはロビー", parseRoomRef("/foo/bar"), { kind: "lobby" });
eq("コードの無い /r はロビー", parseRoomRef("/r"), { kind: "lobby" });
eq("空のコードはロビー", parseRoomRef("/r/---"), { kind: "lobby" });

// --- 参加者 ---
eq("参加者URL", parseRoomRef("/r/ABCD"), { kind: "player", code: "ABCD" });
eq("小文字でも同じ部屋", parseRoomRef("/r/abcd"), { kind: "player", code: "ABCD" });
eq("末尾スラッシュ", parseRoomRef("/r/ABCD/"), { kind: "player", code: "ABCD" });

// --- 投影・管理 ---
const KEY = "TrEWSc19p7sANLET";
eq("投影画面URL", parseRoomRef(`/screen/${KEY}`), { kind: "screen", hostKey: KEY });
eq("管理画面URL", parseRoomRef(`/host/${KEY}`), { kind: "host", hostKey: KEY });
eq(
  "base64url の記号を通す",
  parseRoomRef("/host/aB-_12345678zz"),
  { kind: "host", hostKey: "aB-_12345678zz" },
);
eq("短すぎるキーは弾く", parseRoomRef("/host/abc"), { kind: "lobby" });
eq("使えない文字が入ったキーは弾く", parseRoomRef("/host/abc/def!ghi"), {
  kind: "lobby",
});

// --- ハンドシェイクで名乗る内容 ---
// ここが入れ替わると、参加者に曲データが渡る／主催者が部屋に入れない。
eq("参加者は部屋コードで名乗る", handshakeAuth({ kind: "player", code: "ABCD" }), {
  room: "ABCD",
});
eq("投影画面は主催キーで名乗る", handshakeAuth({ kind: "screen", hostKey: KEY }), {
  hostKey: KEY,
});
eq("管理画面は主催キーで名乗る", handshakeAuth({ kind: "host", hostKey: KEY }), {
  hostKey: KEY,
});
eq("ロビーでは繋がない", handshakeAuth({ kind: "lobby" }), null);

console.log(ng === 0 ? "\nすべて PASS" : `\n${ng}件 FAIL`);
process.exit(ng === 0 ? 0 : 1);
