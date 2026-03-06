/**
 * Obsidian Module Augmentation
 *
 * Declares internal Obsidian APIs that are available at runtime but not
 * exposed in the public type definitions. This lets us remove `as any`
 * casts when accessing these properties.
 *
 * Only properties that are actually used in the codebase are declared here.
 */

import 'obsidian';

declare module 'obsidian' {
    interface App {
        plugins: {
            manifests: Record<string, PluginManifest>;
            plugins: Record<string, Plugin_2>;
            enabledPlugins: Set<string>;
            enablePlugin(id: string): Promise<void>;
            disablePlugin(id: string): Promise<void>;
        };
        commands: {
            commands: Record<string, { id: string; name: string }>;
            executeCommandById(id: string): boolean;
        };
        internalPlugins: {
            plugins: Record<string, {
                enabled: boolean;
                instance?: { options?: Record<string, unknown> };
            }>;
        };
        setting: {
            open(): void;
            close(): void;
            openTabById(id: string): void;
        };
    }

    interface WorkspaceSidedock {
        collapsed: boolean;
        setSize?(size: number): void;
    }

    interface WorkspaceMobileDrawer {
        collapsed: boolean;
        setSize?(size: number): void;
    }

    interface FileSystemAdapter {
        basePath: string;
        getBasePath(): string;
    }

    interface MetadataCache {
        getBacklinksForFile(file: TFile): {
            data: Record<string, unknown[]>;
            keys(): string[];
        };
    }

    interface MetadataTypeManager {
        setType(property: string, type: string): void;
        getType(property: string): string | undefined;
    }

    interface App {
        metadataTypeManager: MetadataTypeManager;
    }
}
