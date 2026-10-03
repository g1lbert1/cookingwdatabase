import { recipes, users, likes, favorites, comments } from './mongoCollections.js';

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
