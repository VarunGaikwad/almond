import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { name: 'Almond — Personal Finance', short_name: 'Almond', description: 'A calmer place for your money.',
    start_url: '/', scope: '/', display: 'standalone', background_color: '#f7f7f2', theme_color: '#6d8163',
    icons: [ { src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }, { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' } ],
  };
}
