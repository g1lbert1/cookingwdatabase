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

### Sharing (branch `sharing`)
Any signed-in user can post recipes; they appear in the same list as the
site's own, most liked first.

* `recipes` sorts by `likeCount` desc, then `createdAt` desc. Both fields are
  set on insert and backfilled at startup for older documents
  (`backfillRecipeDefaults`), so nothing sinks to the bottom for lacking them.
* Each recipe stores `authorId` (the poster's `users._id`). The API exposes it
  as `author { _id username avatar }`, never the email. Recipes with no
  `authorId` are the site's own and show `author: null`.
* `createRecipe` and `createImageUploadSignature` need any signed-in user.
  `updateRecipe` and `deleteRecipe` need the author or an admin, otherwise
  `FORBIDDEN`. Edits cannot change `authorId`, `likeCount` or `createdAt`.
* Two people can post the same title: on a slug collision the second one gets
  a short random suffix (`garlic-bread-3f9a1c`) instead of an error.
* Likes and favorites are their own collections (`likes`, `favorites`), one
  row per `(recipeId, userId)` under a unique index, so `likeRecipe` and
  friends are idempotent. Liking also `$inc`s `recipes.likeCount`, the
  denormalised counter the list sorts on; favorites keep no counter. Every
  Recipe carries `likedByMe` / `favoritedByMe` for the caller (false when
  anonymous), and `me { recipes likedRecipes favoriteRecipes }` feeds the
  profile tabs. Deleting a recipe removes its reaction rows.
* Comments live in a `comments` collection (`recipeId`, `authorId`, `body`,
  `createdAt`) and are only read through `Recipe.comments`, oldest first, so
  list queries never load threads. `recipes.commentCount` is the counter the
  cards show. `addComment` needs a signed-in user and a trimmed body of 1 to
  1000 characters; `deleteComment` is allowed for the comment's author, the
  recipe's author (so posters can moderate their own threads), or an admin.
  Each Comment carries `canDelete` for the caller. Deleting a recipe removes
  its comments.

### Notes
* Any user created before this fix was stored without `email`/`username` (the
  mongo driver drops `undefined` keys), which made `me` fail forever for them.
  `me` now repairs those records in place on next login.
* `ADMIN_EMAIL` must match the token's email claim, or nobody is admin and
  `createRecipe` returns `FORBIDDEN` for everyone. The check runs on every
  `me` call, not just when the user record is first created, so setting or
  changing `ADMIN_EMAIL` promotes the matching account on its next login.
* Admin promotion also requires the `email_verified` claim to be `true`. Auth0
  only enforces email uniqueness per connection, so without this check anyone
  could register a password account under the admin address and be seeded as
  admin. If the admin signed up via a password connection, verify the email
  in Auth0 before first login.
* `redis` is still an unused dependency, kept for the planned caching work.
* The server now runs on Express (via `@as-integrations/express5`) so that
  CORS can be restricted to `CORS_ORIGIN` and `/graphql` can be rate
  limited. Introspection and error stack traces are disabled when
  `NODE_ENV=production`, which also enables `trust proxy` (one hop) so the
  rate limiter sees real client IPs behind the host's reverse proxy.
* Startup creates unique indexes on `recipes.slug` and `users.auth0Id` and
  fails fast if Mongo is unreachable. If existing data already contains
  duplicate slugs or auth0Ids, index creation throws and you must dedupe first.
* Recipe input is validated in `helpers.validateRecipeInput`: non-empty
  trimmed title (max 200 chars) that yields a usable slug, non-negative integer
  prepTime, at least one ingredient with a non-empty name and non-negative
  amount, and at least one non-empty instruction step. A title that collides
  with an existing slug returns `BAD_USER_INPUT`.
* Recipes have an optional `imageUrl`. It must be an absolute http(s) URL or
  a root-relative path (e.g. `/carbonara.jpg` for a file in the frontend's
  `public/` folder). Other schemes such as `javascript:` and `data:` are
  rejected, so the value is always safe to use as an `<img src>`.
* Photos are uploaded from the browser straight to Cloudinary, not through
  this API. `createImageUploadSignature` (any signed-in user) returns the
  cloud name, API key and a list of signed fields; the browser posts the file
  plus those fields verbatim and stores the returned `secure_url` in
  `imageUrl`. Set the three `CLOUDINARY_*` variables to enable it.

### Upload safeguards
Everything that constrains an upload is inside the signature, so Cloudinary
enforces it server-side no matter what a client sends:

* `allowed_formats` = jpg, png, webp, heic, avif. No SVG (scriptable), no GIF,
  no raw files. A disallowed file is rejected before it is stored.
* `transformation` = `c_limit,w_2400,h_2400,q_auto:good`, applied on the way
  in. The file is re-encoded (which drops EXIF/GPS and anything hidden in the
  container) and capped in size at rest.
* `public_id` = a random id per signature. Signatures stay valid for about an
  hour and can be replayed; pinning the id means a replay can only overwrite
  that one asset rather than mint unlimited new ones.
* `tags` = `user_<mongo id>`, so one search in the Cloudinary console finds
  (and can purge) everything a given account uploaded.
* Per-user quota: `UPLOAD_SIGNATURES_PER_HOUR` (default 20) signatures per
  user per sliding hour, kept in process memory, `RATE_LIMITED` beyond it.
  With more than one API instance this belongs in a shared store.
* `imageUrl` on a recipe must be either a root-relative path (`/x.jpg` in the
  frontend's public folder) or a bare delivery URL in this cloud and folder
  with an allowed extension. Third-party hosts, other clouds or folders,
  transformation segments and `raw`/`video` URLs are all rejected, so nobody
  can hotlink a tracking pixel or unmoderated content into the list.

* Orphan cleanup: when a recipe is deleted, or an edit replaces or removes
  its photo, the server calls Cloudinary's signed `destroy` for the old
  asset (`cloudinary.js`). Best effort: it runs after the database change
  and a failure is logged, never surfaced, so a Cloudinary hiccup cannot
  cost a user their edit. Only URLs in this cloud and folder are touched.

* Orphan sweep (`orphanSweep.js`): a photo uploaded but never saved (an
  abandoned form, or "Replace photo" used twice before saving) is tied to
  no recipe, so the per-mutation cleanup never sees it. The sweep lists the
  folder through the Admin API and deletes assets that are (a) tagged
  `user_<id>`, i.e. uploaded through this API, (b) referenced by no
  `recipes.imageUrl`, and (c) older than `ORPHAN_SWEEP_GRACE_HOURS`
  (default 24). Untagged assets, which includes everything uploaded before
  tagging existed and anything placed in the folder by hand, are never
  touched. It runs a minute after boot and then daily when
  `ORPHAN_SWEEP=on` (the default in production), and by hand with
  `npm run sweep-orphans` (dry run; add `-- --delete` to remove,
  `-- --grace=48` to widen the grace period).

  **One folder, one database.** The sweep's reference set is whatever
  database this process is connected to, while the Cloudinary folder is
  shared by every environment using the account. A sweep from a laptop
  pointed at the production folder would treat production photos as
  orphans. Give development its own `CLOUDINARY_FOLDER` (for example
  `cookingwtristan-dev`); that is also why the automatic sweep is off
  outside production.

Still open, on purpose:
* No content moderation. Cloudinary's AWS Rekognition moderation add-on can
  be turned on by signing `moderation=aws_rek`; it is paid.

In the Cloudinary console (Settings → Security / Upload) keep **unsigned
uploads disabled**, leave the default upload preset signed, and consider
**Strict transformations** off only because the frontend builds display
transformations client-side.

* Slugs are generated and looked up with the same `slugify` settings, so
  accented titles round-trip ("Crème" stores and resolves as "creme").
