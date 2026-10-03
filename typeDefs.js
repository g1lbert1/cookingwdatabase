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
    # Every recipe, most liked first; ties fall back to newest first.
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
    # Who posted it. Null for the site's own recipes (created before sharing
    # existed, or by an admin without an account record).
    author: Author
    likeCount: Int!
    createdAt: String
  }

  # The public face of a user, safe to show on anyone's recipe. User (below)
  # includes the email and is only ever returned for the caller themself.
  type Author {
    _id: String!
    username: String!
    avatar: String
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

  # createRecipe and createImageUploadSignature need a signed-in user.
  # updateRecipe and deleteRecipe need the recipe's author or an admin.
  type Mutation {
    createRecipe(input: RecipeInput!): Recipe!
    createImageUploadSignature: ImageUploadSignature!
    updateRecipe(_id: String!, input: RecipeInput!): Recipe!
    deleteRecipe(_id: String!): Boolean!
  }
`;
