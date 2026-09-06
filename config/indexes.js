import { recipes, users } from './mongoCollections.js';

// Called once at startup. createIndex is idempotent, so restarting is safe.
// - recipes.slug unique: two recipes with the same title would otherwise share
//   a slug and getRecipeBySlug would return whichever Mongo found first.
// - users.auth0Id unique: two concurrent first-login `me` calls could both
//   miss the findOne and both insert, leaving duplicate user documents.
export const ensureIndexes = async () => {
  const recipeList = await recipes();
  const userList = await users();
  await Promise.all([
    recipeList.createIndex({ slug: 1 }, { unique: true, name: 'slug_unique' }),
    userList.createIndex({ auth0Id: 1 }, { unique: true, name: 'auth0Id_unique' })
  ]);
};
