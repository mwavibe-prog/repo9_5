# Steady Sailors

A cooperative multiplayer boat game for **up to 15 players**, designed to be
simple and friendly for **elderly players (60+)** and new gamers.

Everyone on their phone helps row a boat down a river. When an obstacle
appears, the whole crew must steer LEFT or RIGHT together. Reach the shore
without running out of lives and you all win.

## Why it's easy to play

- **One button at a time.** You only ever see the action you need right now
  (ROW, or LEFT / RIGHT).
- **Huge tap targets.** Buttons fill most of the phone screen.
- **Big text, high contrast.** No small labels or tiny icons.
- **No time pressure.** Players have 10 seconds to react to an obstacle, and
  the game always waits for the crew to tap together.
- **Friendly feedback.** Gentle vibration on each tap, cheerful sounds on the
  big screen, and clear "YOU MADE IT!" or "try again" messages.
- **Fully cooperative.** Nobody loses individually - the whole crew wins or
  tries again together.

## How to play (the rules)

1. One person opens the **main screen** on a TV, laptop, or projector:
   `http://<host>:3000/`
2. Every player scans the QR code with their phone and joins (up to 15).
3. Host taps **START**.
4. **Rowing phase:** Everyone taps the big green **ROW** button. When half
   the crew has rowed, the boat advances.
5. **Steering phase:** An obstacle appears on the river. The big screen shows
   an arrow saying **LEFT** or **RIGHT**. Everyone taps the matching button.
   If the crew votes the correct direction in time, the boat dodges it.
   Otherwise the boat takes a hit and loses a life.
6. Reach the finish line before losing all 3 lives to win.

## Running it

You need Node.js 18 or later.

```bash
npm install
npm start
```

Then open the printed URLs:

- **Host screen:** `http://localhost:3000/`
- **Player phones:** the QR code on the host screen, or
  `http://<your-lan-ip>:3000/play`

Phones and the host must be on the same Wi-Fi. The server prints LAN IPs on
startup.

## Project layout

```
server.js             Express + Socket.IO game server (game state, phases)
public/index.html     Host / shared-screen UI
public/play.html      Player phone UI
public/style.css      Shared styles (big fonts, high contrast)
public/host.js        Host screen logic (river, boat, QR)
public/player.js      Player phone logic (one big button)
```

## Tuning the game

All tuning knobs live in `server.js`:

- `MAX_PLAYERS` - player cap (default 15).
- `rowingThreshold()` - how many of the crew need to act together (default:
  half, minimum 1). Lower it to make the game easier.
- Rowing phase auto-advance after **15 s** of inactivity.
- Obstacle response window **10 s**.
- Each successful row advances the boat by **15%** of the river.
- Starting lives **3**.

## License

MIT
