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

/*
==========================================================
WAITING QUEUES

These are completely independent from the Friends system.

A player does NOT need to be friends with another player
to enter one of these queues.
==========================================================
*/

const waiting = {
  face: [],
  chat: [],
  hunt: [],
  pose: [],
  laugh: []
};

/*
==========================================================
USER DATA
==========================================================
*/

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

/*
==========================================================
HELPERS
==========================================================
*/

function safeSend(ws, data) {
  if (!ws || ws.readyState !== 1) return;

  try {
    ws.send(JSON.stringify(data));
  } catch (error) {
    console.warn("WebSocket send error:", error.message);
  }
}

function makeId() {
  return crypto.randomUUID();
}

function cleanUsername(name) {
  if (!name) return "Player";

  return (
    String(name)
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, 20) || "Player"
  );
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

function getPlayerById(room, playerId) {
  if (!room) return null;

  return (
    room.players.find(
      player => player.playerId === playerId
    ) || null
  );
}

function getOpponent(room, playerId) {
  if (!room) return null;

  return (
    room.players.find(
      player => player.playerId !== playerId
    ) || null
  );
}

function getRoomForPlayer(playerId) {
  if (!playerId) return null;

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

/*
==========================================================
ROOM STATE
==========================================================
*/

function sendRoomState(room) {
  if (!room) return;

  for (const player of room.players) {
    const ws = getClientByPlayerId(player.playerId);

    if (!ws) continue;

    const opponent = getOpponent(
      room,
      player.playerId
    );

    safeSend(ws, {
      type: "room-state",

      roomId: room.roomId,

      playerId: player.playerId,

      mode: room.mode,

      role: player.role,

      username: player.username,

      opponentUsername:
        opponent?.username || "Waiting...",

      target: room.target || null,

      score:
        room.scores[player.playerId] || 0,

      opponentScore:
        opponent
          ? room.scores[opponent.playerId] || 0
          : 0,

      started: room.started,

      round: room.round || 1
    });
  }
}

/*
==========================================================
WAITING QUEUE MANAGEMENT
==========================================================
*/

function removeFromWaiting(ws) {
  for (const mode of Object.keys(waiting)) {
    waiting[mode] = waiting[mode].filter(
      entry => entry.ws !== ws
    );
  }
}

function cleanWaitingQueues() {
  for (const mode of Object.keys(waiting)) {
    waiting[mode] = waiting[mode].filter(entry => {
      return (
        entry.ws &&
        entry.ws.readyState === 1 &&
        !entry.ws.__roomId
      );
    });
  }
}

/*
==========================================================
SESSION MANAGEMENT

Sessions allow a player to reconnect after a temporary
connection/Wi-Fi problem without immediately destroying
the game room.
==========================================================
*/

function saveSession(room, player) {
  if (!room || !player?.sessionId) return;

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

  const player = getPlayerById(
    room,
    session.playerId
  );

  if (!player) {
    sessions.delete(sessionId);
    return false;
  }

  /*
  Replace the old WebSocket connection with
  the player's new connection.
  */

  player.ws = ws;

  ws.__playerId = player.playerId;
  ws.__roomId = room.roomId;
  ws.__sessionId = sessionId;
  ws.__username = player.username;

  saveSession(room, player);

  safeSend(ws, {
    type: "session-restored",

    playerId: player.playerId,

    roomId: room.roomId,

    mode: room.mode,

    role: player.role,

    opponentUsername:
      getOpponent(room, player.playerId)
        ?.username || "Waiting..."
  });

  sendRoomState(room);

  const opponent = getOpponent(
    room,
    player.playerId
  );

  if (opponent) {
    const opponentWs =
      getClientByPlayerId(
        opponent.playerId
      );

    safeSend(opponentWs, {
      type: "opponent-reconnected",

      opponentUsername:
        player.username,

      playerId:
        player.playerId
    });
  }

  return true;
}

/*
==========================================================
ROOM ENDING

A room is ended ONLY when someone deliberately leaves,
or when the game itself finishes.
A temporary WebSocket disconnect does NOT end the room.
==========================================================
*/

function endRoom(room, reason = "ended") {
  if (!room) return;

  rooms.delete(room.roomId);

  for (const player of room.players) {
    if (player.sessionId) {
      sessions.delete(player.sessionId);
    }

    const ws =
      getClientByPlayerId(
        player.playerId
      );

    if (ws) {
      ws.__roomId = null;

      safeSend(ws, {
        type: "room-ended",
        reason
      });
    }
  }
}

/*
==========================================================
PROGRESS
==========================================================
*/

function addXP(username, amount) {
  const user = getUser(username);

  user.xp += amount;

  while (
    user.xp >= user.level * 500
  ) {
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

/*
==========================================================
ROOM CREATION

This is the important part for RANDOM MATCHMAKING.

Player A and Player B can be complete strangers.

No friend relationship is checked here.
==========================================================
*/

function createRoom(mode, first, second) {
  const roomId = makeId();

  const playerA = {
    playerId: makeId(),

    ws: first.ws,

    username: first.username,

    sessionId: first.sessionId,

    role: "a"
  };

  const playerB = {
    playerId: makeId(),

    ws: second.ws,

    username: second.username,

    sessionId: second.sessionId,

    role: "b"
  };

  const room = {
    roomId,

    mode,

    players: [
      playerA,
      playerB
    ],

    started: true,

    target: null,

    scores: {
      [playerA.playerId]: 0,
      [playerB.playerId]: 0
    },

    round: 1,

    createdAt: Date.now()
  };

  rooms.set(
    roomId,
    room
  );

  first.ws.__playerId =
    playerA.playerId;

  first.ws.__roomId =
    roomId;

  first.ws.__sessionId =
    first.sessionId;

  second.ws.__playerId =
    playerB.playerId;

  second.ws.__roomId =
    roomId;

  second.ws.__sessionId =
    second.sessionId;

  saveSession(
    room,
    playerA
  );

  saveSession(
    room,
    playerB
  );

  return room;
}

/*
==========================================================
RANDOM MATCHMAKING

The player chooses a game mode.

They are placed into that mode's waiting queue.

The next RANDOM PLAYER who chooses the same mode
gets matched with them.

FRIENDS ARE NOT INVOLVED.
==========================================================
*/

function startMatch(
  mode,
  ws,
  username,
  sessionId
) {
  if (!waiting[mode]) {
    safeSend(ws, {
      type: "error",

      message:
        "That game mode is not available."
    });

    return;
  }

  /*
  If the player is already in a room,
  don't create another room.
  */

  const existingRoom =
    getRoomForPlayer(
      ws.__playerId
    );

  if (existingRoom) {
    const existingPlayer =
      getPlayerById(
        existingRoom,
        ws.__playerId
      );

    if (existingPlayer) {
      existingPlayer.ws = ws;

      existingPlayer.username =
        username;

      existingPlayer.sessionId =
        sessionId;

      ws.__roomId =
        existingRoom.roomId;

      ws.__sessionId =
        sessionId;

      saveSession(
        existingRoom,
        existingPlayer
      );
    }

    sendRoomState(
      existingRoom
    );

    return;
  }

  /*
  Remove this WebSocket from any previous queue.
  */

  removeFromWaiting(ws);

  cleanWaitingQueues();

  /*
  Find ANY available random player
  waiting for this exact game mode.
  */

  let opponentIndex = -1;

  for (
    let i = 0;
    i < waiting[mode].length;
    i++
  ) {
    const entry =
      waiting[mode][i];

    if (
      entry.ws &&
      entry.ws !== ws &&
      entry.ws.readyState === 1 &&
      !entry.ws.__roomId
    ) {
      opponentIndex = i;
      break;
    }
  }

  /*
  NO RANDOM OPPONENT YET:
  put this player into the queue.
  */

  if (opponentIndex === -1) {
    waiting[mode].push({
      ws,

      username,

      sessionId
    });

    safeSend(ws, {
      type: "waiting",

      mode,

      message:
        "Waiting for a random opponent..."
    });

    return;
  }

  /*
  RANDOM OPPONENT FOUND.
  */

  const opponent =
    waiting[mode].splice(
      opponentIndex,
      1
    )[0];

  /*
  Double-check that the opponent is still usable.
  */

  if (
    !opponent ||
    !opponent.ws ||
    opponent.ws.readyState !== 1 ||
    opponent.ws.__roomId
  ) {
    return startMatch(
      mode,
      ws,
      username,
      sessionId
    );
  }

  /*
  CREATE THE GAME ROOM.
  */

  const room = createRoom(
    mode,

    {
      ws: opponent.ws,

      username:
        opponent.username,

      sessionId:
        opponent.sessionId
    },

    {
      ws,

      username,

      sessionId
    }
  );

  /*
  Tell Player A they found a random opponent.
  */

  safeSend(
    opponent.ws,
    {
      type: "match-found",

      roomId:
        room.roomId,

      mode,

      playerId:
        room.players[0].playerId,

      role: "a",

      opponentUsername:
        username
    }
  );

  /*
  Tell Player B they found a random opponent.
  */

  safeSend(
    ws,
    {
      type: "match-found",

      roomId:
        room.roomId,

      mode,

      playerId:
        room.players[1].playerId,

      role: "b",

      opponentUsername:
        opponent.username
    }
  );

  /*
  Send the complete room state to both players.
  */

  sendRoomState(room);
}

/*
==========================================================
WEBSOCKET CONNECTION
==========================================================
*/

wss.on("connection", ws => {
  clients.add(ws);

  ws.__playerId = null;

  ws.__roomId = null;

  ws.__sessionId = null;

  ws.__username = "Player";

  safeSend(ws, {
    type: "connected"
  });

  /*
  ========================================================
  MESSAGE HANDLER
  ========================================================
  */

  ws.on("message", raw => {
    let message;

    try {
      message =
        JSON.parse(
          raw.toString()
        );
    } catch {
      safeSend(ws, {
        type: "error",

        message:
          "Invalid server message."
      });

      return;
    }

    const type =
      message.type;

    /*
    ======================================================
    SET USERNAME
    ======================================================
    */

    if (
      type ===
      "set-username"
    ) {
      const username =
        cleanUsername(
          message.username
        );

      const sessionId =
        message.sessionId ||
        makeId();

      ws.__username =
        username;

      ws.__sessionId =
        sessionId;

      /*
      Try restoring an old game first.
      */

      const restored =
        restoreSession(
          ws,
          sessionId
        );

      if (!restored) {
        ws.__playerId =
          ws.__playerId ||
          makeId();

        getUser(username);

        safeSend(ws, {
          type:
            "username-set",

          username,

          sessionId,

          playerId:
            ws.__playerId
        });
      } else {
        safeSend(ws, {
          type:
            "username-set",

          username,

          sessionId,

          playerId:
            ws.__playerId
        });
      }

      return;
    }

    /*
    ======================================================
    FIND RANDOM MATCH
    ======================================================
    */

    if (
      type ===
      "find-match"
    ) {
      const mode =
        String(
          message.mode ||
          "face"
        ).toLowerCase();

      const username =
        cleanUsername(
          message.username ||
          ws.__username
        );

      const sessionId =
        message.sessionId ||
        ws.__sessionId ||
        makeId();

      ws.__username =
        username;

      ws.__sessionId =
        sessionId;

      getUser(username);

      startMatch(
        mode,
        ws,
        username,
        sessionId
      );

      return;
    }

    /*
    ======================================================
    LEAVE GAME
    ======================================================
    */

    if (
      type ===
      "leave"
    ) {
      removeFromWaiting(ws);

      const room =
        rooms.get(
          ws.__roomId
        );

      if (room) {
        const player =
          getPlayerById(
            room,
            ws.__playerId
          );

        if (
          player?.sessionId
        ) {
          sessions.delete(
            player.sessionId
          );
        }

        const opponent =
          getOpponent(
            room,
            ws.__playerId
          );

        if (opponent) {
          const opponentWs =
            getClientByPlayerId(
              opponent.playerId
            );

          safeSend(
            opponentWs,
            {
              type:
                "opponent-left"
            }
          );
        }

        endRoom(
          room,
          "left"
        );
      }

      ws.__roomId = null;

      safeSend(ws, {
        type: "left"
      });

      return;
    }

    /*
    ======================================================
    WEBRTC SIGNALING
    ======================================================

    This forwards:

    - Offers
    - Answers
    - ICE candidates

    from one random player directly to their opponent.

    The server NEVER needs to inspect the camera or microphone.
    ======================================================
    */

    if (
      type ===
      "signal"
    ) {
      const room =
        rooms.get(
          ws.__roomId
        );

      if (!room) {
        return;
      }

      const opponent =
        getOpponent(
          room,
          ws.__playerId
        );

      if (!opponent) {
        return;
      }

      const opponentWs =
        getClientByPlayerId(
          opponent.playerId
        );

      if (!opponentWs) {
        return;
      }

      safeSend(
        opponentWs,
        {
          type: "signal",

          signal:
            message.signal
        }
      );

      return;
    }

    /*
    ======================================================
    FACE SCORE
    ======================================================
    */

    if (
      type ===
      "face-score"
    ) {
      const room =
        rooms.get(
          ws.__roomId
        );

      if (!room) return;

      const score =
        Math.max(
          0,
          Math.min(
            100,
            Number(
              message.score
            ) || 0
          )
        );

      room.scores[
        ws.__playerId
      ] = score;

      const opponent =
        getOpponent(
          room,
          ws.__playerId
        );

      if (!opponent) return;

      const opponentWs =
        getClientByPlayerId(
          opponent.playerId
        );

      safeSend(
        opponentWs,
        {
          type:
            "opponent-score",

          score
        }
      );

      safeSend(
        ws,
        {
          type:
            "score-updated",

          score
        }
      );

      return;
    }

    /*
    ======================================================
    FACE ROUND FINISHED
    ======================================================
    */

    if (
      type ===
      "face-round-finished"
    ) {
      const room =
        rooms.get(
          ws.__roomId
        );

      if (!room) return;

      const playerA =
        room.players[0];

      const playerB =
        room.players[1];

      const scoreA =
        room.scores[
          playerA.playerId
        ] || 0;

      const scoreB =
        room.scores[
          playerB.playerId
        ] || 0;

      let winner = null;

      if (scoreA > scoreB) {
        winner =
          playerA.playerId;
      }

      if (scoreB > scoreA) {
        winner =
          playerB.playerId;
      }

      for (
        const player
        of room.players
      ) {
        const won =
          winner ===
          player.playerId;

        recordGame(
          player.username,
          won
        );

        const playerWs =
          getClientByPlayerId(
            player.playerId
          );

        const opponent =
          getOpponent(
            room,
            player.playerId
          );

        safeSend(
          playerWs,
          {
            type:
              "round-result",

            winner,

            myScore:
              room.scores[
                player.playerId
              ] || 0,

            opponentScore:
              opponent
                ? room.scores[
                    opponent.playerId
                  ] || 0
                : 0,

            progress:
              userPayload(
                getUser(
                  player.username
                )
              )
          }
        );
      }

      return;
    }

    /*
    ======================================================
    CHAT
    ======================================================
    */

    if (
      type ===
      "chat-message"
    ) {
      const room =
        rooms.get(
          ws.__roomId
        );

      if (!room) return;

      const text =
        String(
          message.text || ""
        )
          .replace(
            /[<>]/g,
            ""
          )
          .trim()
          .slice(
            0,
            300
          );

      if (!text) return;

      const opponent =
        getOpponent(
          room,
          ws.__playerId
        );

      if (!opponent) return;

      const opponentWs =
        getClientByPlayerId(
          opponent.playerId
        );

      safeSend(
        opponentWs,
        {
          type:
            "chat-message",

          username:
            ws.__username,

          text
        }
      );

      return;
    }

    /*
    ======================================================
    HUNT FOUND
    ======================================================
    */

    if (
      type ===
      "hunt-found"
    ) {
      const room =
        rooms.get(
          ws.__roomId
        );

      if (!room) return;

      const opponent =
        getOpponent(
          room,
          ws.__playerId
        );

      if (!opponent) return;

      const points =
        Math.max(
          0,
          Number(
            message.points
          ) || 100
        );

      room.scores[
        ws.__playerId
      ] =
        (
          room.scores[
            ws.__playerId
          ] || 0
        ) + points;

      const opponentWs =
        getClientByPlayerId(
          opponent.playerId
        );

      safeSend(
        ws,
        {
          type:
            "hunt-success",

          score:
            room.scores[
              ws.__playerId
            ]
        }
      );

      safeSend(
        opponentWs,
        {
          type:
            "opponent-hunt-success",

          score:
            room.scores[
              ws.__playerId
            ]
        }
      );

      return;
    }

    /*
    ======================================================
    HUNT TIMEOUT
    ======================================================
    */

    if (
      type ===
      "hunt-timeout"
    ) {
      const room =
        rooms.get(
          ws.__roomId
        );

      if (!room) return;

      const opponent =
        getOpponent(
          room,
          ws.__playerId
        );

      if (!opponent) return;

      const opponentWs =
        getClientByPlayerId(
          opponent.playerId
        );

      safeSend(
        opponentWs,
        {
          type:
            "hunt-opponent-timeout"
        }
      );

      safeSend(
        ws,
        {
          type:
            "hunt-timeout"
        }
      );

      return;
    }

    /*
    ======================================================
    SKIP
    ======================================================
    */

    if (
      type ===
      "skip"
    ) {
      const room =
        rooms.get(
          ws.__roomId
        );

      if (!room) return;

      const opponent =
        getOpponent(
          room,
          ws.__playerId
        );

      if (!opponent) return;

      const opponentWs =
        getClientByPlayerId(
          opponent.playerId
        );

      safeSend(
        opponentWs,
        {
          type:
            "skip-requested",

          username:
            ws.__username
        }
      );

      safeSend(
        ws,
        {
          type:
            "skip-requested",

          username:
            ws.__username
        }
      );

      return;
    }

    /*
    ======================================================
    FRIEND REQUEST

    FRIENDS ARE SEPARATE FROM RANDOM MATCHMAKING.
    ======================================================
    */

    if (
      type ===
      "friend-request"
    ) {
      const targetName =
        cleanUsername(
          message.username ||
          message.to
        );

      const fromUser =
        getUser(
          ws.__username
        );

      const targetUser =
        users.get(
          targetName
        );

      if (!targetUser) {
        safeSend(
          ws,
          {
            type:
              "friend-result",

            ok: false,

            message:
              "That user is not online."
          }
        );

        return;
      }

      if (
        targetUser.username ===
        fromUser.username
      ) {
        safeSend(
          ws,
          {
            type:
              "friend-result",

            ok: false,

            message:
              "You cannot add yourself."
          }
        );

        return;
      }

      if (
        fromUser.friends.has(
          targetUser.username
        )
      ) {
        safeSend(
          ws,
          {
            type:
              "friend-result",

            ok: false,

            message:
              "You are already friends."
          }
        );

        return;
      }

      targetUser.pending.add(
        fromUser.username
      );

      safeSend(
        ws,
        {
          type:
            "friend-result",

          ok: true,

          message:
            "Friend request sent."
        }
      );

      const targetWs =
        [...clients].find(
          client =>
            client.__username ===
            targetUser.username
        );

      safeSend(
        targetWs,
        {
          type:
            "friend-request-received",

          username:
            fromUser.username
        }
      );

      return;
    }

    /*
    ======================================================
    ACCEPT FRIEND REQUEST
    ======================================================
    */

    if (
      type ===
      "friend-accept"
    ) {
      const requester =
        cleanUsername(
          message.username ||
          message.from
        );

      const me =
        getUser(
          ws.__username
        );

      const requesterUser =
        users.get(
          requester
        );

      if (!requesterUser) {
        safeSend(
          ws,
          {
            type:
              "friend-result",

            ok: false,

            message:
              "That user is no longer online."
          }
        );

        return;
      }

      if (
        !me.pending.has(
          requester
        )
      ) {
        safeSend(
          ws,
          {
            type:
              "friend-result",

            ok: false,

            message:
              "Friend request not found."
          }
        );

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

      safeSend(
        ws,
        {
          type:
            "friend-result",

          ok: true,

          message:
            "Friend request accepted.",

          friends:
            [...me.friends],

          pending:
            [...me.pending]
        }
      );

      const requesterWs =
        [...clients].find(
          client =>
            client.__username ===
            requester
        );

      safeSend(
        requesterWs,
        {
          type:
            "friend-result",

          ok: true,

          message:
            `${me.username} accepted your friend request.`,

          friends:
            [...requesterUser.friends],

          pending:
            [...requesterUser.pending]
        }
      );

      return;
    }

    /*
    ======================================================
    GET FRIENDS
    ======================================================
    */

    if (
      type ===
      "get-friends"
    ) {
      const user =
        getUser(
          ws.__username
        );

      safeSend(
        ws,
        {
          type:
            "friends-list",

          friends:
            [...user.friends],

          pending:
            [...user.pending]
        }
      );

      return;
    }

    /*
    ======================================================
    GET PROGRESS
    ======================================================
    */

    if (
      type ===
      "get-progress"
    ) {
      const user =
        getUser(
          ws.__username
        );

      safeSend(
        ws,
        {
          type:
            "progress",

          data:
            userPayload(
              user
            ),

          dailyChallenges,

          badges
        }
      );

      return;
    }

    /*
    ======================================================
    LEADERBOARD
    ======================================================
    */

    if (
      type ===
      "leaderboard"
    ) {
      const leaderboard =
        [
          ...users.values()
        ]
          .sort(
            (a, b) =>
              (
                b.xp +
                b.wins * 100
              ) -
              (
                a.xp +
                a.wins * 100
              )
          )
          .slice(
            0,
            20
          )
          .map(
            (user, index) => ({
              rank:
                index + 1,

              username:
                user.username,

              xp:
                user.xp,

              level:
                user.level,

              wins:
                user.wins,

              games:
                user.games
            })
          );

      safeSend(
        ws,
        {
          type:
            "leaderboard",

          users:
            leaderboard
        }
      );

      return;
    }

    /*
    ======================================================
    INVITES

    These are optional and are NOT required for
    random matchmaking.
    ======================================================
    */

    if (
      type ===
      "invite"
    ) {
      const targetName =
        cleanUsername(
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
        safeSend(
          ws,
          {
            type:
              "invite-result",

            ok: false,

            message:
              "That player is not online."
          }
        );

        return;
      }

      safeSend(
        targetWs,
        {
          type:
            "invite-received",

          from:
            ws.__username,

          mode:
            message.mode ||
            "face"
        }
      );

      safeSend(
        ws,
        {
          type:
            "invite-result",

          ok: true
        }
      );

      return;
    }

    /*
    ======================================================
    PING
    ======================================================
    */

    if (
      type ===
      "ping"
    ) {
      safeSend(
        ws,
        {
          type:
            "pong"
        }
      );

      return;
    }
  });

  /*
  ========================================================
  CONNECTION CLOSED
  ========================================================

  DO NOT destroy the player's game room.

  Their session remains alive so the browser can reconnect.
  ========================================================
  */

  ws.on("close", () => {
    clients.delete(ws);

    removeFromWaiting(ws);

    const room =
      rooms.get(
        ws.__roomId
      );

    if (!room) {
      return;
    }

    const player =
      getPlayerById(
        room,
        ws.__playerId
      );

    if (player) {
      player.ws = null;
    }

    const opponent =
      getOpponent(
        room,
        ws.__playerId
      );

    if (opponent) {
      const opponentWs =
        getClientByPlayerId(
          opponent.playerId
        );

      safeSend(
        opponentWs,
        {
          type:
            "opponent-temporarily-disconnected"
        }
      );
    }
  });
});

/*
==========================================================
SERVER HEARTBEAT
==========================================================
*/

setInterval(() => {
  for (const ws of clients) {
    if (ws.readyState === 1) {
      safeSend(
        ws,
        {
          type:
            "server-ping"
        }
      );
    }
  }
}, 25000);

/*
==========================================================
START SERVER
==========================================================
*/

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `EmojiTV server running on port ${PORT}`
    );
  }
);
