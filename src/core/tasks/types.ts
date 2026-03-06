/**
 * Task Extraction Types (FEATURE-100)
 *
 * Interfaces for the deterministic task extraction pipeline.
 * ADR-026 (Hook), ADR-027 (Schema), ADR-028 (Base/Iconic).
 */

/** A single task item extracted from agent response text */
export interface TaskItem {
    /** Full original checkbox text (e.g. "@Sebastian: Budget-Analyse erstellen (due: 2026-03-10)") */
    text: string;
    /** Parsed assignee (e.g. "@Sebastian") or empty string */
    assignee: string;
    /** Parsed due date in ISO format (e.g. "2026-03-10") or empty string */
    dueDate: string;
    /** Cleaned task text without assignee prefix and due date marker */
    cleanText: string;
}

/** Task extraction settings stored in plugin settings */
export interface TaskExtractionSettings {
    /** Master toggle for task extraction feature */
    enabled: boolean;
    /** Vault folder path for task notes (without trailing slash) */
    taskFolder: string;
}

/** Default settings for task extraction */
export const DEFAULT_TASK_EXTRACTION_SETTINGS: TaskExtractionSettings = {
    enabled: true,
    taskFolder: 'Tasks',
};

/** Status values for task notes (Eisenhower + Kanban compatible) */
export type TaskStatus = 'Todo' | 'Doing' | 'Done' | 'Waiting';
