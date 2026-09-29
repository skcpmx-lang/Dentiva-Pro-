// @vitest-environment jsdom
/**
 * Component tests for the shared UI primitives (AT-G02, AT-G03, AT-G05).
 *
 * These run in jsdom without Electron, so they cover what a windowed application can still be held to
 * off Windows: the states every list must have (empty / loading / error), keyboard behaviour of
 * modal and drawer dialogs (focus moves in, Tab cycles, Escape closes, focus comes back, the page
 * behind is locked), the destructive-confirmation dialog (typed phrase, password, reason) and the
 * money/description primitives.
 */

import { useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Button,
  ConfirmProvider,
  DataTable,
  DescriptionList,
  Drawer,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  Money,
  Pagination,
  ProgressBar,
  StatCard,
  useConfirm
} from '@renderer/components/ui'

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

describe('list states', () => {
  it('renders a titled empty state with an optional action', async () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        title="No patients yet"
        description="Register the first patient to get started."
        action={<Button onClick={onClick}>New patient</Button>}
      />
    )
    expect(screen.getByRole('heading', { name: 'No patients yet' })).toBeTruthy()
    expect(screen.getByText('Register the first patient to get started.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'New patient' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('announces loading to assistive technology and hides the spinner', () => {
    render(<LoadingState label="Loading patients…" />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toContain('Loading patients…')
    expect(status.querySelector('.spinner')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('reports an error as an alert and offers a retry only when one is possible', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<ErrorState message="The list could not be loaded." onRetry={onRetry} />)
    expect(screen.getByRole('alert').textContent).toContain('The list could not be loaded.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(<ErrorState message="Saved records cannot be retried." />)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('renders a data table with headers, right-aligned money cells and a pager', async () => {
    const onPage = vi.fn()
    const columns = [
      { key: 'name', header: 'Patient', render: (row: { name: string }) => row.name },
      {
        key: 'due',
        header: 'Due',
        align: 'right' as const,
        render: (row: { due: number }) => <Money poisha={row.due} />
      }
    ]
    const rows = [
      { name: 'Rahima Begum', due: 125000 },
      { name: 'Karim Mia', due: 0 }
    ]

    render(
      <>
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.name} />
        <Pagination page={2} pageSize={25} total={80} onPageChange={onPage} />
      </>
    )

    expect(screen.getByRole('columnheader', { name: 'Patient' })).toBeTruthy()
    expect(screen.getByText('Rahima Begum')).toBeTruthy()
    // Money is rendered from integer poisha, never from a float.
    expect(screen.getByText('৳ 1,250.00')).toBeTruthy()

    const next = screen.getByRole('button', { name: /next/i })
    await userEvent.click(next)
    expect(onPage).toHaveBeenCalledWith(3)
  })

  it('shows labelled numbers in stat cards and progress bars with accessible values', () => {
    render(
      <>
        <StatCard label="Patients today" value="12" hint="Compared with 9 yesterday" />
        <ProgressBar value={40} max={80} label="Storage used" />
      </>
    )
    expect(screen.getByText('Patients today')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('Compared with 9 yesterday')).toBeTruthy()

    const bar = screen.getByRole('progressbar', { name: 'Storage used' })
    expect(bar.getAttribute('aria-valuenow')).toBe('50')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
  })

  it('renders a description list from its items', () => {
    render(
      <DescriptionList
        items={[
          { label: 'Patient code', value: 'P-2026-0001' },
          { label: 'Phone', value: '01711 000000' }
        ]}
      />
    )
    expect(screen.getByText('Patient code')).toBeTruthy()
    expect(screen.getByText('P-2026-0001')).toBeTruthy()
  })
})

describe('modal dialog', () => {
  function Harness(): React.ReactElement {
    const [open, setOpen] = useState(false)
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Open the dialog</Button>
        {open ? (
          <Modal
            title="Void this invoice?"
            onClose={() => setOpen(false)}
            footer={<Button onClick={() => setOpen(false)}>Cancel</Button>}
          >
            <p>The invoice stays in the ledger with its void reason.</p>
            <input aria-label="Void reason" />
          </Modal>
        ) : null}
      </div>
    )
  }

  it('moves focus inside, traps Tab, closes on Escape and gives focus back', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const opener = screen.getByRole('button', { name: 'Open the dialog' })
    await user.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Void this invoice?' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    // The page behind the dialog cannot scroll while it is open.
    expect(document.body.style.overflow).toBe('hidden')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    // Tab from the last control wraps to the first instead of leaving the dialog.
    const reason = screen.getByLabelText('Void reason')
    reason.focus()
    await user.tab() // → Cancel
    await user.tab() // → Close (still inside)
    expect(dialog.contains(document.activeElement)).toBe(true)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.style.overflow).toBe('')
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('closes on a click on the backdrop but not on a click inside the dialog', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open the dialog' }))

    await user.click(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).not.toBeNull()

    await user.click(document.querySelector('.overlay') as HTMLElement)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('drawer', () => {
  it('is a labelable dialog that traps focus and closes with Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Drawer title="Patient history" onClose={onClose}>
        <button type="button">First action</button>
        <button type="button">Second action</button>
      </Drawer>
    )

    const drawer = screen.getByRole('dialog', { name: 'Patient history' })
    expect(drawer.getAttribute('aria-modal')).toBe('true')
    await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true))

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('destructive confirmation', () => {
  function Destructive(): React.ReactElement {
    const confirm = useConfirm()
    const [result, setResult] = useState('nothing yet')
    return (
      <div>
        <Button
          onClick={() =>
            confirm({
              title: 'Delete every record',
              message: 'This cannot be undone.',
              confirmLabel: 'Delete everything',
              tone: 'danger',
              typeToConfirm: 'DELETE ALL DATA',
              requirePassword: true,
              reasonLabel: 'Reason',
              reasonMinLength: 5,
              onConfirm: ({ confirmationPhrase, password, reason }) =>
                setResult(`${confirmationPhrase}|${password}|${reason}`)
            })
          }
        >
          Start
        </Button>
        <p data-testid="result">{result}</p>
      </div>
    )
  }

  it('keeps the action blocked until the typed phrase, the password and a reason are supplied', async () => {
    const user = userEvent.setup()
    render(
      <ConfirmProvider>
        <Destructive />
      </ConfirmProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Start' }))
    const confirmButton = screen.getByRole('button', { name: 'Delete everything' })
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true)

    const phraseField = screen.getByLabelText(/type/i)
    await user.type(phraseField, 'delete all data')
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true)

    await user.clear(phraseField)
    await user.type(phraseField, 'DELETE ALL DATA')
    await user.type(screen.getByLabelText(/password/i), 'Harness#Pass1')
    await user.type(screen.getByLabelText(/reason/i), 'Clearing the test database')
    await waitFor(() => expect((confirmButton as HTMLButtonElement).disabled).toBe(false))

    await user.click(confirmButton)
    await waitFor(() =>
      expect(screen.getByTestId('result').textContent).toBe(
        'DELETE ALL DATA|Harness#Pass1|Clearing the test database'
      )
    )
  })
})
