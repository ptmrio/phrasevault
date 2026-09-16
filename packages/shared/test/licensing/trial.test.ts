import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  createTrialManager,
  setDevTrialDays,
  getDevTrialDays,
  isDevTrialOverride,
  type TrialConfig,
} from '../../src/main/licensing/trial'

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testDir),
  },
}))

let testDir: string

function cleanup() {
  if (testDir && fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

beforeEach(() => {
  testDir = path.join(os.tmpdir(), `trial-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(testDir, { recursive: true })
  // Reset dev override before each test
  setDevTrialDays(null)
})

afterEach(() => {
  cleanup()
  setDevTrialDays(null)
})

const defaultConfig: TrialConfig = {
  trialDays: 14,
  reminderStartDays: 5,
  storeName: 'trial-test',
}

describe('createTrialManager', () => {
  describe('getTrialStatus', () => {
    it('records first launch on first call', () => {
      const trial = createTrialManager(defaultConfig)
      const status = trial.getTrialStatus()

      expect(status.firstLaunch).toBeDefined()
      expect(status.firstLaunch).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('preserves first launch across calls', () => {
      const trial = createTrialManager(defaultConfig)
      const status1 = trial.getTrialStatus()
      const status2 = trial.getTrialStatus()

      expect(status1.firstLaunch).toBe(status2.firstLaunch)
    })

    it('new trial has full days remaining', () => {
      const trial = createTrialManager(defaultConfig)
      const status = trial.getTrialStatus()

      expect(status.daysRemaining).toBe(14)
      expect(status.active).toBe(true)
      expect(status.expired).toBe(false)
    })

    it('calculates days remaining correctly', () => {
      // Write a first launch date 7 days ago
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const filePath = path.join(testDir, 'trial-test-trial.json')
      fs.writeFileSync(filePath, JSON.stringify({ firstLaunch: sevenDaysAgo }))

      const trial = createTrialManager(defaultConfig)
      const status = trial.getTrialStatus()

      expect(status.daysRemaining).toBe(7)
      expect(status.active).toBe(true)
      expect(status.expired).toBe(false)
    })

    it('trial expires after trial period', () => {
      // Write a first launch date 15 days ago
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
      const filePath = path.join(testDir, 'trial-test-trial.json')
      fs.writeFileSync(filePath, JSON.stringify({ firstLaunch: fifteenDaysAgo }))

      const trial = createTrialManager(defaultConfig)
      const status = trial.getTrialStatus()

      expect(status.daysRemaining).toBe(0)
      expect(status.active).toBe(false)
      expect(status.expired).toBe(true)
    })

    it('days remaining cannot go negative', () => {
      // Write a first launch date 30 days ago
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const filePath = path.join(testDir, 'trial-test-trial.json')
      fs.writeFileSync(filePath, JSON.stringify({ firstLaunch: thirtyDaysAgo }))

      const trial = createTrialManager(defaultConfig)
      const status = trial.getTrialStatus()

      expect(status.daysRemaining).toBe(0)
      expect(status.expired).toBe(true)
    })

    it('last day of trial is still active', () => {
      // Write a first launch date 13 days ago (day 13, last day)
      const thirteenDaysAgo = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString()
      const filePath = path.join(testDir, 'trial-test-trial.json')
      fs.writeFileSync(filePath, JSON.stringify({ firstLaunch: thirteenDaysAgo }))

      const trial = createTrialManager(defaultConfig)
      const status = trial.getTrialStatus()

      expect(status.daysRemaining).toBe(1)
      expect(status.active).toBe(true)
      expect(status.expired).toBe(false)
    })

    it('exactly at expiry boundary is expired', () => {
      // Write a first launch date exactly 14 days ago
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
      const filePath = path.join(testDir, 'trial-test-trial.json')
      fs.writeFileSync(filePath, JSON.stringify({ firstLaunch: fourteenDaysAgo }))

      const trial = createTrialManager(defaultConfig)
      const status = trial.getTrialStatus()

      expect(status.daysRemaining).toBe(0)
      expect(status.expired).toBe(true)
    })
  })

  describe('shouldShowReminder', () => {
    it('does not show reminder for new trial', () => {
      const trial = createTrialManager(defaultConfig)

      expect(trial.shouldShowReminder()).toBe(false)
    })

    it('shows reminder in last reminderStartDays', () => {
      // Write a first launch date 10 days ago (4 days remaining, within 5-day reminder window)
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      const filePath = path.join(testDir, 'trial-test-trial.json')
      fs.writeFileSync(filePath, JSON.stringify({ firstLaunch: tenDaysAgo }))

      const trial = createTrialManager(defaultConfig)

      expect(trial.shouldShowReminder()).toBe(true)
    })

    it('shows reminder when expired', () => {
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
      const filePath = path.join(testDir, 'trial-test-trial.json')
      fs.writeFileSync(filePath, JSON.stringify({ firstLaunch: fifteenDaysAgo }))

      const trial = createTrialManager(defaultConfig)

      expect(trial.shouldShowReminder()).toBe(true)
    })

    it('does not show reminder twice on same day', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      const today = new Date().toISOString().split('T')[0]
      const filePath = path.join(testDir, 'trial-test-trial.json')
      fs.writeFileSync(filePath, JSON.stringify({
        firstLaunch: tenDaysAgo,
        lastReminderShown: today,
      }))

      const trial = createTrialManager(defaultConfig)

      expect(trial.shouldShowReminder()).toBe(false)
    })

    it('shows reminder on new day', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const filePath = path.join(testDir, 'trial-test-trial.json')
      fs.writeFileSync(filePath, JSON.stringify({
        firstLaunch: tenDaysAgo,
        lastReminderShown: yesterday,
      }))

      const trial = createTrialManager(defaultConfig)

      expect(trial.shouldShowReminder()).toBe(true)
    })
  })

  describe('markReminderShown', () => {
    it('records today as last reminder shown', () => {
      const trial = createTrialManager(defaultConfig)
      trial.getTrialStatus() // Initialize

      trial.markReminderShown()

      const filePath = path.join(testDir, 'trial-test-trial.json')
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      const today = new Date().toISOString().split('T')[0]

      expect(data.lastReminderShown).toBe(today)
    })

    it('prevents reminder from showing again same day', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      const filePath = path.join(testDir, 'trial-test-trial.json')
      fs.writeFileSync(filePath, JSON.stringify({ firstLaunch: tenDaysAgo }))

      const trial = createTrialManager(defaultConfig)

      expect(trial.shouldShowReminder()).toBe(true)
      trial.markReminderShown()
      expect(trial.shouldShowReminder()).toBe(false)
    })
  })

  describe('resetTrial', () => {
    it('clears all trial data', () => {
      const trial = createTrialManager(defaultConfig)
      trial.getTrialStatus() // Initialize
      trial.markReminderShown()

      trial.resetTrial()

      // After reset, next getTrialStatus should create new firstLaunch
      const before = new Date().toISOString()
      const status = trial.getTrialStatus()
      const after = new Date().toISOString()

      expect(status.firstLaunch >= before).toBe(true)
      expect(status.firstLaunch <= after).toBe(true)
      expect(status.daysRemaining).toBe(14)
    })
  })

  describe('custom trial configuration', () => {
    it('respects custom trialDays', () => {
      const trial = createTrialManager({
        trialDays: 30,
        storeName: 'custom-trial',
      })

      const status = trial.getTrialStatus()

      expect(status.daysRemaining).toBe(30)
    })

    it('respects custom reminderStartDays', () => {
      const config: TrialConfig = {
        trialDays: 14,
        reminderStartDays: 3,
        storeName: 'custom-reminder',
      }

      // 10 days used, 4 days remaining (outside 3-day reminder window)
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      const filePath = path.join(testDir, 'custom-reminder-trial.json')
      fs.writeFileSync(filePath, JSON.stringify({ firstLaunch: tenDaysAgo }))

      const trial = createTrialManager(config)

      expect(trial.shouldShowReminder()).toBe(false)
    })

    it('defaults reminderStartDays to 5', () => {
      const config: TrialConfig = {
        trialDays: 14,
        storeName: 'default-reminder',
      }

      // 10 days used, 4 days remaining (inside default 5-day reminder window)
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      const filePath = path.join(testDir, 'default-reminder-trial.json')
      fs.writeFileSync(filePath, JSON.stringify({ firstLaunch: tenDaysAgo }))

      const trial = createTrialManager(config)

      expect(trial.shouldShowReminder()).toBe(true)
    })
  })
})

describe('Dev override functions', () => {
  beforeEach(() => {
    setDevTrialDays(null)
  })

  afterEach(() => {
    setDevTrialDays(null)
  })

  describe('setDevTrialDays / getDevTrialDays', () => {
    it('default is null', () => {
      expect(getDevTrialDays()).toBeNull()
    })

    it('sets and gets override value', () => {
      setDevTrialDays(5)

      expect(getDevTrialDays()).toBe(5)
    })

    it('can be reset to null', () => {
      setDevTrialDays(5)
      setDevTrialDays(null)

      expect(getDevTrialDays()).toBeNull()
    })

    it('can be set to 0', () => {
      setDevTrialDays(0)

      expect(getDevTrialDays()).toBe(0)
    })
  })

  describe('isDevTrialOverride', () => {
    it('returns false by default', () => {
      expect(isDevTrialOverride()).toBe(false)
    })

    it('returns true when override set', () => {
      setDevTrialDays(5)

      expect(isDevTrialOverride()).toBe(true)
    })

    it('returns true when override is 0', () => {
      setDevTrialDays(0)

      expect(isDevTrialOverride()).toBe(true)
    })

    it('returns false after reset', () => {
      setDevTrialDays(5)
      setDevTrialDays(null)

      expect(isDevTrialOverride()).toBe(false)
    })
  })

  describe('dev override affects trial status', () => {
    it('overrides days remaining', () => {
      const trial = createTrialManager(defaultConfig)

      setDevTrialDays(3)
      const status = trial.getTrialStatus()

      expect(status.daysRemaining).toBe(3)
      expect(status.active).toBe(true)
      expect(status.expired).toBe(false)
    })

    it('can simulate expired trial', () => {
      const trial = createTrialManager(defaultConfig)

      setDevTrialDays(0)
      const status = trial.getTrialStatus()

      expect(status.daysRemaining).toBe(0)
      expect(status.active).toBe(false)
      expect(status.expired).toBe(true)
    })

    it('always shows reminder in dev mode', () => {
      const trial = createTrialManager(defaultConfig)

      setDevTrialDays(10) // Outside normal reminder window

      expect(trial.shouldShowReminder()).toBe(true)
    })

    it('preserves firstLaunch in dev override', () => {
      const trial = createTrialManager(defaultConfig)
      const status1 = trial.getTrialStatus()

      setDevTrialDays(3)
      const status2 = trial.getTrialStatus()

      expect(status2.firstLaunch).toBe(status1.firstLaunch)
    })
  })
})

describe('Trial edge cases', () => {
  it('handles 23 hours 59 minutes as day 0', () => {
    const almostOneDayAgo = new Date(Date.now() - (23 * 60 * 60 * 1000 + 59 * 60 * 1000)).toISOString()
    const filePath = path.join(testDir, 'trial-test-trial.json')
    fs.writeFileSync(filePath, JSON.stringify({ firstLaunch: almostOneDayAgo }))

    const trial = createTrialManager(defaultConfig)
    const status = trial.getTrialStatus()

    expect(status.daysRemaining).toBe(14) // Still on day 0
  })

  it('handles exactly 24 hours as day 1', () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const filePath = path.join(testDir, 'trial-test-trial.json')
    fs.writeFileSync(filePath, JSON.stringify({ firstLaunch: oneDayAgo }))

    const trial = createTrialManager(defaultConfig)
    const status = trial.getTrialStatus()

    expect(status.daysRemaining).toBe(13) // Day 1 used
  })

  it('handles persistence across manager instances', () => {
    const trial1 = createTrialManager(defaultConfig)
    trial1.getTrialStatus()

    const trial2 = createTrialManager(defaultConfig)
    const status2 = trial2.getTrialStatus()

    expect(status2.daysRemaining).toBe(14)
    expect(status2.firstLaunch).toBeDefined()
  })
})
