// Finds (and with --delete, removes) photos in the Cloudinary folder that no
// recipe in the connected database references. Dry run by default.
//
//   npm run sweep-orphans                 # report only
//   npm run sweep-orphans -- --delete     # actually delete
//   npm run sweep-orphans -- --grace=48   # skip uploads newer than 48 hours
//
// Run it against the database that owns the Cloudinary folder. A local
// database pointed at the production folder would see production photos
// as unreferenced; keep CLOUDINARY_FOLDER per environment (see README).
import { sweepOrphanPhotos } from '../orphanSweep.js';
import { cloudinaryConfig, mongoConfig } from '../config/settings.js';
import { closeConnection } from '../config/mongoConnection.js';

const args = process.argv.slice(2);
const dryRun = !args.includes('--delete');
const graceArg = args.find((a) => a.startsWith('--grace='));
const graceHours = graceArg ? Number(graceArg.split('=')[1]) : 24;
if(!Number.isFinite(graceHours) || graceHours < 0){
  console.error('--grace must be a number of hours, zero or greater.');
  process.exit(1);
}

console.log(
  `${dryRun ? 'DRY RUN' : 'DELETING'}: folder "${cloudinaryConfig?.folder}" in cloud ` +
  `"${cloudinaryConfig?.cloudName}" against database "${mongoConfig.database}", grace ${graceHours}h`
);

try {
  const report = await sweepOrphanPhotos({ graceHours, dryRun });
  if(report.skipped){
    console.log(`Skipped: ${report.skipped}`);
  } else {
    console.log(`Scanned ${report.scanned} assets; ${report.referenced} referenced by recipes.`);
    if(report.orphans.length === 0){
      console.log('No orphans.');
    } else {
      const kb = (b) => `${Math.round(b / 1024)} KB`;
      for(const o of report.orphans){
        console.log(`  ${dryRun ? 'would delete' : 'delete'}  ${o.publicId}  (${kb(o.bytes)}, uploaded ${o.createdAt})`);
      }
      console.log(dryRun
        ? `${report.orphans.length} orphan(s). Re-run with --delete to remove them.`
        : `Deleted ${report.deleted.length} of ${report.orphans.length}.`);
    }
  }
} finally {
  //closeConnection assumes a connection was opened; a skipped sweep never
  //opened one.
  try { await closeConnection(); } catch { /* nothing to close */ }
}
