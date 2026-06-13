# 022 — Authentication: Registration & Login

**Status:** completed

## Background

The platform had zero authentication — every `/api/*` route and the SSE `/events` stream were open, and the React client had no route guards. This is phase 1 of a two-phase auth effort (phase 2 is user management / coworker invites).

## Problem

We need email/password registration and login, a session mechanism that survives reloads, and role-based gating, without pulling in a heavyweight auth framework or breaking the existing DDD layering.

## Design

- **Crypto/JWT primitives** live in `src/infrastructure/auth/`: `hashPassword.ts` (bcrypt, 12 rounds) and `jwtService.ts` (`signToken`/`verifyToken`, `JwtPayload` = `{ userId, orgId, role }`, 7-day expiry, `JWT_SECRET` from env).
- **Use cases** live in `src/application/auth/`: `registerOrganization` (validate password ≥12 chars + number + symbol, hash via `AuthDb.hashPassword`, create org+user in one transaction, return `AuthUser`) and `loginUser` (lookup by lowercased email, compare via `AuthDb.comparePassword`, reject deactivated). Both depend on a narrow `AuthDb` port and throw `AuthError` (carries an HTTP `status`). Shared `AuthUser` interface is the password-free user shape used everywhere.
- **Two new tables** (`organizations`, `users`) via migration `0007_auth.sql` and matching Drizzle definitions. Registration inserts both in a single `pg` transaction (BEGIN/COMMIT/ROLLBACK); unique-violation (`23505`) maps to a 409.
- **`AuthDb` port** includes `findUserByEmail`, `createOrgAndUser`, `hashPassword`, and `comparePassword` — keeping all infrastructure concerns out of the application layer.
- **Express middleware** (`src/api/middleware/`): `authenticate` reads the `auth_token` httpOnly cookie, verifies the JWT, and attaches `req.user: AuthUser`; `requireRole(role)` is a 403 factory for future admin-only routes. JWT carries only id/org/role; `/api/auth/me` re-queries for the full profile.
- **Routes** (`src/api/routes/auth.ts`): `register`, `login`, `logout`, `me`. Cookie config: `httpOnly`, `secure` in prod, `sameSite: 'lax'`, `maxAge` 7 days.
- **server.ts wiring:** mount `cookieParser()`, then the public `/api/auth` router, then `app.use('/api', authenticate)` and `app.use('/events', authenticate)` so all other API/SSE routes are gated. CORS gained `credentials: true`.
- **Frontend:** `AuthContext` (calls `/api/auth/me` on mount, exposes `user/loading/login/logout/setUser`), `ProtectedRoute` (spinner while loading → redirect to `/login` if no user), and `LoginPage` / `RegisterPage`. `/login` and `/register` render outside `Layout` and `ProtectedRoute`; everything else is wrapped by both. All `client/src/api.ts` fetches send `credentials: 'include'`.

## Questions and Answers

- **Why JWT in a cookie rather than localStorage?** httpOnly cookies are not readable by JS, mitigating XSS token theft. `sameSite: 'lax'` covers basic CSRF for this phase.
- **Why re-query in `/me` instead of putting the profile in the token?** Keeps the token small and avoids stale name/email/status after edits.
- **Why a narrow `AuthDb` port with hash/compare methods?** Keeps all infrastructure concerns (bcrypt, pg) out of the application layer so use cases are unit-testable without a live database or real bcrypt calls.

## Trade-offs

- No refresh tokens — a 7-day expiry is acceptable for now; users re-login after expiry.
- No rate limiting on auth endpoints (deferred).
- Google/SAML buttons and Forgot Password are UI placeholders; Remember Me is cosmetic (does not change cookie lifetime).
- Parsers are not yet scoped to organizations (deferred to phase 2).

## Implementation Results

- New tables `organizations` + `users`; migration `0007_auth.sql`.
- New modules under `infrastructure/auth`, `application/auth`, `api/middleware`, `api/routes/auth.ts`.
- Unit tests: `hashPassword`, `jwtService`, `RegisterOrganization`, `LoginUser`.
- Frontend: `AuthContext`, `ProtectedRoute`, `LoginPage`, `RegisterPage`; routing updated in `App.tsx` and `main.tsx`.
