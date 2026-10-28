import { defineConfig } from 'vite';

// GitHub Pages では https://asaka6.github.io/karaoke-trainer/ に置かれる
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/karaoke-trainer/' : '/',
  build: { target: 'es2022' },
  test: { environment: 'node' },
} as any);
