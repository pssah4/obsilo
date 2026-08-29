import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import obsidianmd from 'eslint-plugin-obsidianmd';
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js';
import { DEFAULT_ACRONYMS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js';

// Brand + acronym allowlist for the Bedrock provider. These have to be merged
// with the obsidianmd defaults because passing a brands/acronyms option replaces
// the built-in list entirely instead of extending it.
// Kept minimal: only brands that appear in new Bedrock-specific UI text. Adding
// too many (Ollama, Azure, OpenAI...) would conflict with existing lowercase
// usages in src/i18n/locales/en.ts where those words refer to CLI commands or
// filenames, not branded products.
// ignoreWords does not apply to the first token of a sentence (the rule's
// firstAlpha branch only consults acronyms + brands), so anchor terms that
// must keep their casing at sentence start go into brands instead.
const VAULT_OPERATOR_BRANDS = [
    ...DEFAULT_BRANDS,
    'Amazon Bedrock', 'Bedrock', 'ChatGPT', 'Vault Operator', 'KnowledgeDB', 'Markdown',
    // Hyphenated nouns that appear at sentence start in German UI strings
    'Living-Document', 'Cross-surface', 'Top-Hub-Block', 'Top-Hub-Generator',
    'Marker-Block', 'Frontmatter-Backfill-Job', 'Inbox-Triage', 'MOC-Pflege',
    'MOC-Marker', 'Auto-Trigger-Property', 'Cluster-Kandidaten',
    // Third-party products and tools the agent integrates with. Each one is
    // a proper noun; the sentence-case rule otherwise lowercases them
    // mid-sentence ("install Tavily" -> "install tavily").
    'Tavily', 'Brave', 'Pandoc', 'ImageMagick', 'Dataview', 'Templater',
    'MetaEdit', 'Perplexity', 'Claude Code', 'Claude.ai',
    // FEAT-04-10/04-11: MCP connector UI copy names these products.
    'Claude Desktop', 'GitHub', 'Notion',
];
// EPIC-26: not adding provider names like OpenAI / OpenRouter / Ollama /
// Anthropic to the brand list -- the rule does CASE-INSENSITIVE matching
// (collectBrandMatches uses /gi), so "openai.com" in a URL would be flagged
// as needing brand-canonical "OpenAI" casing. Pre-existing locale strings
// reference these names via lowercase domains (openai.com, ollama.ai,
// openrouter.ai). EPIC-26 strings avoid mid-sentence brand mentions instead.
const VAULT_OPERATOR_ACRONYMS = [...DEFAULT_ACRONYMS, 'AWS', 'IAM', 'SSO', 'STS', 'EU', 'US', 'OS', 'VPC', 'ARN', 'MOC', 'MOCs', 'BA-25', 'BA-26', 'MCP', 'DB',
    // EPIC-26 -- AI provider acronyms referenced in the new UI copy.
    'LLM', 'SDK',
    // File-size units that show up in UI strings. Without these, "5 MB"
    // becomes "5 mb".
    'KB', 'MB', 'GB', 'TB', 'DNA',
    // Office file format acronyms that appear in capability descriptions.
    'DOCX', 'XLSX', 'PPTX',
    // EPIC-42: OKF frontmatter standard referenced in graph-expansion copy.
    'OKF',
    // FIX-42-06-01: reranker asset UI copy names the WebAssembly backend.
    // Only ever appears uppercase in locale strings, so no lowercase "wasm"
    // token gets folded.
    'WASM',
    // FIX-42-06-01: integrity-check acronym in the asset-download status copy.
    'SHA256',
    // 3.6.0: the reranker runtime, named in the asset label and its help text.
    'ONNX',
    // FEAT-24-12: currency codes in the cost-display copy. Model prices are
    // published in USD and the footer converts to EUR, so both appear as
    // codes, never as lowercase words. Without these, "USD to EUR rate"
    // becomes "Usd to eur rate".
    'USD', 'EUR',
];
// Proper nouns that should keep their casing in Bedrock-related UI copy but
// don't belong in the general brand list (they are not branded products).
// Includes German technical compound nouns (German grammar capitalises all
// nouns) so the English-centric sentence-case rule does not flag them.
const VAULT_OPERATOR_IGNORE_WORDS = [
    'Europe', 'Frankfurt', 'Frontmatter', 'Backfill', 'Inbox', 'Triage',
    'Stores', 'Konsole', 'Cluster', 'Ontologie', 'Settings', 'Plugin',
    'Off', 'On', 'Toggle', 'Refresh', 'Plus', 'Pro',
    'Days', 'Map', 'I', 'DELETE',
    // EPIC-26: AWS region identifiers used as placeholders.
    'eu-central-1', 'us-east-1', 'us-west-2',
    // UI labels referenced inside other UI strings. The sentence-case rule
    // would lowercase them mid-sentence ("see the History sidebar" ->
    // "see the history sidebar"); we want to preserve the on-screen label.
    'History', 'Permissions', 'Permissive', 'Providers', 'Connectors',
    'Embeddings',
    'Customize', 'Migrate', 'Connect', 'Disconnect', 'Duplicate', 'New',
    'Note', 'Web', 'Vault', 'Read', 'Edits', 'Sub-agents',
    'External-commands', 'Remote', 'Redeploy', 'X',
    // Emphasis / language names that the rule otherwise normalises.
    'FIRST', 'German', 'English', 'non-English', 'N', 'Show',
    // FEAT-04-11: publisher trust-tier labels (glossary terms) + the
    // "External MCP servers" section label referenced in other strings.
    'Verified', 'Community', 'Unverified', 'External',
    // Plural acronym forms — we want "APIs" / "PDFs" preserved, not folded
    // to "APIS" / "PDFS" via the acronyms list or to "apis" / "pdfs" via
    // the lowercase pass.
    'APIs', 'PDFs', 'MBs', 'KBs', 'GBs',
    // FEAT-04-10/13: MCP transport + client copy. Protocol/product names and
    // UI labels referenced inside help strings; lowercasing them would break
    // the on-screen reference. (All bot-passed at 3.3.1.)
    'Streamable', 'Cursor', 'Arguments', 'Referenced', 'Enable',
    // AUDIT/3.6.0: UI labels referenced inside other UI strings. Same reason
    // as the block above -- these name on-screen elements (the "Local
    // reranking" section, the "Reranker model (ONNX)" and "Semantic
    // reranker" assets, the "Storage layout consolidation" section), and
    // lowercasing them mid-sentence would break the reference.
    'Local', 'Reranker', 'Semantic', 'Storage', 'Interface',
    // Emphasis word used in the freshness-scan copy ("your WHOLE vault").
    'WHOLE',
];

// Regex patterns whose matching strings are exempt from sentence-case
// evaluation. Used for UI label patterns the rule misclassifies.
const VAULT_OPERATOR_IGNORE_REGEX = [
    // Button labels prefixed with "+ " (e.g. "+ New agent", "+ Duplicate").
    // The rule treats "+ " as leading content and lowercases the next token,
    // turning "+ New" into "+ new". The label form is intentional.
    '^\\+\\s+\\w',
    // EPIC-42: literal frontmatter property names and value examples. The
    // OKF vocabulary is lowercase by definition ('moc'), and the naming
    // convention 'Author-Year_Title' is a literal default value, not prose.
    '^moc$',
    '\\bOKF (default|vocabulary)\\b',
    '\\bAuthor-Year_Title\\b',
    // Tool identifiers referenced in UI copy (snake_case, must stay as-is;
    // the acronyms pass would otherwise fold docx -> DOCX inside them).
    'create_(docx|xlsx|pptx)',
    // Issue #62 / 3.6.1: the literal Ollama API path named in the keep-alive
    // help text. The distinction it carries is the whole point of the setting
    // (the OpenAI-compatible /v1 route silently drops keep_alive, the native
    // one honours it), so the path stays as written rather than being
    // paraphrased away.
    '/api/embed',
    // Sentence fragments interpolated mid-sentence via {{var}}; they must
    // keep lowercase ("last check: never", "1 embedding model").
    '^never$',
    '^embedding models?$',
    '^your active LLM provider',
    // FEAT-04-11: label fragments interpolated mid-sentence (e.g.
    // "notion.com (verified domain)", "You need an access token ...").
    '^verified domain$',
    '^an access token or API key from this provider$',
    // FEAT-04-13: MCP connector TYPE identifiers -- literal transport ids,
    // intentionally lowercase (they are wire values, not prose).
    '^stdio \\(local program\\)$',
    '^streamable-http \\(remote\\)$',
    '^sse \\(remote\\)$',
    // Deliberate-lowercase status/permission labels shown as-is.
    '^write$',
    '^uncertain$',
    '^fairly sure$',
    '^confident$',
    // Grammatically-correct multi-sentence help copy + one label that the
    // rule misclassifies (it flags the capital that opens the second
    // sentence, or the first token of a short label). All bot-passed at
    // 3.3.1; exempted here rather than degrading the on-screen text.
    '^Nothing in this severity\\. Switch',
    '^Runs only while Obsidian is open\\. Plain http',
    '^In your client: pick Streamable HTTP',
    '^Some clients cannot use the HTTP option',
    '^Put tokens and secrets here, never in Arguments',
    '^Weekly budget \\(USD\\)$',
];

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    security.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            'no-unsanitized': noUnsanitized,
            obsidianmd,
        },
        rules: {
            // TypeScript
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', { args: 'none' }],
            '@typescript-eslint/no-explicit-any': 'warn',
            'no-prototype-builtins': 'off',
            '@typescript-eslint/no-empty-function': 'off',
            // TypeScript strict rules (matched to ObsidianReviewBot config)
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/require-await': 'error',
            '@typescript-eslint/no-deprecated': 'warn',
            '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
            '@typescript-eslint/no-implied-eval': 'error',
            // Security
            'security/detect-child-process': 'error',
            'security/detect-eval-with-expression': 'error',
            'security/detect-non-literal-fs-filename': 'warn',
            'security/detect-non-literal-regexp': 'warn',
            'security/detect-possible-timing-attacks': 'warn',
            'security/detect-object-injection': 'warn',
            'no-unsanitized/method': 'error',
            'no-unsanitized/property': 'error',
            // Obsidian Community Plugin Review-Bot Rules
            ...obsidianmd.configs.recommended,
            // Bot-matching config: enforceCamelCaseLower plus merged brand/acronym allowlist
            // for the Bedrock provider. VAULT_OPERATOR_BRANDS/ACRONYMS extend the obsidianmd defaults
            // (not replace them), so existing strings in locale files keep passing.
            'obsidianmd/ui/sentence-case-locale-module': ['error', {
                enforceCamelCaseLower: true,
                brands: VAULT_OPERATOR_BRANDS,
                acronyms: VAULT_OPERATOR_ACRONYMS,
                ignoreWords: VAULT_OPERATOR_IGNORE_WORDS,
                ignoreRegex: VAULT_OPERATOR_IGNORE_REGEX,
            }],
            'obsidianmd/ui/sentence-case': ['error', {
                enforceCamelCaseLower: true,
                brands: VAULT_OPERATOR_BRANDS,
                acronyms: VAULT_OPERATOR_ACRONYMS,
                ignoreWords: VAULT_OPERATOR_IGNORE_WORDS,
                ignoreRegex: VAULT_OPERATOR_IGNORE_REGEX,
            }],
        },
    },
    {
        // Test files use async mock callbacks to match async interfaces; the
        // body often returns a literal so there is nothing to await. They also
        // hand-mock Obsidian's configDir as the literal '.obsidian' and use
        // '.obsidian/...' paths as path-traversal attack fixtures. The Review
        // Bot does not scan test files, but the local check would flag both, so
        // relax these rules for tests only.
        files: ['src/**/__tests__/**/*.ts', 'src/**/*.test.ts'],
        rules: {
            '@typescript-eslint/require-await': 'off',
            'obsidianmd/hardcoded-config-path': 'off',
        },
    },
    {
        // PLAN-41 Wave 4 / ADR-137: Layer-Guard auf der `vectors`-Tabelle.
        // Direkte SQL-Zugriffe auf `vectors` sind nur in der Helfer-Heimat
        // (VectorStore, KnowledgeDB, knowledgeDomains) erlaubt. Tests duerfen
        // ebenfalls roh queryen, weil sie Fixtures setzen und State verifizieren.
        // Alle anderen Aufrufer muessen die VectorStore-API benutzen.
        files: ['src/**/*.ts'],
        ignores: [
            'src/core/knowledge/VectorStore.ts',
            'src/core/knowledge/KnowledgeDB.ts',
            'src/core/knowledge/knowledgeDomains.ts',
            'src/**/__tests__/**/*.ts',
        ],
        rules: {
            'no-restricted-syntax': ['error',
                {
                    selector: "Literal[value=/\\b(FROM|INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+vectors\\b/i]",
                    message: "Direct access to the `vectors` table is forbidden outside src/core/knowledge/VectorStore.ts. Use VectorStore.findNoteVectors / findSessionVectors / ... or findVectors({domain?}) for cross-layer queries. See ADR-137. If truly needed, disable with '// eslint-disable-next-line no-restricted-syntax -- reason: <why>'.",
                },
                {
                    selector: "TemplateElement[value.raw=/\\b(FROM|INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+vectors\\b/i]",
                    message: "Direct access to the `vectors` table is forbidden outside src/core/knowledge/VectorStore.ts. See ADR-137.",
                },
            ],
        },
    },
    {
        // EPIC-42 / FEAT-42-04: i18n-Guard. In den gesweepten UI-Bereichen
        // muessen user-sichtbare Texte durch t() laufen. Hardcodierte
        // String-Literale in Notice/setName/setDesc/... sind Regressionen.
        // Legitime Ausnahmen (reine Symbole, Werte) mit
        // '// eslint-disable-next-line no-restricted-syntax -- reason: <why>'.
        files: ['src/ui/**/*.ts', 'src/main.ts', 'src/core/inline/**/*.ts'],
        ignores: ['src/**/__tests__/**/*.ts'],
        rules: {
            'no-restricted-syntax': ['error',
                {
                    selector: "NewExpression[callee.name='Notice'] > Literal[value=/[A-Za-z]{3}/]:first-child",
                    message: 'User-visible Notice text must go through t() (src/i18n). Add a key to en.ts instead of a hardcoded string. See FEAT-42-04.',
                },
                {
                    selector: "CallExpression[callee.property.name=/^(setName|setDesc|setButtonText|setTooltip|setTitle)$/] > Literal[value=/[A-Za-z]{3}/]:first-child",
                    message: 'User-visible UI text must go through t() (src/i18n). Add a key to en.ts instead of a hardcoded string. See FEAT-42-04.',
                },
            ],
        },
    },
    {
        ignores: ['node_modules/', 'main.js', 'forked-kilocode/', '_devprocess/', 'docs/'],
    }
);
