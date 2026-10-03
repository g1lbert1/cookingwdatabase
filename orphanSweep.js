import { cloudinaryConfig } from './config/settings.js';
import { recipes as recipeCollection } from './config/mongoCollections.js';
import { cloudinary, publicIdFromUrl } from './cloudinary.js';

//Finds photos in our Cloudinary folder that no recipe references and
//deletes them. This catches what the per-mutation cleanup cannot: a photo
//uploaded from a form that was never submitted, or "Replace photo" used
//twice before saving.
//
//Three guards keep it from deleting anything that matters:
//  1. Only assets tagged user_<id>, i.e. uploaded through this API's signed
//     flow. Anything placed in the folder by hand (and every upload from
//     before tagging existed) is left alone.
//  2. A grace period, so a photo on a form someone is still filling in is
//     never swept. Uploads newer than graceHours are skipped.
//  3. The reference set is every imageUrl in the recipes collection this
//     process is connected to. The folder and that database must belong
//     together; see the README about per-environment folders.
export const sweepOrphanPhotos = async ({ graceHours = 24, dryRun = true } = {}) => {
  if(!cloudinaryConfig) return { skipped: 'Cloudinary is not configured', dryRun };

  const recipeList = await recipeCollection();
  const withPhotos = await recipeList
    .find({ imageUrl: { $type: 'string' } }, { projection: { imageUrl: 1 } })
    .toArray();
  const referenced = new Set(
    withPhotos.map((r) => publicIdFromUrl(r.imageUrl)).filter(Boolean)
  );

  const assets = await cloudinary.listFolderImages();
  const cutoff = Date.now() - graceHours * 60 * 60 * 1000;
  const orphans = assets.filter((a) =>
    a.tags.some((t) => t.startsWith('user_')) &&
    !referenced.has(a.publicId) &&
    new Date(a.createdAt).getTime() < cutoff
  );

  const deleted = dryRun || orphans.length === 0
    ? []
    : await cloudinary.deleteImages(orphans.map((a) => a.publicId));

  return {
    dryRun,
    graceHours,
    scanned: assets.length,
    referenced: referenced.size,
    orphans: orphans.map((a) => ({ publicId: a.publicId, createdAt: a.createdAt, bytes: a.bytes })),
    deleted
  };
};

//Runs the sweep shortly after boot and then once a day, for long-lived
//deployments. Timers are unref'd so they never keep a shutting-down process
//alive. Errors are logged; a sweep that fails today runs again tomorrow.
export const scheduleOrphanSweep = ({ graceHours, initialDelayMs = 60 * 1000, intervalMs = 24 * 60 * 60 * 1000 }) => {
  const run = async () => {
    try {
      const report = await sweepOrphanPhotos({ graceHours, dryRun: false });
      console.log(
        `Orphan photo sweep: scanned ${report.scanned}, referenced ${report.referenced}, ` +
        `deleted ${report.deleted.length}` +
        (report.deleted.length ? ` (${report.deleted.join(', ')})` : '')
      );
    } catch (e) {
      console.error('Orphan photo sweep failed:', e.message);
    }
  };
  setTimeout(run, initialDelayMs).unref();
  setInterval(run, intervalMs).unref();
};
