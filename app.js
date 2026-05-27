import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';

import { typeDefs } from './typeDefs.js';
import { resolvers } from './resolvers.js';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const client = jwksClient({
  //.env this
  jwksUri: `https://dev-5jcvwvffofu7udns.us.auth0.com/.well-known/jwks.json`
});

// Helper to get the signing key
const getKey = (header, callback) => {
  client.getSigningKey(header.kid, (err, key) => {
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
};

const server = new ApolloServer({
  typeDefs,
  resolvers
});

const {url} = await startStandaloneServer(server, {
  listen: {port: 4000, host: '0.0.0.0'},
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
              audience: 'https://cookingwtristan-api.com',
              issuer: 'https://dev-5jcvwvffofu7udns.us.auth0.com/',
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
