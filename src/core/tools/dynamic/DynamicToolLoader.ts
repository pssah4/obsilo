/**
 * DynamicToolLoader
 *
 * Loads persisted dynamic tools from the plugin data directory at startup
 * and registers them with the ToolRegistry.
 *
 * Dynamic tools are stored as JSON records in:
 *   <configDir>/plugins/<pluginId>/dynamic-tools/<name>.json
 *
 * MIGRATION: This class now includes migrateToSkills() which converts
 * legacy dynamic tool JSON records into unified skill folders (SKILL.md +
 * code/ + code-compiled/). After migration, the JSON files are deleted.
 *
 * Part of Self-Development Phase 3: Sandbox + Dynamic Modules.
 */

import { TFile, TFolder } from 'obsidian';
import type ObsidianAgentPlugin from '../../../main';
import type { ToolRegistry } from '../ToolRegistry';
import type { ISandboxExecutor } from '../../sandbox/ISandboxExecutor';
import { DynamicToolFactory } from './DynamicToolFactory';
import type { DynamicToolRecord } from './types';
import type { SelfAuthoredSkillLoader } from '../../skills/SelfAuthoredSkillLoader';

// ---------------------------------------------------------------------------
// DynamicToolLoader
// ---------------------------------------------------------------------------

export class DynamicToolLoader {
    private readonly toolsDir: string;

    constructor(private plugin: ObsidianAgentPlugin) {
        this.toolsDir = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/dynamic-tools`;
    }

    /**
     * Load all persisted dynamic tools and register them.
     * This is kept as a fallback during migration. Once all tools are
     * migrated to skills, this method is no longer needed.
     */
    async loadAll(
        registry: ToolRegistry,
        sandboxExecutor: ISandboxExecutor,
    ): Promise<number> {
        const folder = this.plugin.app.vault.getAbstractFileByPath(this.toolsDir);
        if (!(folder instanceof TFolder)) return 0;

        let loaded = 0;
        for (const child of folder.children) {
            if (child instanceof TFile && child.extension === 'json') {
                try {
                    const content = await this.plugin.app.vault.read(child);
                    const record = JSON.parse(content) as DynamicToolRecord;

                    const tool = DynamicToolFactory.create(
                        record.definition,
                        record.compiledJs,
                        sandboxExecutor,
                        this.plugin,
                    );
                    registry.register(tool);
                    loaded++;
                } catch (e) {
                    console.warn(`[DynamicToolLoader] Failed to load ${child.path}:`, e);
                }
            }
        }

        if (loaded > 0) {
            console.debug(`[DynamicToolLoader] Loaded ${loaded} dynamic tool(s)`);
        }
        return loaded;
    }

    /**
     * Migrate all dynamic tool JSON records to unified skill folders.
     * Creates:
     *   skills/{tool-name}/SKILL.md
     *   skills/{tool-name}/code/{tool-name}.ts
     *   skills/{tool-name}/code-compiled/{tool-name}.js
     *
     * After successful migration, the JSON file is deleted.
     *
     * @returns Number of tools successfully migrated
     */
    async migrateToSkills(skillLoader: SelfAuthoredSkillLoader): Promise<number> {
        const folder = this.plugin.app.vault.getAbstractFileByPath(this.toolsDir);
        if (!(folder instanceof TFolder)) return 0;

        const jsonFiles = folder.children.filter(
            (c): c is TFile => c instanceof TFile && c.extension === 'json'
        );

        if (jsonFiles.length === 0) return 0;

        let migrated = 0;
        const skillsDir = skillLoader.getSkillsDir();

        for (const jsonFile of jsonFiles) {
            // Track created artifacts for rollback on partial failure
            const createdPaths: string[] = [];
            const createdFolders: string[] = [];

            try {
                const content = await this.plugin.app.vault.read(jsonFile);
                const record = JSON.parse(content) as DynamicToolRecord;
                const toolName = record.definition.name;
                const fileName = toolName.replace(/^custom_/, '').replace(/_/g, '-');
                const slug = fileName;

                // Check if skill already exists (skip if so)
                const skillDir = `${skillsDir}/${slug}`;
                const skillFilePath = `${skillDir}/SKILL.md`;
                const existing = this.plugin.app.vault.getAbstractFileByPath(skillFilePath);
                if (existing instanceof TFile) {
                    console.debug(`[DynamicToolLoader] Skill "${toolName}" already exists, skipping migration`);
                    continue;
                }

                // Create skill directory structure (track for rollback)
                await this.ensureFolder(skillDir);
                createdFolders.push(skillDir);
                await this.ensureFolder(`${skillDir}/code`);
                createdFolders.push(`${skillDir}/code`);
                await this.ensureFolder(`${skillDir}/code-compiled`);
                createdFolders.push(`${skillDir}/code-compiled`);

                // Build SKILL.md
                const schemaStr = JSON.stringify(record.definition.input_schema, null, 4);
                const depsStr = record.definition.dependencies?.length
                    ? JSON.stringify(record.definition.dependencies)
                    : '[]';

                const skillMd = `---
name: ${toolName}
description: ${record.definition.description}
trigger: "${toolName.replace(/^custom_/, '').replace(/_/g, '|')}"
source: learned
requiredTools: [${toolName}]
codeModules: [${fileName}]
createdAt: ${record.createdAt}
successCount: 0
---
Migrated from dynamic tool. This skill provides the ${toolName} tool.

1. Use ${toolName} with the appropriate input.
`;
                await this.plugin.app.vault.create(skillFilePath, skillMd);
                createdPaths.push(skillFilePath);

                // Write TypeScript source
                // Escape strings for safe embedding in generated TypeScript literals (CWE-116 fix)
                const escapeForStringLiteral = (s: string): string =>
                    s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');

                const tsSource = record.sourceTs.includes('export const definition')
                    ? record.sourceTs
                    : `export const definition = {
    name: '${escapeForStringLiteral(toolName)}',
    description: '${escapeForStringLiteral(record.definition.description)}',
    input_schema: ${schemaStr},
    isWriteOperation: ${record.definition.isWriteOperation ?? false},
    dependencies: ${depsStr},
};

${record.sourceTs}
`;
                const tsPath = `${skillDir}/code/${fileName}.ts`;
                await this.plugin.app.vault.create(tsPath, tsSource);
                createdPaths.push(tsPath);

                // Write compiled JS cache
                const jsPath = `${skillDir}/code-compiled/${fileName}.js`;
                await this.plugin.app.vault.create(jsPath, record.compiledJs);
                createdPaths.push(jsPath);

                // Only delete the original JSON AFTER all files written successfully
                await this.plugin.app.fileManager.trashFile(jsonFile);

                migrated++;
                console.debug(`[DynamicToolLoader] Migrated "${toolName}" to skill at ${skillDir}`);
            } catch (e) {
                console.warn(`[DynamicToolLoader] Migration failed for ${jsonFile.path}, rolling back:`, e);

                // Rollback: delete created files (reverse order)
                for (const path of createdPaths.reverse()) {
                    try {
                        const file = this.plugin.app.vault.getAbstractFileByPath(path);
                        if (file instanceof TFile) {
                            await this.plugin.app.fileManager.trashFile(file);
                        }
                    } catch (rbErr) {
                        console.warn(`[DynamicToolLoader] Rollback: failed to delete ${path}:`, rbErr);
                    }
                }
                // Clean up empty folders (deepest first)
                for (const folderPath of createdFolders.reverse()) {
                    try {
                        const dir = this.plugin.app.vault.getAbstractFileByPath(folderPath);
                        if (dir instanceof TFolder && dir.children.length === 0) {
                            await this.plugin.app.fileManager.trashFile(dir);
                        }
                    } catch {
                        // Non-fatal: folder may not be empty
                    }
                }
            }
        }

        if (migrated > 0) {
            console.debug(`[DynamicToolLoader] Migrated ${migrated} dynamic tool(s) to skills`);
        }

        return migrated;
    }

    /**
     * Save a dynamic tool record to disk.
     */
    async save(record: DynamicToolRecord): Promise<void> {
        await this.ensureDir();
        const filePath = `${this.toolsDir}/${record.definition.name}.json`;
        const content = JSON.stringify(record, null, 2);

        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.plugin.app.vault.modify(file, content);
        } else {
            await this.plugin.app.vault.create(filePath, content);
        }
    }

    /**
     * Delete a dynamic tool record from disk.
     */
    async remove(name: string): Promise<void> {
        const filePath = `${this.toolsDir}/${name}.json`;
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.plugin.app.fileManager.trashFile(file);
        }
    }

    /**
     * List all persisted dynamic tool names.
     */
    async listNames(): Promise<string[]> {
        const folder = this.plugin.app.vault.getAbstractFileByPath(this.toolsDir);
        if (!(folder instanceof TFolder)) return [];
        return folder.children
            .filter((c): c is TFile => c instanceof TFile && c.extension === 'json')
            .map(f => f.basename);
    }

    /**
     * Get the tools directory path.
     */
    getToolsDir(): string {
        return this.toolsDir;
    }

    private async ensureDir(): Promise<void> {
        await this.ensureFolder(this.toolsDir);
    }

    private async ensureFolder(path: string): Promise<void> {
        const folder = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(folder instanceof TFolder)) {
            await this.plugin.app.vault.createFolder(path);
        }
    }
}
