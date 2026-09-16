/**
 * JsonStore - Simple JSON file-based storage for Electron apps
 *
 * A drop-in replacement for electron-store that uses native Node.js fs
 * to avoid Vite bundling issues with electron-store's atomically dependency.
 *
 * Features:
 * - Type-safe with generics
 * - Atomic writes (write to temp, then rename)
 * - Automatic directory creation
 * - Default values with deep merge
 * - In-memory caching for performance
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export interface JsonStoreOptions<T> {
  /** Store name (creates {name}.json in userData) */
  name: string
  /** Default values - used when key doesn't exist */
  defaults?: T
  /** Custom directory path (defaults to app.getPath('userData')) */
  cwd?: string
  /** Clear store if JSON is invalid (default: false) */
  clearInvalidConfig?: boolean
}

/**
 * Type-safe JSON file store
 */
export class JsonStore<T extends Record<string, unknown>> {
  private filePath: string
  private data: T
  private defaults: T

  constructor(options: JsonStoreOptions<T>) {
    const dir = options.cwd ?? app.getPath('userData')
    this.filePath = path.join(dir, `${options.name}.json`)
    this.defaults = options.defaults ?? ({} as T)

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // Load existing data or use defaults
    this.data = this.load(options.clearInvalidConfig ?? false)
  }

  /**
   * Load data from file
   */
  private load(clearInvalidConfig: boolean): T {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw)
        // Deep merge with defaults
        return this.deepMerge(this.defaults, parsed)
      }
    } catch (err) {
      console.error(`[JsonStore] Failed to load ${this.filePath}:`, err)
      if (clearInvalidConfig) {
        console.log('[JsonStore] Clearing invalid config and using defaults')
        this.save(this.defaults)
        return { ...this.defaults }
      }
    }
    return { ...this.defaults }
  }

  /**
   * Save data to file atomically
   */
  private save(data: T): void {
    const tempPath = `${this.filePath}.tmp`
    try {
      // Write to temp file first
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8')
      // Atomic rename
      fs.renameSync(tempPath, this.filePath)
    } catch (err) {
      // Clean up temp file on error
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath)
        }
      } catch {
        // Ignore cleanup errors
      }
      throw err
    }
  }

  /**
   * Deep merge two objects
   */
  private deepMerge<U extends Record<string, unknown>>(target: U, source: Partial<U>): U {
    const result = { ...target }
    for (const key in source) {
      const sourceVal = source[key]
      const targetVal = result[key]
      if (
        sourceVal !== null &&
        typeof sourceVal === 'object' &&
        !Array.isArray(sourceVal) &&
        targetVal !== null &&
        typeof targetVal === 'object' &&
        !Array.isArray(targetVal)
      ) {
        result[key] = this.deepMerge(
          targetVal as Record<string, unknown>,
          sourceVal as Record<string, unknown>
        ) as U[Extract<keyof U, string>]
      } else if (sourceVal !== undefined) {
        result[key] = sourceVal as U[Extract<keyof U, string>]
      }
    }
    return result
  }

  /**
   * Get a value by key
   */
  get<K extends keyof T>(key: K): T[K]
  get<K extends keyof T>(key: K, defaultValue: T[K]): T[K]
  get<K extends keyof T>(key: K, defaultValue?: T[K]): T[K] {
    const value = this.data[key]
    if (value === undefined) {
      return defaultValue ?? this.defaults[key]
    }
    return value
  }

  /**
   * Set a value by key
   */
  set<K extends keyof T>(key: K, value: T[K]): void
  set(key: string, value: unknown): void
  set(key: string, value: unknown): void {
    (this.data as Record<string, unknown>)[key] = value
    this.save(this.data)
  }

  /**
   * Set multiple values at once
   */
  setMultiple(values: Partial<T>): void {
    for (const [key, value] of Object.entries(values)) {
      (this.data as Record<string, unknown>)[key] = value
    }
    this.save(this.data)
  }

  /**
   * Check if a key exists
   */
  has(key: keyof T): boolean {
    return key in this.data && this.data[key] !== undefined
  }

  /**
   * Delete a key
   */
  delete(key: keyof T): void {
    delete this.data[key]
    this.save(this.data)
  }

  /**
   * Clear all data (reset to defaults)
   */
  clear(): void {
    this.data = { ...this.defaults }
    this.save(this.data)
  }

  /**
   * Get all data
   */
  get store(): T {
    return { ...this.data }
  }

  /**
   * Get the file path
   */
  get path(): string {
    return this.filePath
  }

  /**
   * Reload data from disk
   */
  reload(): void {
    this.data = this.load(false)
  }
}

/**
 * Create a JsonStore instance
 * Convenience function for cleaner API
 */
export function createJsonStore<T extends Record<string, unknown>>(
  options: JsonStoreOptions<T>
): JsonStore<T> {
  return new JsonStore<T>(options)
}
