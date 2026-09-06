export const typeDefs = `#graphql
  enum Unit {
    GRAMS
    CUPS
    TABLESPOONS
    TEASPOONS
    PIECE
    ML
    LITER
    OUNCE
    POUND
  }

  type Query {
    recipes: [Recipe!]!
    getRecipeBySlug(slug: String!): Recipe 
    me: User
  }
  
  type Recipe {
    _id: String!
    title: String!
    slug: String!
    ingredients: [Ingredient!]!
    instructions: [String!]!
    prepTime: Int!
    content: String
  }

  type User {
    _id: String!
    auth0Id: String!
    email: String!
    username: String!
    avatar: String
    createdAt: String!
    role: String!
  }

  type Ingredient {
    name: String!
    amount: Float
    unit: Unit
    notes: String
  }

  input RecipeInput {
    title: String!
    ingredients: [IngredientInput!]!
    instructions: [String!]!
    prepTime: Int!
    content: String
  }

  input IngredientInput {
    name: String!
    amount: Float
    unit: Unit
    notes: String
  }

  type Mutation {
    createRecipe(input: RecipeInput!): Recipe!
    updateRecipe(_id: String!, input: RecipeInput!): Recipe!
    deleteRecipe(_id: String!): Boolean!
  }
`;
