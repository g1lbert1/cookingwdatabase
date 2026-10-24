import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

//validateImageUrl accepts this site's Cloudinary folder, so the test needs the
//config a server would have. Set before the import so settings.js sees it.
process.env.AUTH0_DOMAIN ??= 'example.auth0.com';
process.env.AUTH0_AUDIENCE ??= 'https://example-api';
process.env.CLOUDINARY_CLOUD_NAME ??= 'democloud';
process.env.CLOUDINARY_API_KEY ??= 'key';
process.env.CLOUDINARY_API_SECRET ??= 'secret';
process.env.CLOUDINARY_FOLDER ??= 'testfolder';

const helpers = (await import('../helpers.js')).default;

const photo = (name) => `https://res.cloudinary.com/democloud/image/upload/v1/testfolder/${name}.jpg`;

const base = () => ({
  title: 'Garlic butter pasta',
  prepTime: 20,
  ingredients: [{ name: 'Spaghetti', amount: 200, unit: 'GRAMS', notes: null }],
  instructions: ['Boil the pasta.', 'Toss with garlic butter.'],
  content: 'Weeknight dinner.',
  imageUrl: photo('cover')
});

describe('validateRecipeInput: page settings', () => {
  test('a plain recipe gets the defaults', () => {
    const out = helpers.validateRecipeInput(base());
    assert.equal(out.story, null);
    assert.deepEqual(out.gallery, []);
    assert.equal(out.layout, 'CLASSIC');
    assert.equal(out.accent, 'PLUM');
  });

  test('keeps a story, trimmed, and the chosen layout and accent', () => {
    const out = helpers.validateRecipeInput({ ...base(), story: '  # Why I make this\n\nBecause.  ', layout: 'EDITORIAL', accent: 'TEAL' });
    assert.equal(out.story, '# Why I make this\n\nBecause.');
    assert.equal(out.layout, 'EDITORIAL');
    assert.equal(out.accent, 'TEAL');
  });

  test('an empty story is null', () => {
    assert.equal(helpers.validateRecipeInput({ ...base(), story: '   ' }).story, null);
  });

  test('story length limit', () => {
    assert.throws(() => helpers.validateRecipeInput({ ...base(), story: 'a'.repeat(20001) }), /20,000 characters/);
  });

  test('story is checked for profanity like every other field', () => {
    assert.throws(() => helpers.validateRecipeInput({ ...base(), story: 'This is some fucking good pasta' }), /The story contains language/);
  });

  test('gallery keeps order, drops blanks, repeats and the cover photo', () => {
    const out = helpers.validateRecipeInput({
      ...base(),
      gallery: [photo('a'), '', photo('b'), photo('a'), photo('cover'), null]
    });
    assert.deepEqual(out.gallery, [photo('a'), photo('b')]);
  });

  test('gallery refuses photos from elsewhere', () => {
    assert.throws(() => helpers.validateRecipeInput({ ...base(), gallery: ['https://evil.example/x.jpg'] }), /uploaded through this site/);
    assert.throws(() => helpers.validateRecipeInput({ ...base(), gallery: ['javascript:alert(1)'] }), /uploaded through this site/);
  });

  test('gallery size limit', () => {
    const nine = Array.from({ length: 9 }, (_, i) => photo(`g${i}`));
    assert.throws(() => helpers.validateRecipeInput({ ...base(), gallery: nine }), /at most 8/);
  });

  test('unknown layout or accent is refused even if the schema were bypassed', () => {
    assert.throws(() => helpers.validateRecipeInput({ ...base(), layout: 'NEON' }), /Unknown layout/);
    assert.throws(() => helpers.validateRecipeInput({ ...base(), accent: 'red' }), /Unknown accent/);
  });
});

describe('validateRecipeInput: profanity on the core fields', () => {
  test('title', () => {
    assert.throws(() => helpers.validateRecipeInput({ ...base(), title: 'Fucking great pasta' }), /The title contains language/);
  });
  test('description', () => {
    assert.throws(() => helpers.validateRecipeInput({ ...base(), content: 'sh1t hot' }), /The description contains language/);
  });
  test('ingredient name and notes, with the row number', () => {
    assert.throws(() => helpers.validateRecipeInput({ ...base(), ingredients: [{ name: 'Spaghetti' }, { name: 'bitch sauce' }] }), /Ingredient 2 contains/);
    assert.throws(() => helpers.validateRecipeInput({ ...base(), ingredients: [{ name: 'Butter', notes: 'the fucking good kind' }] }), /Ingredient 1's notes/);
  });
  test('instruction steps, with the step number', () => {
    assert.throws(() => helpers.validateRecipeInput({ ...base(), instructions: ['Boil.', 'Stir the shit out of it.'] }), /Step 2 contains/);
  });
  test('cooking words pass', () => {
    const out = helpers.validateRecipeInput({
      ...base(),
      title: 'Spotted dick with cumin custard',
      ingredients: [{ name: 'Shiitake mushrooms' }, { name: 'Cucumber', notes: 'assorted sizes' }],
      instructions: ['Scrape the bowl.', 'Add the cock-a-leekie stock.']
    });
    assert.equal(out.title, 'Spotted dick with cumin custard');
  });
});

describe('validateCommentBody', () => {
  test('refuses profanity', () => {
    assert.throws(() => helpers.validateCommentBody('this is shit'), /Your comment contains language/);
  });
  test('allows conversation', () => {
    assert.equal(helpers.validateCommentBody(' Loved it, thanks! '), 'Loved it, thanks!');
  });
});
