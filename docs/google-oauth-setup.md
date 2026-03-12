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
2. Select **External** user type → **Create**
3. Fill in the required fields:
   - **App name:** `HomeHQ`
   - **User support email:** your email
   - **Developer contact email:** your email
4. Click **Save and Continue**
5. On the **Scopes** step, click **Add or Remove Scopes**
   - Search for and add: `https://www.googleapis.com/auth/calendar.readonly`
   - This is the only scope needed for MVP (read-only calendar access)
   - Click **Update** → **Save and Continue**
6. On the **Test users** step, click **Add Users**
   - Add the Google account email that owns the family calendars
   - Click **Save and Continue**
7. Click **Back to Dashboard**

> **Why "External" + test users?** Publishing the app requires Google review, which isn't needed for a single-household app. Keeping it in "Testing" mode with your account added as a test user works indefinitely.

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
- [ ] OAuth consent screen configured (External, testing mode)
- [ ] Your Google account added as a test user
- [ ] `calendar.readonly` scope added
- [ ] OAuth client ID created (Web application type)
- [ ] Redirect URI set to `http://localhost:3000/api/oauth/callback`
- [ ] `GOOGLE_CLIENT_ID` added to `.env`
- [ ] `GOOGLE_CLIENT_SECRET` added to `.env`
- [ ] `COOKIE_SECRET` added to `.env`
