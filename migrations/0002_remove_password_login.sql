-- Sign-in moved to Cloudflare Access; the app no longer issues its own sessions.
DROP TABLE sessions;
DROP TABLE login_limits;
