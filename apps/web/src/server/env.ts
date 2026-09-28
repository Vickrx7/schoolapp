import 'server-only';
import { loadEnv, webServerEnvSchema, type WebServerEnv } from '@lynx/config';

let cached: WebServerEnv | undefined;

export function serverEnv(): WebServerEnv {
  cached ??= loadEnv(webServerEnvSchema);
  return cached;
}
