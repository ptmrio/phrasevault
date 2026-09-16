/**
 * Markdown rendering utilities for main process
 * Handles IPC for markdown file reading and rendering
 */

import { ipcMain } from 'electron'
import type { IpcMainEvent } from 'electron'
import fs from 'fs'
import path from 'path'
import { marked } from 'marked'

export interface MarkdownOptions {
  /** Base directory for resolving relative file paths */
  basePath: string
  /** GitHub Flavored Markdown (default: true) */
  gfm?: boolean
  /** Convert line breaks to <br> (default: true) */
  breaks?: boolean
}

export interface MarkdownContentResponse {
  success: boolean
  html?: string
  error?: string
  filename?: string
}

let cleanupFn: (() => void) | null = null

/**
 * Configure marked with consistent options
 */
function configureMarked(options: MarkdownOptions): void {
  marked.setOptions({
    gfm: options.gfm ?? true,
    breaks: options.breaks ?? true,
  })
}

/**
 * Render markdown string to HTML
 */
export function renderMarkdown(content: string): string {
  return marked.parse(content) as string
}

/**
 * Read and render a markdown file
 */
export function renderMarkdownFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null
  }
  const content = fs.readFileSync(filePath, 'utf-8')
  return renderMarkdown(content)
}

/**
 * Register IPC handlers for markdown rendering
 * Apps should call this in their main process setup
 *
 * @param options - Configuration including base path for files
 * @returns Cleanup function to remove handlers
 */
export function registerMarkdownHandlers(options: MarkdownOptions): () => void {
  // Clean up any previous handlers
  if (cleanupFn) {
    cleanupFn()
  }

  configureMarked(options)

  const handleReadFile = (event: IpcMainEvent, filename: string): void => {
    try {
      const filePath = path.resolve(options.basePath, filename)
      const html = renderMarkdownFile(filePath)

      if (html !== null) {
        event.sender.send('markdown:content', {
          success: true,
          html,
          filename,
        } as MarkdownContentResponse)
      } else {
        event.sender.send('markdown:content', {
          success: false,
          error: 'File not found',
        } as MarkdownContentResponse)
      }
    } catch (error) {
      event.sender.send('markdown:content', {
        success: false,
        error: (error as Error).message,
      } as MarkdownContentResponse)
    }
  }

  const handleRender = (event: IpcMainEvent, content: string): void => {
    try {
      const html = renderMarkdown(content)
      event.sender.send('markdown:content', {
        success: true,
        html,
      } as MarkdownContentResponse)
    } catch (error) {
      event.sender.send('markdown:content', {
        success: false,
        error: (error as Error).message,
      } as MarkdownContentResponse)
    }
  }

  ipcMain.on('markdown:readFile', handleReadFile)
  ipcMain.on('markdown:render', handleRender)

  cleanupFn = () => {
    ipcMain.removeListener('markdown:readFile', handleReadFile)
    ipcMain.removeListener('markdown:render', handleRender)
  }

  return cleanupFn
}

/**
 * Get the required IPC channels for preload whitelist
 */
export const MARKDOWN_IPC_CHANNELS = [
  'markdown:readFile',
  'markdown:render',
  'markdown:content',
] as const
