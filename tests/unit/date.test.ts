/** Unit tests for the date/time helpers — the clinic's civil-date arithmetic. */

import { describe, expect, it } from 'vitest'
import {
  addDaysIso,
  addMinutesToTime,
  addMonthsIso,
  ageFromDob,
  compareIsoDates,
  currentTimeSql,
  diffDays,
  formatAge,
  formatDate,
  formatDurationMinutes,
  formatRelativeDate,
  formatTime12h,
  formatTimestamp,
  isValidIsoDate,
  isValidSqlTimestamp,
  isValidTime,
  maxIsoDate,
  minIsoDate,
  minutesBetweenTimes,
  nowSql,
  resolveDateRange,
  sqlToEpochMs,
  todayIso,
  toBengaliDigits,
  weekdayName
} from '@shared/date'

const fixed = new Date(2026, 8, 30, 9, 5, 7) // 30 Sep 2026, local time

describe('date identities', () => {
  it('derives civil dates and timestamps from a clock', () => {
    expect(todayIso(fixed)).toBe('2026-09-30')
    expect(nowSql(fixed)).toBe('2026-09-30 09:05:07')
    expect(currentTimeSql(fixed)).toBe('09:05')
  })

  it('validates the stored formats strictly', () => {
    expect(isValidIsoDate('2026-09-30')).toBe(true)
    expect(isValidIsoDate('2026-9-30')).toBe(false)
    expect(isValidIsoDate('30/09/2026')).toBe(false)
    expect(isValidSqlTimestamp('2026-09-30 09:05:07')).toBe(true)
    expect(isValidSqlTimestamp('2026-09-30T09:05:07')).toBe(false)
    expect(isValidSqlTimestamp('2026-09-30')).toBe(false)
  })

  it('round-trips through epoch milliseconds', () => {
    expect(sqlToEpochMs('2026-09-30 09:05:07')).toBe(fixed.getTime())
  })
})

describe('civil date arithmetic', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDaysIso('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysIso('2028-03-01', -1)).toBe('2028-02-29') // leap year
  })

  it('adds months clamping to the last valid day', () => {
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsIso('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonthsIso('2026-03-15', -1)).toBe('2026-02-15')
    expect(addMonthsIso('2026-01-15', 12)).toBe('2027-01-15')
  })

  it('computes differences and ordering', () => {
    expect(diffDays('2026-09-01', '2026-09-30')).toBe(29)
    expect(diffDays('2026-09-30', '2026-09-01')).toBe(-29)
    expect(compareIsoDates('2026-09-30', '2026-10-01')).toBe(-1)
    expect(compareIsoDates('2026-09-30', '2026-09-30')).toBe(0)
    expect(minIsoDate(['2026-05-01', '2025-12-31', '2026-01-01'])).toBe('2025-12-31')
    expect(maxIsoDate(['2026-05-01', '2025-12-31'])).toBe('2026-05-01')
    expect(minIsoDate([])).toBeNull()
  })
})

describe('date range presets', () => {
  it('resolves every preset the register filters offer', () => {
    expect(resolveDateRange('today', fixed)).toEqual({ from: '2026-09-30', to: '2026-09-30' })
    expect(resolveDateRange('yesterday', fixed)).toEqual({ from: '2026-09-29', to: '2026-09-29' })
    expect(resolveDateRange('last7', fixed)).toEqual({ from: '2026-09-24', to: '2026-09-30' })
    expect(resolveDateRange('last30', fixed)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(resolveDateRange('last90', fixed)).toEqual({ from: '2026-07-03', to: '2026-09-30' })
    expect(resolveDateRange('lastYear', fixed)).toEqual({ from: '2025-10-01', to: '2026-09-30' })
    expect(resolveDateRange('thisMonth', fixed)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(resolveDateRange('lastMonth', fixed)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(resolveDateRange('thisYear', fixed)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('has no range for custom and all', () => {
    expect(resolveDateRange('custom', fixed)).toBeNull()
    expect(resolveDateRange('all', fixed)).toBeNull()
  })
})

describe('ages', () => {
  it('computes years and months on the reference date', () => {
    expect(ageFromDob('1990-05-15', '2026-09-30')).toEqual({ years: 36, months: 4 })
    expect(ageFromDob('2026-09-30', '2026-09-30')).toEqual({ years: 0, months: 0 })
    expect(ageFromDob('2026-09-20', '2026-10-19')).toEqual({ years: 0, months: 0 })
    expect(ageFromDob('1990-05-15', '1990-05-14')).toEqual({ years: 0, months: 0 }) // future babies never go negative
  })

  it('formats the label used on charts and prescriptions', () => {
    expect(formatAge('2026-09-30', '2026-09-30')).toBe('Newborn')
    expect(formatAge('2026-08-30', '2026-09-30')).toBe('1 month')
    expect(formatAge('2026-03-30', '2026-09-30')).toBe('6 months')
    expect(formatAge('2020-09-30', '2026-09-30')).toBe('6 years')
    expect(formatAge('1990-05-15', '2026-09-30')).toBe('36 years 4 months')
  })
})

describe('display formatting', () => {
  it('formats dates and timestamps unambiguously', () => {
    expect(formatDate('2026-09-30')).toBe('30 Sep 2026')
    expect(formatDate('2026-09-30', 'dd/MM/yyyy')).toBe('30/09/2026')
    expect(formatDate('2026-09-30', 'dd MMMM yyyy')).toBe('30 September 2026')
    expect(formatDate('2026-09-30', 'yyyy-MM-dd')).toBe('2026-09-30')
    expect(formatDate('2026-09-30', 'MMM dd, yyyy')).toBe('Sep 30, 2026')
    expect(formatTimestamp('2026-09-30 09:05:07')).toBe('30 Sep 2026 09:05')
  })

  it('formats relative dates and weekdays', () => {
    expect(formatRelativeDate('2026-09-30', fixed)).toBe('Today')
    expect(formatRelativeDate('2026-09-29', fixed)).toBe('Yesterday')
    expect(formatRelativeDate('2026-10-01', fixed)).toBe('Tomorrow')
    expect(formatRelativeDate('2026-09-27', fixed)).toBe('3 days ago')
    expect(formatRelativeDate('2026-10-02', fixed)).toBe('in 2 days')
    expect(formatRelativeDate('2026-08-01', fixed)).toBe('01 Aug 2026')
    expect(weekdayName('2026-09-30')).toBe('Wed')
    expect(weekdayName('2026-09-30', false)).toBe('Wednesday')
  })

  it('translates digits for Bengali printing', () => {
    expect(toBengaliDigits('2026-09-30')).toBe('২০২৬-০৯-৩০')
  })
})

describe('times', () => {
  it('measures and shifts times of day', () => {
    expect(minutesBetweenTimes('09:15', '10:45')).toBe(90)
    expect(minutesBetweenTimes('23:30', '23:45')).toBe(15)
    expect(addMinutesToTime('09:50', 25)).toBe('10:15')
    expect(addMinutesToTime('23:50', 20)).toBe('00:10') // wraps within the day
    expect(addMinutesToTime('00:05', -10)).toBe('23:55')
  })

  it('validates and labels times', () => {
    expect(isValidTime('23:59')).toBe(true)
    expect(isValidTime('24:00')).toBe(false)
    expect(isValidTime('9:5')).toBe(false)
    expect(isValidTime('09:60')).toBe(false)
    expect(formatTime12h('09:30')).toBe('09:30 AM')
    expect(formatTime12h('00:15')).toBe('12:15 AM')
    expect(formatTime12h('12:00')).toBe('12:00 PM')
    expect(formatTime12h('23:59')).toBe('11:59 PM')
    expect(formatDurationMinutes(45)).toBe('45 min')
    expect(formatDurationMinutes(75)).toBe('1 h 15 min')
    expect(formatDurationMinutes(120)).toBe('2 h')
  })
})
