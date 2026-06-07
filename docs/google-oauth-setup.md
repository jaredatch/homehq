# Google OAuth Setup for HomeHQ

## 1. Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown at the top → **New Project**
3. Name it something like `HomeHQ` → **Create**
4. Make sure the new project is selected in the dropdown

## 2. Enable the Google Calendar API

1. Go to **APIs & Services → Library** (left sidebar)
2. Search for **Google Calendar API**
3. Click it → **Enable**

## 3. Configure the OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Choose a user type:
   - **Internal** (recommended if you have Google Workspace) — restricts access to users in your Workspace org. No test user setup or app review needed, and refresh tokens never expire from publishing status.
   - **External** — use this if your Google account is a regular `@gmail.com`. Requires adding yourself as a test user (see step 6) **and publishing the app to production (see step 4b) — do not skip this**.
3. Click **Create**
4. Fill in the required fields:
   - **App name:** `HomeHQ`
   - **User support email:** your email
   - **Developer contact email:** your email
5. Click **Save and Continue**
6. On the **Scopes** step, click **Add or Remove Scopes**
   - Search for and add: `https://www.googleapis.com/auth/calendar.readonly`
   - This is the only scope needed for MVP (read-only calendar access)
   - Click **Update** → **Save and Continue**
7. **External only:** On the **Test users** step, click **Add Users** and add the Google account email that owns the family calendars. (Internal apps skip this — all Workspace users are already authorized.)
8. Click **Save and Continue** → **Back to Dashboard**

## 4. Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `HomeHQ`
5. Under **Authorized redirect URIs**, add:
   - `http://localhost:3000/api/oauth/callback` (for local dev)
   - `https://your-domain.com/api/oauth/callback` (for production, if you have one — can add later)
6. Click **Create**
7. You'll see your **Client ID** and **Client Secret** — copy both

## 4b. External apps only: publish to production

> **This is the trap that kills External apps.** While an External app's publishing
> status is **Testing**, Google expires its refresh tokens after **7 days**. The
> dashboard works for a week, then sync silently dies with `invalid_grant` and you have
> to reconnect. (Internal apps are immune — skip this section.)

1. Go to **APIs & Services → OAuth consent screen**
2. Under **Publishing status**, click **Publish App** → confirm
3. The app will show as "unverified" — that's fine for personal use. When connecting,
   Google shows a warning screen; click **Advanced → Go to HomeHQ (unsafe)**. It's your
   own app reading your own calendar.

## 5. Configure HomeHQ

Add the credentials to your `.env` file:

```
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
COOKIE_SECRET=generate-with-openssl-rand-hex-32
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

Generate `COOKIE_SECRET` if you haven't already:

```bash
openssl rand -hex 32
```

## Checklist

- [ ] Google Cloud project created
- [ ] Google Calendar API enabled
- [ ] OAuth consent screen configured (Internal for Workspace, or External with test user added)
- [ ] **External only:** app published to production (avoids 7-day refresh token expiry)
- [ ] `calendar.readonly` scope added
- [ ] OAuth client ID created (Web application type)
- [ ] Redirect URI set to `http://localhost:3000/api/oauth/callback`
- [ ] `GOOGLE_CLIENT_ID` added to `.env`
- [ ] `GOOGLE_CLIENT_SECRET` added to `.env`
- [ ] `COOKIE_SECRET` added to `.env`
