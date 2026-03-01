/**
 * ManageSkillTool
 *
 * Allows the agent to create, update, delete, list, validate, and read
 * self-authored SKILL.md files. Skills are Markdown-based workflow
 * instructions with YAML frontmatter.
 *
 * Skills can optionally include code modules (TypeScript files) that are
 * compiled and registered as dynamic tools. This unifies the former
 * "Skills" and "Dynamic Tools" into a single manage_skill tool.
 *
 * Part of Self-Development Phase 2+3: Skill Self-Authoring + Code Modules.
 */

import { TFile, TFolder } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import type { SelfAuthoredSkillLoader } from '../../skills/SelfAuthoredSkillLoader';
import type { EsbuildWasmManager } from '../../sandbox/EsbuildWasmManager';
import type { SandboxExecutor } from '../../sandbox/SandboxExecutor';
import type { ToolRegistry } from '../ToolRegistry';
import { AstValidator } from '../../sandbox/AstValidator';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

interface CodeModuleInput {
    name: string;
    source_code: string;
    description: string;
    input_schema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
    is_write_operation?: boolean;
    dependencies?: string[];
}

interface ManageSkillInput {
    action: 'create' | 'update' | 'delete' | 'list' | 'validate' | 'read';
    name?: string;
    description?: string;
    trigger?: string;
    required_tools?: string[];
    body?: string;
    source?: string;
    code_modules?: CodeModuleInput[];
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export class ManageSkillTool extends BaseTool<'manage_skill'> {
    readonly name = 'manage_skill' as const;
    readonly isWriteOperation = false;

    private skillLoader: SelfAuthoredSkillLoader;
    private esbuildManager: EsbuildWasmManager | null;
    private sandboxExecutor: SandboxExecutor | null;
    private toolRegistry: ToolRegistry | null;

    constructor(
        plugin: ObsidianAgentPlugin,
        skillLoader: SelfAuthoredSkillLoader,
        esbuildManager?: EsbuildWasmManager | null,
        sandboxExecutor?: SandboxExecutor | null,
        toolRegistry?: ToolRegistry | null,
    ) {
        super(plugin);
        this.skillLoader = skillLoader;
        this.esbuildManager = esbuildManager ?? null;
        this.sandboxExecutor = sandboxExecutor ?? null;
        this.toolRegistry = toolRegistry ?? null;
    }

    getDefinition(): ToolDefinition {
        return {
            name: this.name,
            description: 'Manage self-authored skills (SKILL.md files). Skills are reusable workflow instructions that persist across sessions. Skills can optionally include code_modules — TypeScript code compiled and registered as sandbox tools (names must start with "custom_"). Actions: create, update, delete, list, validate, read.',
            input_schema: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        description: 'Action to perform.',
                        enum: ['create', 'update', 'delete', 'list', 'validate', 'read'],
                    },
                    name: {
                        type: 'string',
                        description: 'Skill name (required for create/update/delete/validate/read).',
                    },
                    description: {
                        type: 'string',
                        description: 'Short description of what the skill does (required for create).',
                    },
                    trigger: {
                        type: 'string',
                        description: 'Regex pattern for auto-triggering the skill from user messages (e.g. "daily|summary|zusammenfassung").',
                    },
                    required_tools: {
                        type: 'array',
                        description: 'List of tool names this skill needs.',
                        items: { type: 'string' },
                    },
                    body: {
                        type: 'string',
                        description: 'Markdown body with step-by-step instructions (required for create).',
                    },
                    source: {
                        type: 'string',
                        description: 'Skill source: "learned" (agent-created), "user" (user-created).',
                        enum: ['learned', 'user'],
                    },
                    code_modules: {
                        type: 'array',
                        description: 'Optional TypeScript code modules to compile and register as sandbox tools. Each module becomes a tool with "custom_" prefix. Only needed for NEW computational capabilities (binary generation, complex algorithms). Most skills only need workflow instructions.',
                        items: {
                            type: 'object',
                            properties: {
                                name: {
                                    type: 'string',
                                    description: 'Tool name (must start with "custom_").',
                                },
                                source_code: {
                                    type: 'string',
                                    description: 'TypeScript source code. Must export a definition object and an execute function.',
                                },
                                description: {
                                    type: 'string',
                                    description: 'Description of what this code module does.',
                                },
                                input_schema: {
                                    type: 'object',
                                    description: 'JSON Schema for tool input.',
                                },
                                is_write_operation: {
                                    type: 'boolean',
                                    description: 'Whether this tool performs write operations (default: false).',
                                },
                                dependencies: {
                                    type: 'array',
                                    description: 'npm package names to bundle (e.g. ["pptxgenjs"]).',
                                    items: { type: 'string' },
                                },
                            },
                            required: ['name', 'source_code', 'description', 'input_schema'],
                        },
                    },
                },
                required: ['action'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const params = input as unknown as ManageSkillInput;
        const action = (params.action ?? '').trim();

        try {
            if (action === 'create') {
                await this.handleCreate(params, callbacks, context);
            } else if (action === 'update') {
                await this.handleUpdate(params, callbacks, context);
            } else if (action === 'delete') {
                await this.handleDelete(params, callbacks, context);
            } else if (action === 'list') {
                this.handleList(callbacks);
            } else if (action === 'validate') {
                await this.handleValidate(params, callbacks);
            } else if (action === 'read') {
                await this.handleRead(params, callbacks);
            } else {
                callbacks.pushToolResult(this.formatError(`Unknown action: "${action}". Use: create, update, delete, list, validate, read`));
            }
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
        }
    }

    // -----------------------------------------------------------------------
    // Action handlers
    // -----------------------------------------------------------------------

    private async handleCreate(
        params: ManageSkillInput,
        callbacks: { pushToolResult(c: string): void },
        context: ToolExecutionContext,
    ): Promise<void> {
        if (!params.name) throw new Error('Missing "name" for create action.');
        if (!params.description) throw new Error('Missing "description" for create action.');
        if (!params.body) throw new Error('Missing "body" for create action.');

        const slug = this.slugify(params.name);
        const dirPath = `${this.skillLoader.getSkillsDir()}/${slug}`;
        const filePath = `${dirPath}/SKILL.md`;

        // Check if skill already exists
        const existing = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (existing instanceof TFile) {
            throw new Error(`Skill "${params.name}" already exists at ${filePath}. Use "update" action.`);
        }

        // Validate code modules if present
        if (params.code_modules?.length) {
            this.validateCodeModuleNames(params.code_modules);
        }

        // Ensure directory exists
        const dir = this.plugin.app.vault.getAbstractFileByPath(dirPath);
        if (!(dir instanceof TFolder)) {
            await this.plugin.app.vault.createFolder(dirPath);
        }

        // Build code module filenames for frontmatter
        const codeModuleNames = params.code_modules?.map(m => this.toolNameToFileName(m.name)) ?? [];

        // Build SKILL.md content
        const content = this.buildSkillMd(params, codeModuleNames);
        await this.plugin.app.vault.create(filePath, content);

        // Process code modules
        const codeResults: string[] = [];
        if (params.code_modules?.length) {
            for (const cm of params.code_modules) {
                const result = await this.processCodeModule(params.name, cm);
                codeResults.push(result);
            }
            context.invalidateToolCache?.();
        }

        const codeMsg = codeResults.length > 0
            ? `\nCode modules:\n${codeResults.join('\n')}`
            : '';

        callbacks.pushToolResult(this.formatSuccess(
            `Skill "${params.name}" created at ${filePath}. It will be available immediately via hot-reload.${codeMsg}`
        ));
    }

    private async handleUpdate(
        params: ManageSkillInput,
        callbacks: { pushToolResult(c: string): void },
        context: ToolExecutionContext,
    ): Promise<void> {
        if (!params.name) throw new Error('Missing "name" for update action.');

        const skill = this.skillLoader.getSkill(params.name);
        if (!skill) throw new Error(`Skill "${params.name}" not found. Use "list" to see available skills.`);
        if (skill.source === 'bundled') throw new Error(`Bundled skills cannot be updated.`);

        const file = this.plugin.app.vault.getAbstractFileByPath(skill.filePath);
        if (!(file instanceof TFile)) throw new Error(`Skill file not found: ${skill.filePath}`);

        // Validate code modules if present
        if (params.code_modules?.length) {
            this.validateCodeModuleNames(params.code_modules);
        }

        // Merge code module names
        const existingCodeModules = skill.codeModules ?? [];
        const newCodeModuleNames = params.code_modules?.map(m => this.toolNameToFileName(m.name)) ?? [];
        const allCodeModules = [...new Set([...existingCodeModules, ...newCodeModuleNames])];

        // Merge updates
        const content = this.buildSkillMd({
            name: params.name,
            description: params.description ?? skill.description,
            trigger: params.trigger ?? skill.triggerSource,
            required_tools: params.required_tools ?? skill.requiredTools,
            body: params.body ?? skill.body,
            source: skill.source,
        }, allCodeModules);

        await this.plugin.app.vault.modify(file, content);

        // Process code modules
        const codeResults: string[] = [];
        if (params.code_modules?.length) {
            for (const cm of params.code_modules) {
                const result = await this.processCodeModule(params.name, cm);
                codeResults.push(result);
            }
            context.invalidateToolCache?.();
        }

        const codeMsg = codeResults.length > 0
            ? `\nCode modules updated:\n${codeResults.join('\n')}`
            : '';

        callbacks.pushToolResult(this.formatSuccess(`Skill "${params.name}" updated.${codeMsg}`));
    }

    private async handleDelete(
        params: ManageSkillInput,
        callbacks: { pushToolResult(c: string): void },
        context: ToolExecutionContext,
    ): Promise<void> {
        if (!params.name) throw new Error('Missing "name" for delete action.');

        const skill = this.skillLoader.getSkill(params.name);
        if (!skill) throw new Error(`Skill "${params.name}" not found.`);
        if (skill.source === 'bundled') throw new Error(`Bundled skills cannot be deleted.`);

        // Unregister code tools first
        this.skillLoader.unregisterCodeTools(skill);

        // Delete code module files
        if (skill.codeModules.length > 0) {
            await this.skillLoader.deleteCodeModules(skill);
        }

        // Delete the SKILL.md file
        const file = this.plugin.app.vault.getAbstractFileByPath(skill.filePath);
        if (file instanceof TFile) {
            await this.plugin.app.fileManager.trashFile(file);
        }

        if (skill.codeModules.length > 0) {
            context.invalidateToolCache?.();
        }

        callbacks.pushToolResult(this.formatSuccess(`Skill "${params.name}" deleted.`));
    }

    private handleList(callbacks: { pushToolResult(c: string): void }): void {
        const skills = this.skillLoader.getAllSkills();
        if (skills.length === 0) {
            callbacks.pushToolResult(this.formatSuccess('No self-authored skills found. Use "create" to make one.'));
            return;
        }

        const lines = skills.map(s => {
            const success = s.successCount > 0 ? ` (used ${s.successCount}x)` : '';
            const codeInfo = s.codeModules.length > 0
                ? ` [code: ${s.codeModuleInfos.map(m => m.name).join(', ')}]`
                : '';
            return `- ${s.name}: ${s.description} [${s.source}]${success}${codeInfo}`;
        });

        callbacks.pushToolResult(this.formatSuccess(
            `${skills.length} skill(s):\n${lines.join('\n')}`
        ));
    }

    private async handleValidate(
        params: ManageSkillInput,
        callbacks: { pushToolResult(c: string): void },
    ): Promise<void> {
        if (!params.name) throw new Error('Missing "name" for validate action.');

        const skill = this.skillLoader.getSkill(params.name);
        if (!skill) throw new Error(`Skill "${params.name}" not found.`);

        const issues: string[] = [];

        if (!skill.description) issues.push('Missing description');
        if (!skill.body || skill.body.length < 10) issues.push('Body too short (should describe steps)');

        // Check trigger regex validity
        try {
            new RegExp(skill.triggerSource);
        } catch {
            issues.push(`Invalid trigger regex: ${skill.triggerSource}`);
        }

        // Check required tools exist
        for (const tool of skill.requiredTools) {
            if (!this.plugin.toolRegistry.hasTool(tool as import('../types').ToolName)) {
                issues.push(`Required tool not found: ${tool}`);
            }
        }

        // Validate code modules
        for (const moduleName of skill.codeModules) {
            const source = await this.skillLoader.readCodeModuleSource(skill.name, moduleName);
            if (!source) {
                issues.push(`Code module source not found: ${moduleName}.ts`);
                continue;
            }

            // AST validation
            const validation = AstValidator.validate(source);
            if (!validation.valid) {
                issues.push(`Code module "${moduleName}" AST errors: ${validation.errors.join('; ')}`);
            }

            // Check compiled cache exists
            const moduleInfo = skill.codeModuleInfos.find(m => m.file === moduleName);
            if (!moduleInfo?.compiledJs) {
                issues.push(`Code module "${moduleName}" has no compiled cache`);
            }
        }

        if (issues.length === 0) {
            callbacks.pushToolResult(this.formatSuccess(`Skill "${params.name}" is valid.`));
        } else {
            callbacks.pushToolResult(this.formatSuccess(
                `Skill "${params.name}" has ${issues.length} issue(s):\n${issues.map(i => `- ${i}`).join('\n')}`
            ));
        }
    }

    private async handleRead(
        params: ManageSkillInput,
        callbacks: { pushToolResult(c: string): void },
    ): Promise<void> {
        if (!params.name) throw new Error('Missing "name" for read action.');

        const skill = this.skillLoader.getSkill(params.name);
        if (!skill) throw new Error(`Skill "${params.name}" not found.`);

        let codeSection = '';
        if (skill.codeModules.length > 0) {
            const codeParts: string[] = [];
            for (const moduleName of skill.codeModules) {
                const source = await this.skillLoader.readCodeModuleSource(skill.name, moduleName);
                const moduleInfo = skill.codeModuleInfos.find(m => m.file === moduleName);
                const status = moduleInfo?.compiledJs ? 'compiled' : 'not compiled';
                codeParts.push(`### ${moduleInfo?.name ?? moduleName} (${status})\n\`\`\`typescript\n${source ?? '(source not found)'}\n\`\`\``);
            }
            codeSection = `\n\n## Code Modules\n\n${codeParts.join('\n\n')}`;
        }

        callbacks.pushToolResult(this.formatSuccess(
            `# ${skill.name}\n\n**Description**: ${skill.description}\n**Trigger**: ${skill.triggerSource}\n**Source**: ${skill.source}\n**Used**: ${skill.successCount} time(s)\n**Tools**: ${skill.requiredTools.join(', ') || '(none)'}\n**Code Modules**: ${skill.codeModules.length > 0 ? skill.codeModules.join(', ') : '(none)'}\n\n---\n\n${skill.body}${codeSection}`
        ));
    }

    // -----------------------------------------------------------------------
    // Code Module Processing
    // -----------------------------------------------------------------------

    /**
     * Process a single code module: validate, write source, compile, register.
     */
    private async processCodeModule(
        skillName: string,
        cm: CodeModuleInput,
    ): Promise<string> {
        // AST validation
        const validation = AstValidator.validate(cm.source_code);
        if (!validation.valid) {
            throw new Error(`Code module "${cm.name}" validation failed:\n${validation.errors.join('\n')}`);
        }

        // Build the full source with definition export wrapper
        const fullSource = this.buildCodeModuleSource(cm);
        const fileName = this.toolNameToFileName(cm.name);

        // Write source file
        await this.skillLoader.writeCodeModuleSource(skillName, fileName, fullSource);

        // Compile
        const moduleInfo = await this.skillLoader.compileCodeModule(
            skillName,
            fileName,
            cm.dependencies,
        );

        // Dry-run test in sandbox
        if (this.sandboxExecutor) {
            try {
                await this.sandboxExecutor.execute(moduleInfo.compiledJs!, {});
            } catch (e) {
                console.warn(`[ManageSkillTool] Dry-run test warning for ${cm.name}:`, e);
                // Non-fatal: some tools may require specific input to work
            }
        }

        // Register the tool
        const skill = this.skillLoader.getSkill(skillName);
        if (skill) {
            this.skillLoader.registerCodeTools(skill);
        }

        return `- ${cm.name}: compiled and registered`;
    }

    /**
     * Build TypeScript source file with definition + execute exports.
     */
    private buildCodeModuleSource(cm: CodeModuleInput): string {
        // If the source_code already contains "export const definition", use it as-is
        if (cm.source_code.includes('export const definition')) {
            return cm.source_code;
        }

        // Otherwise, wrap the source_code in the expected convention
        const schemaStr = JSON.stringify(cm.input_schema, null, 4);
        const depsStr = cm.dependencies?.length
            ? JSON.stringify(cm.dependencies)
            : '[]';

        return `export const definition = {
    name: '${cm.name}',
    description: '${cm.description.replace(/'/g, "\\'")}',
    input_schema: ${schemaStr},
    isWriteOperation: ${cm.is_write_operation ?? false},
    dependencies: ${depsStr},
};

${cm.source_code}
`;
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private validateCodeModuleNames(modules: CodeModuleInput[]): void {
        for (const cm of modules) {
            if (!cm.name.startsWith('custom_')) {
                throw new Error(`Code module name "${cm.name}" must start with "custom_" prefix.`);
            }
        }
    }

    /**
     * Convert tool name to file name: custom_pptx_generator -> pptx-generator
     */
    private toolNameToFileName(toolName: string): string {
        return toolName
            .replace(/^custom_/, '')
            .replace(/_/g, '-');
    }

    private buildSkillMd(
        params: Omit<ManageSkillInput, 'action' | 'code_modules'>,
        codeModuleNames?: string[],
    ): string {
        const tools = params.required_tools?.length
            ? `[${params.required_tools.join(', ')}]`
            : '[]';

        const codeModulesLine = codeModuleNames?.length
            ? `\ncodeModules: [${codeModuleNames.join(', ')}]`
            : '';

        return `---
name: ${params.name}
description: ${params.description ?? ''}
trigger: "${params.trigger ?? params.name?.toLowerCase() ?? ''}"
source: ${params.source ?? 'learned'}
requiredTools: ${tools}${codeModulesLine}
createdAt: ${new Date().toISOString()}
successCount: 0
---
${params.body ?? ''}
`;
    }

    private slugify(name: string): string {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }
}
