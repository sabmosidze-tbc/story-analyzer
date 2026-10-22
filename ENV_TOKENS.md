# Environment Variables Reference

This file explains every variable in `.env.local` — what it is, why the app needs it, and how to obtain it.

---

## `GITHUB_TOKEN`

| | |
|---|---|
| **Purpose** | Authenticates requests to the [GitHub Models API](https://models.github.com), which gives access to GPT-5, GPT-4.1, GPT-4o, o-series reasoning models, and more |
| **Used by** | `src/app/api/analyze/route.ts` — every AI analysis call |
| **Required?** | **Yes** — the app will not be able to call any AI model without this |

### What it is
A GitHub **Personal Access Token (PAT)**. GitHub Models is a hosted inference service that lets you call OpenAI, Meta, and other models through GitHub's infrastructure instead of paying OpenAI directly.

### How to get it
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **"Generate new token (classic)"**
3. Give it a name (e.g. `story-analyzer`)
4. Under **Scopes**, tick **`models`** (you may also see it listed as "Access to GitHub Models")
5. Click **"Generate token"** and copy the value immediately (you won't see it again)
6. Paste it as the value of `GITHUB_TOKEN`

### Notes
- Free GitHub accounts have a rate limit on GitHub Models (fine for personal/team use)
- The token value starts with `github_pat_...`

---

## `OPENAI_API_KEY`

| | |
|---|---|
| **Purpose** | Direct OpenAI API key as a fallback, in case `GITHUB_TOKEN` is not set |
| **Used by** | `src/app/api/analyze/route.ts` |
| **Required?** | **No** — only needed if you are not using `GITHUB_TOKEN` |

### What it is
A standard OpenAI API key that starts with `sk-...`. If both `GITHUB_TOKEN` and `OPENAI_API_KEY` are set, `GITHUB_TOKEN` takes priority (GitHub Models is used).

### How to get it
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Click **"Create new secret key"**
3. Copy the `sk-...` value and paste it here

---

## `JIRA_BASE_URL`

| | |
|---|---|
| **Purpose** | The root URL of your Jira Cloud instance |
| **Used by** | All Jira API routes: `src/app/api/jira/fetch/`, `src/app/api/jira/preview/`, `src/app/api/jira/comment/` |
| **Required?** | **Only if you use the Jira integration** |

### What it is
Your organization's Jira Cloud URL. It always has the format `https://<your-org>.atlassian.net`. Do **not** include a trailing slash.

### How to find it
It's the URL you use to access Jira in your browser, e.g. `https://tbcbank.atlassian.net`.

---

## `JIRA_EMAIL`

| | |
|---|---|
| **Purpose** | The email address of the Jira account used to make API calls |
| **Used by** | Jira API routes (Basic Auth: `email:api_token` base64-encoded) |
| **Required?** | **Only if you use the Jira integration** |

### What it is
The login email of the Jira account that holds the API token below. This account needs at least **Browse Projects** and **Add Comments** permissions on the projects you use.

---

## `JIRA_API_TOKEN`

| | |
|---|---|
| **Purpose** | Password substitute for authenticating Jira REST API calls |
| **Used by** | Jira API routes |
| **Required?** | **Only if you use the Jira integration** |

### What it is
A Jira-specific API token (not your account password). It is combined with `JIRA_EMAIL` using HTTP Basic Auth to authenticate every Jira request.

### How to get it
1. Go to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **"Create API token"**
3. Give it a label (e.g. `story-analyzer`)
4. Copy the token and paste it as `JIRA_API_TOKEN`

### Notes
- Tokens do not expire automatically but can be revoked manually
- Never commit this token to source control

---

## `AUTH_GITHUB_ID`

| | |
|---|---|
| **Purpose** | OAuth App Client ID — identifies this app to GitHub's OAuth system |
| **Used by** | `src/auth.ts` via Auth.js v5 for the GitHub sign-in flow |
| **Required?** | **Only if you want the GitHub sign-in button** (for Copilot model access) |

### What it is
The public identifier of your GitHub OAuth App. It starts with `Ov23li...`.

### How to get it
1. Go to [github.com/settings/developers](https://github.com/settings/developers) → **OAuth Apps** → **New OAuth App**
2. Fill in:
   - **Application name**: `StoryAnalyzer` (or anything)
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:3000/api/auth/callback/github`
3. Click **Register application**
4. Copy the **Client ID** → paste as `AUTH_GITHUB_ID`

---

## `AUTH_GITHUB_SECRET`

| | |
|---|---|
| **Purpose** | OAuth App Client Secret — proves to GitHub that this server is the legitimate owner of the OAuth App |
| **Used by** | `src/auth.ts` |
| **Required?** | **Only if you use GitHub sign-in** |

### What it is
The private secret of your GitHub OAuth App. Never expose this publicly.

### How to get it
From the same OAuth App page (step 3 above):
1. Click **"Generate a new client secret"**
2. Copy the value immediately → paste as `AUTH_GITHUB_SECRET`

### Notes
- This is a server-side secret — it is never sent to the browser
- If it leaks, regenerate it on the OAuth App settings page immediately

---

## `AUTH_SECRET`

| | |
|---|---|
| **Purpose** | Secret key used by Auth.js to sign and encrypt session cookies and JWTs |
| **Used by** | Auth.js v5 (`next-auth`) for all session management |
| **Required?** | **Yes, if GitHub sign-in is enabled** |

### What it is
A random 32-byte base64-encoded string. It must be kept secret — anyone who has this value can forge session tokens.

### How to generate one
Run this command in your terminal:
```bash
openssl rand -base64 32
```
Copy the output and paste it as `AUTH_SECRET`.

### Notes
- If you change this value, all existing user sessions will be immediately invalidated (users will be signed out)
- Must be the same value across all server instances if you deploy to multiple machines

---

## `AUTH_URL`

| | |
|---|---|
| **Purpose** | Tells Auth.js the base URL of the application so it can construct correct OAuth callback URLs |
| **Used by** | Auth.js v5 |
| **Required?** | **Yes, when running locally** (not always needed in production on Vercel) |

### What it is
The full base URL of the app. Auth.js uses this to build the callback URL it sends to GitHub during OAuth:
`{AUTH_URL}/api/auth/callback/github`

### Values
- **Local development**: `http://localhost:3000`
- **Production**: `https://your-domain.com`

### Notes
- This must exactly match what you registered as the **Authorization callback URL** in your GitHub OAuth App settings (minus the path suffix)

---

## Quick Reference

| Variable | Required | Sensitive | Rotate if leaked |
|---|---|---|---|
| `GITHUB_TOKEN` | Yes | Yes | Revoke at github.com/settings/tokens |
| `OPENAI_API_KEY` | No | Yes | Revoke at platform.openai.com/api-keys |
| `JIRA_BASE_URL` | Jira only | No | — |
| `JIRA_EMAIL` | Jira only | No | — |
| `JIRA_API_TOKEN` | Jira only | Yes | Revoke at id.atlassian.com |
| `AUTH_GITHUB_ID` | Sign-in only | No | Regenerate OAuth app |
| `AUTH_GITHUB_SECRET` | Sign-in only | Yes | Regenerate on OAuth app page |
| `AUTH_SECRET` | Sign-in only | Yes | Regenerate with `openssl rand -base64 32` |
| `AUTH_URL` | Sign-in only | No | — |
