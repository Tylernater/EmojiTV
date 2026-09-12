import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const waiting = [];
const rooms = new Map();
const clients = new Set();
const leaderboard = { face: new Map(), hunt: new Map(), chat: new Map() };
const reports = [];
const MAX_REPORTS = 5000;

const EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","🤗","🫠","🫡",
  "🤔","🫢","🫣","🫤","🫥","😐","😑","😶","🫨","😏","😒","🙄","😬","🤥","😶‍🌫️",
  "😴","🤤","😪","😵","😵‍💫","🤐","🤢","🤮","🤧","😷","🤒","🤕","🥴","🥶","🥵","😳","😯","😦","😧",
  "😟","😕","🙁","☹️","😞","😔","😢","😭","😥","😓","😰","😨","😱","😖","😣","😫","😩","🥺","🥹",
  "😠","😡","🤬","😤","😮‍💨",
  "😮","😲","😯","😦","😧","😨","😱","🤯","😵‍💫",
  "🤭","🫣","🤫","🤠","🥸","😈","👿","💀","☠️","👻","👽","🤖","🎃","😺","😸","😹","😻","😼","😽","🙀","😿","😾"
];

const HUNT_ITEMS = [
  { emoji: "🧻", label: "toilet paper", aliases: ["toilet paper", "a roll of toilet paper"] },
  { emoji: "🍎", label: "apple", aliases: ["an apple", "apple"] },
  { emoji: "🍌", label: "banana", aliases: ["a banana", "banana"] },
  { emoji: "🥤", label: "cup", aliases: ["a cup", "a drinking cup"] },
  { emoji: "🧴", label: "bottle", aliases: ["a bottle", "a plastic bottle"] },
  { emoji: "📕", label: "book", aliases: ["a book", "a red book"] },
  { emoji: "🥄", label: "spoon", aliases: ["a spoon", "a metal spoon"] },
  { emoji: "🧸", label: "teddy bear", aliases: ["a teddy bear", "a stuffed bear"] },
  { emoji: "📱", label: "cell phone", aliases: ["a cell phone", "a smartphone", "a phone"] },
  { emoji: "🪥", label: "toothbrush", aliases: ["a toothbrush", "toothbrush"] }
];

const TOTAL_FACE_ROUNDS = 5;
const TOTAL_HUNT_ROUNDS = 10;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_, res) => {
  res.json({ ok: true, game: "EmojiTV" });
});

function send(ws, data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(data) {
  for (const ws of clients) {
    send(ws, data);
  }
}

function createId() {
  return crypto.randomUUID();
}

function cleanName(name) {
  const value = String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 20);

  return value || "Guest";
}

function removeFromWaiting(ws) {
  const i = waiting.indexOf(ws);

  if (i !== -1) {
    waiting.splice(i, 1);
  }
}

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function modeRounds(mode) {
  return mode === "hunt" ? TOTAL_HUNT_ROUNDS : TOTAL_FACE_ROUNDS;
}

function nextHuntTarget() {
  return { ...randomItem(HUNT_ITEMS) };
}

function onlinePayload() {
  const names = [...clients]
    .map(ws => ws.username || "Guest")
    .sort((a, b) => a.localeCompare(b));

  return {
    type: "online-list",
    count: clients.size,
    names
  };
}

function broadcastOnline() {
  broadcast(onlinePayload());
}

function ensureStats(mode, username) {
  if (!leaderboard[mode].has(username)) {
    leaderboard[mode].set(username, {
      username,
      wins: 0,
      points: 0,
      games: 0
    });
  }

  return leaderboard[mode].get(username);
}

function recordCompletedGame(room) {
  if (!room || room.completed) {
    return;
  }

  room.completed = true;

  const players = [room.a, room.b];
  const scores = room.scores;

  const aScore = scores[room.a.playerId] || 0;
  const bScore = scores[room.b.playerId] || 0;

  for (const player of players) {
    const stats = ensureStats(room.mode, player.username);

    stats.games += 1;
    stats.points += scores[player.playerId] || 0;
  }

  if (aScore > bScore) {
    ensureStats(room.mode, room.a.username).wins += 1;
  }

  if (bScore > aScore) {
    ensureStats(room.mode, room.b.username).wins += 1;
  }

  broadcastLeaderboards();
}

function leaderboardPayload(mode) {
  const rows = [...leaderboard[mode].values()]
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.points - a.points ||
        a.username.localeCompare(b.username)
    )
    .slice(0, 20)
    .map((x, i) => ({
      rank: i + 1,
      ...x
    }));

  return {
    mode,
    rows
  };
}

function broadcastLeaderboards() {
  for (const mode of ["face", "hunt", "chat"]) {
    broadcast(leaderboardPayload(mode));
  }
}

function endRoom(ws, notifyOpponent = true) {
  removeFromWaiting(ws);

  if (!ws.roomId) {
    return null;
  }

  const roomId = ws.roomId;
  const room = rooms.get(roomId);

  if (!room) {
    ws.roomId = null;
    return null;
  }

  const opponent = room.a === ws ? room.b : room.a;

  if (room.mode === "chat" && !room.completed) {
    room.completed = true;

    ensureStats("chat", room.a.username).games += 1;
    ensureStats("chat", room.b.username).games += 1;

    ensureStats("chat", room.a.username).points += 1;
    ensureStats("chat", room.b.username).points += 1;

    broadcastLeaderboards();
  }

  if (opponent && notifyOpponent) {
    send(opponent, {
      type: "opponent-left"
    });
  }

  if (room.a) {
    room.a.roomId = null;
  }

  if (room.b) {
    room.b.roomId = null;
  }

  rooms.delete(roomId);

  return opponent;
}

function putInQueue(ws, mode) {
  removeFromWaiting(ws);

  if (ws.readyState !== 1) {
    return;
  }

  ws.queueMode = mode;

  waiting.push(ws);

  send(ws, {
    type: "waiting",
    mode
  });
}

function findWaitingOpponent(mode) {
  for (let i = 0; i < waiting.length; i++) {
    const candidate = waiting[i];

    if (
      candidate.readyState === 1 &&
      candidate.queueMode === mode
    ) {
      waiting.splice(i, 1);
      candidate.queueMode = null;

      return candidate;
    }
  }

  return null;
}

function startMatch(playerA, playerB, mode) {
  const roomId = createId();

  const target =
    mode === "hunt"
      ? nextHuntTarget()
      : mode === "face"
      ? randomItem(EMOJIS)
      : null;

  const rounds = modeRounds(mode);

  const room = {
    id: roomId,
    a: playerA,
    b: playerB,
    mode,
    round: 1,
    totalRounds: rounds,
    target,
    scores: {
      [playerA.playerId]: 0,
      [playerB.playerId]: 0
    },
    roundScores: {},
    nextReady: new Set(),
    huntFound: false,
    completed: false
  };

  rooms.set(roomId, room);

  playerA.roomId = roomId;
  playerB.roomId = roomId;

  playerA.role = "a";
  playerB.role = "b";

  const base = {
    type: "matched",
    roomId,
    round: 1,
    totalRounds: rounds,
    mode,
    target
  };

  send(playerA, {
    ...base,
    role: "a",
    opponentId: playerB.playerId,
    opponentUsername: playerB.username
  });

  send(playerB, {
    ...base,
    role: "b",
    opponentId: playerA.playerId,
    opponentUsername: playerA.username
  });
}

function sendNextRound(room) {
  if (room.round >= room.totalRounds) {
    recordCompletedGame(room);

    send(room.a, {
      type: "game-over",
      mode: room.mode,
      finalScores: room.scores
    });

    send(room.b, {
      type: "game-over",
      mode: room.mode,
      finalScores: room.scores
    });

    return;
  }

  room.round += 1;
  room.nextReady.clear();
  room.huntFound = false;
  room.roundScores = {};

  room.target =
    room.mode === "hunt"
      ? nextHuntTarget()
      : room.mode === "face"
      ? randomItem(EMOJIS)
      : null;

  const message = {
    type: "new-round",
    round: room.round,
    totalRounds: room.totalRounds,
    mode: room.mode,
    target: room.target
  };

  send(room.a, message);
  send(room.b, message);
}

wss.on("connection", ws => {
  clients.add(ws);

  ws.playerId = createId();
  ws.roomId = null;
  ws.role = null;
  ws.queueMode = null;
  ws.username = "Guest";

  send(ws, {
    type: "ready",
    playerId: ws.playerId,
    username: ws.username
  });

  send(ws, onlinePayload());
  broadcastOnline();

  ws.on("message", raw => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === "set-username") {
      const oldName = ws.username;

      ws.username = cleanName(message.username);

      send(ws, {
        type: "username-saved",
        username: ws.username
      });

      if (oldName !== ws.username) {
        broadcastOnline();
      }

      return;
    }

    if (message.type === "get-leaderboards") {
      for (const mode of ["face", "hunt", "chat"]) {
        send(ws, leaderboardPayload(mode));
      }

      return;
    }

    if (message.type === "report") {
      const allowedModes = ["face", "chat", "hunt"];

      const reasons = [
        "harassment",
        "sexual-content",
        "hate",
        "threats",
        "spam",
        "privacy",
        "other"
      ];

      const room = ws.roomId
        ? rooms.get(ws.roomId)
        : null;

      const mode = allowedModes.includes(message.mode)
        ? message.mode
        : room?.mode;

      if (!mode || !room) {
        send(ws, {
          type: "report-result",
          ok: false,
          error:
            "You can only report someone while connected to a game."
        });

        return;
      }

      const opponent =
        room.a === ws
          ? room.b
          : room.a;

      if (!opponent) {
        return;
      }

      const reason = reasons.includes(message.reason)
        ? message.reason
        : "other";

      const details = String(message.details || "")
        .trim()
        .slice(0, 1000);

      const report = {
        id: createId(),
        createdAt: new Date().toISOString(),
        mode,
        reporterId: ws.playerId,
        reporterUsername: ws.username,
        reportedId: opponent.playerId,
        reportedUsername: opponent.username,
        roomId: room.id,
        reason,
        details
      };

      reports.push(report);

      if (reports.length > MAX_REPORTS) {
        reports.shift();
      }

      console.log(
        "EmojiTV REPORT",
        JSON.stringify(report)
      );

      send(ws, {
        type: "report-result",
        ok: true,
        reportId: report.id
      });

      return;
    }

    if (message.type === "find-match") {
      const mode = [
        "face",
        "chat",
        "hunt"
      ].includes(message.mode)
        ? message.mode
        : "face";

      if (message.username) {
        ws.username = cleanName(message.username);
      }

      removeFromWaiting(ws);

      const opponent = findWaitingOpponent(mode);

      if (opponent) {
        startMatch(opponent, ws, mode);
      } else {
        putInQueue(ws, mode);
      }

      broadcastOnline();

      return;
    }

    if (message.type === "skip") {
      const oldMode = ws.roomId
        ? rooms.get(ws.roomId)?.mode
        : ws.queueMode;

      endRoom(ws, true);

      if (oldMode) {
        putInQueue(ws, oldMode);
      }

      broadcastOnline();

      return;
    }

    if (message.type === "leave") {
      endRoom(ws, true);
      broadcastOnline();
      return;
    }

    if (!ws.roomId) {
      return;
    }

    const room = rooms.get(ws.roomId);

    if (!room) {
      return;
    }

    const opponent =
      room.a === ws
        ? room.b
        : room.a;

    if (
      message.type === "round-score" &&
      room.mode === "face"
    ) {
      const score = Math.max(
        0,
        Math.min(
          100,
          Number(message.score) || 0
        )
      );

      room.roundScores[ws.playerId] = score;

      room.scores[ws.playerId] =
        (room.scores[ws.playerId] || 0) +
        score;

      send(ws, {
        type: "your-score",
        score,
        totalScore: room.scores[ws.playerId],
        round: room.round
      });

      send(opponent, {
        type: "opponent-score",
        score,
        totalScore: room.scores[ws.playerId],
        round: room.round
      });

      return;
    }

    if (
      message.type === "hunt-found" &&
      room.mode === "hunt" &&
      !room.huntFound
    ) {
      room.huntFound = true;

      room.scores[ws.playerId] += 1;

      send(room.a, {
        type: "hunt-winner",
        winnerId: ws.playerId,
        round: room.round,
        scores: room.scores
      });

      send(room.b, {
        type: "hunt-winner",
        winnerId: ws.playerId,
        round: room.round,
        scores: room.scores
      });

      setTimeout(() => {
        if (rooms.get(room.id) === room) {
          sendNextRound(room);
        }
      }, 2200);

      return;
    }

    if (
      message.type === "next-round" &&
      room.mode === "face"
    ) {
      room.nextReady.add(ws.playerId);

      if (room.nextReady.size === 2) {
        sendNextRound(room);
      }

      return;
    }

    if (
      message.type === "chat-message" &&
      room.mode === "chat"
    ) {
      const text = String(message.text || "")
        .slice(0, 300);

      if (text) {
        send(opponent, {
          type: "chat-message",
          text
        });

        send(ws, {
          type: "chat-message",
          text,
          self: true
        });
      }

      return;
    }

    if (
      message.type === "signal" &&
      opponent
    ) {
      send(opponent, {
        type: "signal",
        signal: message.signal,
        from: ws.playerId
      });
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    removeFromWaiting(ws);
    endRoom(ws, true);
    broadcastOnline();
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `EmojiTV running on port ${PORT}`
  );
});
