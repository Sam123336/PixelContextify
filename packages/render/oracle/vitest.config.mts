const APP = '/Users/sambit/Belivmart/belivmart-admin'

export default {
  root: APP + '/.rcx-oracle',
  resolve: { alias: [{ find: /^@\//, replacement: APP + '/' }] },
  esbuild: { jsx: 'automatic' },
  test: { environment: 'jsdom', include: ['**/*.test.tsx'], globals: true },
}
