# Emoji Face-Off — fixed camera version

## Easiest setup

1. Install Node.js if you do not already have it.
2. Open a terminal in this folder.
3. Run:
   npm install
4. Then run:
   npm start
5. Open this exact address in your browser:
   http://localhost:3000
6. Click PLAY NOW.
7. Allow Camera and Microphone.

IMPORTANT: Do NOT double-click `public/index.html`. The game needs to be opened through `http://localhost:3000`.

### What was fixed
- Camera/microphone permission errors are no longer confused with server connection errors.
- The camera is attached to the waiting/game video as soon as permission is granted.
- The local camera is shown before matchmaking finishes.
- Clear messages tell you whether the camera or game server is the problem.
- Added retry/cancel controls.
- Added a server health endpoint.
