import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';

import { typeDefs } from './typeDefs.js';
import { resolvers } from './resolvers.js';
import { authConfig, serverConfig } from './config/settings.js';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

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

const server = new ApolloServer({
  typeDefs,
  resolvers
});

const {url} = await startStandaloneServer(server, {
  listen: {port: serverConfig.port, host: serverConfig.host},
  context: async ({ req }) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    if(!token) return {};
      try{
        //replaces jwt with secure verification
        const user = await new Promise((resolve, reject) => {
          jwt.verify(
            token,
            getKey,
            {
              audience: authConfig.audience,
              issuer: authConfig.issuer,
              algorithms: ['RS256'],
            },
            (err, decoded) => {
              if(err) return reject(err);
              resolve(decoded);
            }
          );
        });
        return { user };
      } catch (e) {
        console.error("Auth Error", e.message);
        return {};
    }
  },
});
console.log(`🚀  Server ready at: ${url}`);

// Installed only after a successful listen, so startup failures (EADDRINUSE,
// bad config) still fail loudly instead of hanging. Once serving, a stray async
// throw should be logged rather than take the whole API down.
process.on('uncaughtException', (e) => console.error('Uncaught Exception:', e));
process.on('unhandledRejection', (e) => console.error('Unhandled Rejection:', e));
