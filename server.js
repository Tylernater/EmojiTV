import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "EmojiTV",
    players: clients.size,
    rooms: rooms.size
  });
});

const wss = new WebSocketServer({ server });

const clients = new Set();
const rooms = new Map();
const sessions = new Map();

const waiting = {
  face: [],
  chat: [],
  hunt: [],
  pose: [],
  laugh: []
};

const users = new Map();

const dailyChallenges = [
  "Play 1 game",
  "Win a Face-Off",
  "Complete a Hunt"
];

const badges = [
  "First Win",
  "5 Win Streak",
  "10 Win Streak",
  "Perfect Face-Off",
  "Hunt Master",
  "10 Friends",
  "100 Games"
];

function safeSend(ws, data) {
  if (!ws) return;

  if (ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(data));
    } catch (err) {
      console.warn("Send error:", err.message);
    }
  }
}

function makeId() {
  return crypto.randomUUID();
}

function cleanUsername(name) {
  if (!name) return "Player";

  return String(name)
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 20) || "Player";
}

function getUser(username) {
  const name = cleanUsername(username);

  if (!users.has(name)) {
    users.set(name, {
      username: name,
      xp: 0,
      level: 1,
      wins: 0,
      losses: 0,
      games: 0,
      streak: 0,
      bestStreak: 0,
      friends: new Set(),
      pending: new Set()
    });
  }

  return users.get(name);
}

function userPayload(user) {
  if (!user) return null;

  return {
    username: user.username,
    xp: user.xp,
    level: user.level,
    wins: user.wins,
    losses: user.losses,
    games: user.games,
    streak: user.streak,
    bestStreak: user.bestStreak,
    friends: [...user.friends],
    pending: [...user.pending]
  };
}

function getClientByPlayerId(playerId) {
  for (const ws of clients) {
    if (ws.__playerId === playerId) {
      return ws;
    }
  }

  return null;
}

function otherPlayer(room, playerId) {
  if (!room) return null;

  return room.players.find(
    player => player.playerId !== playerId
  ) || null;
}

function roomForPlayer(playerId) {
  for (const room of rooms.values()) {
    if (
      room.players.some(
        player => player.playerId === playerId
      )
    ) {
      return room;
    }
  }

  return null;
}

function getRoomPlayer(room, playerId) {
  return room?.players.find(
    player => player.playerId === playerId
  ) || null;
}

function sendRoomState(room) {
  if (!room) return;

  for (const player of room.players) {
    const ws = getClientByPlayerId(player.playerId);

    if (!ws) continue;

    const opponent = otherPlayer(room, player.playerId);

    safeSend(ws, {
      type: "room-state",
      roomId: room.roomId,
      playerId: player.playerId,
      mode: room.mode,
      role: player.role,
      username: player.username,
      opponentUsername: opponent?.username || "Waiting...",
      target: room.target || null,
      score: room.scores[player.playerId] || 0,
      opponentScore: opponent
        ? room.scores[opponent.playerId] || 0
        : 0,
      started: room.started,
      round: room.round || 1
    });
  }
}

function removeFromWaiting(ws) {
  for (const mode of Object.keys(waiting)) {
    waiting[mode] = waiting[mode].filter(
      item => item.ws !== ws
    );
  }
}

function saveSession(room, player) {
  if (!player?.sessionId) return;

  sessions.set(player.sessionId, {
    roomId: room.roomId,
    playerId: player.playerId
  });
}

function restoreSession(ws, sessionId) {
  if (!sessionId) return false;

  const session = sessions.get(sessionId);

  if (!session) return false;

  const room = rooms.get(session.roomId);

  if (!room) {
    sessions.delete(sessionId);
    return false;
  }

  const player = getRoomPlayer(room, session.playerId);

  if (!player) {
    sessions.delete(sessionId);
    return false;
  }

  player.ws = ws;
  ws.__playerId = player.playerId;
  ws.__roomId = room.roomId;
  ws.__sessionId = sessionId;
  ws.__username = player.username;

  sendRoomState(room);

  const opponent = otherPlayer(room, player.playerId);

  if (opponent) {
    const opponentWs = getClientByPlayerId(
      opponent.playerId
    );

    safeSend(opponentWs, {
      type: "session-restored",
      playerId: player.playerId,
      opponentUsername: player.username
    });
  }

  safeSend(ws, {
    type: "session-restored",
    playerId: player.playerId,
    roomId: room.roomId,
    opponentUsername: opponent?.username || "Waiting..."
  });

  return true;
}

function endRoom(room, reason = "ended") {
  if (!room) return;

  rooms.delete(room.roomId);

  for (const player of room.players) {
    if (player.sessionId) {
      sessions.delete(player.sessionId);
    }

    const ws = player.ws;

    if (ws) {
      ws.__roomId = null;

      safeSend(ws, {
        type: "room-ended",
        reason
      });
    }
  }
}

function addXP(username, amount) {
  const user = getUser(username);

  user.xp += amount;

  while (user.xp >= user.level * 500) {
    user.xp -= user.level * 500;
    user.level++;
  }

  return user;
}

function recordGame(username, won) {
  const user = getUser(username);

  user.games++;

  if (won) {
    user.wins++;
    user.streak++;
    user.bestStreak = Math.max(
      user.bestStreak,
      user.streak
    );

    addXP(username, 100);
  } else {
    user.losses++;
    user.streak = 0;
    addXP(username, 25);
  }

  return user;
}

function createRoom(mode, a, b) {
  const roomId = makeId();

  const playerA = {
    playerId: makeId(),
    ws: a.ws,
    username: a.username,
    sessionId: a.sessionId,
    role: "a"
  };

  const playerB = {
    playerId: makeId(),
    ws: b.ws,
    username: b.username,
    sessionId: b.sessionId,
    role: "b"
  };

  const room = {
    roomId,
    mode,
    players: [playerA, playerB],
    started: true,
    target: null,
    scores: {
      [playerA.playerId]: 0,
      [playerB.playerId]: 0
    },
    round: 1,
    createdAt: Date.now()
  };

  rooms.set(roomId, room);

  a.ws.__playerId = playerA.playerId;
  a.ws.__roomId = roomId;
  a.ws.__sessionId = a.sessionId;

  b.ws.__playerId = playerB.playerId;
  b.ws.__roomId = roomId;
  b.ws.__sessionId = b.sessionId;

  saveSession(room, playerA);
  saveSession(room, playerB);

  return room;
}

function startMatch(mode, ws, username, sessionId) {
  if (!waiting[mode]) {
    safeSend(ws, {
      type: "error",
      message: "Unknown game mode."
    });

    return;
  }

  removeFromWaiting(ws);

  const existingRoom = roomForPlayer(ws.__playerId);

  if (existingRoom) {
    ws.__roomId = existingRoom.roomId;

    const player = getRoomPlayer(
      existingRoom,
      ws.__playerId
    );

    if (player) {
      player.ws = ws;
      player.username = username;
      player.sessionId = sessionId;

      saveSession(existingRoom, player);
    }

    sendRoomState(existingRoom);
    return;
  }

  const possibleOpponent = waiting[mode].find(
    item =>
      item.ws !== ws &&
      item.ws.readyState === 1
  );

  if (possibleOpponent) {
    waiting[mode] = waiting[mode].filter(
      item => item !== possibleOpponent
    );

    const room = createRoom(
      mode,
      {
        ws: possibleOpponent.ws,
        username: possibleOpponent.username,
        sessionId: possibleOpponent.sessionId
      },
      {
        ws,
        username,
        sessionId
      }
    );

    safeSend(possibleOpponent.ws, {
      type: "match-found",
      roomId: room.roomId,
      mode,
      playerId: room.players[0].playerId,
      role: "a",
      opponentUsername: username
    });

    safeSend(ws, {
      type: "match-found",
      roomId: room.roomId,
      mode,
      playerId: room.players[1].playerId,
      role: "b",
      opponentUsername: possibleOpponent.username
    });

    sendRoomState(room);

    return;
  }

  waiting[mode].push({
    ws,
    username,
    sessionId
  });

  safeSend(ws, {
    type: "waiting",
    mode
  });
}

wss.on("connection", ws => {
  clients.add(ws);

  ws.__playerId = null;
  ws.__roomId = null;
  ws.__sessionId = null;
  ws.__username = "Player";

  safeSend(ws, {
    type: "connected"
  });

  ws.on("message", raw => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      safeSend(ws, {
        type: "error",
        message: "Invalid message."
      });

      return;
    }

    const type = message.type;

    if (type === "set-username") {
      const username = cleanUsername(message.username);
      const sessionId =
        message.sessionId || makeId();

      ws.__username = username;
      ws.__sessionId = sessionId;

      const restored = restoreSession(
        ws,
        sessionId
      );

      if (!restored) {
        ws.__playerId = ws.__playerId || makeId();

        getUser(username);

        safeSend(ws, {
          type: "username-set",
          username,
          sessionId,
          playerId: ws.__playerId
        });
      } else {
        safeSend(ws, {
          type: "username-set",
          username,
          sessionId,
          playerId: ws.__playerId
        });
      }

      return;
    }

    if (type === "find-match") {
      const mode = String(
        message.mode || "face"
      ).toLowerCase();

      const username = cleanUsername(
        message.username || ws.__username
      );

      const sessionId =
        message.sessionId ||
        ws.__sessionId ||
        makeId();

      ws.__username = username;
      ws.__sessionId = sessionId;

      getUser(username);

      startMatch(
        mode,
        ws,
        username,
        sessionId
      );

      return;
    }

    if (type === "leave") {
      removeFromWaiting(ws);

      const room = rooms.get(ws.__roomId);

      if (room) {
        const player = getRoomPlayer(
          room,
          ws.__playerId
        );

        if (player?.sessionId) {
          sessions.delete(
            player.sessionId
          );
        }

        const opponent = otherPlayer(
          room,
          ws.__playerId
        );

        if (opponent) {
          const opponentWs =
            getClientByPlayerId(
              opponent.playerId
            );

          safeSend(opponentWs, {
            type: "opponent-left"
          });
        }

        endRoom(room, "left");
      }

      ws.__roomId = null;

      safeSend(ws, {
        type: "left"
      });

      return;
    }

    if (type === "signal") {
      const room = rooms.get(
        ws.__roomId
      );

      if (!room) return;

      const opponent = otherPlayer(
        room,
        ws.__playerId
      );

      if (!opponent) return;

      const opponentWs =
        getClientByPlayerId(
          opponent.playerId
        );

      safeSend(opponentWs, {
        type: "signal",
        signal: message.signal
      });

      return;
    }

    if (type === "face-score") {
      const room = rooms.get(
        ws.__roomId
      );

      if (!room) return;

      const score = Math.max(
        0,
        Math.min(
          100,
          Number(message.score) || 0
        )
      );

      room.scores[ws.__playerId] = score;

      const opponent =
        otherPlayer(
          room,
          ws.__playerId
        );

      const opponentWs =
        opponent
          ? getClientByPlayerId(
              opponent.playerId
            )
          : null;

      safeSend(opponentWs, {
        type: "opponent-score",
        score
      });

      safeSend(ws, {
        type: "score-updated",
        score
      });

      return;
    }

    if (type === "face-round-finished") {
      const room = rooms.get(
        ws.__roomId
      );

      if (!room) return;

      const opponent =
        otherPlayer(
          room,
          ws.__playerId
        );

      if (!opponent) return;

      const aScore =
        room.scores[
          room.players[0].playerId
        ] || 0;

      const bScore =
        room.scores[
          room.players[1].playerId
        ] || 0;

      let winner = null;

      if (aScore > bScore) {
        winner =
          room.players[0].playerId;
      } else if (bScore > aScore) {
        winner =
          room.players[1].playerId;
      }

      for (const player of room.players) {
        const won =
          winner === player.playerId;

        recordGame(
          player.username,
          won
        );

        const playerWs =
          getClientByPlayerId(
            player.playerId
          );

        safeSend(playerWs, {
          type: "round-result",
          winner,
          myScore:
            room.scores[
              player.playerId
            ] || 0,
          opponentScore:
            room.scores[
              otherPlayer(
                room,
                player.playerId
              )?.playerId
            ] || 0,
          progress:
            userPayload(
              getUser(player.username)
            )
        });
      }

      return;
    }

    if (type === "chat-message") {
      const room = rooms.get(
        ws.__roomId
      );

      if (!room) return;

      const text = String(
        message.text || ""
      )
        .replace(/[<>]/g, "")
        .trim()
        .slice(0, 300);

      if (!text) return;

      const opponent =
        otherPlayer(
          room,
          ws.__playerId
        );

      if (!opponent) return;

      const opponentWs =
        getClientByPlayerId(
          opponent.playerId
        );

      safeSend(opponentWs, {
        type: "chat-message",
        username: ws.__username,
        text
      });

      return;
    }

    if (type === "hunt-found") {
      const room = rooms.get(
        ws.__roomId
      );

      if (!room) return;

      const opponent =
        otherPlayer(
          room,
          ws.__playerId
        );

      if (!opponent) return;

      const points =
        Math.max(
          0,
          Number(message.points) || 100
        );

      room.scores[ws.__playerId] =
        (room.scores[ws.__playerId] || 0) +
        points;

      const opponentWs =
        getClientByPlayerId(
          opponent.playerId
        );

      safeSend(ws, {
        type: "hunt-success",
        score:
          room.scores[ws.__playerId]
      });

      safeSend(opponentWs, {
        type: "opponent-hunt-success",
        score:
          room.scores[ws.__playerId]
      });

      return;
    }

    if (type === "hunt-timeout") {
      const room = rooms.get(
        ws.__roomId
      );

      if (!room) return;

      const opponent =
        otherPlayer(
          room,
          ws.__playerId
        );

      if (!opponent) return;

      const opponentWs =
        getClientByPlayerId(
          opponent.playerId
        );

      safeSend(opponentWs, {
        type: "hunt-opponent-timeout"
      });

      safeSend(ws, {
        type: "hunt-timeout"
      });

      return;
    }

    if (type === "skip") {
      const room = rooms.get(
        ws.__roomId
      );

      if (!room) return;

      const opponent =
        otherPlayer(
          room,
          ws.__playerId
        );

      if (!opponent) return;

      const opponentWs =
        getClientByPlayerId(
          opponent.playerId
        );

      safeSend(opponentWs, {
        type: "skip-requested",
        username: ws.__username
      });

      safeSend(ws, {
        type: "skip-requested",
        username: ws.__username
      });

      return;
    }

    if (type === "friend-request") {
      const targetName = cleanUsername(
        message.username ||
        message.to
      );

      const fromUser = getUser(
        ws.__username
      );

      const targetUser =
        users.get(targetName);

      if (!targetUser) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message:
            "That user is not online."
        });

        return;
      }

      if (
        targetUser.username ===
        fromUser.username
      ) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message:
            "You cannot add yourself."
        });

        return;
      }

      if (
        fromUser.friends.has(
          targetUser.username
        )
      ) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message:
            "You are already friends."
        });

        return;
      }

      targetUser.pending.add(
        fromUser.username
      );

      safeSend(ws, {
        type: "friend-result",
        ok: true,
        message:
          "Friend request sent."
      });

      const targetWs =
        [...clients].find(
          client =>
            client.__username ===
            targetUser.username
        );

      safeSend(targetWs, {
        type: "friend-request-received",
        username:
          fromUser.username
      });

      return;
    }

    if (type === "friend-accept") {
      const requester =
        cleanUsername(
          message.username ||
          message.from
        );

      const me = getUser(
        ws.__username
      );

      const requesterUser =
        users.get(requester);

      if (!requesterUser) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message:
            "That user is no longer online."
        });

        return;
      }

      if (
        !me.pending.has(requester)
      ) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message:
            "Friend request not found."
        });

        return;
      }

      me.pending.delete(
        requester
      );

      me.friends.add(
        requester
      );

      requesterUser.friends.add(
        me.username
      );

      safeSend(ws, {
        type: "friend-result",
        ok: true,
        message:
          "Friend request accepted.",
        friends:
          [...me.friends],
        pending:
          [...me.pending]
      });

      const requesterWs =
        [...clients].find(
          client =>
            client.__username ===
            requester
        );

      safeSend(requesterWs, {
        type: "friend-result",
        ok: true,
        message:
          `${me.username} accepted your friend request.`,
        friends:
          [...requesterUser.friends],
        pending:
          [...requesterUser.pending]
      });

      return;
    }

    if (type === "get-friends") {
      const user = getUser(
        ws.__username
      );

      safeSend(ws, {
        type: "friends-list",
        friends:
          [...user.friends],
        pending:
          [...user.pending]
      });

      return;
    }

    if (type === "get-progress") {
      const user = getUser(
        ws.__username
      );

      safeSend(ws, {
        type: "progress",
        data: userPayload(user),
        dailyChallenges,
        badges
      });

      return;
    }

    if (type === "leaderboard") {
      const list = [
        ...users.values()
      ]
        .sort(
          (a, b) =>
            (b.xp + b.wins * 100) -
            (a.xp + a.wins * 100)
        )
        .slice(0, 20)
        .map((user, index) => ({
          rank: index + 1,
          username:
            user.username,
          xp: user.xp,
          level:
            user.level,
          wins:
            user.wins,
          games:
            user.games
        }));

      safeSend(ws, {
        type: "leaderboard",
        users: list
      });

      return;
    }

    if (type === "invite") {
      const targetName = cleanUsername(
        message.username ||
        message.to
      );

      const targetWs =
        [...clients].find(
          client =>
            client.__username ===
            targetName
        );

      if (!targetWs) {
        safeSend(ws, {
          type: "invite-result",
          ok: false,
          message:
            "That player is not online."
        });

        return;
      }

      safeSend(targetWs, {
        type: "invite-received",
        from:
          ws.__username,
        mode:
          message.mode || "face"
      });

      safeSend(ws, {
        type: "invite-result",
        ok: true
      });

      return;
    }

    if (type === "ping") {
      safeSend(ws, {
        type: "pong"
      });

      return;
    }
  });

  ws.on("close", () => {
    clients.delete(ws);

    removeFromWaiting(ws);

    /*
      IMPORTANT:
      Do NOT end the game when a player disconnects.

      The session stays alive so the player can reconnect
      after Wi-Fi problems, browser freezes, or accidental
      connection drops.
    */

    const room = rooms.get(
      ws.__roomId
    );

    if (room) {
      const player = getRoomPlayer(
        room,
        ws.__playerId
      );

      if (player) {
        player.ws = null;
      }

      const opponent =
        otherPlayer(
          room,
          ws.__playerId
        );

      if (opponent) {
        const opponentWs =
          getClientByPlayerId(
            opponent.playerId
          );

        safeSend(opponentWs, {
          type:
            "opponent-temporarily-disconnected"
        });
      }
    }
  });
});

setInterval(() => {
  for (const ws of clients) {
    if (ws.readyState === 1) {
      safeSend(ws, {
        type: "server-ping"
      });
    }
  }
}, 25000);

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `EmojiTV server running on port ${PORT}`
    );
  }
);
