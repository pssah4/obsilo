/**
 * SelfAuthoredSkillLoader
 *
 * Loads and manages agent-created SKILL.md files with YAML frontmatter.
 * Skills are stored in the plugin data directory under skills/.
 * Hot-reload via Vault events.
 *
 * Skills can optionally contain code modules (TypeScript files in code/)
 * that are compiled and registered as dynamic tools. This unifies the
 * former "Skills" and "Dynamic Tools" concepts into a single abstraction.
 *
 * Part of Self-Development Phase 2+3: Skill Self-Authoring + Code Modules.
 */

import { TFile, TFolder } from 'obsidian';
import { safeRegex } from '../utils/safeRegex';
import type ObsidianAgentPlugin from '../../main';
import type { EsbuildWasmManager } from '../sandbox/EsbuildWasmManager';
import type { SandboxExecutor } from '../sandbox/SandboxExecutor';
import type { ToolRegistry } from '../tools/ToolRegistry';
import { DynamicToolFactory } from '../tools/dynamic/DynamicToolFactory';
import type { CodeModuleInfo, DynamicToolDefinition } from '../tools/dynamic/types';
import type { ToolName } from '../tools/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SelfAuthoredSkill {
    name: string;
    description: string;
    trigger: RegExp;
    triggerSource: string;
    source: 'learned' | 'user' | 'bundled';
    requiredTools: string[];
    /** Code module filenames (without .ts) listed in frontmatter */
    codeModules: string[];
    /** Loaded code module metadata (populated after loading compiled JS) */
    codeModuleInfos: CodeModuleInfo[];
    createdAt: Date;
    successCount: number;
    body: string;
    filePath: string;
}

// ---------------------------------------------------------------------------
// SelfAuthoredSkillLoader
// ---------------------------------------------------------------------------

export class SelfAuthoredSkillLoader {
    private skills = new Map<string, SelfAuthoredSkill>();
    private readonly skillsDir: string;
    private esbuildManager: EsbuildWasmManager | null;
    private sandboxExecutor: SandboxExecutor | null;
    private toolRegistry: ToolRegistry | null;
    /** Debounce timers for hot-reload per file path */
    private recompileTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** Serialize compilation to prevent concurrent builds for the same module */
    private compileQueue = Promise.resolve();

    constructor(
        private plugin: ObsidianAgentPlugin,
        esbuildManager?: EsbuildWasmManager | null,
        sandboxExecutor?: SandboxExecutor | null,
        toolRegistry?: ToolRegistry | null,
    ) {
        this.skillsDir = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/skills`;
        this.esbuildManager = esbuildManager ?? null;
        this.sandboxExecutor = sandboxExecutor ?? null;
        this.toolRegistry = toolRegistry ?? null;
    }

    /**
     * Late-bind dependencies that are not available at construction time.
     * Called from main.ts after ToolRegistry is created.
     */
    setDependencies(
        esbuildManager: EsbuildWasmManager,
        sandboxExecutor: SandboxExecutor,
        toolRegistry: ToolRegistry,
    ): void {
        this.esbuildManager = esbuildManager;
        this.sandboxExecutor = sandboxExecutor;
        this.toolRegistry = toolRegistry;
    }

    /**
     * Scan the skills directory and load all SKILL.md files.
     * For skills with code modules, loads cached compiled JS and registers tools.
     */
    async loadAll(): Promise<void> {
        this.skills.clear();
        const folder = this.plugin.app.vault.getAbstractFileByPath(this.skillsDir);
        if (!(folder instanceof TFolder)) return;

        for (const child of folder.children) {
            if (child instanceof TFolder) {
                // Look for SKILL.md inside each skill folder
                const skillFile = this.plugin.app.vault.getAbstractFileByPath(
                    `${child.path}/SKILL.md`
                );
                if (skillFile instanceof TFile) {
                    await this.loadSkillFile(skillFile);
                }
            }
        }

        // After all skills are loaded, load cached code modules and register tools
        for (const skill of this.skills.values()) {
            if (skill.codeModules.length > 0) {
                await this.loadCodeModules(skill);
                this.registerCodeTools(skill);
            }
        }

        console.debug(`[SelfAuthoredSkillLoader] Loaded ${this.skills.size} skill(s)`);
    }

    /**
     * Set up hot-reload watchers for skill file changes.
     * Code file changes are debounced (500ms) and serialized to prevent
     * race conditions during rapid edits.
     */
    setupWatcher(): void {
        this.plugin.registerEvent(
            this.plugin.app.vault.on('modify', (file) => {
                if (file instanceof TFile && this.isSkillFile(file)) {
                    void this.loadSkillFile(file);
                } else if (file instanceof TFile && this.isCodeFile(file)) {
                    this.debouncedCodeRecompile(file);
                }
            })
        );
        this.plugin.registerEvent(
            this.plugin.app.vault.on('create', (file) => {
                if (file instanceof TFile && this.isSkillFile(file)) {
                    void this.loadSkillFile(file);
                }
            })
        );
        this.plugin.registerEvent(
            this.plugin.app.vault.on('delete', (file) => {
                if (file instanceof TFile && this.isSkillFile(file)) {
                    this.removeSkillByPath(file.path);
                }
            })
        );
    }

    /**
     * Debounce code file recompilation (500ms) to avoid rapid-fire compilation
     * during incremental saves. Each file path gets its own timer.
     */
    private debouncedCodeRecompile(file: TFile): void {
        const existing = this.recompileTimers.get(file.path);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            this.recompileTimers.delete(file.path);
            // Serialize: queue behind any in-flight compilation
            this.compileQueue = this.compileQueue
                .then(() => this.handleCodeFileChange(file))
                .catch(e => console.warn(`[SelfAuthoredSkillLoader] Queued recompile failed for ${file.path}:`, e));
        }, 500);

        this.recompileTimers.set(file.path, timer);
    }

    /**
     * Get metadata summary for system prompt (Progressive Disclosure: metadata only).
     */
    getMetadataSummary(): string {
        if (this.skills.size === 0) return '';
        return [...this.skills.values()]
            .map(s => {
                const codeBadge = s.codeModules.length > 0
                    ? ` [code: ${s.codeModuleInfos.map(m => m.name).join(', ')}]`
                    : '';
                return `- ${s.name}: ${s.description} [trigger: ${s.triggerSource}]${codeBadge}`;
            })
            .join('\n');
    }

    /**
     * Get full skill body for activation (Progressive Disclosure: full content).
     */
    getSkillBody(name: string): string | undefined {
        return this.skills.get(name)?.body;
    }

    /**
     * Match a user message against skill triggers. Returns matching skills.
     */
    matchSkills(userMessage: string): SelfAuthoredSkill[] {
        const matches: SelfAuthoredSkill[] = [];
        for (const skill of this.skills.values()) {
            if (skill.trigger.test(userMessage)) {
                matches.push(skill);
            }
        }
        return matches;
    }

    /**
     * Get all loaded skills.
     */
    getAllSkills(): SelfAuthoredSkill[] {
        return [...this.skills.values()];
    }

    /**
     * Get a skill by name.
     */
    getSkill(name: string): SelfAuthoredSkill | undefined {
        return this.skills.get(name);
    }

    /**
     * Increment the success count for a skill.
     */
    async incrementSuccess(name: string): Promise<void> {
        const skill = this.skills.get(name);
        if (!skill) return;
        skill.successCount++;
        // Update the file
        await this.updateFrontmatterField(skill.filePath, 'successCount', String(skill.successCount));
    }

    /**
     * Get the skills directory path.
     */
    getSkillsDir(): string {
        return this.skillsDir;
    }

    // -----------------------------------------------------------------------
    // Code Module Management (public, used by ManageSkillTool)
    // -----------------------------------------------------------------------

    /**
     * Compile a TypeScript code module for a skill.
     * Reads source from code/{moduleName}.ts, compiles via esbuild,
     * and caches the result in code-compiled/{moduleName}.js.
     *
     * @returns The CodeModuleInfo with compiledJs populated.
     */
    async compileCodeModule(
        skillName: string,
        moduleName: string,
        dependencies?: string[],
    ): Promise<CodeModuleInfo> {
        if (!this.esbuildManager) {
            throw new Error('EsbuildWasmManager not available. Cannot compile code modules.');
        }

        const skill = this.skills.get(skillName);
        if (!skill) throw new Error(`Skill "${skillName}" not found.`);

        const skillDir = skill.filePath.replace(/\/SKILL\.md$/, '');
        const sourceFile = this.plugin.app.vault.getAbstractFileByPath(
            `${skillDir}/code/${moduleName}.ts`
        );
        if (!(sourceFile instanceof TFile)) {
            throw new Error(`Source file not found: ${skillDir}/code/${moduleName}.ts`);
        }

        const sourceCode = await this.plugin.app.vault.read(sourceFile);

        // Compile
        let compiledJs: string;
        if (dependencies && dependencies.length > 0) {
            compiledJs = await this.esbuildManager.build(sourceCode, dependencies);
        } else {
            compiledJs = await this.esbuildManager.transform(sourceCode);
        }

        // Cache compiled JS
        const compiledDir = `${skillDir}/code-compiled`;
        const compiledPath = `${compiledDir}/${moduleName}.js`;

        // Ensure code-compiled directory exists
        const compiledFolder = this.plugin.app.vault.getAbstractFileByPath(compiledDir);
        if (!(compiledFolder instanceof TFolder)) {
            await this.plugin.app.vault.createFolder(compiledDir);
        }

        // Write compiled JS
        const existingCompiled = this.plugin.app.vault.getAbstractFileByPath(compiledPath);
        if (existingCompiled instanceof TFile) {
            await this.plugin.app.vault.modify(existingCompiled, compiledJs);
        } else {
            await this.plugin.app.vault.create(compiledPath, compiledJs);
        }

        // Parse the definition from the source code
        const moduleInfo = this.parseCodeModuleDefinition(sourceCode, moduleName);
        moduleInfo.compiledJs = compiledJs;

        // Update skill's codeModuleInfos
        const existingIdx = skill.codeModuleInfos.findIndex(m => m.file === moduleName);
        if (existingIdx >= 0) {
            skill.codeModuleInfos[existingIdx] = moduleInfo;
        } else {
            skill.codeModuleInfos.push(moduleInfo);
        }

        // Ensure codeModules list includes this module
        if (!skill.codeModules.includes(moduleName)) {
            skill.codeModules.push(moduleName);
        }

        return moduleInfo;
    }

    /**
     * Register all code module tools for a skill with the ToolRegistry.
     */
    registerCodeTools(skill: SelfAuthoredSkill): void {
        if (!this.toolRegistry || !this.sandboxExecutor) return;

        for (const moduleInfo of skill.codeModuleInfos) {
            if (!moduleInfo.compiledJs) continue;

            const definition: DynamicToolDefinition = {
                name: moduleInfo.name,
                description: moduleInfo.description,
                input_schema: moduleInfo.inputSchema,
                isWriteOperation: moduleInfo.isWriteOperation,
                dependencies: moduleInfo.dependencies,
            };

            const tool = DynamicToolFactory.create(
                definition,
                moduleInfo.compiledJs,
                this.sandboxExecutor,
                this.plugin,
            );
            this.toolRegistry.register(tool);
            console.debug(`[SelfAuthoredSkillLoader] Registered code tool: ${moduleInfo.name}`);
        }
    }

    /**
     * Unregister all code module tools for a skill from the ToolRegistry.
     */
    unregisterCodeTools(skill: SelfAuthoredSkill): void {
        if (!this.toolRegistry) return;

        for (const moduleInfo of skill.codeModuleInfos) {
            this.toolRegistry.unregister(moduleInfo.name as ToolName);
            console.debug(`[SelfAuthoredSkillLoader] Unregistered code tool: ${moduleInfo.name}`);
        }
    }

    /**
     * Write a TypeScript source file into a skill's code/ directory.
     */
    async writeCodeModuleSource(
        skillName: string,
        moduleName: string,
        sourceCode: string,
    ): Promise<void> {
        const skill = this.skills.get(skillName);
        if (!skill) throw new Error(`Skill "${skillName}" not found.`);

        const skillDir = skill.filePath.replace(/\/SKILL\.md$/, '');
        const codeDir = `${skillDir}/code`;
        const filePath = `${codeDir}/${moduleName}.ts`;

        // Ensure code directory exists
        const codeFolder = this.plugin.app.vault.getAbstractFileByPath(codeDir);
        if (!(codeFolder instanceof TFolder)) {
            await this.plugin.app.vault.createFolder(codeDir);
        }

        // Write the source file
        const existing = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (existing instanceof TFile) {
            await this.plugin.app.vault.modify(existing, sourceCode);
        } else {
            await this.plugin.app.vault.create(filePath, sourceCode);
        }
    }

    /**
     * Delete code module files (source + compiled) for a skill.
     */
    async deleteCodeModules(skill: SelfAuthoredSkill): Promise<void> {
        const skillDir = skill.filePath.replace(/\/SKILL\.md$/, '');

        // Delete code-compiled/ files
        for (const moduleName of skill.codeModules) {
            const compiledPath = `${skillDir}/code-compiled/${moduleName}.js`;
            const compiledFile = this.plugin.app.vault.getAbstractFileByPath(compiledPath);
            if (compiledFile instanceof TFile) {
                await this.plugin.app.fileManager.trashFile(compiledFile);
            }

            const sourcePath = `${skillDir}/code/${moduleName}.ts`;
            const sourceFile = this.plugin.app.vault.getAbstractFileByPath(sourcePath);
            if (sourceFile instanceof TFile) {
                await this.plugin.app.fileManager.trashFile(sourceFile);
            }
        }

        // Try to remove empty directories
        const compiledDir = this.plugin.app.vault.getAbstractFileByPath(`${skillDir}/code-compiled`);
        if (compiledDir instanceof TFolder && compiledDir.children.length === 0) {
            await this.plugin.app.vault.delete(compiledDir);
        }
        const codeDir = this.plugin.app.vault.getAbstractFileByPath(`${skillDir}/code`);
        if (codeDir instanceof TFolder && codeDir.children.length === 0) {
            await this.plugin.app.vault.delete(codeDir);
        }
    }

    /**
     * Read source code of a code module.
     */
    async readCodeModuleSource(skillName: string, moduleName: string): Promise<string | null> {
        const skill = this.skills.get(skillName);
        if (!skill) return null;

        const skillDir = skill.filePath.replace(/\/SKILL\.md$/, '');
        const sourcePath = `${skillDir}/code/${moduleName}.ts`;
        const sourceFile = this.plugin.app.vault.getAbstractFileByPath(sourcePath);
        if (!(sourceFile instanceof TFile)) return null;

        return await this.plugin.app.vault.read(sourceFile);
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    private async loadSkillFile(file: TFile): Promise<void> {
        try {
            const content = await this.plugin.app.vault.read(file);
            const parsed = this.parseSkillMd(content, file.path);
            if (parsed) {
                this.skills.set(parsed.name, parsed);
            }
        } catch (e) {
            console.warn(`[SelfAuthoredSkillLoader] Failed to load ${file.path}:`, e);
        }
    }

    /**
     * Load cached compiled JS for a skill's code modules.
     * This does NOT trigger compilation — only loads from code-compiled/ cache.
     */
    private async loadCodeModules(skill: SelfAuthoredSkill): Promise<void> {
        const skillDir = skill.filePath.replace(/\/SKILL\.md$/, '');

        for (const moduleName of skill.codeModules) {
            try {
                // Try to load compiled JS from cache
                const compiledPath = `${skillDir}/code-compiled/${moduleName}.js`;
                const compiledFile = this.plugin.app.vault.getAbstractFileByPath(compiledPath);
                if (!(compiledFile instanceof TFile)) {
                    console.debug(`[SelfAuthoredSkillLoader] No cached compiled JS for ${moduleName} in skill "${skill.name}"`);
                    continue;
                }

                const compiledJs = await this.plugin.app.vault.read(compiledFile);

                // Try to read source to get definition metadata
                const sourcePath = `${skillDir}/code/${moduleName}.ts`;
                const sourceFile = this.plugin.app.vault.getAbstractFileByPath(sourcePath);
                let moduleInfo: CodeModuleInfo;

                if (sourceFile instanceof TFile) {
                    const sourceCode = await this.plugin.app.vault.read(sourceFile);
                    moduleInfo = this.parseCodeModuleDefinition(sourceCode, moduleName);
                } else {
                    // Fallback: minimal info from module name
                    moduleInfo = {
                        name: `custom_${moduleName.replace(/-/g, '_')}`,
                        file: moduleName,
                        description: `Code module: ${moduleName}`,
                        inputSchema: { type: 'object', properties: {} },
                        isWriteOperation: false,
                        dependencies: [],
                    };
                }

                moduleInfo.compiledJs = compiledJs;
                skill.codeModuleInfos.push(moduleInfo);
            } catch (e) {
                console.warn(`[SelfAuthoredSkillLoader] Failed to load code module ${moduleName}:`, e);
            }
        }
    }

    /**
     * Parse the `export const definition = {...}` from a TypeScript source file.
     * Uses safe field extraction — NO code evaluation (no eval/new Function).
     * Extracts individual fields via regex to avoid executing untrusted code
     * in the plugin context.
     */
    private parseCodeModuleDefinition(sourceCode: string, moduleName: string): CodeModuleInfo {
        const defaults: CodeModuleInfo = {
            name: `custom_${moduleName.replace(/-/g, '_')}`,
            file: moduleName,
            description: `Code module: ${moduleName}`,
            inputSchema: { type: 'object', properties: {} },
            isWriteOperation: false,
            dependencies: [],
        };

        try {
            // Extract the definition block (between export const definition = { ... };)
            const defMatch = sourceCode.match(
                /export\s+const\s+definition\s*=\s*(\{[\s\S]*?\n\});/
            );
            if (!defMatch) return defaults;
            const block = defMatch[1];

            // Safe field extractors — only parse string/boolean/array literals
            const name = this.extractStringField(block, 'name') ?? defaults.name;
            const description = this.extractStringField(block, 'description') ?? defaults.description;
            const isWriteOperation = this.extractBooleanField(block, 'isWriteOperation') ?? false;
            const dependencies = this.extractStringArrayField(block, 'dependencies') ?? [];

            // Extract input_schema as JSON — it's a nested object, parse carefully
            let inputSchema = defaults.inputSchema;
            const schemaMatch = block.match(/input_schema\s*:\s*(\{[\s\S]*?\n\s{4}\})/);
            if (schemaMatch) {
                try {
                    // Normalize JS object literal to valid JSON:
                    // - single quotes → double quotes (for string values)
                    // - unquoted keys → quoted keys
                    // - trailing commas removed
                    const jsonStr = schemaMatch[1]
                        .replace(/'/g, '"')
                        .replace(/(\w+)\s*:/g, '"$1":')
                        .replace(/,(\s*[}\]])/g, '$1');
                    const parsed = JSON.parse(jsonStr) as CodeModuleInfo['inputSchema'];
                    if (parsed && typeof parsed === 'object' && parsed.type === 'object') {
                        inputSchema = parsed;
                    }
                } catch {
                    // Schema parsing failed — use defaults
                }
            }

            return { name, file: moduleName, description, inputSchema, isWriteOperation, dependencies };
        } catch (e) {
            console.warn(`[SelfAuthoredSkillLoader] Failed to parse definition from ${moduleName}.ts:`, e);
            return defaults;
        }
    }

    /** Extract a string field value from a JS object literal block. */
    private extractStringField(block: string, field: string): string | undefined {
        // Matches: field: 'value' or field: "value"
        const match = block.match(new RegExp(`${field}\\s*:\\s*['"]([^'"]*?)['"]`));
        return match ? match[1] : undefined;
    }

    /** Extract a boolean field value from a JS object literal block. */
    private extractBooleanField(block: string, field: string): boolean | undefined {
        const match = block.match(new RegExp(`${field}\\s*:\\s*(true|false)`));
        return match ? match[1] === 'true' : undefined;
    }

    /** Extract a string array field from a JS object literal block. */
    private extractStringArrayField(block: string, field: string): string[] | undefined {
        const match = block.match(new RegExp(`${field}\\s*:\\s*\\[([^\\]]*)\\]`));
        if (!match) return undefined;
        if (!match[1].trim()) return [];
        return match[1].split(',')
            .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
    }

    /**
     * Handle changes to .ts files in code/ directories.
     * Re-compiles and re-registers the affected code module.
     */
    private async handleCodeFileChange(file: TFile): Promise<void> {
        // Find which skill this code file belongs to
        const skill = this.findSkillByCodeFile(file.path);
        if (!skill) return;

        const moduleName = file.basename; // filename without extension

        try {
            // Find dependencies from existing module info
            const existingInfo = skill.codeModuleInfos.find(m => m.file === moduleName);
            const dependencies = existingInfo?.dependencies;

            // Unregister old tool
            if (existingInfo && this.toolRegistry) {
                this.toolRegistry.unregister(existingInfo.name as ToolName);
            }

            // Recompile and register
            await this.compileCodeModule(skill.name, moduleName, dependencies);
            this.registerCodeTools(skill);
            console.debug(`[SelfAuthoredSkillLoader] Hot-reloaded code module: ${moduleName} in skill "${skill.name}"`);
        } catch (e) {
            console.warn(`[SelfAuthoredSkillLoader] Failed to hot-reload ${file.path}:`, e);
        }
    }

    private findSkillByCodeFile(filePath: string): SelfAuthoredSkill | undefined {
        for (const skill of this.skills.values()) {
            const skillDir = skill.filePath.replace(/\/SKILL\.md$/, '');
            if (filePath.startsWith(`${skillDir}/code/`)) {
                return skill;
            }
        }
        return undefined;
    }

    private parseSkillMd(content: string, filePath: string): SelfAuthoredSkill | null {
        // Split frontmatter and body at --- delimiters
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (!fmMatch) return null;

        const frontmatter = fmMatch[1];
        const body = fmMatch[2].trim();

        // Parse frontmatter key-value pairs
        const fm = this.parseFrontmatter(frontmatter);
        if (!fm.name || !fm.description) return null;

        let trigger: RegExp;
        let triggerSource: string;
        triggerSource = fm.trigger ?? fm.name.toLowerCase();
        // M-3: Use safeRegex to prevent ReDoS from malicious trigger patterns
        trigger = safeRegex(triggerSource, 'i');

        return {
            name: fm.name,
            description: fm.description,
            trigger,
            triggerSource,
            source: (fm.source as SelfAuthoredSkill['source']) ?? 'user',
            requiredTools: fm.requiredTools ? this.parseArray(fm.requiredTools) : [],
            codeModules: fm.codeModules ? this.parseArray(fm.codeModules) : [],
            codeModuleInfos: [],
            createdAt: fm.createdAt ? new Date(fm.createdAt) : new Date(),
            successCount: fm.successCount ? parseInt(fm.successCount, 10) : 0,
            body,
            filePath,
        };
    }

    private parseFrontmatter(text: string): Record<string, string> {
        const result: Record<string, string> = {};
        for (const line of text.split('\n')) {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) continue;
            const key = line.slice(0, colonIdx).trim();
            let value = line.slice(colonIdx + 1).trim();
            // Strip quotes
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            result[key] = value;
        }
        return result;
    }

    private parseArray(value: string): string[] {
        // Support [a, b, c] format
        const match = value.match(/^\[(.*)]$/);
        if (match) {
            return match[1].split(',').map(s => s.trim()).filter(Boolean);
        }
        return value.split(',').map(s => s.trim()).filter(Boolean);
    }

    private isSkillFile(file: TFile): boolean {
        return file.path.startsWith(this.skillsDir) && file.name === 'SKILL.md';
    }

    private isCodeFile(file: TFile): boolean {
        return file.path.startsWith(this.skillsDir)
            && file.extension === 'ts'
            && file.path.includes('/code/');
    }

    private removeSkillByPath(path: string): void {
        for (const [name, skill] of this.skills) {
            if (skill.filePath === path) {
                // Unregister code tools before removing
                this.unregisterCodeTools(skill);
                this.skills.delete(name);
                console.debug(`[SelfAuthoredSkillLoader] Removed skill: ${name}`);
                return;
            }
        }
    }

    private async updateFrontmatterField(filePath: string, key: string, value: string): Promise<void> {
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;
        const content = await this.plugin.app.vault.read(file);
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) return;

        const fm = fmMatch[1];
        const regex = new RegExp(`^${key}:.*$`, 'm');
        const updated = regex.test(fm)
            ? fm.replace(regex, `${key}: ${value}`)
            : fm + `\n${key}: ${value}`;

        const newContent = content.replace(fmMatch[0], `---\n${updated}\n---`);
        await this.plugin.app.vault.modify(file, newContent);
    }
}
