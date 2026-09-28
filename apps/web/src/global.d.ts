import type messages from '../messages/fr-CA.json';

declare module 'next-intl' {
  interface AppConfig {
    Messages: typeof messages;
  }
}
