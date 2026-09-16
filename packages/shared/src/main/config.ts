/**
 * Config service using JsonStore
 * Type-safe configuration management with migrations support
 */
import { JsonStore } from './json-store'

export interface BaseConfigSchema {
  theme: 'light' | 'dark' | 'system'
  language: string
  [key: string]: unknown
}

export interface ConfigServiceOptions<T extends BaseConfigSchema> {
  /** Store name (unique per app) */
  name: string
  /** Default values */
  defaults: T
  /** Optional migrations keyed by version */
  migrations?: Record<string, (store: JsonStore<T>) => void>
}

/**
 * Create a typed config service for an app
 */
export function createConfigService<T extends BaseConfigSchema>(
  options: ConfigServiceOptions<T>
) {
  const store = new JsonStore<T>({
    name: options.name,
    defaults: options.defaults,
    clearInvalidConfig: true,
  })

  // Run migrations if provided
  if (options.migrations) {
    runMigrations(store, options.migrations)
  }

  function get<K extends keyof T>(key: K): T[K] {
    return store.get(key)
  }

  function set<K extends keyof T>(key: K, value: T[K]): void {
    store.set(key, value)
  }

  function setMultiple(values: Partial<T>): void {
    store.setMultiple(values)
  }

  function getAll(): T {
    return store.store
  }

  function reset(): void {
    store.clear()
  }

  function has(key: keyof T): boolean {
    return store.has(key)
  }

  return {
    get,
    set,
    setMultiple,
    getAll,
    reset,
    has,
    /** Direct access to underlying store (for advanced use) */
    _store: store,
  }
}

function runMigrations<T extends BaseConfigSchema>(
  store: JsonStore<T>,
  migrations: Record<string, (store: JsonStore<T>) => void>
): void {
  const currentVersion = (store.get('_configVersion' as keyof T) as string) || '0.0.0'
  const sortedVersions = Object.keys(migrations).sort(compareVersions)

  for (const version of sortedVersions) {
    if (compareVersions(version, currentVersion) > 0) {
      const migration = migrations[version]
      if (migration) {
        migration(store)
        store.set('_configVersion' as keyof T, version as T[keyof T])
      }
    }
  }
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] ?? 0
    const numB = partsB[i] ?? 0
    if (numA > numB) return 1
    if (numA < numB) return -1
  }
  return 0
}

export type ConfigService<T extends BaseConfigSchema> = ReturnType<
  typeof createConfigService<T>
>
