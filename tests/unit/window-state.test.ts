/**
 * Unit tests for the window-state memory (REQ-SHELL-003).
 *
 * The geometry is stored in the configuration folder and validated against the display layout, so a window
 * that was saved on a monitor the user has since disconnected still opens on screen. `electron.screen` is
 * the one boundary that cannot exist outside Electron, so it is stubbed with a fake display layout; the
 * file handling, the clamping and the "is it still visible" rule are the real code.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeDisplay {
  workArea: { x: number; y: number; width: number; height: number }
}

let displays: FakeDisplay[] = []

vi.mock('electron', () => ({
  screen: {
    getAllDisplays: () => displays
  }
}))

const { loadAppConfig, loadWindowState, saveAppConfig, saveWindowState } = await import('@main/window-state')

let configDir: string

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'dentiva-window-'))
  displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]
})

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true })
})

describe('window state memory', () => {
  it('starts with the documented default window when nothing was stored', () => {
    const state = loadWindowState(configDir)
    expect(state.width).toBe(1440)
    expect(state.height).toBe(900)
    expect(state.x).toBeUndefined()
    expect(state.isMaximized).toBe(false)
    expect(state.isFullScreen).toBe(false)
  })

  it('stores the geometry and reads it back', () => {
    saveWindowState(configDir, {
      x: 120,
      y: 80,
      width: 1600,
      height: 1000,
      isMaximized: true,
      isFullScreen: false
    })
    const state = loadWindowState(configDir)
    expect(state).toMatchObject({ x: 120, y: 80, width: 1600, height: 1000, isMaximized: true })
  })

  it('drops the position when the saved monitor is no longer attached, keeping the size', () => {
    // Saved on a 4K screen to the right of the laptop panel.
    saveWindowState(configDir, {
      x: 2600,
      y: 200,
      width: 1700,
      height: 980,
      isMaximized: false,
      isFullScreen: false
    })
    const state = loadWindowState(configDir)
    expect(state.x).toBeUndefined()
    expect(state.y).toBeUndefined()
    expect(state.width).toBe(1700)
    expect(state.height).toBe(980)
  })

  it('keeps the position when the monitor is present, including a negative origin', () => {
    displays = [
      { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
      { workArea: { x: -1600, y: -120, width: 1600, height: 900 } }
    ]
    saveWindowState(configDir, {
      x: -1500,
      y: 0,
      width: 1400,
      height: 900,
      isMaximized: false,
      isFullScreen: false
    })
    expect(loadWindowState(configDir)).toMatchObject({ x: -1500, y: 0 })
  })

  it('never restores a window smaller than the supported minimum, and rounds fractional sizes', () => {
    writeFileSync(
      join(configDir, 'window-state.json'),
      JSON.stringify({ x: 10, y: 10, width: 320.6, height: 200.2, isMaximized: false, isFullScreen: false }),
      'utf8'
    )
    const state = loadWindowState(configDir)
    expect(state.width).toBe(1024)
    expect(state.height).toBe(680)
  })

  it('falls back to the defaults when the file is corrupt or unreadable', () => {
    writeFileSync(join(configDir, 'window-state.json'), '{ this is not json', 'utf8')
    expect(loadWindowState(configDir).width).toBe(1440)

    writeFileSync(join(configDir, 'window-state.json'), '"a string instead of an object"', 'utf8')
    expect(loadWindowState(configDir).height).toBe(900)
  })

  it('writes the state next to the configuration, not inside the clinic data folder', () => {
    saveWindowState(configDir, { width: 1500, height: 950, isMaximized: false, isFullScreen: true })
    expect(existsSync(join(configDir, 'window-state.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(configDir, 'window-state.json'), 'utf8'))).toMatchObject({
      width: 1500,
      isFullScreen: true
    })
  })

  it('remembers the chosen data folder and survives a missing or broken file', () => {
    expect(loadAppConfig(configDir)).toEqual({})
    saveAppConfig(configDir, { dataRoot: 'D:\\DentivaData', lastDataRootCheck: '2026-09-30' })
    expect(loadAppConfig(configDir)).toEqual({ dataRoot: 'D:\\DentivaData', lastDataRootCheck: '2026-09-30' })

    writeFileSync(join(configDir, 'app-config.json'), 'not json at all', 'utf8')
    expect(loadAppConfig(configDir)).toEqual({})
  })
})
