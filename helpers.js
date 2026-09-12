import { GraphQLError } from 'graphql';
import { ObjectId } from 'mongodb';
import slugify from 'slugify';

const badInput = (message) =>
  new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });

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

// Photos are either hosted elsewhere (absolute http/https URL) or served from
// the frontend's public folder (root-relative path like "/carbonara.jpg").
// Anything else, including javascript: and data: URLs, is rejected so the
// stored value is always safe to drop straight into an <img src>.
const validateImageUrl = (value) => {
  if (value == null) return null;
  if (typeof value !== 'string') throw badInput('imageUrl must be a string.');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2048) throw badInput('imageUrl must be 2048 characters or fewer.');
  if (/\s/.test(trimmed)) throw badInput('imageUrl must not contain whitespace.');

  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//')) throw badInput('imageUrl must be an http(s) URL or a path starting with "/".');
    return trimmed;
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw badInput('imageUrl must be an http(s) URL or a path starting with "/".');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badInput('imageUrl must use http or https.');
  }
  return trimmed;
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
      if (ing.amount != null && (typeof ing.amount !== 'number' || !Number.isFinite(ing.amount) || ing.amount < 0)) {
        throw badInput(`Ingredient "${name}" amount must be zero or greater.`);
      }
      const notes = typeof ing.notes === 'string' ? ing.notes.trim() : null;
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
      requireNonEmptyString(step, `Instruction step ${i + 1}`)
    );

    const content = typeof input.content === 'string' ? input.content.trim() : null;
    const imageUrl = validateImageUrl(input.imageUrl);

    return {
      title,
      slug,
      prepTime: input.prepTime,
      ingredients,
      instructions,
      content: content || null,
      imageUrl
    };
  }
};

export default exportedHelpers;
