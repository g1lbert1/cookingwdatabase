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
    imageUrl: String
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
    imageUrl: String
  }

  input IngredientInput {
    name: String!
    amount: Float
    unit: Unit
    notes: String
  }

  # Everything the browser needs to upload one photo straight to Cloudinary.
  # The signature is computed server-side from the API secret and is valid
  # for about an hour; the resulting secure_url goes into RecipeInput.imageUrl.
  type ImageUploadSignature {
    cloudName: String!
    apiKey: String!
    timestamp: Int!
    signature: String!
    folder: String!
  }

  type Mutation {
    createRecipe(input: RecipeInput!): Recipe!
    createImageUploadSignature: ImageUploadSignature!
    updateRecipe(_id: String!, input: RecipeInput!): Recipe!
    deleteRecipe(_id: String!): Boolean!
  }
`;
