## CookingWDatabase
GraphQL database for cookingwtristan
### Implementation Plan:
* Using GraphQL as communication layer between front end app and backend
* MongoDB to persist recipe and user data
* Redis to cache data for faster access time. Also will aid in API rate limiting and a possible *trending recipes* feature

### First Commit:
* Initialized MongoDB connection and collections
* Initialized GraphQL server
* Established typedefs
* still need to work on resolvers now and mongodb seed file, script for users, being able to handle jwt tokens, auth0, etc
* currently working on jwt tokens and auth0 2/2/26
* Done handling jwt tokens and auth0 setup


