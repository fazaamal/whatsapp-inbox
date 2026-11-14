# whatsapp-inbox

Message yourself on WhatsApp and it lands in Notion.

Send anything to your own "Message yourself" chat: a thought, a link, a
screenshot, a photo, a voice note, a file. A small bot on your Mac picks it up
and hands it to Claude Code, which files it as a page in the **WhatsApp Inbox**
Notion database, sorted by project. If the message asks for something
("summarise this", "what's this?", a question), Claude also does it and replies
in the same chat.

```
WhatsApp self-chat ──► bot on your Mac (Baileys, linked device)
                          │  downloads media, transcribes voice notes locally (whisper.cpp)
                          ▼
                       claude -p  (headless Claude Code, like the GitHub Action)
                          │  reads agent/CLAUDE.md, files the page via the Notion MCP,
                          │  uploads the image/audio, answers requests
                          ▼
                       Notion: WhatsApp Inbox  ──► ✅ reaction (+ a 🤖 reply if you asked for something)
```

Only your own self-chat is read. Every other chat is ignored.

## Setup (once per Mac)

Needs: Node 20+, [Claude Code](https://code.claude.com) signed in, Homebrew.

```bash
git clone https://github.com/fazaamal/whatsapp-inbox.git ~/Projects/whatsapp-inbox
cd ~/Projects/whatsapp-inbox
npm install
npm run setup
```

`npm run setup` is safe to re-run. It:

1. installs `ffmpeg` and `whisper-cpp` with Homebrew if missing
2. downloads the speech-to-text model (`ggml-small.bin`, ~466 MB) to `~/.whatsapp-inbox/models`
3. checks Claude Code can reach Notion (if not, it prints the two commands to connect it)
4. shows a QR code: on your phone, **WhatsApp → Settings → Linked devices → Link a device**
5. installs a launchd service, so the bot starts at login and restarts if it crashes
6. links the `whatsapp-inbox` Claude skill into `~/.claude/skills` (see below)

## Using it

| You see | Meaning |
|---|---|
| ⏳ | Working on it |
| ✅ | Filed in Notion |
| ❌ | Failed. Send `/retry` to try the failed ones again |
| 🤖 … | Claude's answer to a request |

Commands (send in the self-chat): `/status`, `/retry`.

**Follow-ups work.** The bot remembers the last 8 messages from the past 6
hours, so you can send a link and then "summarise that". To point at a
specific older message, swipe-reply to it in WhatsApp. Follow-up answers are
filed as their own page *and* added to the original page under "Follow-up".
(Change the window with `historyItems` / `historyHours` in the config.)

The Mac has to be awake for the bot to work. Anything you send while it's asleep
or offline is picked up when it wakes.

## Reading the inbox from Claude Code

The repo includes a Claude skill, [`skills/whatsapp-inbox`](skills/whatsapp-inbox/SKILL.md),
which setup links into `~/.claude/skills`. In any Claude Code session you can ask:

- "what's in my inbox?" (unread counts per project, then the newest items)
- "what did I dump about Warq this week?" / "anything in my inbox for this project?"
- "find the voice note where I talked about pricing"
- "summarise my dumps from the last few days"
- "mark those as reviewed"

It reads the same Notion database the bot writes to. It only changes an item's
Status when you ask, and never deletes anything.

## Day to day

```bash
npm run status     # is it running?
npm run logs       # last log lines
npm run restart    # restart the bot
npm run simulate -- --text "test idea"          # run one fake message through Claude + Notion
npm run simulate -- --file ~/Desktop/x.png --text "what is this?"
npm run simulate -- --with-history --text "summarise that"   # use the recent-messages memory
npm run service:uninstall                       # stop it and remove the service
```

## Changing how it behaves

- **What Claude does with each message:** edit [`agent/CLAUDE.md`](agent/CLAUDE.md).
- **Settings** (projects list, model, tools Claude may use, emoji): edit
  `~/.whatsapp-inbox/config.json` (created from [`config.example.json`](config.example.json)),
  then `npm run restart`.
- Claude may only use: reading files, web search/fetch, the Notion MCP, and
  `bin/notion-upload.mjs` (which only uploads files from the bot's media folder
  to Notion). Add tools in `allowedTools` if you want it to do more.

## Where things live

| Path | What |
|---|---|
| `~/.whatsapp-inbox/auth/` | WhatsApp login. Private; never commit. Delete it to unlink. |
| `~/.whatsapp-inbox/media/` | Downloaded images, voice notes, files |
| `~/.whatsapp-inbox/state.json` | Which messages are done or failed, plus the recent-messages memory |
| `~/.whatsapp-inbox/logs/` | Bot logs |
| `~/Library/LaunchAgents/com.fazasophian.whatsapp-inbox.plist` | The background service |

## Caveats

- [Baileys](https://github.com/WhiskeySockets/Baileys) is an unofficial WhatsApp
  Web client. Reading your own chat as a linked device is low risk, but it isn't
  an official API.
- Each message is one headless Claude run (Sonnet by default), which counts
  toward your Claude plan's usage.
