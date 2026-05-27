import { GraphQLError } from 'graphql';
import { ObjectId } from 'mongodb';
import helpers from './helpers.js';
import { recipes as recipeCollection } from './config/mongoCollections.js';
import { users as userCollection } from './config/mongoCollections.js';
import slugify from "slugify";

export const resolvers = {
  //Query Resolver
  Query: {
    recipes: async () => {
      const recipeList = await recipeCollection();
      const allRecipes = await recipeList.find({}).toArray();
      if(!allRecipes){
        throw new GraphQLError(`Internal Server Error`, {
          extensions: {code: 'INTERNAL_SERVER_ERROR'}
        });
      }
      return allRecipes.map(recipe => ({
        ...recipe,
        _id: recipe._id.toString()
      }));
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
      return {
        ...foundRecipe,
        _id: foundRecipe._id.toString()
      };
    },

    me: async (_, __, context) => {
      //check if user is logged in
      if(!context.user){
        throw new GraphQLError(`User must be logged in`, {
          extensions: {code: 'UNAUTHENTICATED'}
        });
      }

      const userList = await userCollection();
      let currentUser = await userList.findOne({ auth0Id: context.user.sub });
      const claims = context.user;
      const namespace = 'https://cookingwtristan-api.com';
      const email = claims[`${namespace}/email` ] || claims.email;
      const username = claims[`${namespace}/username`] || claims.nickname || claims.name;
      const avatar = claims[`${namespace}/avatar`] || claims.picture; 
      if(!currentUser){
        const newUser = {
          auth0Id: claims.sub,
          email: email,
          username: username,
          avatar: avatar,
          createdAt: new Date().toISOString(),
          role: email === "robotic140@gmail.com"
            ? "admin"
            : "user"
        };
        const insertInfo = await userList.insertOne(newUser);
        currentUser = await userList.findOne({ _id: insertInfo.insertedId });
      }
      return {
        ...currentUser,
        _id: currentUser._id.toString()
      };
    },
  },

  Mutation: {
    createRecipe: async (_, { input }, context) => {
      if (!context.user) {
        throw new GraphQLError("Must be logged in", {
            extensions: { code: "UNAUTHENTICATED" }
        });
      }

      const userList = await userCollection();
      const currentUser = await userList.findOne({
        auth0Id: context.user.sub
      });

      if (currentUser?.role !== "admin") {
        throw new GraphQLError("Unauthorized", {
            extensions: { code: "FORBIDDEN" }
        });
      }

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


  }


}
