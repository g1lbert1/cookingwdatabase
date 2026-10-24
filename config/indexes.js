import { recipes, users, likes, favorites, comments } from './mongoCollections.js';
import { usernameKey, withUsernameSuffix } from '../usernames.js';

// Users from before usernames were unique have no usernameLower. Give each
// one its key; where two accounts share a name apart from case, the newer
// account gets a short suffix so the unique index can be created. Must run
// before ensureIndexes. Idempotent: only documents without the key are
// touched, and a rename is logged so it can be explained to the person.
export const backfillUsernames = async () => {
  const userList = await users();
  const missing = await userList
    .find({ usernameLower: { $exists: false } }, { projection: { username: 1 } })
    .sort({ _id: 1 })
    .toArray();
  if(missing.length === 0) return;
  const taken = new Set(
    (await userList.find({ usernameLower: { $type: 'string' } }, { projection: { usernameLower: 1 } }).toArray())
      .map((u) => u.usernameLower)
  );
  for(const u of missing){
    let username = String(u.username ?? '').trim() || 'cook';
    let key = usernameKey(username);
    while(taken.has(key)){
      username = withUsernameSuffix(username);
      key = usernameKey(username);
    }
    if(username !== u.username){
      console.warn(`backfillUsernames: "${u.username}" (${u._id}) renamed to "${username}" to make usernames unique.`);
    }
    taken.add(key);
    await userList.updateOne({ _id: u._id }, { $set: { username, usernameLower: key } });
  }
};

// Called once at startup. createIndex is idempotent, so restarting is safe.
// - recipes.slug unique: two recipes with the same title would otherwise share
//   a slug and getRecipeBySlug would return whichever Mongo found first.
// - users.auth0Id unique: two concurrent first-login `me` calls could both
//   miss the findOne and both insert, leaving duplicate user documents.
// - recipes popularity: the list query sorts by likeCount desc, createdAt desc.
// - recipes.authorId: "recipes by this user" lookups (profile page, cleanup).
// - likes/favorites (recipeId, userId) unique: a double-tap inserts nothing
//   and recipes.likeCount can only move once per user. The userId index
//   backs the profile's "liked" and "favorites" tabs, newest first.
// - comments (recipeId, createdAt): the recipe page reads a thread in order.
export const ensureIndexes = async () => {
  const recipeList = await recipes();
  const userList = await users();
  const commentList = await comments();
  const reactionIndexes = async (rows) => {
    await rows.createIndex({ recipeId: 1, userId: 1 }, { unique: true, name: 'recipe_user_unique' });
    await rows.createIndex({ userId: 1, createdAt: -1 }, { name: 'user_recent' });
  };
  await Promise.all([
    recipeList.createIndex({ slug: 1 }, { unique: true, name: 'slug_unique' }),
    recipeList.createIndex({ likeCount: -1, createdAt: -1 }, { name: 'popularity' }),
    recipeList.createIndex({ authorId: 1 }, { name: 'authorId' }),
    userList.createIndex({ auth0Id: 1 }, { unique: true, name: 'auth0Id_unique' }),
    //Case-insensitive uniqueness for usernames and the lookup behind /u/:name.
    //Partial so the index never trips over a document the backfill below has
    //not reached (there should be none once backfillUsernames has run).
    userList.createIndex(
      { usernameLower: 1 },
      { unique: true, name: 'username_unique', partialFilterExpression: { usernameLower: { $type: 'string' } } }
    ),
    //Old names after a rename, so a stale link still finds its owner and a
    //rename cannot grab a name someone gave up a moment ago.
    userList.createIndex({ 'previousUsernames.usernameLower': 1 }, { name: 'previous_usernames' }),
    reactionIndexes(await likes()),
    reactionIndexes(await favorites()),
    commentList.createIndex({ recipeId: 1, createdAt: 1 }, { name: 'recipe_thread' }),
    commentList.createIndex({ authorId: 1 }, { name: 'authorId' })
  ]);
};

// Recipes written before sharing existed have no likeCount or createdAt. Mongo
// sorts a missing field below every present value, so without this backfill
// the original recipes would sink to the bottom of the list. createdAt is
// recovered from the ObjectId, which embeds the insertion time. Idempotent:
// only documents still missing a field are touched.
export const backfillRecipeDefaults = async () => {
  const recipeList = await recipes();
  await recipeList.updateMany(
    { likeCount: { $exists: false } },
    { $set: { likeCount: 0 } }
  );
  await recipeList.updateMany(
    { commentCount: { $exists: false } },
    { $set: { commentCount: 0 } }
  );
  const missingCreatedAt = await recipeList
    .find({ createdAt: { $exists: false } }, { projection: { _id: 1 } })
    .toArray();
  await Promise.all(
    missingCreatedAt.map((r) =>
      recipeList.updateOne(
        { _id: r._id },
        { $set: { createdAt: r._id.getTimestamp().toISOString() } }
      )
    )
  );
};
