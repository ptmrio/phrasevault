/**
 * Trial mode management using JsonStore
 */
import { JsonStore } from '../json-store'

export interface TrialConfig {
  /** Number of trial days (default: 14) */
  trialDays: number
  /** Days before expiry to start showing reminders (default: 5) */
  reminderStartDays?: number
  /** Store name for trial data */
  storeName: string
}

export interface TrialStatus {
  active: boolean
  daysRemaining: number
  expired: boolean
  firstLaunch: string
}

interface TrialData {
  firstLaunch: string
  lastReminderShown?: string
  [key: string]: unknown
}

// Dev mode override for testing
let devTrialDaysOverride: number | null = null

// Check environment variable on module load
const envTrialDays = process.env.FAKE_TRIAL_DAYS
if (envTrialDays !== undefined) {
  const days = parseInt(envTrialDays, 10)
  if (!isNaN(days)) {
    devTrialDaysOverride = days
  }
}

export function setDevTrialDays(days: number | null): void {
  devTrialDaysOverride = days
}

export function getDevTrialDays(): number | null {
  return devTrialDaysOverride
}

export function isDevTrialOverride(): boolean {
  return devTrialDaysOverride !== null
}

/**
 * Create a trial manager for an app
 */
export function createTrialManager(config: TrialConfig) {
  const { trialDays, reminderStartDays = 5, storeName } = config

  const store = new JsonStore<TrialData>({
    name: `${storeName}-trial`,
    defaults: {
      firstLaunch: '',
    },
  })

  function getTrialStatus(): TrialStatus {
    let firstLaunch = store.get('firstLaunch')

    // First time launch - record it
    if (!firstLaunch) {
      firstLaunch = new Date().toISOString()
      store.set('firstLaunch', firstLaunch)
    }

    // Dev override for testing
    if (devTrialDaysOverride !== null) {
      return {
        active: devTrialDaysOverride > 0,
        daysRemaining: devTrialDaysOverride,
        expired: devTrialDaysOverride === 0,
        firstLaunch,
      }
    }

    const elapsed = Date.now() - new Date(firstLaunch).getTime()
    const daysUsed = Math.floor(elapsed / (1000 * 60 * 60 * 24))
    const daysRemaining = Math.max(0, trialDays - daysUsed)

    return {
      active: daysRemaining > 0,
      daysRemaining,
      expired: daysRemaining === 0,
      firstLaunch,
    }
  }

  function shouldShowReminder(): boolean {
    // In dev mode with override, always show reminder
    if (devTrialDaysOverride !== null) {
      return true
    }

    const trial = getTrialStatus()

    // Only show reminders in the last N days of trial, or when expired
    if (trial.daysRemaining > reminderStartDays) {
      return false
    }

    const today = new Date().toISOString().split('T')[0]
    const lastShown = store.get('lastReminderShown')

    // Show reminder if never shown or last shown was a different day
    return !lastShown || lastShown !== today
  }

  function markReminderShown(): void {
    const today = new Date().toISOString().split('T')[0]
    store.set('lastReminderShown', today)
  }

  function resetTrial(): void {
    store.clear()
  }

  return {
    getTrialStatus,
    shouldShowReminder,
    markReminderShown,
    resetTrial,
  }
}

export type TrialManager = ReturnType<typeof createTrialManager>
