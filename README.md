# ⬢ Hexhaven

An island trading-and-building game for **2–6 players** with hand-drawn terrain tiles. Your laptop runs the game and shows the board (on the TV), and everyone uses their **phone** as their private hand of cards.

## Start it

```bash
cd C:\repos\personal\hexhaven
npm install      # first time only
npm start
```

The terminal prints the addresses:

| Screen | Address | What it's for |
|---|---|---|
| Laptop / TV | `http://localhost:3700/` | The living board, scores and log. No controls needed |
| Phones | `http://<laptop-ip>:3700/play` | Scan the QR code on the TV |
| Optional host controls | `http://localhost:3700/host` | Manual control: place for anyone, fix hands, undo anything |

**Windows firewall:** the first time, Windows asks whether Node.js may use the network. Tick **Private networks** and allow it, or phones can't connect. Everyone has to be on the same Wi-Fi.

Mirror the laptop to the TV (or drag the browser window onto it) and press `F11` for full screen.

## Play online with GitHub Codespaces (when phones can't reach the laptop)
If the laptop blocks phones (a locked work laptop, for example), run the game in a free GitHub Codespace instead. The laptop and the phones then all open the same web address.

1. Put this folder in a GitHub repository (private is fine).
2. On the repository page: **Code → Codespaces → Create codespace on main**. It installs everything and starts the game by itself (`tools/codespace-start.sh`), and makes port 3700 **Public** so phones don't need a GitHub login. If the terminal says it couldn't, open the **PORTS** tab, right-click 3700, then **Port Visibility → Public**.
3. Open the address the terminal prints (`https://<codespace>-3700.app.github.dev/`) on the laptop and put it on the TV. Phones scan the QR code as usual.

- **Idle timeout:** a codespace stops after 30 minutes without typing in it, even mid-game. Raise it once in GitHub **Settings → Codespaces → Default idle timeout** (up to 240 minutes).
- **Free hours:** personal accounts get about 60 hours a month on the default machine. Stop the codespace after the game (**Code → Codespaces → ⋯ → Stop codespace**). Saves are kept until you delete the codespace.
- **Host controls and live fixes online:** add a Codespaces secret called `ADMIN_KEY` (16+ characters) in GitHub **Settings → Codespaces → Secrets**, give it access to this repository, and restart the codespace. `/host` then asks for that key, and `tools/admin.js` uses it from `.admin.json` (`{ "url": "https://…app.github.dev", "key": "…" }`). Without the key, the game works fully but nobody can open the host controls or the admin API.

## It hosts itself
Nobody needs to run the game. Everything happens on the phones:
- **Starting:** everyone taps **Ready** and the game starts by itself. The first player to join can also tap **🔀 New island** or **▶ Start now**.
- **Placing pieces:** when it's your turn to place a settlement, road or city, or to move the bandit, your phone opens a **map** with the legal spots glowing. Tap one, check what it touches (tiles, numbers, harbour), then **✓ Confirm**. The TV shows a pulsing marker on the spot you're considering, so the table can see it. Use 🔍 to zoom in.
- **Mistakes:** **↩️ Undo my last move** takes back your own last build or bandit move, as long as it's still the same turn.
- **Phones that drop off:** the game keeps going. It discards for an offline player on a 7 after 45 s, skips their special build after 15 s, and plays their setup or turn (roll, then end turn) after 90 s.
- Resources, turn order, setup order, longest road, largest army, scoring and the win are all automatic.

The host screen at `/host` still works if you ever want to step in.

## Two island sizes (picked automatically)

| | 2–4 players: **Basic island** | 5–6 players: **Extended island** |
|---|---|---|
| Tiles | 19: 4 forest, 4 pasture, 4 fields, 3 hills, 3 mountains, **1 desert** | 30: 6 / 6 / 6 / 5 / 5, **2 deserts** |
| Number tokens | 18, laid A→R in a counter-clockwise spiral from a random corner, skipping the desert | 28, random order with red 6s and 8s never touching |
| Harbours | 9: four 3:1 + one 2:1 per resource | 11: five 3:1 + six 2:1 (two for wool) |
| Bank | 19 of each resource | 24 of each resource |
| Development cards | 25: 14 knights, 2 each progress card, 5 VP | 34: 20 knights, 3 each progress card, 5 VP |
| Between turns | — | **Special building phase** |

The lobby switches islands as players join or leave, and the host screen shows which one is active.

**Special building phase (5–6 players):** after each player's turn, every other player gets a turn in order to build or buy development cards with the cards in their hand. Trading and playing development cards aren't allowed. Players who can't afford anything are skipped automatically. Each builder taps **Done** on their phone, and the host can **Skip** anyone.

## Animation
The board is a living island drawn on a canvas in real time (`public/island.js`), under the SVG layer that holds the tokens, pieces and click targets.

- **Wind gusts** roll across the whole island: wheat ripples in bright bands, trees bend, smoke and sand drift, and the windmill turns faster in a gust.
- **Living tiles:** deer graze in forests, sheep wander and graze, a worker wheels clay to the brick stacks, an eagle circles the quarry and the mine cart rolls out with ore, and a camel caravan and a tumbleweed cross the desert.
- **Sea life:** sailing boats leave wakes, boats bob at each harbour, gulls wheel overhead, fish leap and sun glints twinkle.
- **Day and night** (about 6 minutes per cycle): golden dusk, a moonlit night with lit windows, lanterns and stars, then dawn. Switch it off with **Day & night** in the host controls.
- **Game events:** the island assembles tile by tile, rolled tiles flash and resource cards fly to each settlement or city they pay, pieces drop in, the bandit lands in a puff of dust, and a rolled 7 pulses the board red.

If the laptop struggles, the scene lowers its resolution automatically. Devices set to **reduce motion** get a still picture.

**Showcase:** `node tools/build-showcase.js out.html` builds a self-contained page of the living island from the game code (also served at `/showcase.html`).

## How a game goes
1. Players scan the QR code, type their name and pick a colour (6 colours).
2. Everyone taps **Ready** (the first player to join can reshuffle the island or start early). Turn order is random.
3. **Setup:** each player places their own settlement and road on their phone's map. Second-round settlements pay out starting resources automatically.
4. **Turns:** the current player taps **Roll dice** on their phone, or the host presses `R`. Resources go straight to everyone's phones.
5. **Building:** tap Road / Settle / City on your phone, pick the spot on the map and confirm. Cards are deducted automatically.
6. **Rolling a 7:** anyone with more than 7 cards discards half on their phone. Then the roller moves the bandit on their phone's map and picks who to rob.
7. **Dev cards** (Knight, Road Building, Year of Plenty, Monopoly, Victory Point) are bought and played from the phone.
8. **Trading:** use the 🤝 Trade button, either with the bank (harbour rates applied automatically) or as an offer to another player, who accepts on their phone.
9. First to **10 VP** on their own turn wins. Longest road (5+) and largest army (3+ knights) are worth 2 VP each.

## Host powers
- **Place pieces for:** pick any player plus Road / Settlement / City / Bandit / Remove, then click the board. Tick **Free** to skip the cost, or **Ignore rules** to place anywhere.
- **Click a player card** to add or remove their cards, or make it their turn.
- **Real dice?** Enter physical dice results instead of rolling on screen.
- **↩️ Undo** (`Ctrl+Z`) reverses the last action, as many times as needed.
- Shortcuts: `R` roll · `E` end turn · `Esc` cancel tool · `P` hide controls.

The game saves to `savegame.json` after every action, so if the laptop restarts, `npm start` picks up where you left off. A phone that loses its connection reopens `/play` and taps its name to get back in.

## Saves and live fixes
- **💾 Save / 📂 Load** on the host screen (`/host`). Saves go to `saves/<name>.json`. The game also keeps a checkpoint at the **start of every turn** (`saves/auto/turn-NNN.json`, the last 60 turns), so you can rewind to any earlier turn. Loading can be undone with ↩️ Undo, and phones stay connected.
- **Live fixes from the laptop's terminal** with `node tools/admin.js` (it only works on the laptop itself, phones can't reach it):

| Command | What it does |
|---|---|
| `node tools/admin.js` | Summary: whose turn, every hand, dev cards, VP, pieces |
| `give <player> <res> <n>` | Give cards (negative `n` takes them), e.g. `give ana wood 2` |
| `turn <player>` | Make it someone's turn |
| `act '<json>' [note]` | Any host action, e.g. `'{"type":"host:skipRobber"}'`; add `"as":"<player>"` to act as that player |
| `say <text>` | Write a line in the game log on the TV |
| `undo` | Undo the last action |
| `get <file>` / `put <file> [note]` | Download the full game state, edit it, upload it back |
| `saves` · `save <name>` · `load <name>` | List, make and load saves (`load auto/turn-012` rewinds to turn 12) |

## Files
- `game.js`: rules engine (board generation, building rules, robber, dev cards, trading, longest road, scoring)
- `server.js`: web server + live sync (Socket.IO)
- `public/screen.*`: host and TV screens · `public/board.js`: board drawing · `public/play.*`: phone controller
- `tools/admin.js`: live fixes and saves from the terminal
- `npm test`: 40 host-run games + 24 self-hosted games played by random bots to check the rules never break
