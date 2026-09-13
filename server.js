import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ ok: true, game: "EmojiTV" });
});

const wss = new WebSocketServer({ server });

const clients = new Set();
const rooms = new Map();
const sessions = new Map();

const friends = new Map();
const pendingFriends = new Map();
const reports = [];

const waiting = {
  face: [],
  chat: [],
  hunt: [],
  pose: [],
  laugh: []
};

const emojis = [
  "😀",
  "😂",
  "😎",
  "😮",
  "😡",
  "😢",
  "😱",
  "🤔",
  "😴",
  "🤩",
  "🥳",
  "😇",
  "🤪",
  "😈",
  "🥶",
  "🥵"
];

const huntItems = [
  "something red",
  "a cup",
  "a book",
  "something blue",
  "a hat",
  "a stuffed animal",
  "something green",
  "a bottle",
  "something round",
  "a shoe"
];

function makeId() {
  return crypto.randomUUID();
}

function safeSend(ws, data) {
  if (!ws || ws.readyState !== 1) return;

  try {
    ws.send(JSON.stringify(data));
  } catch {}
}

function getClientByPlayerId(playerId) {
  for (const ws of clients) {
    if (ws.__playerId === playerId) return ws;
  }

  return null;
}

function otherPlayer(room, playerId) {
  if (!room) return null;

  if (room.playerA?.playerId === playerId) {
    return room.playerB;
  }

  if (room.playerB?.playerId === playerId) {
    return room.playerA;
  }

  return null;
}

function getPlayer(room, playerId) {
  if (!room) return null;

  if (room.playerA?.playerId === playerId) {
    return room.playerA;
  }

  if (room.playerB?.playerId === playerId) {
    return room.playerB;
  }

  return null;
}

function roomPlayers(room) {
  return [room.playerA, room.playerB].filter(Boolean);
}

function sendRoomState(room) {
  if (!room) return;

  for (const player of roomPlayers(room)) {
    const ws = getClientByPlayerId(player.playerId);

    if (!ws) continue;

    const opponent = otherPlayer(room, player.playerId);

    safeSend(ws, {
      type: "room-state",
      mode: room.mode,
      roomId: room.id,
      playerId: player.playerId,
      opponentId: opponent?.playerId || "",
      opponentUsername: opponent?.username || "",
      round: room.round,
      totalRounds: room.totalRounds,
      targetEmoji: room.targetEmoji,
      huntItem: room.huntItem,
      scores: room.scores,
      roundWins: room.roundWins,
      playerA: room.playerA?.playerId === player.playerId
    });
  }
}

function startMatch(mode, playerA, playerB) {
  const roomId = makeId();

  const room = {
    id: roomId,
    mode,
    playerA,
    playerB,

    round: 1,

    totalRounds:
      mode === "face"
        ? 5
        : mode === "hunt"
          ? 5
          : 1,

    targetEmoji:
      mode === "face"
        ? emojis[Math.floor(Math.random() * emojis.length)]
        : null,

    huntItem:
      mode === "hunt"
        ? huntItems[Math.floor(Math.random() * huntItems.length)]
        : null,

    scores: {
      [playerA.playerId]: 0,
      [playerB.playerId]: 0
    },

    roundWins: {
      [playerA.playerId]: 0,
      [playerB.playerId]: 0
    },

    roundScores: {},

    connected: {
      [playerA.playerId]: true,
      [playerB.playerId]: true
    },

    createdAt: Date.now(),

    started: false,

    chatStarted: false,

    huntStarted: false
  };

  rooms.set(roomId, room);

  playerA.roomId = roomId;
  playerB.roomId = roomId;

  const wsA = getClientByPlayerId(playerA.playerId);
  const wsB = getClientByPlayerId(playerB.playerId);

  if (wsA) {
    wsA.__roomId = roomId;
    wsA.__playerId = playerA.playerId;
  }

  if (wsB) {
    wsB.__roomId = roomId;
    wsB.__playerId = playerB.playerId;
  }

  sessions.set(playerA.sessionId, {
    roomId,
    playerId: playerA.playerId,
    role: "A"
  });

  sessions.set(playerB.sessionId, {
    roomId,
    playerId: playerB.playerId,
    role: "B"
  });

  safeSend(wsA, {
    type: "matched",
    mode,
    roomId,
    playerId: playerA.playerId,
    opponentId: playerB.playerId,
    opponentUsername: playerB.username,
    targetEmoji: room.targetEmoji,
    huntItem: room.huntItem,
    round: room.round,
    totalRounds: room.totalRounds,
    playerA: true
  });

  safeSend(wsB, {
    type: "matched",
    mode,
    roomId,
    playerId: playerB.playerId,
    opponentId: playerA.playerId,
    opponentUsername: playerA.username,
    targetEmoji: room.targetEmoji,
    huntItem: room.huntItem,
    round: room.round,
    totalRounds: room.totalRounds,
    playerA: false
  });

  if (mode === "face") {
    setTimeout(() => {
      const currentRoom = rooms.get(roomId);

      if (!currentRoom) return;

      safeSend(wsA, {
        type: "face-start",
        round: currentRoom.round,
        targetEmoji: currentRoom.targetEmoji
      });

      safeSend(wsB, {
        type: "face-start",
        round: currentRoom.round,
        targetEmoji: currentRoom.targetEmoji
      });
    }, 500);
  }

  if (mode === "hunt") {
    setTimeout(() => {
      const currentRoom = rooms.get(roomId);

      if (!currentRoom) return;

      currentRoom.huntStarted = true;

      safeSend(wsA, {
        type: "hunt-start",
        round: currentRoom.round,
        item: currentRoom.huntItem
      });

      safeSend(wsB, {
        type: "hunt-start",
        round: currentRoom.round,
        item: currentRoom.huntItem
      });
    }, 500);
  }

  return room;
}

function removeFromWaiting(ws) {
  for (const mode of Object.keys(waiting)) {
    waiting[mode] = waiting[mode].filter(
      item => item.ws !== ws
    );
  }
}

function tryMatch(ws, mode) {
  if (!waiting[mode]) return;

  waiting[mode] = waiting[mode].filter(
    item =>
      item.ws &&
      item.ws.readyState === 1 &&
      !item.ws.__roomId
  );

  const existing = waiting[mode].shift();

  if (
    existing &&
    existing.ws &&
    existing.ws.readyState === 1 &&
    existing.ws !== ws
  ) {
    const playerA = existing.player;
    const playerB = {
      playerId: ws.__playerId,
      username: ws.__username || "Player",
      sessionId: ws.__sessionId
    };

    startMatch(mode, playerA, playerB);

    return;
  }

  waiting[mode].push({
    ws,
    player: {
      playerId: ws.__playerId,
      username: ws.__username || "Player",
      sessionId: ws.__sessionId
    }
  });

  safeSend(ws, {
    type: "waiting",
    mode
  });
}

function endRoom(room, leavingPlayerId) {
  if (!room) return;

  rooms.delete(room.id);

  for (const player of roomPlayers(room)) {
    const ws = getClientByPlayerId(player.playerId);

    if (ws) {
      ws.__roomId = null;

      safeSend(ws, {
        type:
          player.playerId === leavingPlayerId
            ? "left-room"
            : "opponent-left"
      });
    }

    if (player.sessionId) {
      sessions.delete(player.sessionId);
    }
  }
}

function awardXP(playerId, amount) {
  const ws = getClientByPlayerId(playerId);

  if (!ws) return;

  ws.__xp = (ws.__xp || 0) + amount;

  safeSend(ws, {
    type: "xp-update",
    xp: ws.__xp
  });
}

function applyGameResult(room) {
  if (!room) return;

  let winnerId = null;

  if (room.mode === "face") {
    const aWins = room.roundWins[room.playerA.playerId] || 0;
    const bWins = room.roundWins[room.playerB.playerId] || 0;

    if (aWins > bWins) {
      winnerId = room.playerA.playerId;
    } else if (bWins > aWins) {
      winnerId = room.playerB.playerId;
    }
  } else {
    const aScore = room.scores[room.playerA.playerId] || 0;
    const bScore = room.scores[room.playerB.playerId] || 0;

    if (aScore > bScore) {
      winnerId = room.playerA.playerId;
    } else if (bScore > aScore) {
      winnerId = room.playerB.playerId;
    }
  }

  for (const player of roomPlayers(room)) {
    const ws = getClientByPlayerId(player.playerId);

    if (!ws) continue;

    const won = winnerId === player.playerId;

    if (won) {
      ws.__wins = (ws.__wins || 0) + 1;
      awardXP(player.playerId, 100);
    } else if (winnerId) {
      awardXP(player.playerId, 25);
    }

    safeSend(ws, {
      type: "game-over",
      winnerId,
      winnerUsername:
        winnerId
          ? getPlayer(room, winnerId)?.username || "Player"
          : null,
      scores: room.scores,
      roundWins: room.roundWins
    });
  }
}

function nextFaceRound(room) {
  if (!room || room.mode !== "face") return;

  room.roundScores = {};

  if (room.round >= room.totalRounds) {
    applyGameResult(room);
    return;
  }

  room.round++;

  room.targetEmoji =
    emojis[Math.floor(Math.random() * emojis.length)];

  for (const player of roomPlayers(room)) {
    const ws = getClientByPlayerId(player.playerId);

    safeSend(ws, {
      type: "next-round",
      round: room.round,
      targetEmoji: room.targetEmoji,
      roundWins: room.roundWins
    });
  }

  setTimeout(() => {
    const currentRoom = rooms.get(room.id);

    if (!currentRoom) return;

    for (const player of roomPlayers(currentRoom)) {
      const ws = getClientByPlayerId(player.playerId);

      safeSend(ws, {
        type: "face-start",
        round: currentRoom.round,
        targetEmoji: currentRoom.targetEmoji
      });
    }
  }, 400);
}

function nextHuntRound(room) {
  if (!room || room.mode !== "hunt") return;

  if (room.round >= room.totalRounds) {
    applyGameResult(room);
    return;
  }

  room.round++;

  room.huntItem =
    huntItems[Math.floor(Math.random() * huntItems.length)];

  room.huntStarted = true;

  for (const player of roomPlayers(room)) {
    const ws = getClientByPlayerId(player.playerId);

    safeSend(ws, {
      type: "next-hunt-round",
      round: room.round,
      item: room.huntItem
    });
  }
}

wss.on("connection", ws => {
  clients.add(ws);

  ws.__playerId = makeId();
  ws.__username = "Player";
  ws.__roomId = null;
  ws.__sessionId = null;
  ws.__xp = 0;
  ws.__wins = 0;

  safeSend(ws, {
    type: "connected",
    playerId: ws.__playerId
  });

  ws.on("message", raw => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const type = message.type;

    if (type === "set-username") {
      const username =
        String(message.username || "Player")
          .trim()
          .slice(0, 24);

      ws.__username = username || "Player";

      if (message.sessionId) {
        ws.__sessionId = String(message.sessionId);

        const existing = sessions.get(ws.__sessionId);

        if (existing) {
          const room = rooms.get(existing.roomId);

          if (room) {
            ws.__playerId = existing.playerId;
            ws.__roomId = existing.roomId;

            const player = getPlayer(room, existing.playerId);

            if (player) {
              player.username = ws.__username;
            }

            sessions.set(ws.__sessionId, {
              roomId: existing.roomId,
              playerId: existing.playerId,
              role: existing.role
            });

            safeSend(ws, {
              type: "session-restored",
              roomId: room.id,
              playerId: existing.playerId,
              opponentId:
                otherPlayer(room, existing.playerId)?.playerId || "",
              opponentUsername:
                otherPlayer(room, existing.playerId)?.username || "",
              mode: room.mode,
              round: room.round,
              totalRounds: room.totalRounds,
              targetEmoji: room.targetEmoji,
              huntItem: room.huntItem,
              scores: room.scores,
              roundWins: room.roundWins
            });

            sendRoomState(room);

            const opponent = otherPlayer(room, existing.playerId);

            if (opponent) {
              const opponentWs =
                getClientByPlayerId(opponent.playerId);

              safeSend(opponentWs, {
                type: "opponent-reconnected",
                opponentUsername: ws.__username
              });
            }

            return;
          }
        }
      }

      safeSend(ws, {
        type: "username-set",
        username: ws.__username
      });

      return;
    }

    if (type === "find-match") {
      const mode = String(message.mode || "face");

      if (!waiting[mode]) {
        safeSend(ws, {
          type: "error",
          message: "Invalid game mode."
        });

        return;
      }

      if (ws.__roomId) {
        const room = rooms.get(ws.__roomId);

        if (room) {
          sendRoomState(room);
          return;
        }
      }

      removeFromWaiting(ws);

      tryMatch(ws, mode);

      return;
    }

    if (type === "leave") {
      removeFromWaiting(ws);

      const room =
        ws.__roomId
          ? rooms.get(ws.__roomId)
          : null;

      if (room) {
        endRoom(room, ws.__playerId);
      }

      if (ws.__sessionId) {
        sessions.delete(ws.__sessionId);
      }

      ws.__roomId = null;

      safeSend(ws, {
        type: "left-room"
      });

      return;
    }

    if (type === "live-round-score") {
      const room =
        ws.__roomId
          ? rooms.get(ws.__roomId)
          : null;

      if (!room || room.mode !== "face") return;

      const opponent = otherPlayer(room, ws.__playerId);

      if (!opponent) return;

      const score = Math.max(
        0,
        Math.min(
          100,
          Number(message.score) || 0
        )
      );

      safeSend(
        getClientByPlayerId(opponent.playerId),
        {
          type: "live-opponent-score",
          score,
          round: room.round
        }
      );

      return;
    }

    if (type === "round-score") {
      const room =
        ws.__roomId
          ? rooms.get(ws.__roomId)
          : null;

      if (!room || room.mode !== "face") return;

      const round =
        Number(message.round) || room.round;

      if (round !== room.round) return;

      const score = Math.max(
        0,
        Math.min(
          100,
          Number(message.score) || 0
        )
      );

      room.roundScores[ws.__playerId] = score;

      const opponent = otherPlayer(room, ws.__playerId);

      safeSend(
        getClientByPlayerId(opponent?.playerId),
        {
          type: "opponent-score",
          score
        }
      );

      if (
        room.roundScores[room.playerA.playerId] !== undefined &&
        room.roundScores[room.playerB.playerId] !== undefined
      ) {
        const aScore =
          room.roundScores[room.playerA.playerId];

        const bScore =
          room.roundScores[room.playerB.playerId];

        let winnerId = null;

        if (aScore > bScore) {
          winnerId = room.playerA.playerId;
          room.roundWins[winnerId]++;
        } else if (bScore > aScore) {
          winnerId = room.playerB.playerId;
          room.roundWins[winnerId]++;
        }

        room.scores[room.playerA.playerId] += aScore;
        room.scores[room.playerB.playerId] += bScore;

        for (const player of roomPlayers(room)) {
          const wsPlayer =
            getClientByPlayerId(player.playerId);

          const yourScore =
            player.playerId === room.playerA.playerId
              ? aScore
              : bScore;

          const opponentScore =
            player.playerId === room.playerA.playerId
              ? bScore
              : aScore;

          safeSend(wsPlayer, {
            type: "round-result",
            round: room.round,
            yourRoundScore: yourScore,
            opponentRoundScore: opponentScore,
            roundWins: room.roundWins,
            winnerId
          });
        }
      }

      return;
    }

    if (type === "next-round") {
      const room =
        ws.__roomId
          ? rooms.get(ws.__roomId)
          : null;

      if (!room) return;

      if (room.mode === "face") {
        const opponent = otherPlayer(room, ws.__playerId);

        room.__nextReady =
          room.__nextReady || {};

        room.__nextReady[ws.__playerId] = true;

        if (
          opponent &&
          room.__nextReady[opponent.playerId]
        ) {
          room.__nextReady = {};

          nextFaceRound(room);
        }
      }

      return;
    }

    if (type === "hunt-found") {
      const room =
        ws.__roomId
          ? rooms.get(ws.__roomId)
          : null;

      if (!room || room.mode !== "hunt") return;

      const score = Math.max(
        0,
        Math.min(
          100,
          Number(message.score) || 100
        )
      );

      room.scores[ws.__playerId] += score;

      const opponent = otherPlayer(room, ws.__playerId);

      safeSend(
        getClientByPlayerId(opponent?.playerId),
        {
          type: "opponent-hunt-found",
          score
        }
      );

      safeSend(ws, {
        type: "hunt-success",
        score
      });

      nextHuntRound(room);

      return;
    }

    if (type === "hunt-skip") {
      const room =
        ws.__roomId
          ? rooms.get(ws.__roomId)
          : null;

      if (!room || room.mode !== "hunt") return;

      room.__skipReady =
        room.__skipReady || {};

      room.__skipReady[ws.__playerId] = true;

      const opponent = otherPlayer(room, ws.__playerId);

      safeSend(
        getClientByPlayerId(opponent?.playerId),
        {
          type: "opponent-skip"
        }
      );

      if (
        opponent &&
        room.__skipReady[opponent.playerId]
      ) {
        room.__skipReady = {};

        nextHuntRound(room);
      }

      return;
    }

    if (type === "chat-message") {
      const room =
        ws.__roomId
          ? rooms.get(ws.__roomId)
          : null;

      if (!room || room.mode !== "chat") return;

      const opponent = otherPlayer(room, ws.__playerId);

      safeSend(
        getClientByPlayerId(opponent?.playerId),
        {
          type: "chat-message",
          message: String(message.message || "").slice(0, 500)
        }
      );

      return;
    }

    if (type === "signal") {
      const room =
        ws.__roomId
          ? rooms.get(ws.__roomId)
          : null;

      if (!room) return;

      const opponent = otherPlayer(room, ws.__playerId);

      if (!opponent) return;

      safeSend(
        getClientByPlayerId(opponent.playerId),
        {
          type: "signal",
          signal: message.signal,
          from: ws.__playerId
        }
      );

      return;
    }

    if (type === "friend-request") {
      const targetUsername =
        String(message.username || "")
          .trim()
          .toLowerCase();

      if (!targetUsername) return;

      let targetWs = null;

      for (const client of clients) {
        if (
          client.__username &&
          client.__username.toLowerCase() ===
            targetUsername &&
          client.readyState === 1
        ) {
          targetWs = client;
          break;
        }
      }

      if (!targetWs) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message: "That player is not online."
        });

        return;
      }

      if (
        targetWs.__playerId === ws.__playerId
      ) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message: "You cannot add yourself."
        });

        return;
      }

      const targetId = targetWs.__playerId;

      if (!pendingFriends.has(targetId)) {
        pendingFriends.set(targetId, new Map());
      }

      pendingFriends
        .get(targetId)
        .set(ws.__playerId, {
          playerId: ws.__playerId,
          username: ws.__username
        });

      safeSend(targetWs, {
        type: "friend-request-received",
        username: ws.__username
      });

      safeSend(ws, {
        type: "friend-result",
        ok: true,
        message: "Friend request sent."
      });

      return;
    }

    if (type === "friend-accept") {
      const requesterId =
        String(message.playerId || "");

      const requesterWs =
        getClientByPlayerId(requesterId);

      if (!requesterWs) return;

      if (!friends.has(ws.__playerId)) {
        friends.set(ws.__playerId, new Map());
      }

      if (!friends.has(requesterId)) {
        friends.set(requesterId, new Map());
      }

      friends
        .get(ws.__playerId)
        .set(requesterId, {
          playerId: requesterId,
          username: requesterWs.__username
        });

      friends
        .get(requesterId)
        .set(ws.__playerId, {
          playerId: ws.__playerId,
          username: ws.__username
        });

      const pending =
        pendingFriends.get(ws.__playerId);

      if (pending) {
        pending.delete(requesterId);
      }

      safeSend(ws, {
        type: "friend-result",
        ok: true,
        message: "Friend request accepted."
      });

      safeSend(requesterWs, {
        type: "friend-result",
        ok: true,
        message: `${ws.__username} accepted your friend request.`
      });

      return;
    }

    if (type === "get-friends") {
      const myFriends =
        Array.from(
          friends.get(ws.__playerId)?.values() || []
        );

      const pending =
        Array.from(
          pendingFriends.get(ws.__playerId)?.values() || []
        );

      safeSend(ws, {
        type: "friends-list",
        friends: myFriends,
        pending
      });

      return;
    }

    if (type === "report") {
      reports.push({
        id: makeId(),
        from: ws.__username,
        target: String(message.username || ""),
        reason: String(message.reason || "").slice(0, 500),
        time: Date.now()
      });

      safeSend(ws, {
        type: "report-result",
        ok: true
      });

      return;
    }

    if (type === "skip") {
      const room =
        ws.__roomId
          ? rooms.get(ws.__roomId)
          : null;

      if (!room) {
        tryMatch(ws, message.mode || "face");
        return;
      }

      const oldRoom = room;

      endRoom(oldRoom, ws.__playerId);

      ws.__roomId = null;

      tryMatch(
        ws,
        message.mode || oldRoom.mode
      );

      return;
    }
  });

  ws.on("close", () => {
    clients.delete(ws);

    removeFromWaiting(ws);

    const room =
      ws.__roomId
        ? rooms.get(ws.__roomId)
        : null;

    if (!room) return;

    const playerId = ws.__playerId;

    room.connected[playerId] = false;

    /*
      IMPORTANT:
      We DO NOT delete the room when someone disconnects.

      This means accidentally losing Wi-Fi, refreshing,
      closing the browser temporarily, etc. does not kick
      the player out of the game.

      Their session remains alive so they can reconnect.
    */

    const opponent = otherPlayer(room, playerId);

    if (opponent) {
      const opponentWs =
        getClientByPlayerId(opponent.playerId);

      safeSend(opponentWs, {
        type: "opponent-temporarily-disconnected"
      });
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`EmojiTV running on port ${PORT}`);
});
