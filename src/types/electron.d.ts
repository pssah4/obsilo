/**
 * Ambient module declaration for 'electron'.
 *
 * Obsidian runs inside Electron, so the module is available at runtime.
 * esbuild treats it as external (see esbuild.config.mjs).
 * We only declare the subset we actually use (safeStorage).
 */
declare module 'electron' {
    interface SafeStorage {
        isEncryptionAvailable(): boolean;
        encryptString(plainText: string): Buffer;
        decryptString(encrypted: Buffer): string;
    }

    const safeStorage: SafeStorage | undefined;
    const remote: { safeStorage?: SafeStorage } | undefined;

    export default { safeStorage, remote };
}
