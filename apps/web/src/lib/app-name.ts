import { appNameFrom } from '@lynx/config';

/**
 * The product name (DECISIONS D-002): `APP_NAME`, read when the server starts, never inlined into
 * the build (D-113), so one image serves any name. Server code only (layouts, pages, the manifest
 * and PDFs, which are dynamic); a client component gets the name as a prop. Not `server-only`,
 * so the PDF renderer that prints it can be unit tested.
 */
export const APP_NAME = appNameFrom(process.env);
