import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 15000,
    // Тесты гоняем последовательно — они работают с реальной БД
    pool: 'forks',
    singleFork: true,
    // Только исходники: dist/__tests__ не должен подхватываться
    include: ['src/**/*.test.ts'],
  },
})
