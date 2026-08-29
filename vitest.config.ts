import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        environment: 'node',
        include: [
            'src/**/__tests__/**/*.test.ts',
            'src/**/*.test.ts',
            // FEAT-29-08: skill-translator ships its dry-run + translate
            // helpers as plain .js under bundled-skills/. Tests live next
            // to the scripts so the rule for new bundled-skill helpers is
            // visible from one place.
            'bundled-skills/**/__tests__/**/*.test.js',
            // pro-skills carry the same kind of .js helpers. The glob matches
            // nothing on the public mirror, where pro-skills/ is stripped, so
            // this stays green there.
            'pro-skills/**/__tests__/**/*.test.js',
        ],
        globals: false,
        setupFiles: [path.resolve(__dirname, 'tests/stubs/safeFsSetup.ts')],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json-summary'],
            // DEBT-CC-2026-08-28-03: `_devprocess/rules/technical.md` has claimed
            // a 30% lines / 35% functions gate since long before this key existed,
            // so the documented hurdle was not enforced anywhere. Measured on
            // 2026-08-29: lines 47.54%, functions 45.51%, i.e. 17.5 and 10.5
            // points of headroom. The numbers stay at the DOCUMENTED values, not
            // at the current ones: a gate pinned to today's number turns every
            // small refactor into a red build, and the point here is to catch a
            // collapse, not to freeze the status quo.
            //
            // A threshold only fires on a `--coverage` run, so perf-budget.yml
            // runs one. Without that step this key would be decoration, which is
            // the same defect in new packaging.
            thresholds: {
                lines: 30,
                functions: 35,
            },
            include: ['src/**/*.ts'],
            exclude: [
                'src/_generated/**',
                'src/**/__tests__/**',
                'src/**/*.test.ts',
                'src/**/*.d.ts',
                'src/types/**',
            ],
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            // vitest stub for obsidian types (import type only — no runtime import)
            'obsidian': path.resolve(__dirname, 'tests/stubs/obsidian.ts'),
        },
    },
});
