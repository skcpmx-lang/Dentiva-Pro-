/**
 * Preload bridge — the only surface the renderer sees.
 *
 * `contextIsolation` and `sandbox` are on; the renderer gets one generic `invoke` function and a
 * subscription for main-process events. No Node module, no `ipcRenderer` and no `require` is exposed.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent, DentivaApi, IpcChannel, IpcPayload, IpcResultOf } from '../shared/ipc'
import type { IpcResult } from '../shared/errors'

const EVENT_CHANNEL = 'dentiva:event'
const INVOKE_CHANNEL = 'dentiva:invoke'

const api: DentivaApi = {
  invoke: <C extends IpcChannel>(channel: C, payload: IpcPayload<C>): Promise<IpcResult<IpcResultOf<C>>> =>
    ipcRenderer.invoke(INVOKE_CHANNEL, channel, payload) as Promise<IpcResult<IpcResultOf<C>>>,
  subscribe: (listener: (event: AppEvent) => void) => {
    const handler = (_event: unknown, payload: AppEvent): void => listener(payload)
    ipcRenderer.on(EVENT_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNEL, handler)
    }
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('dentiva', api)
