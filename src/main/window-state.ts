/**
 * Window state memory: position, size, maximized/full-screen state.
 * Stored in the configuration folder (never inside the data folder) and validated against the display
 * layout so a window saved on a disconnected monitor still opens on screen.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen } from 'electron'

export interface PersistedWindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
  isFullScreen: boolean
}

const DEFAULTS: PersistedWindowState = { width: 1440, height: 900, isMaximized: false, isFullScreen: false }

function isVisibleOnSomeDisplay(state: PersistedWindowState): boolean {
  if (state.x == null || state.y == null) return false
  return screen.getAllDisplays().some((display) => {
    const { x, y, width, height } = display.workArea
    return (
      state.x! >= x - 64 && state.y! >= y - 64 && state.x! + 120 <= x + width && state.y! + 120 <= y + height
    )
  })
}

export function loadWindowState(configDir: string): PersistedWindowState {
  const file = join(configDir, 'window-state.json')
  try {
    if (!existsSync(file)) return { ...DEFAULTS }
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<PersistedWindowState>
    const state: PersistedWindowState = {
      x: typeof parsed.x === 'number' ? parsed.x : undefined,
      y: typeof parsed.y === 'number' ? parsed.y : undefined,
      width: Math.max(1024, Math.round(parsed.width ?? DEFAULTS.width)),
      height: Math.max(680, Math.round(parsed.height ?? DEFAULTS.height)),
      isMaximized: parsed.isMaximized === true,
      isFullScreen: parsed.isFullScreen === true
    }
    if (!isVisibleOnSomeDisplay(state)) {
      state.x = undefined
      state.y = undefined
    }
    return state
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveWindowState(configDir: string, state: PersistedWindowState): void {
  try {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'window-state.json'), JSON.stringify(state, null, 2), 'utf8')
  } catch {
    // Window geometry is a convenience; failing to store it must never break shutdown.
  }
}

/** Configuration file that remembers the clinic's chosen data folder. */
export interface AppConfigFile {
  dataRoot?: string
  lastDataRootCheck?: string
}

export function loadAppConfig(configDir: string): AppConfigFile {
  const file = join(configDir, 'app-config.json')
  try {
    if (!existsSync(file)) return {}
    return JSON.parse(readFileSync(file, 'utf8')) as AppConfigFile
  } catch {
    return {}
  }
}

export function saveAppConfig(configDir: string, config: AppConfigFile): void {
  try {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'app-config.json'), JSON.stringify(config, null, 2), 'utf8')
  } catch {
    // Ignored for the same reason as the window state.
  }
}
