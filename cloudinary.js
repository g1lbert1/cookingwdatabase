import { createHash } from 'node:crypto';
import { cloudinaryConfig } from './config/settings.js';

//Everything that knows Cloudinary's URL shapes and request signing. The
//resolvers only ask: sign these upload params, is this URL one of ours,
//and destroy this asset.

//Cloudinary's signing scheme for both uploads and destroys: sort the params
//alphabetically, join as key=value&..., append the API secret, SHA-1 it.
//https://cloudinary.com/documentation/upload_images#generating_authentication_signatures
export const signParams = (params, secret) => {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1').update(toSign + secret).digest('hex');
};

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

//Matches a bare delivery URL for an image in this cloud and folder with an
//allowed extension, capturing the public_id (folder/name), e.g.
//  https://res.cloudinary.com/<cloud>/image/upload/v123/<folder>/abc123.jpg
//No transformation segment is allowed: stored URLs are the plain upload
//result and the frontend adds its own display transformations.
const ownImageUrl = cloudinaryConfig
  ? new RegExp(
      `^https://res\\.cloudinary\\.com/${escapeRegExp(cloudinaryConfig.cloudName)}` +
      `/image/upload/(?:v\\d+/)?(${escapeRegExp(cloudinaryConfig.folder)}/[A-Za-z0-9_-]+)` +
      `\\.(?:${cloudinaryConfig.allowedFormats.concat('jpeg').join('|')})$`
    )
  : null;

//"folder/name" for one of our delivery URLs, null for anything else.
export const publicIdFromUrl = (url) => {
  if(!ownImageUrl || typeof url !== 'string') return null;
  const match = ownImageUrl.exec(url);
  return match ? match[1] : null;
};

//Admin API calls authenticate with key:secret over Basic auth.
const adminAuth = () =>
  'Basic ' + Buffer.from(`${cloudinaryConfig.apiKey}:${cloudinaryConfig.apiSecret}`).toString('base64');

const adminRequest = async (method, path, params) => {
  const url = new URL(`https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}${path}`);
  for(const [key, value] of params){
    url.searchParams.append(key, value);
  }
  const res = await fetch(url, {
    method,
    headers: { authorization: adminAuth() },
    signal: AbortSignal.timeout(20000)
  });
  const json = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json;
};

//Kept on an object so a test can swap these for recorders instead of
//calling Cloudinary.
export const cloudinary = {
  //Every image asset under our folder, all pages, with tags so the sweep can
  //tell API-issued uploads (tagged user_<id>) from anything placed by hand.
  async listFolderImages() {
    const assets = [];
    let cursor;
    do {
      const params = [
        ['prefix', `${cloudinaryConfig.folder}/`],
        ['max_results', '500'],
        ['tags', 'true']
      ];
      if(cursor) params.push(['next_cursor', cursor]);
      const page = await adminRequest('GET', '/resources/image/upload', params);
      for(const r of page.resources ?? []){
        assets.push({
          publicId: r.public_id,
          createdAt: r.created_at,
          bytes: r.bytes ?? 0,
          tags: r.tags ?? []
        });
      }
      cursor = page.next_cursor;
    } while(cursor);
    return assets;
  },

  //Bulk delete by public_id, 100 per request (the Admin API's ceiling).
  //Returns the ids Cloudinary reports as deleted.
  async deleteImages(publicIds) {
    const deleted = [];
    for(let i = 0; i < publicIds.length; i += 100){
      const chunk = publicIds.slice(i, i + 100);
      const params = chunk.map((id) => ['public_ids[]', id]);
      params.push(['invalidate', 'true']);
      const result = await adminRequest('DELETE', '/resources/image/upload', params);
      for(const [id, status] of Object.entries(result.deleted ?? {})){
        if(status === 'deleted') deleted.push(id);
      }
    }
    return deleted;
  },

  //Deletes the asset behind one of our URLs. Best effort by design: the
  //recipe change that triggered it has already been committed, and a
  //leftover photo costs a little storage while a failed mutation would cost
  //the user their edit. Returns Cloudinary's result ('ok', 'not found'),
  //'skipped' for a URL that is not ours, or 'failed' after logging.
  async destroyImage(url) {
    const publicId = publicIdFromUrl(url);
    if(!publicId) return 'skipped';
    const params = {
      public_id: publicId,
      timestamp: Math.floor(Date.now() / 1000),
      //Also purge CDN copies, so the old photo stops being served promptly.
      invalidate: 'true'
    };
    const body = new URLSearchParams({
      ...params,
      api_key: cloudinaryConfig.apiKey,
      signature: signParams(params, cloudinaryConfig.apiSecret)
    });
    try {
      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/image/destroy`,
        { method: 'POST', body, signal: AbortSignal.timeout(8000) }
      );
      const json = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
      return json.result;
    } catch (e) {
      console.error(`Cloudinary destroy failed for ${publicId}: ${e.message}`);
      return 'failed';
    }
  }
};
