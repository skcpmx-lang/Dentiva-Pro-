/**
 * Renders a `PrintDocument` exactly as it will be printed.
 *
 * The same component is used for the on-screen preview and inside the hidden print window, so the preview
 * can never differ from the printed sheet. Layout is expressed in millimetres using the paper definition
 * from the document itself.
 */

import type {
  InvoiceDocument,
  PrescriptionDocument,
  PrintDocument,
  PrintPatientBlock,
  ReportDocument
} from '@shared/printing/model'

function Header({
  header,
  title,
  meta
}: {
  header: PrintDocument['header']
  title: string
  meta?: { label: string; value: string }[]
}) {
  return (
    <header className="print-header">
      {header.logoDataUrl ? <img className="print-header__logo" src={header.logoDataUrl} alt="" /> : null}
      <div className="print-header__clinic">
        <h1>{header.clinicName}</h1>
        {header.clinicNameBn ? <h2 lang="bn">{header.clinicNameBn}</h2> : null}
        <p>{header.address}</p>
        <p>
          {header.phone ? `Phone: ${header.phone}` : ''}
          {header.phone2 ? ` · ${header.phone2}` : ''}
          {header.email ? ` · ${header.email}` : ''}
        </p>
        {header.registrationNo ? <p>Reg. no: {header.registrationNo}</p> : null}
        {header.dentistName ? (
          <p>
            <strong>{header.dentistName}</strong>
            {header.dentistQualifications.length > 0 ? `, ${header.dentistQualifications.join(', ')}` : ''}
            {header.dentistDesignations.length > 0 ? ` — ${header.dentistDesignations.join(', ')}` : ''}
          </p>
        ) : null}
      </div>
      <div className="print-header__meta">
        <strong>{title}</strong>
        {meta?.map((entry) => (
          <div key={entry.label}>
            {entry.label}: {entry.value}
          </div>
        ))}
      </div>
    </header>
  )
}

function PatientBlock({ patient }: { patient: PrintPatientBlock }) {
  return (
    <section className="print-patient">
      <div className="print-patient__row">
        <span className="print-patient__label">Patient</span>
        <span>
          {patient.name}
          {patient.nameBn ? (
            <>
              {' '}
              <span lang="bn">({patient.nameBn})</span>
            </>
          ) : null}
        </span>
      </div>
      <div className="print-patient__row">
        <span className="print-patient__label">Patient ID</span>
        <span className="mono">{patient.patientCode}</span>
      </div>
      <div className="print-patient__row">
        <span className="print-patient__label">Age / sex</span>
        <span>
          {patient.age ?? '—'} {patient.gender ? `· ${patient.gender}` : ''}
        </span>
      </div>
      <div className="print-patient__row">
        <span className="print-patient__label">Phone</span>
        <span>{patient.phone ?? '—'}</span>
      </div>
      <div className="print-patient__row">
        <span className="print-patient__label">Date</span>
        <span>{patient.date}</span>
      </div>
    </section>
  )
}

function PrescriptionView({ document }: { document: PrescriptionDocument }) {
  const thermal = document.paper.thermal
  return (
    <>
      <Header
        header={document.header}
        title={document.title}
        meta={[
          { label: 'Rx no', value: document.documentId },
          { label: 'Date', value: document.patient.date }
        ]}
      />
      <PatientBlock patient={document.patient} />

      {document.clinical.map((section) => (
        <section className="print-section print-avoid-break" key={section.label}>
          <div className="print-section__label">{section.label}</div>
          {section.lines.map((line, index) => (
            <div className="print-section__line" key={index}>
              {line}
            </div>
          ))}
        </section>
      ))}

      <section className="print-section">
        <div className="print-section__label">Rx — Medicines</div>
        <table className="print-medicines">
          <thead>
            <tr>
              <th style={{ width: '4%' }} className="center">
                #
              </th>
              <th style={{ width: thermal ? '38%' : '26%' }}>Medicine</th>
              {!thermal ? <th style={{ width: '12%' }}>Type / strength</th> : null}
              <th style={{ width: thermal ? '18%' : '10%' }} className="center">
                Dose
              </th>
              <th style={{ width: '6%' }} className="center">
                M
              </th>
              <th style={{ width: '6%' }} className="center">
                N
              </th>
              <th style={{ width: '6%' }} className="center">
                Nt
              </th>
              {!thermal ? <th style={{ width: '10%' }}>Food</th> : null}
              <th style={{ width: '10%' }}>Duration</th>
              <th style={{ width: '8%' }} className="center">
                Qty
              </th>
            </tr>
          </thead>
          <tbody>
            {document.medicines.map((row) => (
              <tr key={row.index}>
                <td className="center">{row.index}</td>
                <td>
                  <strong>{row.medicine}</strong>
                  {row.instruction && !thermal ? (
                    <>
                      {' '}
                      <span style={{ color: '#334155' }}>— {row.instruction}</span>
                    </>
                  ) : null}
                  {row.conditionalInstruction ? (
                    <div className="print-medicines__conditional">{row.conditionalInstruction}</div>
                  ) : null}
                </td>
                {!thermal ? (
                  <td>
                    {row.type ?? ''}
                    {row.strength ? ` · ${row.strength}` : ''}
                  </td>
                ) : null}
                <td className="center">{row.dose ?? ''}</td>
                <td className="center">{row.morning ?? ''}</td>
                <td className="center">{row.noon ?? ''}</td>
                <td className="center">{row.night ?? ''}</td>
                {!thermal ? <td>{row.timing ?? ''}</td> : null}
                <td>{row.duration ?? ''}</td>
                <td className="center">{row.quantity ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {document.followUp ? (
        <section className="print-section print-avoid-break">
          <div className="print-section__label">Follow-up</div>
          <div className="print-section__line">{document.followUp}</div>
        </section>
      ) : null}

      {document.consultationTiming.length > 0 ? (
        <section className="print-section print-avoid-break">
          <div className="print-section__label">Consultation hours</div>
          {document.consultationTiming.map((line, index) => (
            <div className="print-section__line" key={index}>
              {line}
            </div>
          ))}
        </section>
      ) : null}

      {document.footerQuote ? <div className="print-quote">{document.footerQuote}</div> : null}

      <section className="print-signature">
        <div className="print-signature__block">
          {/* The reserved space below stays physically blank: nothing is printed inside it. */}
          <span
            className="print-signature__space"
            style={{ height: `${document.signature.clearanceMm}mm` }}
            aria-hidden="true"
          />
          <div className="print-signature__name">{document.signature.name}</div>
          {document.signature.designationLines.map((line, index) => (
            <div className="print-signature__designation" key={index}>
              {line}
            </div>
          ))}
        </div>
      </section>

      <footer className="print-footer">
        <span>Generated {document.generatedAt}</span>
        <span>Dentiva Pro</span>
      </footer>
    </>
  )
}

function InvoiceView({ document }: { document: InvoiceDocument }) {
  return (
    <>
      {document.voided ? <div className="print-void">VOID</div> : null}
      <Header
        header={document.header}
        title={document.title}
        meta={[
          { label: 'Invoice', value: document.invoiceNo },
          { label: 'Date', value: document.invoiceDate },
          ...(document.dueDate ? [{ label: 'Due', value: document.dueDate }] : []),
          { label: 'Status', value: document.totals.statusLabel }
        ]}
      />
      <PatientBlock patient={document.patient} />

      <table className="print-items">
        <thead>
          <tr>
            <th style={{ width: '5%' }}>#</th>
            <th>Description</th>
            <th style={{ width: '10%' }} className="right">
              Qty
            </th>
            <th style={{ width: '14%' }} className="right">
              Unit price
            </th>
            <th style={{ width: '12%' }} className="right">
              Discount
            </th>
            <th style={{ width: '15%' }} className="right">
              Line total
            </th>
          </tr>
        </thead>
        <tbody>
          {document.items.map((row) => (
            <tr key={row.index}>
              <td>{row.index}</td>
              <td>{row.description}</td>
              <td className="right">{row.quantity}</td>
              <td className="right">{row.unitPrice}</td>
              <td className="right">{row.discount ?? ''}</td>
              <td className="right">{row.lineTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="print-totals">
        <div className="print-totals__row">
          <span>Subtotal</span>
          <span className="mono">{document.totals.subtotal}</span>
        </div>
        {document.totals.discount ? (
          <div className="print-totals__row">
            <span>Discount</span>
            <span className="mono">− {document.totals.discount}</span>
          </div>
        ) : null}
        {document.totals.tax ? (
          <div className="print-totals__row">
            <span>Tax</span>
            <span className="mono">{document.totals.tax}</span>
          </div>
        ) : null}
        {document.totals.roundOff ? (
          <div className="print-totals__row">
            <span>Round off</span>
            <span className="mono">{document.totals.roundOff}</span>
          </div>
        ) : null}
        <div className="print-totals__row print-totals__row--grand">
          <span>Total</span>
          <span className="mono">{document.totals.total}</span>
        </div>
        <div className="print-totals__row">
          <span>Paid</span>
          <span className="mono">{document.totals.paid}</span>
        </div>
        <div className="print-totals__row">
          <span>Due</span>
          <span className="mono">{document.totals.due}</span>
        </div>
      </div>

      {document.paymentHistory.length > 0 ? (
        <section className="print-section print-avoid-break">
          <div className="print-section__label">Payments received</div>
          <table className="print-items">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Date</th>
                <th>Method</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {document.paymentHistory.map((payment) => (
                <tr key={payment.receiptNo}>
                  <td className="mono">{payment.receiptNo}</td>
                  <td>{payment.date}</td>
                  <td>
                    {payment.method}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                  </td>
                  <td className="right mono">{payment.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {document.termsNote ? <div className="print-quote">{document.termsNote}</div> : null}
      {document.voided && document.voidReason ? (
        <p>
          <strong>Void reason:</strong> {document.voidReason}
        </p>
      ) : null}

      <footer className="print-footer">
        <span>Generated {document.generatedAt}</span>
        <span>This is a computer-generated invoice.</span>
      </footer>
    </>
  )
}

function ReportView({ document }: { document: ReportDocument }) {
  return (
    <>
      <Header
        header={document.header}
        title={document.title}
        meta={[
          { label: 'From', value: document.range.from },
          { label: 'To', value: document.range.to }
        ]}
      />
      <table className="print-items">
        <thead>
          <tr>
            {document.columns.map((column) => (
              <th key={column.key} className={column.align === 'right' ? 'right' : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {document.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={
                    document.columns[cellIndex]?.align === 'right'
                      ? 'right'
                      : document.columns[cellIndex]?.align === 'center'
                        ? 'center'
                        : undefined
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="print-summaries">
        {document.summaries.map((summary) => (
          <div
            key={summary.label}
            className={summary.emphasis ? 'print-summaries__item--emphasis' : undefined}
          >
            {summary.label}: <span className="mono">{summary.value}</span>
          </div>
        ))}
      </div>

      {document.footNotes.length > 0 ? (
        <div style={{ marginTop: '8pt', fontSize: '8pt', color: '#475569' }}>
          {document.footNotes.map((note, index) => (
            <div key={index}>{note}</div>
          ))}
        </div>
      ) : null}

      <footer className="print-footer">
        <span>
          Generated {document.generatedAt} by {document.generatedBy}
        </span>
        <span>Dentiva Pro</span>
      </footer>
    </>
  )
}

export function PrintDocumentView({
  document,
  onClose
}: {
  document: PrintDocument
  onClose?: () => void
}): React.ReactElement {
  const paper = document.paper
  const style: React.CSSProperties = {
    width: `${paper.widthMm}mm`,
    minHeight: paper.heightMm ? `${paper.heightMm}mm` : undefined,
    paddingTop: `${paper.margins.top}mm`,
    paddingRight: `${paper.margins.right}mm`,
    paddingBottom: `${paper.margins.bottom}mm`,
    paddingLeft: `${paper.margins.left}mm`
  }
  return (
    <div className="print-root">
      {onClose ? (
        <div className="print-toolbar">
          <button type="button" className="button button--sm" onClick={onClose}>
            Close preview
          </button>
        </div>
      ) : null}
      <div className={paper.thermal ? 'print-sheet print-sheet--thermal' : 'print-sheet'} style={style}>
        {document.kind === 'prescription' ? <PrescriptionView document={document} /> : null}
        {document.kind === 'invoice' ? <InvoiceView document={document} /> : null}
        {document.kind === 'report' ? <ReportView document={document} /> : null}
      </div>
    </div>
  )
}
