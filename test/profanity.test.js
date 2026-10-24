import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { containsProfanity, findProfanity, assertClean, assertCleanUsername } from '../profanity.js';

const flagged = (text) => assert.equal(containsProfanity(text), true, `expected "${text}" to be refused (${findProfanity(text)})`);
const allowed = (text) => assert.equal(containsProfanity(text), false, `expected "${text}" to be allowed, matched ${JSON.stringify(findProfanity(text))}`);

describe('ordinary profanity', () => {
  for(const text of ['fuck', 'shit', 'bitch', 'asshole', 'cunt', 'what the fuck is this', 'This recipe is shit.']){
    test(text, () => flagged(text));
  }
});

describe('case and whitespace', () => {
  for(const text of ['FUCK', 'Fuck', 'fUcK', '  shit  ', 'SHIT recipe', 'Bitch']){
    test(JSON.stringify(text), () => flagged(text));
  }
});

describe('common obfuscations', () => {
  for(const text of ['sh1t', 'sh!t', 'fuuuuck', 'fuk', 'f*ck', 'f.u.c.k', 's-h-i-t', 'b!tch', 'b1tch', 'a$$hole', '@sshole', 'c u n t', 'fUcK3r', 'what the f u c k']){
    test(text, () => flagged(text));
  }
  for(const text of ['spicy', 'spice rub', 'a b c salad', 'vitamin c', 'plan b dinner', 'grade a eggs']){
    test(`${text} allowed`, () => allowed(text));
  }
});

describe('slurs', () => {
  //"spic" is deliberately absent from the dataset: it is inside "spice" and
  //"spicy", which a cooking site cannot refuse.
  for(const text of ['nigger', 'n1gger', 'faggot', 'f4ggot', 'kike', 'chink', 'tranny']){
    test(text, () => flagged(text));
  }
});

describe('cooking terminology is allowed', () => {
  const terms = [
    'shiitake mushrooms', 'cumin', 'ground cumin and coriander', 'cucumber salad', 'spotted dick', 'cock-a-leekie soup',
    'cockles', 'coq au vin', 'cocktail sauce', 'assorted nuts', 'molasses cookies', 'passion fruit curd', 'cassava cake',
    'brassica', 'massaman curry', 'wasabi', 'assam tea', 'cassoulet', 'fricassee', 'pissaladière', 'pissaladiere',
    'titbits', 'tartlets', 'petit fours', 'shellfish stock', 'nigiri', 'nigella seeds', 'grape jelly', 'grapefruit',
    'rapeseed oil', 'scrape the bowl', 'scraps', 'hoecakes', 'pasta e fagioli', 'kumquat marmalade', 'basmati rice',
    'scallops', 'chicken breast', 'butt roast', 'pork butt', 'Boston butt', 'crab cakes', 'Scunthorpe pie', 'Dickens pudding',
    'cumberland sausage', 'classic lasagna', 'glass noodles', 'lassi', 'passata', 'sassy sauce', 'potassium', 'analyse the dough',
    'canal house stew', 'hello fresh bread', 'shell the peas', 'wine therapy', 'documentary dinner', 'circumference of the pan',
    'sexy chocolate cake', 'damn good chili', 'hell of a brisket', 'crap, I forgot the salt', 'bloody mary', 'bollito misto'
  ];
  for(const text of terms){
    test(text, () => allowed(text));
  }
});

describe('ordinary conversational language is allowed', () => {
  for(const text of ['Tried it, loved it!', 'My kids ate the whole tray.', 'Great with a cold beer.', 'Needs more garlic imo', '10/10 would cook again', 'Thanks for sharing :)']){
    test(text, () => allowed(text));
  }
});

describe('usernames', () => {
  for(const name of ['tristan', 'cook_with_tristan', 'ShiitakeFan', 'cumin-queen', 'Dickens99', 'passionfruit', 'grapefruit_gal']){
    test(`${name} allowed`, () => allowed(name));
  }
  for(const name of ['fuckface', 'sh1thead', 'b1tch_please', 'FuckYou', 'a55hole', 'kike123']){
    test(`${name} refused`, () => flagged(name));
  }
});

describe('assert helpers', () => {
  test('assertClean returns the text untouched when clean', () => {
    assert.equal(assertClean('  Spotted dick with custard  ', 'Title'), '  Spotted dick with custard  ');
  });
  test('assertClean names the field and never rewrites content', () => {
    assert.throws(() => assertClean('what the fuck', 'Step 2'), (e) =>
      e.message.startsWith('Step 2 contains language') && e.extensions.code === 'BAD_USER_INPUT' && e.extensions.reason === 'PROFANITY'
    );
  });
  test('assertCleanUsername gives the username message', () => {
    assert.throws(() => assertCleanUsername('sh1thead'), /That username isn't allowed/);
  });
  test('non-strings and empty strings are clean', () => {
    assert.equal(containsProfanity(null), false);
    assert.equal(containsProfanity(undefined), false);
    assert.equal(containsProfanity(''), false);
    assert.equal(containsProfanity(42), false);
    assert.deepEqual(findProfanity(null), []);
  });
});
