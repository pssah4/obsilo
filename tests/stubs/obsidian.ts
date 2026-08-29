/**
 * Minimal stub for the `obsidian` module — only covers what test files import.
 * Most production imports of `obsidian` are `import type`, so nothing runs at
 * test time. Exception: `normalizePath`, used by VaultDataFileAdapter.
 */
export class Vault {}
export class App {}
export class Plugin {}
export class TFile {}
export class TFolder {}

/** Notice constructor stub — production code does `new Notice(msg)`. */
export class Notice { constructor(_msg?: string, _timeout?: number) { /* no-op */ } }

/**
 * Mirrors Obsidian's getLanguage(): ISO code of the configured app language.
 * Tests that need a different locale mock the module or use the i18n test hook.
 */
export function getLanguage(): string {
    return 'en';
}

/** Ambient `requestUrl` stub so modules that import it at the top level load. */
export function requestUrl(_opts: unknown): Promise<unknown> {
    throw new Error('requestUrl stub called -- wire a mock in the test.');
}

/**
 * Mirrors Obsidian's normalizePath: collapses backslashes to forward slashes,
 * removes duplicate slashes, and trims leading/trailing slashes. The real
 * implementation also handles `..` and `.` segments; this stub keeps it simple
 * because the tests don't exercise those.
 */
export function normalizePath(p: string): string {
    return p
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\/+|\/+$/g, '');
}

/**
 * FIX-44-09: the frontmatter guard parses the resulting YAML block to decide
 * whether an edit would break the note. Obsidian exports parseYaml at runtime;
 * in tests we back it with the `yaml` package that is already on disk.
 */
export function parseYaml(yaml: string): unknown {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- test stub only, never bundled
    const { parse } = require('yaml') as { parse: (s: string) => unknown };
    return parse(yaml);
}

/**
 * FEAT-44-10: update_frontmatter resolves its result via parseYaml/stringifyYaml
 * so that the approval diff and the write come from the same code. Obsidian
 * exports both at runtime; in tests we back them with the `yaml` package.
 */
export function stringifyYaml(obj: unknown): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- test stub only, never bundled
    const { stringify } = require('yaml') as { stringify: (o: unknown) => string };
    return stringify(obj);
}

/**
 * Minimal Modal stub. FIX-44-14 needs to assert that closing the approval gate
 * with Esc / the X resolves its promise (it used to hang the agent loop), and
 * that requires driving the Obsidian Modal lifecycle in a test.
 */
export class Modal {
    app: unknown;
    contentEl: {
        empty: () => void;
        createDiv: () => unknown;
        appendChild: (n: unknown) => void;
        ownerDocument: unknown;
    };
    modalEl: { addClass: (c: string) => void };
    private closed = false;

    constructor(app: unknown) {
        this.app = app;
        this.contentEl = {
            empty: () => { /* no-op */ },
            createDiv: () => ({}),
            appendChild: () => { /* no-op */ },
            ownerDocument: globalThis.document,
        };
        this.modalEl = { addClass: () => { /* no-op */ } };
    }

    /** Obsidian's title setter. Recorded so a test can assert the heading. */
    title = '';
    setTitle(title: string): this { this.title = title; return this; }

    open(): void { this.onOpen(); }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.onClose();
    }

    onOpen(): void { /* subclass */ }
    onClose(): void { /* subclass */ }
}

export function setIcon(_el: unknown, _name: string): void { /* no-op */ }

/**
 * Minimal Setting stub (FIX-19-05-07: VaultHealthRepairModal renders its
 * scan/re-check toolbars as native Settings). Mirrors the production call
 * chain `new Setting(container).setName().setDesc().addButton(cb)`. It builds
 * real fakeDom children on the container so the modal tests, which assert on
 * rendered text, keep seeing the labels. The button callback receives a
 * ButtonComponent whose click can be simulated via the static registry.
 */
interface SettingHost {
    createDiv: (opts?: unknown) => SettingHost;
    createEl: (tag: string, opts?: unknown) => SettingHost;
    createSpan?: (opts?: unknown) => SettingHost;
    addClass: (...c: string[]) => void;
    setText?: (t: string) => void;
    addEventListener?: (type: string, fn: () => void) => void;
    setAttribute?: (k: string, v: string) => void;
}

export class ButtonComponent {
    static instances: ButtonComponent[] = [];
    static reset(): void { ButtonComponent.instances = []; }
    private clickCb: (() => void) | null = null;
    text = '';
    constructor(public buttonEl: SettingHost) { ButtonComponent.instances.push(this); }
    setButtonText(t: string): this { this.text = t; this.buttonEl.setText?.(t); return this; }
    setIcon(_i: string): this { return this; }
    setCta(): this { this.buttonEl.addClass('mod-cta'); return this; }
    setDisabled(_d: boolean): this { return this; }
    onClick(cb: () => void): this { this.clickCb = cb; return this; }
    simulateClick(): void { this.clickCb?.(); }
}

/**
 * Minimal TextComponent stub (IMP-14-04-01: the MCP connection details render
 * their copy-paste values as read-only text fields). Mirrors the production
 * call chain `addText(text => { text.setValue(v); text.inputEl.readOnly = true; })`.
 */
export class TextComponent {
    static instances: TextComponent[] = [];
    static reset(): void { TextComponent.instances = []; }
    value = '';
    inputEl: { readOnly: boolean; type: string; value: string; addClass: (...c: string[]) => void };
    protected changeCb: ((v: string) => void | Promise<void>) | null = null;
    constructor(public containerEl: SettingHost) {
        this.inputEl = { readOnly: false, type: 'text', value: '', addClass: () => { /* no-op */ } };
        TextComponent.instances.push(this);
    }
    setValue(v: string): this { this.value = v; this.inputEl.value = v; return this; }
    getValue(): string { return this.value; }
    setPlaceholder(_p: string): this { return this; }
    /**
     * Records the callback (same contract as ToggleComponent): setValue never
     * fires it, only a simulated edit does. FEAT-24-12 needs this to drive the
     * FX-rate field, which validates what the user types.
     */
    onChange(cb: (v: string) => void | Promise<void>): this { this.changeCb = cb; return this; }
    /** Test helper: simulate the user typing. Awaitable for async handlers. */
    async simulateChange(v: string): Promise<void> {
        this.setValue(v);
        await this.changeCb?.(v);
    }
}

/**
 * Minimal TextAreaComponent stub (FEAT-24-12: the price-override map is a
 * multi-line text field). Same registry/simulateChange contract as
 * TextComponent, which is also what the real class extends.
 */
export class TextAreaComponent extends TextComponent {
    static instances: TextAreaComponent[] = [];
    static reset(): void { TextAreaComponent.instances = []; }
    constructor(containerEl: SettingHost) {
        super(containerEl);
        TextAreaComponent.instances.push(this);
    }
}

/**
 * Minimal ExtraButtonComponent stub (IMP-14-04-01: the token field carries a
 * reveal toggle as an extra button). Same registry/simulateClick contract as
 * ButtonComponent.
 */
export class ExtraButtonComponent {
    static instances: ExtraButtonComponent[] = [];
    static reset(): void { ExtraButtonComponent.instances = []; }
    icon = '';
    tooltip = '';
    private clickCb: (() => void) | null = null;
    constructor(public extraSettingsEl: SettingHost) { ExtraButtonComponent.instances.push(this); }
    setIcon(i: string): this { this.icon = i; return this; }
    setTooltip(tip: string): this { this.tooltip = tip; return this; }
    setDisabled(_d: boolean): this { return this; }
    onClick(cb: () => void): this { this.clickCb = cb; return this; }
    simulateClick(): void { this.clickCb?.(); }
}

export class Setting {
    settingEl: SettingHost;
    nameEl: SettingHost;
    descEl: SettingHost;
    controlEl: SettingHost;
    constructor(container: SettingHost) {
        this.settingEl = container.createDiv('setting-item');
        const info = this.settingEl.createDiv('setting-item-info');
        this.nameEl = info.createDiv('setting-item-name');
        this.descEl = info.createDiv('setting-item-description');
        this.controlEl = this.settingEl.createDiv('setting-item-control');
    }
    setName(name: string): this { this.nameEl.setText?.(name); return this; }
    setDesc(desc: string): this { this.descEl.setText?.(desc); return this; }
    addButton(cb: (b: ButtonComponent) => void): this {
        const btnEl = this.controlEl.createEl('button');
        cb(new ButtonComponent(btnEl));
        return this;
    }
    addText(cb: (t: TextComponent) => void): this {
        cb(new TextComponent(this.controlEl));
        return this;
    }
    addTextArea(cb: (t: TextAreaComponent) => void): this {
        cb(new TextAreaComponent(this.controlEl));
        return this;
    }
    addExtraButton(cb: (b: ExtraButtonComponent) => void): this {
        const btnEl = this.controlEl.createEl('button');
        cb(new ExtraButtonComponent(btnEl));
        return this;
    }
    addToggle(cb: (t: ToggleComponent) => void): this {
        cb(new ToggleComponent(this.controlEl));
        return this;
    }
}

/**
 * Minimal ToggleComponent stub (FEAT-02-12: ChatOptionsPopover renders real
 * switches). Mirrors the production call order `new ToggleComponent(host)
 * .setValue(x).onChange(cb)`: setValue only records state, it never fires the
 * callback. Tests reach the instances a component created internally via the
 * static registry and flip them with simulateClick().
 */
export class ToggleComponent {
    static instances: ToggleComponent[] = [];
    static reset(): void { ToggleComponent.instances = []; }
    value = false;
    private changeCb: ((v: boolean) => void) | null = null;
    constructor(public containerEl: unknown) { ToggleComponent.instances.push(this); }
    setValue(v: boolean): this { this.value = v; return this; }
    onChange(cb: (v: boolean) => void): this { this.changeCb = cb; return this; }
    /** Test helper: simulate the user flipping the switch. */
    simulateClick(): void { this.value = !this.value; this.changeCb?.(this.value); }
}
