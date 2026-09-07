// Config is read from the environment. `npm start` loads .env via node's
// built-in --env-file-if-exists, so there is no dotenv dependency.
// See .env.example for the full list of keys.

const required = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. Copy .env.example to .env and fill it in.`
    );
  }
  return value;
};

export const isProduction = process.env.NODE_ENV === 'production';

export const mongoConfig = {
  serverUrl: process.env.MONGO_URL || 'mongodb://localhost:27017/',
  database: process.env.MONGO_DB || 'cookingwdatabase'
};

const domain = required('AUTH0_DOMAIN');

export const authConfig = {
  domain,
  audience: required('AUTH0_AUDIENCE'),
  // Auth0 issuers always carry the trailing slash.
  issuer: `https://${domain}/`,
  jwksUri: `https://${domain}/.well-known/jwks.json`,
  // Optional. When unset, nobody is auto-promoted to admin.
  adminEmail: process.env.ADMIN_EMAIL || null
};

export const serverConfig = {
  port: Number(process.env.PORT) || 4000,
  host: process.env.HOST || '0.0.0.0',
  // Comma-separated list of browser origins allowed to call the API.
  // Defaults to the Vite dev server. The API uses bearer tokens, not cookies,
  // so a wildcard would not leak sessions, but it still lets any site drive
  // the API with a token it has obtained and hides misconfigured deployments.
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  // Requests per IP per window. Generous for a recipe site; tighten if abused.
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 300
  }
};
