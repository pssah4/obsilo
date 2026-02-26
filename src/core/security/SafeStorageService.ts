/**
 * SafeStorageService — encrypts/decrypts API keys via Electron's safeStorage API.
 *
 * Electron's safeStorage delegates to the OS keychain:
 *   - macOS: Keychain Services
 *   - Windows: DPAPI (Data Protection API)
 *   - Linux: libsecret (GNOME Keyring / KWallet)
 *
 * Encrypted values are stored as "enc:v1:<base64>" in data.json.
 * The prefix allows detection of encrypted vs. plaintext values.
 *
 * Fallback: when safeStorage is unavailable, encrypt() returns plaintext
 * unchanged and decrypt() passes through plaintext values.
 *
 * @see ADR-019-electron-safestorage.md
 */

const ENCRYPTED_PREFIX = 'enc:v1:';

// Minimal type for the subset of Electron's safeStorage API we use.
interface ElectronSafeStorage {
    isEncryptionAvailable(): boolean;
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
}

export class SafeStorageService {
    private available: boolean;
    private storage: ElectronSafeStorage | null = null;

    constructor() {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const electron = require('electron');
            // In Obsidian's Electron renderer, safeStorage may be on the
            // module directly or behind the (deprecated) remote bridge.
            const ss: ElectronSafeStorage | undefined =
                electron.safeStorage ?? electron.remote?.safeStorage;
            if (ss && typeof ss.isEncryptionAvailable === 'function' && ss.isEncryptionAvailable()) {
                this.storage = ss;
                this.available = true;
            } else {
                this.available = false;
            }
        } catch {
            this.available = false;
        }

        if (!this.available) {
            console.warn('[SafeStorage] OS keychain not available -- API keys will be stored in plaintext');
        }
    }

    /** True when the OS keychain is usable for encryption. */
    isAvailable(): boolean {
        return this.available;
    }

    /**
     * Encrypt a plaintext string.
     * Returns `enc:v1:<base64>` on success, or the original plaintext on failure / unavailability.
     */
    encrypt(plainText: string): string {
        if (!plainText || !this.available || !this.storage) return plainText;
        try {
            const encrypted = this.storage.encryptString(plainText);
            return ENCRYPTED_PREFIX + encrypted.toString('base64');
        } catch (e) {
            console.warn('[SafeStorage] Encryption failed, storing plaintext:', e);
            return plainText;
        }
    }

    /**
     * Decrypt a value.
     * If the value has the `enc:v1:` prefix it is decrypted; otherwise returned as-is (plaintext passthrough).
     */
    decrypt(value: string): string {
        if (!value || !value.startsWith(ENCRYPTED_PREFIX)) return value;
        if (!this.available || !this.storage) {
            console.warn('[SafeStorage] Cannot decrypt: OS keychain unavailable');
            return '';
        }
        try {
            const b64 = value.slice(ENCRYPTED_PREFIX.length);
            const buffer = Buffer.from(b64, 'base64');
            return this.storage.decryptString(buffer);
        } catch (e) {
            console.warn('[SafeStorage] Decryption failed:', e);
            return '';
        }
    }

    /** Check whether a value is already encrypted (has the enc:v1: prefix). */
    isEncrypted(value: string | undefined): boolean {
        return !!value && value.startsWith(ENCRYPTED_PREFIX);
    }
}
