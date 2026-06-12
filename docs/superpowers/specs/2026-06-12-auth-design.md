# Auth: Registration & Login

**Date:** 2026-06-12  
**Status:** Approved  
**Branch:** `feat/auth`

---

## Background

The scraper platform currently has zero authentication — all API endpoints are open and the React client has no route guards. The next two phases add:

1. **(This spec)** Registration, login, JWT session, role model — foundation layer
2. **(Next spec)** User Management — invite coworkers, change roles, deactivate users

---

## Scope

Email/password authentication only. Google and SAML SSO buttons render in the UI but are disabled ("Coming soon"). Forgot Password link is a placeholder. No email delivery infrastructure required.

---

## Database Schema

Two new Drizzle tables, one migration file.

```
organizations
  id          uuid PK default random()
  name        text NOT NULL UNIQUE
  industry    text NOT NULL
  createdAt   timestamptz NOT NULL default now()
  updatedAt   timestamptz NOT NULL default now()

users
  id             uuid PK default random()
  organizationId uuid NOT NULL FK → organizations(id) ON DELETE CASCADE
  fullName       text NOT NULL
  email          text NOT NULL UNIQUE
  passwordHash   text NOT NULL
  role           text NOT NULL  -- 'admin' | 'coworker'
  status         text NOT NULL  -- 'active' | 'pending' | 'deactivated'
  createdAt      timestamptz NOT NULL default now()
  updatedAt      timestamptz NOT NULL default now()
```

**Registration is atomic** — org and admin user are created in a single PostgreSQL transaction. If either insert fails, both roll back.

Existing tables (`parsers`, `steps`, `parser_runs`, etc.) are unchanged. Parser-to-org scoping is deferred to the User Management phase.

---

## Backend Architecture

### New packages
- `bcrypt` + `@types/bcrypt`
- `jsonwebtoken` + `@types/jsonwebtoken`
- `cookie-parser` + `@types/cookie-parser`

### New files (DDD layering)

```
src/infrastructure/auth/
  hashPassword.ts        bcrypt hash (rounds=12) + compare helpers
  jwtService.ts          sign() and verify(); JWT payload below

src/application/auth/
  RegisterOrganization.ts  validate input → hash password → create org+user in tx → return user
  LoginUser.ts             lookup user by email → bcrypt compare → return user or throw

src/api/routes/
  auth.ts                  4 endpoints (see below)

src/api/middleware/
  authenticate.ts          read httpOnly cookie → verify JWT → attach req.user → 401 on fail
  requireRole.ts           requireRole('admin') factory → 403 if role doesn't match
```

### JWT payload
```ts
{
  userId: string
  orgId:  string
  role:   'admin' | 'coworker'
  iat:    number
  exp:    number   // 7 days
}
```

### Cookie config
```ts
{
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000,  // 7 days in ms
}
```

### Auth API endpoints
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/register` | Create org + admin user, set cookie, return user |
| POST | `/api/auth/login` | Verify credentials, set cookie, return user |
| POST | `/api/auth/logout` | Clear cookie |
| GET | `/api/auth/me` | Return `req.user` (called on client init) |

### Global middleware
`authenticate` middleware applied globally to all `/api/*` and `/events` routes in `server.ts`. Auth routes (`/api/auth/*`) are excluded from the auth check.

### Password validation
- Minimum 12 characters
- Must contain at least one number and one symbol
- Validated in `RegisterOrganization.ts` before hashing

---

## Frontend Architecture

### No new packages required

### New files

```
client/src/context/AuthContext.tsx
  Fetches GET /api/auth/me on mount.
  Exposes: { user, login(), logout(), loading }
  login()  → POST /api/auth/login → updates user state
  logout() → POST /api/auth/logout → clears user → navigate('/login')

client/src/components/ProtectedRoute.tsx
  loading  → full-screen spinner
  no user  → <Navigate to="/login" replace />
  user     → renders children

client/src/pages/LoginPage.tsx
  Centered card on light gray background.
  Fields: Email Address, Password (show/hide toggle)
  Controls: Remember Me checkbox (cosmetic — no effect on cookie duration this phase), Forgot Password link (placeholder — shows toast "Not implemented")
  Primary button: "Sign In →"
  Disabled buttons: Google, SAML SSO (tooltip "Coming soon")
  Footer link: "Register your organization" → /register

client/src/pages/RegisterPage.tsx
  Split layout: dark marketing panel (left 1/3) + white form (right 2/3).
  Fields: Organization Name, Industry (dropdown), Admin Full Name,
          Professional Email, Password (show/hide, min 12 chars hint),
          Terms checkbox (required; "Service Agreement" and "Privacy Policy" links are placeholder href="#")
  Primary button: "Register Organization →"
  Footer link: "Already have an account? SIGN IN" → /login
  Footer badges: ISO 27001, AES-256, Global Edge Network (static)
```

### Industry dropdown options
Technology, Finance, Healthcare, Retail, Manufacturing, Media, Education, Other

### Routing changes (`App.tsx`)
```
/login      LoginPage     — outside Layout, outside ProtectedRoute
/register   RegisterPage  — outside Layout, outside ProtectedRoute
/*          ProtectedRoute → Layout → existing routes
```

`AuthContext` wraps the entire app at the root level (`main.tsx`).

---

## Data Flow

### Registration
1. User fills form → client POSTs `/api/auth/register`
2. `RegisterOrganization` validates, hashes pw, creates org+user in tx
3. Server signs JWT, sets httpOnly cookie, returns `{ user }`
4. Client stores user in `AuthContext`, redirects to `/`

### Login
1. User fills form → client POSTs `/api/auth/login`
2. `LoginUser` looks up by email, runs `bcrypt.compare`
3. Server signs JWT, sets httpOnly cookie, returns `{ user }`
4. Client stores user in `AuthContext`, redirects to `/`

### Session restore (app init)
1. `AuthContext` mounts → GET `/api/auth/me`
2. Browser sends cookie automatically
3. `authenticate` middleware verifies JWT → returns `{ user }`
4. `AuthContext` sets user, unblocks `ProtectedRoute`

### Logout
1. User clicks logout → POST `/api/auth/logout`
2. Server clears cookie
3. `AuthContext` clears user → navigate to `/login`

---

## Error Handling

| Scenario | HTTP | Client behavior |
|----------|------|-----------------|
| Email already registered | 409 | Inline form error |
| Wrong email/password | 401 | "Invalid email or password" (no hint which) |
| Missing/expired JWT on API call | 401 | `AuthContext` clears user, redirects to `/login` |
| Insufficient role | 403 | Error toast |
| Password too weak | 400 | Inline form error |

---

## What's NOT in this phase

- Google / SAML SSO (UI placeholders only)
- Forgot password / password reset email flow
- Parser scoping to organizations
- User invite flow (next phase)
- Refresh tokens (7-day expiry is sufficient for now)
- Rate limiting on auth endpoints

---

## Design Log

This change is architectural (new domain entities, new DB tables, new API routes, new middleware layer). A design log entry must be created in `design-log/` after implementation.
