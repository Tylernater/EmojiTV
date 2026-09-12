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

const EMOJIS = ["😎", "😮", "😡", "😂", "😐"];
const TOTAL_ROUNDS = 5;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_, res) => {
  res.json({ ok: true, game: "Emoji Face-Off" });
});

const createId = () => crypto.randomUUID();

function send(ws, data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function removeFromWaiting(ws) {
  const index = waiting.indexOf(ws);

  if (index !== -1) {
    waiting.splice(index, 1);
  }
}

function getRandomEmoji() {
  return EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
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

  if (opponent && notifyOpponent) {
    send(opponent, {
      type: "opponent-left"
    });
  }

  if (room.a) room.a.roomId = null;
  if (room.b) room.b.roomId = null;

  rooms.delete(roomId);

  return opponent;
}

function putInQueue(ws) {
  removeFromWaiting(ws);

  if (ws.readyState !== 1) {
    return;
  }

  waiting.push(ws);

  send(ws, {
    type: "waiting"
  });
}

function startMatch(playerA, playerB) {
  const roomId = createId();

  // IMPORTANT:
  // The server chooses ONE emoji and sends the SAME emoji
  // to both players.
  const target = getRandomEmoji();

  const room = {
    a: playerA,
    b: playerB,
    round: 1,
    target,
    scores: {
      [playerA.playerId]: 0,
      [playerB.playerId]: 0
    },
    nextReady: new Set()
  };

  rooms.set(roomId, room);

  playerA.roomId = roomId;
  playerB.roomId = roomId;

  playerA.role = "a";
  playerB.role = "b";

  send(playerA, {
    type: "matched",
    roomId,
    role: "a",
    opponentId: playerB.playerId,
    round: 1,
    totalRounds: TOTAL_ROUNDS,
    target
  });

  send(playerB, {
    type: "matched",
    roomId,
    role: "b",
    opponentId: playerA.playerId,
    round: 1,
    totalRounds: TOTAL_ROUNDS,
    target
  });
}

wss.on("connection", (ws) => {
  ws.playerId = createId();
  ws.roomId = null;
  ws.role = null;

  send(ws, {
    type: "ready",
    playerId: ws.playerId
  });

  ws.on("message", (raw) => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Find a random opponent
    if (message.type === "find-match") {
      removeFromWaiting(ws);

      let opponent = waiting.shift();

      while (opponent && opponent.readyState !== 1) {
        opponent = waiting.shift();
      }

      if (opponent) {
        startMatch(opponent, ws);
      } else {
        putInQueue(ws);
      }

      return;
    }

    // Skip current opponent and search for another one
    if (message.type === "skip") {
      endRoom(ws, true);
      putInQueue(ws);
      return;
    }

    // Leave matchmaking/game
    if (message.type === "leave") {
      endRoom(ws, true);
      return;
    }

    // Send a player's face score to the opponent
    if (message.type === "round-score" && ws.roomId) {
      const room = rooms.get(ws.roomId);

      if (!room) {
        return;
      }

      const opponent = room.a === ws ? room.b : room.a;

      const score = Math.max(
        0,
        Math.min(100, Number(message.score) || 0)
      );

      room.scores[ws.playerId] = score;

      send(ws, {
        type: "your-score",
        score,
        round: room.round
      });

      send(opponent, {
        type: "opponent-score",
        score,
        round: room.round
      });

      return;
    }

    // Player is ready for the next round
    if (message.type === "next-round" && ws.roomId) {
      const room = rooms.get(ws.roomId);

      if (!room) {
        return;
      }

      room.nextReady.add(ws.playerId);

      // Wait until BOTH players are ready
      if (room.nextReady.size === 2) {
        if (room.round >= TOTAL_ROUNDS) {
          send(room.a, {
            type: "game-over"
          });

          send(room.b, {
            type: "game-over"
          });

          return;
        }

        room.round += 1;

        // IMPORTANT:
        // Choose the emoji ONCE on the server.
        // Both players receive this exact same emoji.
        room.target = getRandomEmoji();

        room.nextReady.clear();

        const roundMessage = {
          type: "new-round",
          round: room.round,
          totalRounds: TOTAL_ROUNDS,
          target: room.target
        };

        send(room.a, roundMessage);
        send(room.b, roundMessage);
      }

      return;
    }

    // Relay WebRTC signaling messages between players
    if (ws.roomId) {
      const room = rooms.get(ws.roomId);

      if (!room) {
        return;
      }

      const opponent = room.a === ws ? room.b : room.a;

      if (opponent) {
        send(opponent, {
          ...message,
          from: ws.playerId
        });
      }
    }
  });

  ws.on("close", () => {
    removeFromWaiting(ws);
    endRoom(ws, true);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Emoji Face-Off running on port ${PORT}`);
});
