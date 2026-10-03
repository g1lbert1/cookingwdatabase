import { recipes, users } from './mongoCollections.js';

// Called once at startup. createIndex is idempotent, so restarting is safe.
// - recipes.slug unique: two recipes with the same title would otherwise share
//   a slug and getRecipeBySlug would return whichever Mongo found first.
// - users.auth0Id unique: two concurrent first-login `me` calls could both
//   miss the findOne and both insert, leaving duplicate user documents.
// - recipes popularity: the list query sorts by likeCount desc, createdAt desc.
// - recipes.authorId: "recipes by this user" lookups (profile page, cleanup).
export const ensureIndexes = async () => {
  const recipeList = await recipes();
  const userList = await users();
  await Promise.all([
    recipeList.createIndex({ slug: 1 }, { unique: true, name: 'slug_unique' }),
    recipeList.createIndex({ likeCount: -1, createdAt: -1 }, { name: 'popularity' }),
    recipeList.createIndex({ authorId: 1 }, { name: 'authorId' }),
    userList.createIndex({ auth0Id: 1 }, { unique: true, name: 'auth0Id_unique' })
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
