import type { MetadataRoute } from 'next';
import { APP_NAME } from '@/lib/app-name';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description:
      'Planification, suivi des leçons et suppléance pour les écoles catholiques de langue française.',
    lang: 'fr-CA',
    start_url: '/today',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#2553d8',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    // Long-press the app icon at 6 a.m.: straight to the absence form (two taps to send).
    shortcuts: [
      {
        name: 'Signaler une absence',
        short_name: 'Absence',
        url: '/absences/new',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
