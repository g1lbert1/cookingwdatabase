import { createHash, randomBytes } from 'node:crypto';
import { GraphQLError } from 'graphql';
import { ObjectId } from 'mongodb';
import helpers from './helpers.js';
import { authConfig, cloudinaryConfig } from './config/settings.js';
import {
  recipes as recipeCollection,
  users as userCollection,
  likes as likeCollection,
  favorites as favoriteCollection,
  comments as commentCollection
} from './config/mongoCollections.js';

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

const notFound = () =>
  new GraphQLError('Recipe Not Found', { extensions: {code: 'NOT_FOUND'} });

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

//The signed-in viewer for read-only decoration (likedByMe and friends).
//Unlike requireAccount it never creates or repairs anything: a viewer with
//no account yet has no reactions, and anonymous readers get null.
const findViewer = async (context) => {
  if(!context.user) return null;
  const userList = await userCollection();
  return userList.findOne({ auth0Id: context.user.sub });
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
  if(!recipe) throw notFound();
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

//Sets likedByMe / favoritedByMe for the viewer with one query per reaction
//type, however many recipes are in the batch.
const markForViewer = async (recipeDocs, viewer) => {
  if(!viewer || recipeDocs.length === 0){
    return recipeDocs.map((r) => ({ ...r, likedByMe: false, favoritedByMe: false }));
  }
  const ids = recipeDocs.map((r) => r._id);
  const rowsFor = async (collection) => {
    const rows = await collection();
    const found = await rows
      .find({ userId: viewer._id, recipeId: { $in: ids } })
      .project({ recipeId: 1 })
      .toArray();
    return new Set(found.map((row) => row.recipeId.toString()));
  };
  const [liked, favorited] = await Promise.all([rowsFor(likeCollection), rowsFor(favoriteCollection)]);
  return recipeDocs.map((r) => ({
    ...r,
    likedByMe: liked.has(r._id.toString()),
    favoritedByMe: favorited.has(r._id.toString())
  }));
};

const serializeRecipe = (recipe) => ({
  ...recipe,
  _id: recipe._id.toString(),
  likeCount: recipe.likeCount ?? 0,
  createdAt: recipe.createdAt ?? null,
  author: recipe.author ?? null,
  likedByMe: recipe.likedByMe ?? false,
  favoritedByMe: recipe.favoritedByMe ?? false,
  commentCount: recipe.commentCount ?? 0
});

//A comment as the API returns it. canDelete is decided for the viewer here
//so the client never has to re-derive the rule: the comment's author, the
//recipe's author, or an admin.
const canDeleteComment = (viewer, comment, recipe) =>
  Boolean(viewer) && (
    isAdmin(viewer) ||
    comment.authorId.equals(viewer._id) ||
    (recipe.authorId != null && recipe.authorId.equals(viewer._id))
  );

const serializeComment = (comment, author, viewer, recipe) => ({
  _id: comment._id.toString(),
  body: comment.body,
  createdAt: comment.createdAt,
  author,
  canDelete: canDeleteComment(viewer, comment, recipe)
});

//The thread for one recipe, oldest first, authors joined in one query.
const commentsForRecipe = async (recipe, viewer) => {
  const commentList = await commentCollection();
  const docs = await commentList
    .find({ recipeId: recipe._id })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  if(docs.length === 0) return [];
  const userList = await userCollection();
  const authors = await userList
    .find({ _id: { $in: docs.map((c) => c.authorId) } })
    .project({ username: 1, avatar: 1 })
    .toArray();
  const byId = new Map(authors.map((u) => [u._id.toString(), toAuthor(u)]));
  return docs.map((c) =>
    serializeComment(c, byId.get(c.authorId.toString()) ?? null, viewer, recipe)
  );
};

//Raw documents -> API shape, with authors joined and the viewer's flags set.
const present = async (recipeDocs, viewer) =>
  (await markForViewer(await attachAuthors(recipeDocs), viewer)).map(serializeRecipe);

//Likes and favorites share one shape: a (recipeId, userId) row guarded by a
//unique index, so a repeated like inserts nothing and the mutation is safe to
//retry. Likes also move recipes.likeCount, which the list sorts on; the
//`changed` flag keeps the counter honest when nothing was inserted or removed.
const setReaction = async (context, _id, { collection, on, counter = null }) => {
  const user = await requireAccount(context);
  const objectId = helpers.validateId(_id);
  const recipeList = await recipeCollection();
  if(!(await recipeList.findOne({ _id: objectId }, { projection: { _id: 1 } }))) throw notFound();

  const rows = await collection();
  let changed = false;
  if(on){
    try {
      await rows.insertOne({ recipeId: objectId, userId: user._id, createdAt: new Date().toISOString() });
      changed = true;
    } catch (e) {
      if(e?.code !== 11000) throw e;
    }
  } else {
    const result = await rows.deleteOne({ recipeId: objectId, userId: user._id });
    changed = result.deletedCount === 1;
  }
  if(changed && counter){
    await recipeList.updateOne({ _id: objectId }, { $inc: { [counter]: on ? 1 : -1 } });
  }

  const recipe = await recipeList.findOne({ _id: objectId });
  if(!recipe) throw notFound();
  const [presented] = await present([recipe], user);
  return presented;
};

//The recipes behind a user's reaction rows, most recently reacted first.
const reactedRecipes = async (collection, user) => {
  const rows = await collection();
  const reactions = await rows
    .find({ userId: user._id })
    .sort({ createdAt: -1, _id: -1 })
    .project({ recipeId: 1 })
    .toArray();
  if(reactions.length === 0) return [];
  const recipeList = await recipeCollection();
  const docs = await recipeList.find({ _id: { $in: reactions.map((r) => r.recipeId) } }).toArray();
  const byId = new Map(docs.map((d) => [d._id.toString(), d]));
  //Keep the reaction order; a recipe deleted in the meantime just drops out.
  const ordered = reactions.map((r) => byId.get(r.recipeId.toString())).filter(Boolean);
  return present(ordered, user);
};

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

//Per-user cap on upload signatures, a sliding one-hour window kept in memory.
//Each signature is good for one stored asset, so this is also the per-user
//storage growth cap. Process-local: with several API instances each would
//allow the full quota, which is the point at which this belongs in Redis.
const signatureWindowMs = 60 * 60 * 1000;
const signatureIssued = new Map();
const takeSignatureSlot = (userId) => {
  const now = Date.now();
  const recent = (signatureIssued.get(userId) ?? []).filter((t) => now - t < signatureWindowMs);
  if(recent.length >= cloudinaryConfig.signaturesPerHour){
    throw new GraphQLError(
      `You have uploaded a lot of photos recently. Try again in a little while.`,
      { extensions: { code: 'RATE_LIMITED' } }
    );
  }
  recent.push(now);
  signatureIssued.set(userId, recent);
  //Keep the map from growing with every user who ever uploaded.
  if(signatureIssued.size > 10000){
    for(const [id, times] of signatureIssued){
      if(times.every((t) => now - t >= signatureWindowMs)) signatureIssued.delete(id);
    }
  }
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
    recipes: async (_, __, context) => {
      const recipeList = await recipeCollection();
      const allRecipes = await recipeList
        .find({})
        .sort({ likeCount: -1, createdAt: -1, _id: -1 })
        .toArray();
      return present(allRecipes, await findViewer(context));
    },

    getRecipeBySlug: async (_, args, context) => {
      //validate Input
      const slug = helpers.validateSlug(args.slug);
      const recipeList = await recipeCollection();
      const foundRecipe = await recipeList.findOne({ slug: slug });
      if(!foundRecipe) throw notFound();
      const [presented] = await present([foundRecipe], await findViewer(context));
      return presented;
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

  //Resolved only when a query asks for it, so list queries never pay for
  //threads. The parent is the serialized recipe (string _id, raw authorId).
  Recipe: {
    comments: async (recipe, _, context) =>
      commentsForRecipe(
        { ...recipe, _id: new ObjectId(recipe._id) },
        await findViewer(context)
      ),
  },

  //Profile tabs. The parent is the serialized `me` object, so _id comes back
  //as a string and is rebuilt into an ObjectId for the lookups.
  User: {
    recipes: async (user) => {
      const recipeList = await recipeCollection();
      const owner = { ...user, _id: new ObjectId(user._id) };
      const docs = await recipeList
        .find({ authorId: owner._id })
        .sort({ createdAt: -1, _id: -1 })
        .toArray();
      return present(docs, owner);
    },
    likedRecipes: (user) =>
      reactedRecipes(likeCollection, { ...user, _id: new ObjectId(user._id) }),
    favoriteRecipes: (user) =>
      reactedRecipes(favoriteCollection, { ...user, _id: new ObjectId(user._id) }),
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
        commentCount: 0,
        createdAt: new Date().toISOString()
      };
      const inserted = await retryOnSlugCollision(recipe, async (slug) => {
        const insertInfo = await recipeList.insertOne({ ...doc, slug });
        return { ...doc, slug, _id: insertInfo.insertedId };
      });
      return serializeRecipe({ ...inserted, author: toAuthor(user) });
    },

    updateRecipe: async (_, { _id, input }, context) => {
      const { user, recipe: existing, recipeList } = await requireManageable(context, _id);

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
      if(!updated) throw notFound();
      const [presented] = await present([updated], user);
      return presented;
    },

    //Anyone signed in may upload a photo for their recipe. The secret never
    //leaves the server, and every constraint below is inside the signature,
    //so Cloudinary itself enforces it: a client cannot widen the formats,
    //skip the transformation, or point the upload at another asset id.
    createImageUploadSignature: async (_, __, context) => {
      const user = await requireAccount(context);

      if(!cloudinaryConfig){
        throw new GraphQLError('Photo uploads are not configured on this server.', {
          extensions: { code: 'UPLOADS_DISABLED' }
        });
      }
      takeSignatureSlot(user._id.toString());

      const timestamp = Math.floor(Date.now() / 1000);
      const params = {
        timestamp,
        folder: cloudinaryConfig.folder,
        //A fixed, random asset id. Cloudinary signatures stay valid for about
        //an hour and can be replayed; with the id pinned, a replay can only
        //overwrite this one asset instead of minting unlimited new ones.
        public_id: randomBytes(12).toString('hex'),
        allowed_formats: cloudinaryConfig.allowedFormats.join(','),
        transformation: cloudinaryConfig.incomingTransformation,
        //Who uploaded it, so an abuser's assets can be found and purged in
        //one search from the Cloudinary console.
        tags: `user_${user._id.toString()}`
      };
      const fields = Object.entries(params).map(([name, value]) => ({ name, value: String(value) }));
      fields.push({ name: 'signature', value: signUploadParams(params, cloudinaryConfig.apiSecret) });
      return {
        cloudName: cloudinaryConfig.cloudName,
        apiKey: cloudinaryConfig.apiKey,
        fields
      };
    },

    deleteRecipe: async (_, { _id }, context) => {
      const { recipe, recipeList } = await requireManageable(context, _id);
      const result = await recipeList.deleteOne({ _id: recipe._id });
      if(result.deletedCount === 0) throw notFound();
      //Reaction rows and comments for a vanished recipe would only ever be
      //skipped; drop them so the profile tabs never pay for loading them.
      const [likeList, favoriteList, commentList] = await Promise.all([
        likeCollection(), favoriteCollection(), commentCollection()
      ]);
      await Promise.all([
        likeList.deleteMany({ recipeId: recipe._id }),
        favoriteList.deleteMany({ recipeId: recipe._id }),
        commentList.deleteMany({ recipeId: recipe._id })
      ]);
      return true;
    },

    addComment: async (_, { recipeId, body }, context) => {
      const user = await requireAccount(context);
      const text = helpers.validateCommentBody(body);
      const objectId = helpers.validateId(recipeId);
      const recipeList = await recipeCollection();
      const recipe = await recipeList.findOne({ _id: objectId }, { projection: { authorId: 1 } });
      if(!recipe) throw notFound();

      const commentList = await commentCollection();
      const doc = {
        recipeId: objectId,
        authorId: user._id,
        body: text,
        createdAt: new Date().toISOString()
      };
      const insertInfo = await commentList.insertOne(doc);
      //The counter feeds the cards; the thread itself is read from the rows.
      await recipeList.updateOne({ _id: objectId }, { $inc: { commentCount: 1 } });
      return serializeComment({ ...doc, _id: insertInfo.insertedId }, toAuthor(user), user, recipe);
    },

    deleteComment: async (_, { _id }, context) => {
      const user = await requireAccount(context);
      const objectId = helpers.validateId(_id);
      const commentList = await commentCollection();
      const comment = await commentList.findOne({ _id: objectId });
      if(!comment){
        throw new GraphQLError('Comment Not Found', { extensions: {code: 'NOT_FOUND'} });
      }
      const recipeList = await recipeCollection();
      //A recipe deleted out from under the comment leaves no owner to check;
      //the comment is then orphaned and anyone who could see it may remove it.
      const recipe = (await recipeList.findOne({ _id: comment.recipeId }, { projection: { authorId: 1 } }))
        ?? { authorId: null };
      if(!canDeleteComment(user, comment, recipe)){
        throw new GraphQLError("You can only delete your own comments, or comments on your recipes.", {
          extensions: { code: "FORBIDDEN" }
        });
      }
      const result = await commentList.deleteOne({ _id: objectId });
      if(result.deletedCount === 1){
        await recipeList.updateOne(
          { _id: comment.recipeId, commentCount: { $gt: 0 } },
          { $inc: { commentCount: -1 } }
        );
      }
      return true;
    },

    likeRecipe: (_, { _id }, context) =>
      setReaction(context, _id, { collection: likeCollection, on: true, counter: 'likeCount' }),
    unlikeRecipe: (_, { _id }, context) =>
      setReaction(context, _id, { collection: likeCollection, on: false, counter: 'likeCount' }),
    favoriteRecipe: (_, { _id }, context) =>
      setReaction(context, _id, { collection: favoriteCollection, on: true }),
    unfavoriteRecipe: (_, { _id }, context) =>
      setReaction(context, _id, { collection: favoriteCollection, on: false }),
  }
}
