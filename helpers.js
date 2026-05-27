import { GraphQLError } from 'graphql';

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

}

export default exportedHelpers;
