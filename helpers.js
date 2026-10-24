import { GraphQLError } from 'graphql';
import { ObjectId } from 'mongodb';
import slugify from 'slugify';
import { publicIdFromUrl } from './cloudinary.js';
import { assertClean } from './profanity.js';

const badInput = (message) =>
  new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });

//The optional recipe page settings. The GraphQL enums already refuse other
//values; these are the defaults and the guard for documents written by hand.
export const RECIPE_LAYOUTS = ['CLASSIC', 'EDITORIAL', 'GALLERY'];
export const RECIPE_ACCENTS = ['PLUM', 'VIOLET', 'BERRY', 'TEAL'];
export const DEFAULT_LAYOUT = 'CLASSIC';
export const DEFAULT_ACCENT = 'PLUM';
const STORY_MAX = 20000;
const GALLERY_MAX = 8;

// Single slug algorithm for both writing and looking up. The old validateSlug
// stripped non-word characters while createRecipe used slugify's
// transliteration, so "Crème" stored as "creme" but was looked up as "crme".
const makeSlug = (text) => slugify(text, { lower: true, strict: true, trim: true });

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badInput(`${label} must be a non-empty string.`);
  }
  return value.trim();
};

// Photos come from exactly two places: this site's own Cloudinary folder
// (what the upload flow produces; see cloudinary.js for the exact shape) or
// the frontend's public folder as a root-relative path like "/carbonara.jpg".
// Anything else is refused, which closes off hotlinking arbitrary
// third-party images (tracking pixels, content nobody here controls) as
// well as javascript: and data: URLs.
const validateImageUrl = (value) => {
  if (value == null) return null;
  if (typeof value !== 'string') throw badInput('imageUrl must be a string.');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2048) throw badInput('imageUrl must be 2048 characters or fewer.');
  if (/\s/.test(trimmed)) throw badInput('imageUrl must not contain whitespace.');

  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//')) throw badInput('imageUrl must be a photo uploaded here or a path starting with "/".');
    return trimmed;
  }
  if (publicIdFromUrl(trimmed)) return trimmed;
  throw badInput('imageUrl must be a photo uploaded through this site or a path starting with "/".');
};

const exportedHelpers = {
  makeSlug,
  validateImageUrl,

  validateSlug (slug) {
    const trimmed = requireNonEmptyString(slug, 'Slug');
    const normalized = makeSlug(trimmed);
    if (!normalized) throw badInput(`Slug "${slug}" contains no usable characters.`);
    return normalized;
  },

  //Comments are plain text, trimmed. The limit keeps a thread readable and
  //the document small; the schema only guarantees a String.
  validateCommentBody (body) {
    const trimmed = requireNonEmptyString(body, 'Comment');
    if (trimmed.length > 1000) throw badInput('Comments must be 1000 characters or fewer.');
    return assertClean(trimmed, 'Your comment');
  },

  //Guards ObjectId construction, which throws a raw BSONError on bad input.
  validateId (id) {
    const trimmed = requireNonEmptyString(id, '_id');
    if (!ObjectId.isValid(trimmed)) throw badInput(`${trimmed} is not a valid _id.`);
    return new ObjectId(trimmed);
  },

  // The GraphQL schema only enforces types and nullability. Everything below
  // is a semantic rule the schema cannot express: "" is a valid String!, -5 is
  // a valid Int!, and [] is a valid [Ingredient!]!. Returns a trimmed copy
  // with the slug attached, so resolvers persist exactly what was validated.
  validateRecipeInput (input) {
    const title = requireNonEmptyString(input.title, 'Title');
    if (title.length > 200) throw badInput('Title must be 200 characters or fewer.');
    assertClean(title, 'The title');

    const slug = makeSlug(title);
    if (!slug) throw badInput(`Title "${title}" contains no characters usable in a URL.`);

    if (!Number.isInteger(input.prepTime) || input.prepTime < 0) {
      throw badInput('prepTime must be a whole number of minutes, zero or greater.');
    }

    if (!Array.isArray(input.ingredients) || input.ingredients.length === 0) {
      throw badInput('A recipe needs at least one ingredient.');
    }
    const ingredients = input.ingredients.map((ing, i) => {
      const name = requireNonEmptyString(ing.name, `Ingredient ${i + 1} name`);
      assertClean(name, `Ingredient ${i + 1}`);
      if (ing.amount != null && (typeof ing.amount !== 'number' || !Number.isFinite(ing.amount) || ing.amount < 0)) {
        throw badInput(`Ingredient "${name}" amount must be zero or greater.`);
      }
      const notes = typeof ing.notes === 'string' ? ing.notes.trim() : null;
      if (notes) assertClean(notes, `Ingredient ${i + 1}'s notes`);
      return {
        name,
        amount: ing.amount ?? null,
        unit: ing.unit ?? null,
        notes: notes || null
      };
    });

    if (!Array.isArray(input.instructions) || input.instructions.length === 0) {
      throw badInput('A recipe needs at least one instruction step.');
    }
    const instructions = input.instructions.map((step, i) =>
      assertClean(requireNonEmptyString(step, `Instruction step ${i + 1}`), `Step ${i + 1}`)
    );

    const content = typeof input.content === 'string' ? input.content.trim() : null;
    if (content) assertClean(content, 'The description');
    const imageUrl = validateImageUrl(input.imageUrl);

    //The optional page settings. Absent, null and empty all mean "plain".
    if (input.story != null && typeof input.story !== 'string') throw badInput('story must be text.');
    const story = input.story?.trim() || null;
    if (story && story.length > STORY_MAX) {
      throw badInput(`The story must be ${STORY_MAX.toLocaleString('en-US')} characters or fewer.`);
    }
    if (story) assertClean(story, 'The story');

    if (input.gallery != null && !Array.isArray(input.gallery)) throw badInput('gallery must be a list of photo URLs.');
    const gallery = [];
    for (const url of input.gallery ?? []) {
      const valid = validateImageUrl(url);
      //A blank slot, a repeat, or the cover photo again adds nothing.
      if (valid && valid !== imageUrl && !gallery.includes(valid)) gallery.push(valid);
    }
    if (gallery.length > GALLERY_MAX) {
      throw badInput(`A recipe can have at most ${GALLERY_MAX} extra photos.`);
    }

    const layout = input.layout ?? DEFAULT_LAYOUT;
    if (!RECIPE_LAYOUTS.includes(layout)) throw badInput(`Unknown layout "${layout}".`);
    const accent = input.accent ?? DEFAULT_ACCENT;
    if (!RECIPE_ACCENTS.includes(accent)) throw badInput(`Unknown accent "${accent}".`);

    return {
      title,
      slug,
      prepTime: input.prepTime,
      ingredients,
      instructions,
      content: content || null,
      imageUrl,
      story,
      gallery,
      layout,
      accent
    };
  }
};

export default exportedHelpers;
