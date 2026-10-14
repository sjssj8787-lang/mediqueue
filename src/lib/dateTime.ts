function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatLocalDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatLocalDateTime(date = new Date()): string {
  return `${formatLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function localDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : formatLocalDate(date)
}