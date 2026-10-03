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
    # The viewer's own reactions. Always false when not signed in.
    likedByMe: Boolean!
    favoritedByMe: Boolean!
    commentCount: Int!
    # Oldest first, so a thread reads top to bottom. Only fetched when asked.
    comments: [Comment!]!
  }

  type Comment {
    _id: String!
    body: String!
    createdAt: String!
    author: Author
    # True for the comment's author, the recipe's author, and admins.
    canDelete: Boolean!
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
    # The profile tabs. Only reachable through \`me\`, so always the caller's own.
    recipes: [Recipe!]!
    likedRecipes: [Recipe!]!
    favoriteRecipes: [Recipe!]!
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
  # The browser posts the file plus every field verbatim; the fields are
  # signed server-side, so Cloudinary enforces them (one fixed asset id,
  # allowed formats, size-capping transformation) and rejects anything else.
  # The resulting secure_url goes into RecipeInput.imageUrl.
  type ImageUploadSignature {
    cloudName: String!
    apiKey: String!
    fields: [UploadField!]!
  }

  type UploadField {
    name: String!
    value: String!
  }

  # createRecipe and createImageUploadSignature need a signed-in user.
  # updateRecipe and deleteRecipe need the recipe's author or an admin.
  # The like and favorite mutations need a signed-in user, are idempotent
  # (liking twice is one like), and return the recipe with fresh counts and
  # viewer flags so the client cache updates in place.
  type Mutation {
    createRecipe(input: RecipeInput!): Recipe!
    createImageUploadSignature: ImageUploadSignature!
    updateRecipe(_id: String!, input: RecipeInput!): Recipe!
    deleteRecipe(_id: String!): Boolean!
    likeRecipe(_id: String!): Recipe!
    unlikeRecipe(_id: String!): Recipe!
    favoriteRecipe(_id: String!): Recipe!
    unfavoriteRecipe(_id: String!): Recipe!
    # Signed-in users. body is trimmed and must be 1 to 1000 characters.
    addComment(recipeId: String!, body: String!): Comment!
    # The comment's author, the recipe's author, or an admin.
    deleteComment(_id: String!): Boolean!
  }
`;
