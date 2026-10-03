import {dbConnection} from './mongoConnection.js';

const getCollectionFn = (collection) => {
  let _col = undefined;

  return async () => {
    if (!_col) {
      const db = await dbConnection();
      _col = await db.collection(collection);
    }

    return _col;
  };
};

export const recipes = getCollectionFn('recipes');
export const users = getCollectionFn('users');
// One row per (recipeId, userId). See config/indexes.js for the unique index.
export const likes = getCollectionFn('likes');
export const favorites = getCollectionFn('favorites');
