import { GraphQLError } from 'graphql';
import helpers from './helpers.js';
import { authConfig } from './config/settings.js';
import { recipes as recipeCollection } from './config/mongoCollections.js';
import { users as userCollection } from './config/mongoCollections.js';
import slugify from "slugify";

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

const requireUser = (context) => {
  if(!context.user){
    throw new GraphQLError(`User must be logged in`, {
      extensions: {code: 'UNAUTHENTICATED'}
    });
  }
  return context.user;
};

const requireAdmin = async (context) => {
  const claims = requireUser(context);
  const userList = await userCollection();
  const currentUser = await userList.findOne({ auth0Id: claims.sub });
  if(currentUser?.role !== "admin"){
    throw new GraphQLError("Unauthorized", {
      extensions: { code: "FORBIDDEN" }
    });
  }
  return currentUser;
};

const serializeRecipe = (recipe) => ({
  ...recipe,
  _id: recipe._id.toString()
});

export const resolvers = {
  //Query Resolver
  Query: {
    recipes: async () => {
      const recipeList = await recipeCollection();
      const allRecipes = await recipeList.find({}).toArray();
      return allRecipes.map(serializeRecipe);
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
      return serializeRecipe(foundRecipe);
    },

    me: async (_, __, context) => {
      //check if user is logged in
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
          role:
            authConfig.adminEmail &&
            profile.emailVerified &&
            profile.email === authConfig.adminEmail
              ? "admin"
              : "user"
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

      return {
        ...currentUser,
        _id: currentUser._id.toString(),
        avatar: currentUser.avatar ?? null
      };
    },
  },

  Mutation: {
    createRecipe: async (_, { input }, context) => {
      await requireAdmin(context);

      const recipeList = await recipeCollection();
      const recipe = {
        ...input,
        slug: slugify(input.title, {
            lower: true,
            strict: true
        })
      };
      const insertInfo = await recipeList.insertOne(recipe);
      return {
        ...recipe,
        _id: insertInfo.insertedId.toString()
      };
    },

    updateRecipe: async (_, { _id, input }, context) => {
      await requireAdmin(context);

      const objectId = helpers.validateId(_id);
      const recipeList = await recipeCollection();
      const updated = await recipeList.findOneAndUpdate(
        { _id: objectId },
        { $set: {
          ...input,
          slug: slugify(input.title, { lower: true, strict: true })
        } },
        { returnDocument: 'after' }
      );
      if(!updated){
        throw new GraphQLError('Recipe Not Found', {
          extensions: {code: 'NOT_FOUND'}
        });
      }
      return serializeRecipe(updated);
    },

    deleteRecipe: async (_, { _id }, context) => {
      await requireAdmin(context);

      const objectId = helpers.validateId(_id);
      const recipeList = await recipeCollection();
      const result = await recipeList.deleteOne({ _id: objectId });
      if(result.deletedCount === 0){
        throw new GraphQLError('Recipe Not Found', {
          extensions: {code: 'NOT_FOUND'}
        });
      }
      return true;
    },
  }
}
