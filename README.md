## CookingWDatabase
GraphQL database for cookingwtristan
### Implementation Plan:
* Using GraphQL as communication layer between front end app and backend
* MongoDB to persist recipe and user data
* Redis to cache data for faster access time. Also will aid in API rate limiting and a possible *trending recipes* feature

### First Commit:
* Initialized MongoDB connection and collections
* Initialized GraphQL server
* Established typedefs
* still need to work on resolvers now and mongodb seed file, script for users, being able to handle jwt tokens, auth0, etc
* currently working on jwt tokens and auth0 2/2/26
* Done handling jwt tokens and auth0 setup



### Setup
```
cp .env.example .env   # then edit values
npm install
npm start              # loads .env via node --env-file-if-exists
```

### Required Auth0 Action (login still fails without this)
The frontend requests an **access token** (`audience: https://cookingwtristan-api.com`).
Access tokens carry `iss/sub/aud/iat/exp/scope` and **nothing else** — the
`openid profile email` scope populates the *ID* token, not this one. So
`claims.email` / `claims.nickname` / `claims.picture` are all undefined on the
server, which is what broke `me` on first login.

Fix it in Auth0 → Actions → Library → Build Custom → Login flow:

```js
exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'https://cookingwtristan-api.com';
  api.accessToken.setCustomClaim(`${namespace}/email`, event.user.email);
  api.accessToken.setCustomClaim(`${namespace}/username`,
    event.user.nickname || event.user.name);
  api.accessToken.setCustomClaim(`${namespace}/avatar`, event.user.picture);
  // Required for admin bootstrap. Without it nobody is ever promoted.
  api.accessToken.setCustomClaim(`${namespace}/email_verified`, event.user.email_verified === true);
};
```

Then drag it into the Login flow and hit Apply. Until it is live, `me` returns a
clear `BAD_USER_INPUT` naming the missing claims instead of writing a broken
user document.

### Notes
* Any user created before this fix was stored without `email`/`username` (the
  mongo driver drops `undefined` keys), which made `me` fail forever for them.
  `me` now repairs those records in place on next login.
* `ADMIN_EMAIL` must match the token's email claim, or nobody is admin and
  `createRecipe` returns `FORBIDDEN` for everyone.
* Admin promotion also requires the `email_verified` claim to be `true`. Auth0
  only enforces email uniqueness per connection, so without this check anyone
  could register a password account under the admin address and be seeded as
  admin. If the admin signed up via a password connection, verify the email
  in Auth0 before first login.
* `redis` is still an unused dependency, kept for the planned caching work.
* The server now runs on Express (via `@as-integrations/express5`) so that
  CORS can be restricted to `CORS_ORIGIN` and `/graphql` can be rate
  limited. Introspection and error stack traces are disabled when
  `NODE_ENV=production`. If you deploy behind a reverse proxy, set
  `app.set('trust proxy', 1)` so the rate limiter sees real client IPs.
* Startup creates unique indexes on `recipes.slug` and `users.auth0Id` and
  fails fast if Mongo is unreachable. If existing data already contains
  duplicate slugs or auth0Ids, index creation throws and you must dedupe first.
* Recipe input is validated in `helpers.validateRecipeInput`: non-empty
  trimmed title (max 200 chars) that yields a usable slug, non-negative integer
  prepTime, at least one ingredient with a non-empty name and non-negative
  amount, and at least one non-empty instruction step. A title that collides
  with an existing slug returns `BAD_USER_INPUT`.
* Slugs are generated and looked up with the same `slugify` settings, so
  accented titles round-trip ("Crème" stores and resolves as "creme").
