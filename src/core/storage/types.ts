/**
 * FileAdapter — Storage abstraction for services that need file I/O.
 *
 * Mirrors the subset of Obsidian's DataAdapter API used across all services.
 * Implemented by:
 *   - GlobalFileService  (Node.js fs at ~/.obsidian-agent/)
 *   - VaultFileAdapter    (wrapper around vault.adapter for per-vault data)
 *
 * All paths are relative to the adapter's root directory.
 */

export interface FileAdapter {
    /** Check whether a file or directory exists. */
    exists(path: string): Promise<boolean>;

    /** Read a file's content as UTF-8 string. Throws if file does not exist. */
    read(path: string): Promise<string>;

    /** Write (create or overwrite) a file. Creates parent directories as needed. */
    write(path: string, data: string): Promise<void>;

    /** Create a directory (and parents). No-op if it already exists. */
    mkdir(path: string): Promise<void>;

    /**
     * List immediate children of a directory.
     * Returns paths relative to the adapter root (matching Obsidian convention).
     */
    list(path: string): Promise<{ files: string[]; folders: string[] }>;

    /** Delete a file. Throws if file does not exist. */
    remove(path: string): Promise<void>;

    /** Append data to a file. Creates the file if it does not exist. */
    append(path: string, data: string): Promise<void>;

    /** Get file metadata. Returns null if file does not exist. */
    stat(path: string): Promise<{ mtime: number; size: number } | null>;
}
