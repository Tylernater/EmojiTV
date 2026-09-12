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

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_, res) => res.json({ ok: true, game: "Emoji Face-Off" }));

const id = () => crypto.randomUUID();
const send = (ws, data) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
};
const removeWaiting = ws => {
  const i = waiting.indexOf(ws);
  if (i >= 0) waiting.splice(i, 1);
};

wss.on("connection", ws => {
  ws.playerId = id();
  send(ws, { type: "ready", playerId: ws.playerId });

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "find-match") {
      removeWaiting(ws);

      let opponent = waiting.shift();
      while (opponent && opponent.readyState !== 1) opponent = waiting.shift();

      if (opponent) {
        const roomId = id();
        rooms.set(roomId, { a: opponent, b: ws });
        opponent.roomId = ws.roomId = roomId;
        opponent.role = "a";
        ws.role = "b";

        send(opponent, { type: "matched", roomId, role: "a", opponentId: ws.playerId });
        send(ws, { type: "matched", roomId, role: "b", opponentId: opponent.playerId });
      } else {
        waiting.push(ws);
        send(ws, { type: "waiting" });
      }
      return;
    }

    if (msg.type === "leave") {
      removeWaiting(ws);
      if (ws.roomId) {
        const room = rooms.get(ws.roomId);
        const other = room && (room.a === ws ? room.b : room.a);
        if (other) send(other, { type: "opponent-left" });
        rooms.delete(ws.roomId);
        ws.roomId = null;
      }
      return;
    }

    if (ws.roomId) {
      const room = rooms.get(ws.roomId);
      const other = room && (room.a === ws ? room.b : room.a);
      if (other) send(other, { ...msg, from: ws.playerId });
    }
  });

  ws.on("close", () => {
    removeWaiting(ws);
    if (ws.roomId) {
      const room = rooms.get(ws.roomId);
      const other = room && (room.a === ws ? room.b : room.a);
      if (other) send(other, { type: "opponent-left" });
      rooms.delete(ws.roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Emoji Face-Off running on http://localhost:${PORT}`));
