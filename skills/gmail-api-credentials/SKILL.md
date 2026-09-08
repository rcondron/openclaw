---
name: gmail-api-credentials
description: Create Google Cloud OAuth credentials for sending mail programmatically, driving the Google Cloud Console in the browser. Produces a long-lived refresh token for the gmail.send scope. Use when someone wants an agent to send email from their own Gmail or Workspace account without a password, an app password, or a 2FA prompt on every send.
---

# Gmail API credentials via the browser

Turns a Google account the user has already signed into in the browser into a set
of API credentials — client ID, client secret, refresh token — that send mail
without ever touching the login again.

The whole job takes about ten minutes of browser work and needs the user present
twice, for 2FA. Everything else is unattended.

## Before you start

**Tell the user they will be interrupted twice for 2FA**, and roughly when. This
is the single biggest source of dead time: the run stalls at a 2FA prompt while
the user is away, and a stall in the middle of an OAuth flow can expire the
authorization and cost the whole sequence. Ask them to stay reachable for the
next ten minutes before you begin.

You need from them:
- the Google account email (already signed in, ideally)
- the account password — the console re-authenticates even on a live session
- a phone able to approve the 2FA prompt

**Scope: `https://www.googleapis.com/auth/gmail.send` and nothing wider.**
`gmail.send` is classified *sensitive*. Every read scope — `gmail.readonly`,
`gmail.modify`, `gmail.compose`, `https://mail.google.com/` — is *restricted*,
and restricted scopes drag the project into an annual third-party CASA security
assessment costing $500–$4,500 a year. Sending mail does not. Do not widen the
scope because it seems convenient; it changes the compliance obligation.

## Steps

Navigate directly to each URL. Do not click through the console's own
navigation — it is slow, and the layout changes.

### 1. Create the project

```
https://console.cloud.google.com/projectcreate
```

Expect a Terms-of-Service checkbox on a first-ever visit, and a free-trial
dialog that must be dismissed before the form is usable. Name it for the job,
e.g. `gmail-send-automation`.

Record the project ID from the confirmation — it is the name plus a numeric
suffix (`gmail-send-automation-507617`), not the name you typed. Every later URL
needs it.

### 2. Enable the Gmail API

```
https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=<PROJECT_ID>
```

Click Enable and confirm the page then shows **Disable API** — that button is the
proof it took. Do this *before* the consent screen: a token minted against a
project with the API disabled fails later, at send time, where the cause is much
harder to see.

### 3. Configure the OAuth consent screen

```
https://console.cloud.google.com/auth/overview/create?project=<PROJECT_ID>
```

A four-step wizard: App information → Audience → Contact information → Finish.
Choose **External** at the Audience step. The support-email and contact-email
fields are dropdowns, not text inputs — open them and select.

### 4. Add the user as a test user

```
https://console.cloud.google.com/auth/audience?project=<PROJECT_ID>
```

Add the account's own email under Test users. Without this the consent screen
refuses the very account you are authorizing.

### 5. Publish to production — do not skip this

On the same Audience page, click **Publish app** and confirm. Leave the
verification submission alone; unverified is fine.

**This is the step that decides whether the credentials survive the week.** While
publishing status is `Testing`, every refresh token Google issues **expires seven
days after consent**. A daily job built on a Testing-mode token works, looks
finished, and dies silently the following week with `invalid_grant`. Publishing
to Production — even unverified — makes refresh tokens long-lived.

The costs of publishing unverified are small and acceptable here: a one-time
"Google hasn't verified this app" interstitial during consent (click Advanced →
"Go to … (unsafe)"), and a 100-user cap you will never approach with one account.

### 6. Create the OAuth client

```
https://console.cloud.google.com/auth/clients/create?project=<PROJECT_ID>
```

Application type **Desktop app**. The type selector is a dropdown: open it,
then select. Name it anything.

The client ID and secret appear in a modal **once**. Write them to a file
immediately, before dismissing it.

### 7. Authorize and exchange for a refresh token

The browser is on a different machine from the agent, so a loopback redirect
cannot be caught by a listener here — `http://localhost` resolves to the
*browser's* host, not yours. Two options, in order of preference:

**Read the code out of the URL bar.** Use `redirect_uri=http://localhost`. After
consent the browser lands on a dead `http://localhost/?code=4/0A…&scope=…` page —
connection refused is expected and fine. Snapshot the page and read `code` from
the URL. This is the durable approach.

**Fall back to OOB** (`urn:ietf:wg:oauth:2.0:oob`) only if the above fails. It
displays the code in a text box, but it is deprecated and Google is withdrawing
it.

Build the authorization URL with `access_type=offline` and `prompt=consent`.
Without both, Google returns an access token and **no refresh token**, and the
whole exercise produces nothing durable.

```
https://accounts.google.com/o/oauth2/v2/auth
  ?client_id=<CLIENT_ID>
  &redirect_uri=http://localhost
  &response_type=code
  &scope=https://www.googleapis.com/auth/gmail.send
  &access_type=offline
  &prompt=consent
```

Navigate there, pick the account, approve 2FA (second interruption), click past
the unverified-app warning, click **Allow**, then read the code from the URL.

Exchange it promptly — authorization codes expire in minutes:

```bash
curl -s https://oauth2.googleapis.com/token \
  -d client_id=<CLIENT_ID> -d client_secret=<CLIENT_SECRET> \
  -d code=<CODE> -d grant_type=authorization_code \
  -d redirect_uri=http://localhost
```

Confirm the response contains `refresh_token`. If it does not, the URL was
missing `access_type=offline` or `prompt=consent`, or this account already
granted consent before — revoke at myaccount.google.com/permissions and repeat.

### 8. Verify before declaring success

Refresh once and send one real message. A credential set that has never
completed a send is not finished work.

```bash
curl -s https://oauth2.googleapis.com/token \
  -d client_id=<ID> -d client_secret=<SECRET> \
  -d refresh_token=<TOKEN> -d grant_type=refresh_token
```

## Handling secrets

**Never print the client secret, authorization code, or refresh token into the
conversation, and never append them to MEMORY.md.** MEMORY.md is loaded into
context every session and is not a secret store; a refresh token written there is
a permanent credential sitting in plain text in every future prompt.

Write them to a file in the workspace and lock it down:

```bash
umask 077
cat > gmail-credentials.json <<'EOF'
{"client_id":"…","client_secret":"…","refresh_token":"…"}
EOF
chmod 600 gmail-credentials.json
```

In MEMORY.md record only the *path* and the project ID. Tell the user the
credentials exist and where, not what they are.

## Environment notes

Only `requests` is needed for the token exchange — plain HTTP form posts. Do not
install `google-auth`, `google-auth-oauthlib`, or `google-api-python-client`;
they pull a large dependency tree for no benefit here.

`pip` is not on PATH in the agent container; use `pip3`. On a Debian-based image
it will refuse with an externally-managed-environment error, so:

```bash
pip3 install --break-system-packages requests
```

## Browser-tool discipline

**Snapshot immediately before every act.** Element refs (`e28`) are invalidated
by any DOM change, including the console's own toast notifications. Acting on a
ref captured before a click reliably fails with *"Element not found or not
visible"*, and recovering usually means re-navigating and losing your place.

Keep tool arguments to plain scalars. A malformed argument — nested markup
leaking into an action name — is rejected outright and wastes the call.

The Cloud Console is a heavy SPA: after any navigation or submit, snapshot and
confirm you are where you think you are before acting further.

## When this is the wrong approach

If the account is **Google Workspace and the agent only ever serves that one
organization**, an Internal OAuth app is strictly better: no consent screen
warning, no 100-user cap, no publishing dance, and restricted scopes like
`gmail.readonly` become available with no verification and no CASA. That path
needs an admin, not a browser.

This skill is the right one for a personal `@gmail.com`, or when no admin access
is available.
