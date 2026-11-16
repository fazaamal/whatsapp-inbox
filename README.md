# whatsapp-inbox

Message yourself on WhatsApp and it lands in Notion.

Send anything to your own "Message yourself" chat: a thought, a link, a
screenshot, a photo, a video, a voice note, a file. A small bot on your Mac picks it up
and hands it to Claude Code, which files it as a page in the **WhatsApp Inbox**
Notion database, sorted by project, and replies in the same chat with what it
saved and a link to the page. If the message asks for something ("summarise
this", "what's this?", a question), Claude also does it and the reply is the answer.

```
WhatsApp self-chat ──► bot on your Mac (Baileys, linked device)
                          │  downloads media, transcribes voice notes and videos locally (whisper.cpp),
                          │  grabs still frames from videos (macOS AVFoundation)
                          ▼
                       claude -p  (headless Claude Code, like the GitHub Action)
                          │  reads agent/CLAUDE.md, files the page via the Notion MCP,
                          │  looks at images and video frames, uploads the media, answers requests
                          ▼
                       Notion: WhatsApp Inbox  ──► ✅ reaction + a 🤖 reply (what was saved, or the answer)
```

Only your own self-chat is read. Every other chat is ignored.

There are two parts, and you can install either:

| Part | What it does | Install |
|---|---|---|
| **The bot** | Watches your WhatsApp self-chat and files messages in Notion | [Full install](#full-install-bot--skill), once per Mac that should run it |
| **The skill** | Lets any Claude Code session read the inbox ("what did I dump about Warq?") | Included in the full install, or [skill only](#skill-only) on any other Mac |

Run the bot on **one** Mac only. An always-on one (like a Mac mini) is best,
because the bot only works while that Mac is awake.

## Installation

### Before you start

You need, on the Mac:

1. **macOS** with [Homebrew](https://brew.sh).
2. **Node.js 20 or newer**: `node -v` to check. Install with `brew install node` or nvm.
3. **Claude Code**, installed and signed in: `claude --version` should work, and
   running `claude` once should not ask you to log in. See
   [code.claude.com](https://code.claude.com).
4. **Notion connected to Claude Code** (both the bot and the skill use it):

   ```bash
   claude mcp add --scope user --transport http notion https://mcp.notion.com/mcp
   ```

   Then run `claude`, type `/mcp`, pick **notion** and sign in with the Notion
   account that has the WhatsApp Inbox database. `claude mcp list` should now show
   `notion … ✔ Connected`.
5. **Your phone** with WhatsApp, for scanning a QR code once (bot only).

### Full install (bot + skill)

```bash
git clone https://github.com/fazaamal/whatsapp-inbox.git ~/Projects/whatsapp-inbox
cd ~/Projects/whatsapp-inbox
npm install
npm run setup
```

`npm run setup` walks through six steps and is safe to re-run (it skips what's done):

1. installs `whisper-cpp` with Homebrew if missing (voice notes are converted with macOS's built-in `afconvert`; `ffmpeg` is only a fallback). Videos need no extra install: the first one compiles a small frame grabber (`bin/video-frames.swift`) with the Xcode command line tools' `swiftc`
2. downloads the speech-to-text model for voice notes (`ggml-small.bin`, ~466 MB,
   from Hugging Face) to `~/.whatsapp-inbox/models`
3. checks Claude Code can reach Notion (if not, it prints the commands from step 4 above)
4. shows a QR code. On your phone: **WhatsApp → Settings → Linked devices → Link a
   device**, then scan it. "WhatsApp Inbox" appears in your linked devices.
5. installs a background service (launchd) so the bot starts at login and restarts
   if it crashes
6. links the `whatsapp-inbox` skill into `~/.claude/skills`

**Check it works:**

```bash
npm run status       # should say: state: running
```

Then send "hello, test" to your own WhatsApp chat ("Message yourself"). Within a
minute you should get ⏳ then ✅ on it, and a page in the WhatsApp Inbox. Send
`/status` to the same chat for a health check.

### Skill only

For a Mac where you want to *read* the inbox from Claude Code but not run the bot:

```bash
git clone https://github.com/fazaamal/whatsapp-inbox.git ~/Projects/whatsapp-inbox
cd ~/Projects/whatsapp-inbox
npm run skill:install
```

No `npm install` needed. This links `skills/whatsapp-inbox` into
`~/.claude/skills/whatsapp-inbox`, so `git pull` keeps it up to date. If you'd
rather not keep the repo around, `node scripts/skill.mjs copy` copies it instead.

You still need Claude Code and Notion connected ([before you start](#before-you-start),
items 3–4). Start a **new** Claude Code session and ask "what's in my inbox?".

Without the repo at all, copy the one file by hand:

```bash
mkdir -p ~/.claude/skills/whatsapp-inbox
curl -fsSL -H "Authorization: token $(gh auth token)" \
  https://raw.githubusercontent.com/fazaamal/whatsapp-inbox/main/skills/whatsapp-inbox/SKILL.md \
  -o ~/.claude/skills/whatsapp-inbox/SKILL.md
```

(The repo is private, hence the GitHub token; this needs `gh auth login` first.)

### Using a different Notion workspace

The database IDs are already set for Faza's workspace. To start fresh somewhere
else, ask Claude Code (with Notion connected) to create it:

> Create a Notion database called "WhatsApp Inbox" with: Name (title), Project
> (select: Warq, Zamrud, Zaman, BuildWithFaza, Minaarah, Masters, Surau Al-Iman,
> Ideas, Personal, Other), Type (select: Idea, Link, Image, Voice note, Video, File,
> Request), Status (select: New, Reviewed, Done), Summary (text), Link (url),
> Tags (multi-select), Received (date), Message ID (text). Give me its URL and
> its collection:// data source URL.

Then put the two URLs in `~/.whatsapp-inbox/config.json` (`notionDatabaseUrl`,
`notionDataSource`) and `npm run restart`. For the skill, replace the two IDs at
the top of [`skills/whatsapp-inbox/SKILL.md`](skills/whatsapp-inbox/SKILL.md).

### Updating

```bash
cd ~/Projects/whatsapp-inbox
git pull
npm install
npm run restart      # bot only; the linked skill updates with git pull
```

### Moving the bot to another Mac

On the old Mac: `npm run service:uninstall`, then in WhatsApp remove the "WhatsApp
Inbox" linked device. On the new Mac: do the [full install](#full-install-bot--skill).
The Notion inbox stays as it is.

### Uninstalling

```bash
cd ~/Projects/whatsapp-inbox
npm run service:uninstall     # stop the bot and remove the background service
npm run skill:uninstall       # remove the skill from Claude Code
rm -rf ~/.whatsapp-inbox      # WhatsApp login, downloaded media, model, logs
```

Then remove "WhatsApp Inbox" from **WhatsApp → Settings → Linked devices**. The
Notion database is left alone; delete it in Notion if you want.

## Using it

| You see | Meaning |
|---|---|
| ⏳ | Working on it |
| ✅ | Filed in Notion |
| ❌ | Failed. Send `/retry` to try the failed ones again |
| 🤖 … | What was saved and where (with a link), or the answer to your request |

Commands (send in the self-chat): `/status`, `/retry`.

**Follow-ups work.** The bot remembers the last 8 messages from the past 6
hours, so you can send a link and then "summarise that". To point at a
specific older message, swipe-reply to it in WhatsApp. Follow-up answers are
filed as their own page *and* added to the original page under "Follow-up".
(Change the window with `historyItems` / `historyHours` in the config.)

The Mac has to be awake for the bot to work. Anything you send while it's asleep
or offline is picked up when it wakes.

## Reading the inbox from Claude Code

The repo includes a Claude skill, [`skills/whatsapp-inbox`](skills/whatsapp-inbox/SKILL.md)
(installed by `npm run setup`, or on its own with [`npm run skill:install`](#skill-only)).
In any Claude Code session you can ask:

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
- **Full access for your own words.** A message you type or speak yourself
  (text with no link, or a voice note, not forwarded) runs with full access:
  every tool, the shell, your whole home folder, all your Claude Code MCP
  servers and your Chrome (Claude in Chrome). So "what was I doing in my Claude
  Code chats today?" or "what tabs do I have open?" just work. CLAUDE.md still
  tells it to only do irreversible or outward-facing things (deleting, pushing,
  sending, paying) when your message names that exact action.
- **Locked down for everything else.** Links, images, videos, files and forwarded
  messages carry someone else's words, which can hide instructions. Those runs
  may only read files, search/fetch the web, use the Notion MCP, and run
  `bin/notion-upload.mjs` (which only uploads files from the bot's media folder
  to Notion). Add tools in `allowedTools` to widen this.
- Change it with `fullAccess` in `~/.whatsapp-inbox/config.json`:
  `"own-messages"` (default), `"always"` (every message, links and media
  included: anything a web page says could run on your Mac), or `"off"`.

## Where things live

| Path | What |
|---|---|
| `~/.whatsapp-inbox/auth/` | WhatsApp login. Private; never commit. Delete it to unlink. |
| `~/.whatsapp-inbox/media/` | Downloaded images, videos (with their still frames in `*.frames/`), voice notes, files |
| `~/.whatsapp-inbox/state.json` | Which messages are done or failed, plus the recent-messages memory |
| `~/.whatsapp-inbox/logs/` | Bot logs |
| `~/Library/LaunchAgents/com.fazasophian.whatsapp-inbox.plist` | The background service |

## Caveats

- [Baileys](https://github.com/WhiskeySockets/Baileys) is an unofficial WhatsApp
  Web client. Reading your own chat as a linked device is low risk, but it isn't
  an official API.
- Each message is one headless Claude run (Sonnet by default), which counts
  toward your Claude plan's usage.
