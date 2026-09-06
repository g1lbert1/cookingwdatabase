import { GraphQLError } from 'graphql';
import { ObjectId } from 'mongodb';

const exportedHelpers = {
  validateSlug (slug) {
    if(typeof slug !== "string" || slug.trim().length === 0){
      throw new GraphQLError(`Error: Slug ${slug} must be a non-empty string.`, {
        extensions: {code: 'BAD_USER_INPUT'}
      });
    }
    return slug
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') //remove non-word chars
    .replace(/[\s_-]+/g, '-') //replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ''); //trim hyphens from ends
  },

  //Guards ObjectId construction, which throws a raw BSONError on bad input.
  validateId (id) {
    if(typeof id !== "string" || id.trim().length === 0){
      throw new GraphQLError(`Error: _id must be a non-empty string.`, {
        extensions: {code: 'BAD_USER_INPUT'}
      });
    }
    const trimmed = id.trim();
    if(!ObjectId.isValid(trimmed)){
      throw new GraphQLError(`Error: ${trimmed} is not a valid _id.`, {
        extensions: {code: 'BAD_USER_INPUT'}
      });
    }
    return new ObjectId(trimmed);
  },

}

export default exportedHelpers;
