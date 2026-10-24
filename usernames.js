import { randomBytes } from 'node:crypto';
import { GraphQLError } from 'graphql';
import { assertCleanUsername, containsProfanity } from './profanity.js';

//Username rules, in one place for the login flow, the rename mutation and
//the live check the profile form runs while the user types.
//
//A username is shown exactly as typed but compared case-insensitively:
//`usernameLower` is what the unique index and every lookup use, so "Tristan"
//and "tristan" are the same name and `/u/Tristan` finds either spelling.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
//Letters, digits, underscore and hyphen; must start and end with a letter
//or digit so a name never reads as a flag or a dangling separator.
const SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/;

//Names that would collide with routes or read as official.
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help', 'staff', 'moderator', 'mod',
  'me', 'you', 'user', 'users', 'profile', 'profiles', 'account', 'accounts', 'settings',
  'u', 'recipes', 'recipe', 'about', 'home', 'login', 'logout', 'signup', 'register',
  'new', 'edit', 'delete', 'api', 'graphql', 'www', 'null', 'undefined', 'anonymous',
  'deleted', 'deleted-user', 'deleted_user', 'cookingwtristan'
]);

//How long a previous username stays reserved for its old owner after a
//rename, during which old links redirect and nobody else can claim it.
export const PREVIOUS_NAME_HOLD_DAYS = 30;

const badInput = (message) =>
  new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });

export const usernameKey = (name) => name.toLowerCase();

//Returns { username, usernameLower } for a valid name or throws a
//user-facing error naming the rule that failed. Trims surrounding
//whitespace; nothing else is altered, so what the user sees is what is
//saved.
export const validateUsername = (raw) => {
  if(typeof raw !== 'string') throw badInput('Username must be text.');
  const username = raw.trim();
  if(username.length < USERNAME_MIN){
    throw badInput(`Usernames need at least ${USERNAME_MIN} characters.`);
  }
  if(username.length > USERNAME_MAX){
    throw badInput(`Usernames can be at most ${USERNAME_MAX} characters.`);
  }
  if(!SHAPE.test(username)){
    throw badInput('Usernames can only use letters, numbers, underscores and hyphens, and must start and end with a letter or number.');
  }
  const usernameLower = usernameKey(username);
  if(RESERVED.has(usernameLower)){
    throw badInput("That username is reserved. Please choose a different one.");
  }
  assertCleanUsername(username);
  return { username, usernameLower };
};

//Turns whatever Auth0 sent as a nickname into something that passes the
//rules above, for first login: invalid characters become hyphens, the
//result is trimmed to size, and a name that is too short, reserved or
//profane is replaced by a neutral one. Never throws.
export const usernameFromNickname = (nickname) => {
  const base = String(nickname ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, USERNAME_MAX)
    .replace(/[_-]+$/g, '');
  const usable =
    base.length >= USERNAME_MIN &&
    SHAPE.test(base) &&
    !RESERVED.has(usernameKey(base)) &&
    !containsProfanity(base);
  return usable ? base : `cook-${randomBytes(3).toString('hex')}`;
};

//A short suffix for collisions, kept within the length limit.
export const withUsernameSuffix = (username) => {
  const suffix = `-${randomBytes(2).toString('hex')}`;
  return username.slice(0, USERNAME_MAX - suffix.length).replace(/[_-]+$/g, '') + suffix;
};

export const isReservedUsername = (name) => RESERVED.has(usernameKey(name));
