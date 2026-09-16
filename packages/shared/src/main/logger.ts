/**
 * Simple file logger for Electron apps
 * Writes logs to userData/logs/ with rotation support
 */
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggerOptions {
  /** App name for log file naming */
  appName: string
  /** Max file size in bytes before rotation (default: 5MB) */
  maxFileSize?: number
  /** Max number of log files to keep (default: 3) */
  maxFiles?: number
  /** Minimum log level (default: 'info') */
  minLevel?: LogLevel
  /** Also log to console (default: true in dev) */
  console?: boolean
}

export interface AppLogger {
  logger: Logger
  log: {
    debug: (message: string, ...args: unknown[]) => void
    info: (message: string, ...args: unknown[]) => void
    warn: (message: string, ...args: unknown[]) => void
    error: (message: string, ...args: unknown[]) => void
  }
  module: {
    debug: (module: string, ...args: unknown[]) => void
    info: (module: string, ...args: unknown[]) => void
    warn: (module: string, ...args: unknown[]) => void
    error: (module: string, ...args: unknown[]) => void
  }
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

/**
 * Create a logger instance
 */
export function createLogger(options: LoggerOptions) {
  const {
    appName,
    maxFileSize = 5 * 1024 * 1024,
    maxFiles = 3,
    minLevel = 'info',
    console: logToConsole = process.env.NODE_ENV === 'development',
  } = options

  const logsDir = path.join(app.getPath('userData'), 'logs')
  const logPath = path.join(logsDir, `${appName}.log`)

  // Ensure logs directory exists
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
  }

  // Rotate logs if needed on startup
  rotateIfNeeded()

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[minLevel]
  }

  function formatMessage(
    level: LogLevel,
    message: string,
    args: unknown[]
  ): string {
    const timestamp = new Date().toISOString()
    const formattedArgs = args.length ? ' ' + JSON.stringify(args) : ''
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${formattedArgs}\n`
  }

  function write(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!shouldLog(level)) return

    const line = formatMessage(level, message, args)

    // Write to file
    try {
      fs.appendFileSync(logPath, line)
    } catch {
      // Ignore file write errors
    }

    // Write to console
    if (logToConsole) {
      const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      consoleFn(`[${level.toUpperCase()}]`, message, ...args)
    }
  }

  function rotateIfNeeded(): void {
    try {
      if (!fs.existsSync(logPath)) return

      const stats = fs.statSync(logPath)
      if (stats.size < maxFileSize) return

      // Rotate existing files
      for (let i = maxFiles - 1; i >= 1; i--) {
        const oldPath = `${logPath}.${i}`
        const newPath = `${logPath}.${i + 1}`
        if (fs.existsSync(oldPath)) {
          if (i === maxFiles - 1) {
            fs.unlinkSync(oldPath)
          } else {
            fs.renameSync(oldPath, newPath)
          }
        }
      }

      // Rename current to .1
      fs.renameSync(logPath, `${logPath}.1`)
    } catch {
      // Ignore rotation errors
    }
  }

  function debug(message: string, ...args: unknown[]): void {
    write('debug', message, ...args)
  }

  function info(message: string, ...args: unknown[]): void {
    write('info', message, ...args)
  }

  function warn(message: string, ...args: unknown[]): void {
    write('warn', message, ...args)
  }

  function error(message: string, ...args: unknown[]): void {
    write('error', message, ...args)
  }

  function getLogPath(): string {
    return logPath
  }

  return {
    debug,
    info,
    warn,
    error,
    getLogPath,
  }
}

export type Logger = ReturnType<typeof createLogger>

/**
 * Create a logger with both plain and module-prefixed helpers.
 */
export function createAppLogger(options: LoggerOptions): AppLogger {
  const logger = createLogger(options)

  const log = {
    debug: (message: string, ...args: unknown[]) => logger.debug(message, ...args),
    info: (message: string, ...args: unknown[]) => logger.info(message, ...args),
    warn: (message: string, ...args: unknown[]) => logger.warn(message, ...args),
    error: (message: string, ...args: unknown[]) => logger.error(message, ...args),
  }

  const module = {
    debug: (moduleName: string, ...args: unknown[]) => logger.debug(`[${moduleName}]`, ...args),
    info: (moduleName: string, ...args: unknown[]) => logger.info(`[${moduleName}]`, ...args),
    warn: (moduleName: string, ...args: unknown[]) => logger.warn(`[${moduleName}]`, ...args),
    error: (moduleName: string, ...args: unknown[]) => logger.error(`[${moduleName}]`, ...args),
  }

  return { logger, log, module }
}
