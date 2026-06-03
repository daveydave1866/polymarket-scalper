---
name: Auth security rules
description: Required security constraints for JWT auth and user registration
---

**JWT secret:** Must come from `process.env.JWT_SECRET ?? process.env.BOT_API_KEY`. If neither is set, throw at call time — never fall back to a hardcoded string. Hardcoded fallbacks weaken auth for users who forget to set env vars.

**Password logging:** Never log passwords in plaintext, including default/generated passwords on first-admin creation. Log only the username and a reminder to change the credential.

**Self-assigned admin role:** The `/auth/register` endpoint must always assign `"user"` role to non-first registrations, regardless of what the request body contains. Only admins can elevate roles via the admin panel (`PUT /api/admin/users/:id`).

**Why:** Caught in code review during multi-user implementation. All three were introduced as subtle bugs during the refactor.

**How to apply:** Any future auth route or startup credential seeding should follow these rules before submission.
