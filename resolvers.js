import { createHash, randomBytes } from 'node:crypto';
import { GraphQLError } from 'graphql';
import helpers from './helpers.js';
import { authConfig, cloudinaryConfig } from './config/settings.js';
import { recipes as recipeCollection } from './config/mongoCollections.js';
import { users as userCollection } from './config/mongoCollections.js';

//Pulls profile fields out of the access token.
//These only exist if an Auth0 Action adds them as namespaced custom claims --
//a raw access token carries iss/sub/aud/iat/exp/scope and nothing else.
const profileFromClaims = (claims) => {
  const namespace = authConfig.audience;
  return {
    email: claims[`${namespace}/email`] || claims.email || null,
    username: claims[`${namespace}/username`] || claims.nickname || claims.name || null,
    avatar: claims[`${namespace}/avatar`] || claims.picture || null,
    //Auth0 only enforces email uniqueness per connection, so an unverified
    //password signup can carry any address. Only trust email for authorization
    //when the Action reports it verified; an absent claim counts as unverified.
    emailVerified:
      claims[`${namespace}/email_verified`] === true || claims.email_verified === true
  };
};

//email and username are non-nullable in the schema, so refuse to persist a user
//without them rather than writing a document that can never be read back.
const requireProfile = (profile) => {
  const missing = ['email', 'username'].filter((field) => !profile[field]);
  if(missing.length){
    throw new GraphQLError(
      `Token is missing required profile claim(s): ${missing.join(', ')}. ` +
      `Add an Auth0 Action that sets ${authConfig.audience}/email and ` +
      `${authConfig.audience}/username on the access token.`,
      { extensions: {code: 'BAD_USER_INPUT'} }
    );
  }
  return profile;
};

//The configured ADMIN_EMAIL is the source of truth for who is admin. Only a
//verified email counts: Auth0 enforces uniqueness per connection, so an
//unverified password signup could otherwise claim any address.
const isConfiguredAdmin = (profile) =>
  Boolean(authConfig.adminEmail) &&
  profile.emailVerified &&
  profile.email === authConfig.adminEmail;

const requireUser = (context) => {
  if(!context.user){
    throw new GraphQLError(`User must be logged in`, {
      extensions: {code: 'UNAUTHENTICATED'}
    });
  }
  return context.user;
};

//Resolves the token to a user document, creating it on first login and
//repairing or promoting it as needed. Every mutation that writes on behalf
//of a user goes through here, so a brand-new account can post a recipe
//without having loaded the profile page first.
const requireAccount = async (context) => {
  const claims = requireUser(context);
  const userList = await userCollection();
  let currentUser = await userList.findOne({ auth0Id: claims.sub });
  const profile = profileFromClaims(claims);

  if(!currentUser){
    requireProfile(profile);
    const newUser = {
      auth0Id: claims.sub,
      email: profile.email,
      username: profile.username,
      avatar: profile.avatar,
      createdAt: new Date().toISOString(),
      role: isConfiguredAdmin(profile) ? "admin" : "user"
    };
    const insertInfo = await userList.insertOne(newUser);
    currentUser = await userList.findOne({ _id: insertInfo.insertedId });
  } else if(!currentUser.email || !currentUser.username){
    //Repairs records written before the claims were validated, which the
    //mongo driver stored with the undefined fields dropped entirely.
    requireProfile(profile);
    await userList.updateOne(
      { _id: currentUser._id },
      { $set: {
        email: profile.email,
        username: profile.username,
        avatar: currentUser.avatar ?? profile.avatar
      } }
    );
    currentUser = await userList.findOne({ _id: currentUser._id });
  }

  //Re-check on every login rather than only at creation. Otherwise an
  //account created before ADMIN_EMAIL was set (or against a fresh
  //database) is stuck as "user" until someone edits Mongo by hand.
  if(currentUser.role !== "admin" && isConfiguredAdmin(profile)){
    await userList.updateOne({ _id: currentUser._id }, { $set: { role: "admin" } });
    currentUser = { ...currentUser, role: "admin" };
  }

  return currentUser;
};

const isAdmin = (user) => user?.role === "admin";

//Authors manage their own recipes; admins manage everything. Recipes from
//before sharing existed have no authorId and are admin-only.
const canManage = (user, recipe) =>
  isAdmin(user) || (recipe.authorId != null && recipe.authorId.equals(user._id));

const requireManageable = async (context, _id) => {
  const user = await requireAccount(context);
  const objectId = helpers.validateId(_id);
  const recipeList = await recipeCollection();
  const recipe = await recipeList.findOne({ _id: objectId });
  if(!recipe){
    throw new GraphQLError('Recipe Not Found', {
      extensions: {code: 'NOT_FOUND'}
    });
  }
  if(!canManage(user, recipe)){
    throw new GraphQLError("You can only change recipes you posted.", {
      extensions: { code: "FORBIDDEN" }
    });
  }
  return { user, recipe, recipeList };
};

//Only the public fields. The User type carries the email and is reserved
//for `me`.
const toAuthor = (user) =>
  user
    ? { _id: user._id.toString(), username: user.username, avatar: user.avatar ?? null }
    : null;

//Attaches `author` to each recipe with one users query instead of one per
//recipe. Recipes without an authorId get null.
const attachAuthors = async (recipeDocs) => {
  const authorIds = recipeDocs.filter((r) => r.authorId).map((r) => r.authorId);
  if(authorIds.length === 0) return recipeDocs.map((r) => ({ ...r, author: null }));
  const userList = await userCollection();
  const authors = await userList
    .find({ _id: { $in: authorIds } })
    .project({ username: 1, avatar: 1 })
    .toArray();
  const byId = new Map(authors.map((u) => [u._id.toString(), toAuthor(u)]));
  return recipeDocs.map((r) => ({
    ...r,
    author: r.authorId ? byId.get(r.authorId.toString()) ?? null : null
  }));
};

const serializeRecipe = (recipe) => ({
  ...recipe,
  _id: recipe._id.toString(),
  likeCount: recipe.likeCount ?? 0,
  createdAt: recipe.createdAt ?? null,
  author: recipe.author ?? null
});

//Mongo raises E11000 when a write violates the unique slug index. With many
//people posting, two recipes called "Carbonara" are expected rather than a
//mistake, so the second one gets a short random suffix on its slug instead
//of an error.
const isDuplicateKey = (e) => e?.code === 11000;
const SLUG_ATTEMPTS = 4;
const withSlugSuffix = (slug) => `${slug}-${randomBytes(3).toString('hex')}`;
const duplicateTitleError = (title) =>
  new GraphQLError(`A recipe titled "${title}" already exists. Choose a different title.`, {
    extensions: {code: 'BAD_USER_INPUT'}
  });

//Runs `write(slug)` with the plain slug first, then with suffixed slugs on
//collision. Gives up with the duplicate-title error only if every attempt
//collides, which would take a remarkable run of bad luck.
const retryOnSlugCollision = async (recipe, write) => {
  let slug = recipe.slug;
  for(let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++){
    try {
      return await write(slug);
    } catch (e) {
      if(!isDuplicateKey(e)) throw e;
      slug = withSlugSuffix(recipe.slug);
    }
  }
  throw duplicateTitleError(recipe.title);
};

//Cloudinary signed-upload scheme: sort the params to sign alphabetically,
//join as key=value&..., append the API secret, SHA-1 the result. The browser
//sends the same params plus the signature; Cloudinary recomputes and compares.
//https://cloudinary.com/documentation/upload_images#generating_authentication_signatures
const signUploadParams = (params, secret) => {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1').update(toSign + secret).digest('hex');
};

export const resolvers = {
  //Query Resolver
  Query: {
    //Most liked first. createdAt breaks ties so new posts surface above older
    //ones at the same count, and _id makes the order stable across pages.
    recipes: async () => {
      const recipeList = await recipeCollection();
      const allRecipes = await recipeList
        .find({})
        .sort({ likeCount: -1, createdAt: -1, _id: -1 })
        .toArray();
      return (await attachAuthors(allRecipes)).map(serializeRecipe);
    },

    getRecipeBySlug: async (_, args) => {
      //validate Input
      const slug = helpers.validateSlug(args.slug);
      const recipeList = await recipeCollection();
      const foundRecipe = await recipeList.findOne({ slug: slug });
      if(!foundRecipe){
        //cant find recipe based on given slug
        throw new GraphQLError('Recipe Not Found', {
          extensions: {code: 'NOT_FOUND'}
        });
      }
      const [withAuthor] = await attachAuthors([foundRecipe]);
      return serializeRecipe(withAuthor);
    },

    me: async (_, __, context) => {
      const currentUser = await requireAccount(context);
      return {
        ...currentUser,
        _id: currentUser._id.toString(),
        avatar: currentUser.avatar ?? null
      };
    },
  },

  Mutation: {
    //Any signed-in user can post. The recipe is stamped with their account id
    //so the list can show who shared it and so only they (or an admin) can
    //change it later.
    createRecipe: async (_, { input }, context) => {
      const user = await requireAccount(context);

      const recipe = helpers.validateRecipeInput(input);
      const recipeList = await recipeCollection();
      const doc = {
        ...recipe,
        authorId: user._id,
        likeCount: 0,
        createdAt: new Date().toISOString()
      };
      const inserted = await retryOnSlugCollision(recipe, async (slug) => {
        const insertInfo = await recipeList.insertOne({ ...doc, slug });
        return { ...doc, slug, _id: insertInfo.insertedId };
      });
      return serializeRecipe({ ...inserted, author: toAuthor(user) });
    },

    updateRecipe: async (_, { _id, input }, context) => {
      const { recipe: existing, recipeList } = await requireManageable(context, _id);

      const recipe = helpers.validateRecipeInput(input);
      //Only the editable fields. authorId, likeCount and createdAt belong to
      //the system and must survive an edit untouched.
      const updated = await retryOnSlugCollision(recipe, (slug) =>
        recipeList.findOneAndUpdate(
          { _id: existing._id },
          { $set: { ...recipe, slug } },
          { returnDocument: 'after' }
        )
      );
      if(!updated){
        throw new GraphQLError('Recipe Not Found', {
          extensions: {code: 'NOT_FOUND'}
        });
      }
      const [withAuthor] = await attachAuthors([updated]);
      return serializeRecipe(withAuthor);
    },

    //Anyone signed in may upload a photo for their recipe. The secret still
    //never leaves the server; the rate limiter bounds abuse.
    createImageUploadSignature: async (_, __, context) => {
      await requireAccount(context);

      if(!cloudinaryConfig){
        throw new GraphQLError('Photo uploads are not configured on this server.', {
          extensions: { code: 'UPLOADS_DISABLED' }
        });
      }
      const timestamp = Math.floor(Date.now() / 1000);
      const params = { folder: cloudinaryConfig.folder, timestamp };
      return {
        cloudName: cloudinaryConfig.cloudName,
        apiKey: cloudinaryConfig.apiKey,
        timestamp,
        signature: signUploadParams(params, cloudinaryConfig.apiSecret),
        folder: cloudinaryConfig.folder
      };
    },

    deleteRecipe: async (_, { _id }, context) => {
      const { recipe, recipeList } = await requireManageable(context, _id);
      const result = await recipeList.deleteOne({ _id: recipe._id });
      if(result.deletedCount === 0){
        throw new GraphQLError('Recipe Not Found', {
          extensions: {code: 'NOT_FOUND'}
        });
      }
      return true;
    },
  }
}
