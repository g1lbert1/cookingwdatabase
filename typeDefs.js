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

  # The page templates a recipe can be shown in. CLASSIC is the site's own
  # layout and the default for every recipe that never chose one.
  enum RecipeLayout {
    CLASSIC
    EDITORIAL
    GALLERY
  }

  # Curated accent tones for the recipe page. Each is a dark surface that
  # white text clears at 9:1 or better; PLUM is the site colour and default.
  enum RecipeAccent {
    PLUM
    VIOLET
    BERRY
    TEAL
  }

  type Query {
    # Every recipe, most liked first; ties fall back to newest first.
    recipes: [Recipe!]!
    getRecipeBySlug(slug: String!): Recipe
    me: User
    # Someone's public profile by username, matched case-insensitively. A
    # username that was given up recently still resolves to its old owner so
    # shared links keep working; the client redirects to the current name.
    # Null when nobody has that name.
    user(username: String!): PublicUser
    # Live feedback for the rename form: is this name valid and free? Signed-in
    # users only. The same rules run again inside updateUsername.
    checkUsername(username: String!): UsernameCheck!
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
    # Optional long-form introduction in Markdown. Rendered by the client
    # with raw HTML disabled; stored exactly as written.
    story: String
    # Extra photos beyond imageUrl, in display order. Empty for most recipes.
    gallery: [String!]!
    layout: RecipeLayout!
    accent: RecipeAccent!
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

  # What anyone may see of a user: the Author fields plus their recipes.
  # Likes and favorites are private and stay on User.
  type PublicUser {
    _id: String!
    username: String!
    avatar: String
    recipeCount: Int!
    # Newest first, with the viewer's own like/favorite flags.
    recipes: [Recipe!]!
  }

  type UsernameCheck {
    available: Boolean!
    # Why not, in words meant for the user. Null when available.
    message: String
  }

  type Ingredient {
    name: String!
    amount: Float
    unit: Unit
    notes: String
  }

  # Everything after imageUrl is optional. Omitted fields keep the plain
  # recipe page: no story, no extra photos, CLASSIC layout, PLUM accent.
  input RecipeInput {
    title: String!
    ingredients: [IngredientInput!]!
    instructions: [String!]!
    prepTime: Int!
    content: String
    imageUrl: String
    # Markdown, up to 20000 characters.
    story: String
    # Up to 8 photos uploaded through this site.
    gallery: [String!]
    layout: RecipeLayout
    accent: RecipeAccent
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
    # Renames the caller. Same rules as checkUsername; the old name redirects
    # to the new one for a while and cannot be taken by anyone else meanwhile.
    updateUsername(username: String!): User!
  }
`;
