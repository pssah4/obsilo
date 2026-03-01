/**
 * SandboxBridge
 *
 * Plugin-side bridge that handles requests from the sandboxed iframe.
 * Controls vault access, URL allowlisting, path validation, and rate limiting.
 *
 * Part of Self-Development Phase 3: Sandbox + Dynamic Modules.
 */

import { TFile, TFolder, requestUrl } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';

// ---------------------------------------------------------------------------
// SandboxBridge
// ---------------------------------------------------------------------------

export class SandboxBridge {
    private writeCount = 0;
    private requestCount = 0;
    private lastReset = Date.now();
    private readonly MAX_WRITES_PER_MIN = 10;
    private readonly MAX_REQUESTS_PER_MIN = 5;

    // M-8: Circuit breaker — disable bridge after excessive consecutive errors
    private consecutiveErrors = 0;
    private static readonly MAX_CONSECUTIVE_ERRORS = 20;
    private circuitOpen = false;

    private readonly URL_ALLOWLIST = [
        'unpkg.com',
        'cdn.jsdelivr.net',
        'registry.npmjs.org',
        'esm.sh',
    ];

    constructor(private plugin: ObsidianAgentPlugin) {}

    async vaultRead(path: string): Promise<string> {
        this.checkCircuitBreaker();
        this.validateVaultPath(path);
        this.logBridgeOp('vault-read', path);
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error(`Not a file: ${path}`);
        const result = await this.plugin.app.vault.read(file);
        this.recordSuccess();
        return result;
    }

    async vaultReadBinary(path: string): Promise<ArrayBuffer> {
        this.checkCircuitBreaker();
        this.validateVaultPath(path);
        this.logBridgeOp('vault-read-binary', path);
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error(`Not a file: ${path}`);
        const result = await this.plugin.app.vault.readBinary(file);
        this.recordSuccess();
        return result;
    }

    async vaultList(path: string): Promise<string[]> {
        this.checkCircuitBreaker();
        this.validateVaultPath(path);
        this.logBridgeOp('vault-list', path);
        const folder = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(folder instanceof TFolder)) throw new Error(`Not a folder: ${path}`);
        const result = folder.children.map(c => c.path);
        this.recordSuccess();
        return result;
    }

    async vaultWrite(path: string, content: string): Promise<void> {
        this.checkCircuitBreaker();
        this.validateVaultPath(path);
        this.checkWriteRateLimit();
        this.logBridgeOp('vault-write', `${path} (${content.length} chars)`);
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            await this.plugin.app.vault.modify(file, content);
        } else {
            await this.plugin.app.vault.create(path, content);
        }
        this.recordSuccess();
    }

    async vaultWriteBinary(path: string, content: ArrayBuffer): Promise<void> {
        this.checkCircuitBreaker();
        this.validateVaultPath(path);
        this.checkWriteRateLimit();
        this.logBridgeOp('vault-write-binary', `${path} (${content.byteLength} bytes)`);
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            await this.plugin.app.vault.modifyBinary(file, content);
        } else {
            await this.plugin.app.vault.createBinary(path, content);
        }
        this.recordSuccess();
    }

    async requestUrlBridge(
        url: string,
        options?: { method?: string; body?: string },
    ): Promise<{ status: number; text: string }> {
        this.checkCircuitBreaker();
        this.checkRequestRateLimit();
        if (!this.isAllowedUrl(url)) {
            throw new Error(
                `URL not on allowlist: ${url}. Allowed: ${this.URL_ALLOWLIST.join(', ')}`
            );
        }
        // M-8: Validate options payload for prototype pollution
        if (options && this.hasPollutionKeys(options)) {
            throw new Error('Rejected: payload contains prototype pollution keys');
        }
        this.logBridgeOp('request-url', url);
        const response = await requestUrl({
            url,
            method: options?.method,
            body: options?.body,
        });
        this.recordSuccess();
        return { status: response.status, text: response.text };
    }

    // -----------------------------------------------------------------------
    // M-8: Security Hardening
    // -----------------------------------------------------------------------

    /**
     * Check for prototype pollution keys in bridge payloads.
     * Rejects objects containing __proto__, constructor, or prototype.
     */
    hasPollutionKeys(obj: unknown): boolean {
        if (typeof obj !== 'object' || obj === null) return false;
        const keys = Object.keys(obj as Record<string, unknown>);
        if (keys.some(k => k === '__proto__' || k === 'constructor' || k === 'prototype')) {
            return true;
        }
        for (const k of keys) {
            if (this.hasPollutionKeys((obj as Record<string, unknown>)[k])) {
                return true;
            }
        }
        return false;
    }

    /** Log a bridge operation for observability. */
    private logBridgeOp(type: string, detail: string): void {
        console.debug(`[SandboxBridge] ${type}: ${detail}`);
    }

    /** Check circuit breaker — throws if bridge is disabled. */
    private checkCircuitBreaker(): void {
        if (this.circuitOpen) {
            throw new Error('SandboxBridge circuit open — too many consecutive errors. Reset the sandbox.');
        }
    }

    /** Record a successful operation — resets error counter. */
    private recordSuccess(): void {
        this.consecutiveErrors = 0;
    }

    /** Record a failed operation — may trip the circuit breaker. */
    recordError(): void {
        this.consecutiveErrors++;
        if (this.consecutiveErrors >= SandboxBridge.MAX_CONSECUTIVE_ERRORS) {
            this.circuitOpen = true;
            console.warn('[SandboxBridge] Circuit breaker tripped — bridge disabled after 20 consecutive errors.');
        }
    }

    /** Reset the circuit breaker (e.g. when sandbox is recreated). */
    resetCircuitBreaker(): void {
        this.consecutiveErrors = 0;
        this.circuitOpen = false;
    }

    // -----------------------------------------------------------------------
    // Validation
    // -----------------------------------------------------------------------

    private validateVaultPath(path: string): void {
        if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
            throw new Error(`Invalid path: ${path}`);
        }
    }

    private isAllowedUrl(url: string): boolean {
        try {
            const parsed = new URL(url);
            const host = parsed.hostname;

            // Block non-HTTPS (data:, file:, ftp:, etc.)
            if (parsed.protocol !== 'https:') return false;

            // Block IP addresses (IPv4 and IPv6) — require domain names only
            if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
            if (host.startsWith('[') || host === 'localhost') return false;

            // Block non-standard ports
            if (parsed.port && parsed.port !== '443') return false;

            return this.URL_ALLOWLIST.some(
                a => host === a || host.endsWith('.' + a)
            );
        } catch {
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // Rate Limiting
    // -----------------------------------------------------------------------

    private checkWriteRateLimit(): void {
        this.resetIfMinuteElapsed();
        // Fix: increment AFTER check (>= instead of > after ++)
        if (this.writeCount >= this.MAX_WRITES_PER_MIN) {
            throw new Error('Write rate limit exceeded (max 10/min)');
        }
        this.writeCount++;
    }

    private checkRequestRateLimit(): void {
        this.resetIfMinuteElapsed();
        if (this.requestCount >= this.MAX_REQUESTS_PER_MIN) {
            throw new Error('Request rate limit exceeded (max 5/min)');
        }
        this.requestCount++;
    }

    private resetIfMinuteElapsed(): void {
        if (Date.now() - this.lastReset > 60000) {
            this.writeCount = 0;
            this.requestCount = 0;
            this.lastReset = Date.now();
        }
    }
}
