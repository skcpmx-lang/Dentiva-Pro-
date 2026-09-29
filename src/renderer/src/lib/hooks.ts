/**
 * Data-fetching hooks used by every screen so loading, error and retry behaviour is identical everywhere.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorMessage, invoke } from './api'
import type { IpcChannel, IpcPayload, IpcResultOf } from '@shared/ipc'

export interface QueryResult<T> {
  data: T | null
  error: string | null
  loading: boolean
  /** True while a background refresh is running and previous data is still on screen. */
  refreshing: boolean
  reload: () => void
  setData: (updater: T | ((current: T | null) => T | null)) => void
}

export function useQuery<C extends IpcChannel>(
  channel: C,
  payload: IpcPayload<C>,
  options: { enabled?: boolean; deps?: readonly unknown[] } = {}
): QueryResult<IpcResultOf<C>> {
  const enabled = options.enabled ?? true
  const [data, setData] = useState<IpcResultOf<C> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [refreshing, setRefreshing] = useState(false)
  const [nonce, setNonce] = useState(0)
  const mounted = useRef(true)
  const payloadRef = useRef(payload)
  payloadRef.current = payload

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const externalDeps = options.deps ?? [JSON.stringify(payload ?? null)]

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading((current) => (data === null ? true : current))
    setRefreshing(data !== null)
    setError(null)
    invoke(channel, payloadRef.current)
      .then((result) => {
        if (cancelled || !mounted.current) return
        setData(result as IpcResultOf<C>)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cancelled || !mounted.current) return
        setError(errorMessage(cause))
      })
      .finally(() => {
        if (cancelled || !mounted.current) return
        setLoading(false)
        setRefreshing(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, nonce, enabled, ...externalDeps])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  return { data, error, loading, refreshing, reload, setData }
}

/** Outcome of a mutation: either the value or the message to show the user (never a stale state read). */
export type ActionResult<TResult> = { ok: true; value: TResult } | { ok: false; error: string }

export interface ActionState<TArgs extends unknown[], TResult> {
  run: (...args: TArgs) => Promise<ActionResult<TResult>>
  pending: boolean
  /** Last error message, for inline display; the message is also returned by `run`. */
  error: string | null
  reset: () => void
}

/** Small helper for one-shot actions (save, delete, print) with pending/error state. */
export function useAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>
): ActionState<TArgs, TResult> {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const actionRef = useRef(action)
  actionRef.current = action

  const run = useCallback(async (...args: TArgs): Promise<ActionResult<TResult>> => {
    setPending(true)
    setError(null)
    try {
      const value = await actionRef.current(...args)
      return { ok: true, value }
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      return { ok: false, error: message }
    } finally {
      setPending(false)
    }
  }, [])

  return { run, pending, error, reset: () => setError(null) }
}

export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(handle)
  }, [value, delayMs])
  return debounced
}

export interface Pagination {
  page: number
  pageSize: number
  setPage: (page: number) => void
  setPageSize: (size: number) => void
  reset: () => void
}

export function usePagination(initialPageSize = 25): Pagination {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const reset = useCallback(() => setPage(1), [])
  return useMemo(
    () => ({
      page,
      pageSize,
      setPage,
      setPageSize: (size: number) => {
        setPageSize(size)
        setPage(1)
      },
      reset
    }),
    [page, pageSize, reset]
  )
}

/** Warn the user when closing the window with unsaved changes (renderer-side guard). */
export function useUnsavedChanges(isDirty: boolean): void {
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent): void => {
      if (!isDirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])
}

/** Local storage backed state (UI preferences only — never business data). */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  const update = useCallback(
    (next: T) => {
      setValue(next)
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Preference storage is best effort only.
      }
    },
    [key]
  )
  return [value, update]
}
