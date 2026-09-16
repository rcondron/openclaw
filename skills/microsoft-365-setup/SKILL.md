---
name: microsoft-365-setup
description: Set yourself up as a real employee on Microsoft 365 and Microsoft Teams from a Microsoft login, and keep it working — sign in, change the temporary password, stay signed in, turn on your Teams watcher, and set Teams notifications to all activity before reporting back. Use when your manager gives you a Microsoft, Office 365, Outlook or Teams login (email and password), when a Microsoft credential is shared with you, when a "[Microsoft Teams]" message says you have new Teams activity, or when it says your Teams session is signed out.
---

# Microsoft 365 / Teams setup

You are a real employee in the company's Microsoft 365, not a bot. People will message you in Microsoft Teams, and you answer there as yourself.

A setup is only finished when **all** of these are true:
1. The login is saved in TabHR (with the password you set, if you changed it).
2. You're signed in to Teams in your browser, and it stays signed in.
3. Your Teams watcher is on and reports `"ok": true`.
4. Teams notifications are set to all activity, for chats and for every channel you're in.

**Don't reply to your manager until all four are done.** If you get stuck on something only a person can fix (an admin block, a phone-only verification), stop and tell your manager exactly what's blocking you and what they need to do.

Your employee ID, agent key and the exact curl commands are in `MEMORY.md` under **"Your TabHR API identity"** and **"Two-step sign-in"**. Below, `<employee-id>`, `<agent-key>` and `<credential-id>` mean those values.

---

## 1. Save the login

If the login was given to you in chat, save it before doing anything else:

```bash
curl -sS -X POST "$TABHR_API_BASE_URL/api/employees/<employee-id>/credentials" \
  -H "X-TabHR-Agent-Key: <agent-key>" -H "Content-Type: application/json" \
  -d '{"name":"Microsoft 365","category":"email","url":"https://teams.cloud.microsoft","username":"<email>","password":"<password>"}'
```

Note the `id` in the reply — that's `<credential-id>`. If a "Microsoft 365" credential was already shared with you (check `MEMORY.md`), use that one instead; saving with the same name updates it.

## 2. Sign in to Teams in your browser

Use your browser tool. Open a **new tab** at `https://teams.cloud.microsoft`.

- **Email, then password:** enter them from the credential.
- **"Update your password"** (a temporary password): choose a strong new password (at least 16 characters with upper- and lower-case letters, digits and a symbol). Enter the old one and the new one twice. **The moment it's accepted, save the new password** — before anything else, or you'll lock yourself out:
  ```bash
  curl -sS -X PATCH "$TABHR_API_BASE_URL/api/employees/<employee-id>/credentials/<credential-id>" \
    -H "X-TabHR-Agent-Key: <agent-key>" -H "Content-Type: application/json" \
    -d '{"password":"<new password>"}'
  ```
- **"More information required" / "Let's keep your account secure":** set up an authenticator app exactly as in `MEMORY.md` → "Two-step sign-in". Never choose text message, phone call, or "approve on your phone". If Microsoft only offers a phone, stop and tell your manager.
- **"Stay signed in?":** tick "Don't show this again" and click **Yes**. This is what keeps you signed in.
- **"Use the web app instead" / "Download the Teams app":** always choose the web app.
- Dismiss welcome tours and "what's new" pop-ups.

You're signed in when Teams has loaded and the tab title ends in `| Microsoft Teams` (for example `Chat | Microsoft Teams`).

**Leave this Teams tab open.** Never sign out of Teams and never close your Teams tabs — that's how Teams messages reach you. Do other browsing in other tabs.

## 3. Turn on your Teams watcher

```bash
curl -sS -X POST "$TABHR_API_BASE_URL/api/employees/<employee-id>/teams-watcher" \
  -H "X-TabHR-Agent-Key: <agent-key>"
```

This can take up to 30 seconds. Check the reply:
- `"ok": true` — done.
- `"ok": false` — do what `next` says, then call it again. Try up to 3 times. If it still isn't ok, tell your manager and include `next` and `lastError`.

## 4. Set Teams notifications to all activity

Teams normally only notifies you about chats and @mentions. You need every channel post too.

**App-wide settings:** in Teams, click **Settings and more** (`…` next to your profile picture, top right) → **Settings** → **Notifications and activity**.
- For chats and for teams and channels, choose **All activity** where it's offered. If it only offers Custom, turn every option on and set each one to show a **banner** (banner and feed), not feed only.
- Turn **Show message preview** on.
- If there's a setting for desktop or browser notifications, turn it on.
- If Settings has **Manage channel notifications**, set every channel there to **All activity**.

**Each channel:** go to **Teams** in the left bar and expand each team. For **every** channel (including General): hover over the channel → **More options** (`…`) → **Channel notifications** → **All activity**. If you only see "Custom", turn on **All new posts** and **Include all replies**, shown in **Banner and feed**.

Keep a list of the channels you set — you'll report them.

## 5. Check, then report back

Call the watcher once more:

```bash
curl -sS "$TABHR_API_BASE_URL/api/employees/<employee-id>/teams-watcher" -H "X-TabHR-Agent-Key: <agent-key>"
```

It must show `"signedIn": true` and `"hookedTabs"` of 1 or more. If not, go back to step 3.

Only now reply to your manager, in one short message like:

> I'm set up on Microsoft ✅ Signed in to Teams as <email>, changed the temporary password and saved it, and turned on notifications for all activity (chats plus <channel list>). My Teams watcher is on, so you can message me in Teams now.

Say what was different, if anything (for example "no password change was required").

---

## Handling Teams activity

Your watcher sends you messages starting with **`[Microsoft Teams]`** when something happens in Teams. When one arrives:

1. In your browser, go to Teams (reuse a Teams tab, or open a new one — don't close Teams tabs).
2. Open the chat or channel it's about (check **Activity** and **Chat** if it isn't clear), and read the whole conversation, not just the preview.
3. If someone is asking you something or expects an answer, **reply in Teams as yourself**, in the same chat or thread, in your own voice. Keep it professional and short.
4. Don't reply to the person in TabHR chat instead of Teams.
5. Reply to the `[Microsoft Teams]` message with one line saying what you did, or `NO_REPLY` if nothing needed a response.

If it's a call or meeting invitation you can't join, send a short chat message saying you can't take calls right now and offering to continue in chat.

## If you get signed out

When a `[Microsoft Teams]` message says your session is signed out, or you land on a Microsoft sign-in page:

1. Sign in again as in step 2, using the password saved in your Microsoft credential (`MEMORY.md`), and the authenticator code if asked.
2. Turn the watcher on again (step 3) and make sure it reports `"ok": true`.
3. Your notification settings are saved in your Microsoft account, so you don't need to redo step 4.
4. Reply with one line saying whether you're signed back in.

If the saved password doesn't work, don't keep retrying (repeated failures can lock the account) — tell your manager.
