import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

import { typeDefs } from './typeDefs.js';
import { resolvers } from './resolvers.js';
import { authConfig, serverConfig, isProduction } from './config/settings.js';
import { ensureIndexes } from './config/indexes.js';

const client = jwksClient({
  jwksUri: authConfig.jwksUri
});

// Helper to get the signing key
const getKey = (header, callback) => {
  client.getSigningKey(header.kid, (err, key) => {
    // Unknown kid (rotated key, wrong tenant, forged header) lands here.
    // Without this guard `key` is undefined and reading .publicKey kills the server.
    if (err) return callback(err);
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
};

const verifyToken = (token) =>
  new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        audience: authConfig.audience,
        issuer: authConfig.issuer,
        algorithms: ['RS256'],
      },
      (err, decoded) => (err ? reject(err) : resolve(decoded))
    );
  });

// Builds the per-request GraphQL context. A missing or invalid token yields an
// anonymous context rather than an HTTP error, so public queries keep working
// and resolvers decide what needs auth via requireUser/requireAdmin.
const buildContext = async ({ req }) => {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match) return {};
  try {
    return { user: await verifyToken(match[1]) };
  } catch (e) {
    console.error('Auth Error', e.message);
    return {};
  }
};

// Fail fast if Mongo is unreachable or the unique indexes conflict with
// existing data, instead of discovering it on the first request.
await ensureIndexes();

const app = express();
const httpServer = http.createServer(app);

const server = new ApolloServer({
  typeDefs,
  resolvers,
  plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
  // Schema exploration is a dev convenience; in production it hands anyone a
  // map of every field and mutation.
  introspection: !isProduction,
  // Stack traces in error responses expose file paths and dependency internals.
  includeStacktraceInErrorResponses: !isProduction,
});
await server.start();

app.use(
  '/graphql',
  cors({ origin: serverConfig.corsOrigins }),
  rateLimit({
    windowMs: serverConfig.rateLimit.windowMs,
    limit: serverConfig.rateLimit.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { errors: [{ message: 'Too many requests, slow down.', extensions: { code: 'RATE_LIMITED' } }] },
  }),
  express.json({ limit: '100kb' }),
  expressMiddleware(server, { context: buildContext })
);

await new Promise((resolve) =>
  httpServer.listen({ port: serverConfig.port, host: serverConfig.host }, resolve)
);
console.log(`🚀  Server ready at: http://${serverConfig.host}:${serverConfig.port}/graphql`);
console.log(`    CORS origins: ${serverConfig.corsOrigins.join(', ')} | introspection: ${!isProduction}`);

// Installed only after a successful listen, so startup failures (EADDRINUSE,
// bad config, Mongo down) still fail loudly instead of hanging. Once serving, a
// stray async throw should be logged rather than take the whole API down.
process.on('uncaughtException', (e) => console.error('Uncaught Exception:', e));
process.on('unhandledRejection', (e) => console.error('Unhandled Rejection:', e));
