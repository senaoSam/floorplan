let _counter = 0

export function generateId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${++_counter}`
}
