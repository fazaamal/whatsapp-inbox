---
name: whatsapp-groups
description: Turn Faza's WhatsApp inbox bot on or off for a WhatsApp group by name, so every message sent in that group is filed in the Notion WhatsApp Inbox and answered, the same way the bot handles Faza's self-chat. Use when Faza says things like "make the bot work in <group>", "add the <group> group to the inbox", "turn the inbox on/off for <group>", "which groups is the bot in?", "stop replying in <group>", "only send me the replies for <group>", or "file <group> under Zamrud".
---

# WhatsApp groups for the inbox bot

The [whatsapp-inbox bot](https://github.com/fazaamal/whatsapp-inbox) normally reads only
Faza's self-chat. This skill turns it on for named groups. In a group it handles **every
message from anyone** (Faza included): files a page in the WhatsApp Inbox with the group
in **Chat** and the sender in **From**, reacts ⏳/✅, and replies.

Everything goes through one command in the bot's repo. Run it on the Mac that runs the
bot (where `~/.whatsapp-inbox/` exists):

```bash
cd ~/Projects/whatsapp-inbox
npm run groups -- add "<group name>"                       # turn it on
npm run groups -- add "<group name>" --project Zamrud --reply self
npm run groups -- set "<group name>" --reply none          # change settings
npm run groups -- remove "<group name>"                    # turn it off
npm run groups                                             # which groups it's on for
npm run groups -- list [part of a name]                    # every group Faza is in
npm run groups -- refresh                                  # re-read groups from WhatsApp
```

The running bot picks up changes within a few seconds; don't restart it.

## Turning a group on

1. Take the group name from Faza's words. A partial name is fine: matching ignores case,
   emoji and punctuation, and an exact name wins over partial matches.
2. Pick options only from what Faza said:
   - `--reply group` (default): answers in the group, visible to everyone in it.
   - `--reply self`: answers go only to Faza's self-chat, tagged with group and sender.
     Use when Faza says "quietly", "don't post in the group", "just send me".
   - `--reply none`: only files pages, no reactions or replies anywhere.
   - `--project <name>`: the default project for the group's messages (one of Warq,
     Zamrud, Zaman, BuildWithFaza, Minaarah, Masters, Surau Al-Iman, Ideas, Personal,
     Other). Set it when the group clearly belongs to one, e.g. a Zamrud team group.
3. Run `add`. Exit codes:
   - `0`: done. Tell Faza what it says (group, where replies go, project).
   - `2`: several groups match. Show Faza the names it printed and ask which one, then
     run again with `--jid <id>`.
   - `3`: no group matches, even after a refresh. Show the closest names from
     `npm run groups -- list <a word from the name>` and ask.
   - `1`: the bot isn't running or answering. Check `npm run status` / `npm run logs`.

Only messages sent **after** a group is turned on are filed; older chat history is not.

## What to tell Faza when turning one on

Mention briefly, once:
- With `--reply group`, the bot posts from Faza's own WhatsApp number, so the group sees
  🤖 replies and reactions from Faza. In a busy group that is a lot of messages; `self`
  is the quiet option.
- Each message is one Claude run (about $0.05–0.15), so a busy group costs more.
- Group messages are always locked down: the bot can only read the message, search the
  web and file in Notion. It never touches Faza's files or other apps, and replies in the
  group never mention Faza's other inbox items or projects.

## Finding what a group sent

Group messages are in the same WhatsApp Inbox (see the `whatsapp-inbox` skill), with
`"Chat" = '<group name>'` and the sender in `"From"`. Self-chat items have an empty Chat.

## Where it's stored

`~/.whatsapp-inbox/config.json` → `"groups"`: `[{name, jid, project, reply, addedAt}]`.
`~/.whatsapp-inbox/groups.json`: every group the account is in, written by the bot on
connect. Prefer the command over editing these by hand.
