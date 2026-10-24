import { GraphQLError } from 'graphql';
import {
  DataSet,
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers
} from 'obscenity';

//The one place that decides what counts as profanity. Usernames, recipe
//text and comments all come through here, so a word allowed in a title is
//allowed in a comment and vice versa.
//
//obscenity's English dataset handles the hard part: case, leetspeak (sh1t),
//confusable characters, repeated letters (fuuuck) and separators (f.u.c.k)
//are all normalised before matching, and its whitelist stops substrings
//inside ordinary words from matching. What it does not know is cooking.
//Spotted dick, cock-a-leekie and shiitake are real food, so they go on the
//whitelist below. Add to ALLOWED_TERMS when a legitimate word is refused;
//never edit the regexes.

//Everyday words in the dataset that are not profanity in a kitchen.
//"sex" is listed so "sexy chocolate cake" is not refused; the explicit
//sexual terms stay on the list.
const REMOVED_WORDS = new Set(['sex']);

//Words and phrases whose letters happen to contain a blocked word.
//Whitelisting is applied after normalisation, so one spelling covers case.
const ALLOWED_TERMS = [
  //shit
  'shiitake', 'shitake',
  //cum
  'cumin', 'cucumber', 'cucumbers', 'cumberland', 'cumquat', 'scum', 'circumference', 'documentary',
  //dick
  'spotted dick', 'dickens', 'dickinson', 'moby dick',
  //cock
  'cock-a-leekie', 'cockaleekie', 'cock a leekie', 'cockle', 'cockles', 'cocktail', 'cocktails', 'coq au vin',
  'peacock', 'hancock', 'babcock', 'cockerel', 'stopcock', 'cockroach',
  //ass
  'assorted', 'assortment', 'molasses', 'passion fruit', 'passionfruit', 'cassava', 'sassafras', 'brassica',
  'massaman', 'wasabi', 'assam', 'assemble', 'assembled', 'assembly', 'cassoulet', 'fricassee', 'tassie',
  'classic', 'glass', 'grass', 'brass', 'mass', 'massage', 'passover', 'compass', 'embassy', 'lassi',
  'harass', 'potassium', 'ambassador', 'sassy', 'passata',
  //piss
  'pissaladière', 'pissaladiere',
  //tit
  'titbit', 'titbits', 'tartlet', 'petit', 'petite', 'appetite', 'constitution',
  //hell
  'hello', 'shellfish', 'shell', 'shells', 'shelled',
  //anal
  'analysis', 'analyse', 'analyze', 'banal', 'canal', 'canals',
  //nig
  'nigiri', 'nigella',
  //crap
  'crappie', 'scrap', 'scraps', 'scrape', 'scraped',
  //rape
  'grape', 'grapes', 'grapefruit', 'rapeseed', 'drape', 'drapes', 'scraper', 'therapist', 'therapy',
  //hoe
  'hoecake', 'hoecakes', 'shoe', 'shoestring',
  //tart is fine, this covers the slur fragment in a common word
  'fagioli', 'fagottini'
];

const dataset = new DataSet().addAll(englishDataset);
dataset.removePhrasesIf((phrase) => REMOVED_WORDS.has(phrase.metadata?.originalWord));
const terms = dataset.build();

const matcher = new RegExpMatcher({
  blacklistedTerms: terms.blacklistedTerms,
  whitelistedTerms: [...terms.whitelistedTerms, ...ALLOWED_TERMS],
  ...englishRecommendedTransformers
});

//Letters spelled out one at a time ("f.u.c.k", "c u n t", "s-h-i-t") slip
//past word-boundary matching. Only such runs are joined back together, so a
//normal sentence is left alone and "a b c" style text is the only thing
//affected. Ordinary words keep their boundaries.
const SPELLED_OUT = /\b(?:[A-Za-z][\s.,*_\-|!@#$%^&+=~`'"]{1,2}){2,}[A-Za-z]\b/g;
const joinSpelledOut = (text) => text.replace(SPELLED_OUT, (run) => run.replace(/[^A-Za-z]/g, ''));

const variants = (text) => {
  const joined = joinSpelledOut(text);
  return joined === text ? [text] : [text, joined];
};

//True when the text contains a blocked word in any of the spellings the
//matcher understands. Non-strings and empty strings are clean.
export const containsProfanity = (text) =>
  typeof text === 'string' && text.length > 0 && variants(text).some((t) => matcher.hasMatch(t));

//The blocked words found, in their dictionary spelling, for tests and logs.
//Never shown to users: the message tells them what to do, not what we saw.
export const findProfanity = (text) => {
  if(typeof text !== 'string' || text.length === 0) return [];
  const words = variants(text)
    .flatMap((t) => matcher.getAllMatches(t, true))
    .map((match) => englishDataset.getPayloadWithPhraseMetadata(match).phraseMetadata?.originalWord)
    .filter(Boolean);
  return [...new Set(words)];
};

const notAllowed = (message) =>
  new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT', reason: 'PROFANITY' } });

//Throws a user-facing error naming the field, so a long form tells the
//author which part to revise. Returns the text unchanged otherwise:
//content is never silently rewritten.
export const assertClean = (text, label) => {
  if(containsProfanity(text)){
    throw notAllowed(`${label} contains language that isn't allowed on this site. Please revise it.`);
  }
  return text;
};

export const assertCleanUsername = (username) => {
  if(containsProfanity(username)){
    throw notAllowed("That username isn't allowed. Please choose a different one.");
  }
  return username;
};
