import type * as Unsearch from '../types.ts'
import type * as filters from '../filters.ts'
import Fuse  from 'fuse.js'

export class Memory<T extends Unsearch.DocumentBase> implements Unsearch.Adapter<T> {
  #documents: Record<string, T>
  #pageSize: number
  #keys: string[]

  constructor(options: { documents?: T[], pageSize?: number, keys?: string[] } = {}) {
    this.#documents = {}
    this.#pageSize = options.pageSize || 10
    this.#keys = options.keys || []

    this.submit(options.documents || [])
  }

  async get(id: string): Promise<T | null> {
    return this.#documents[id] || null
  }

  async search(query: string, options: Unsearch.Options): Promise<Unsearch.Result<T>> {
    const { page, sort, filters } = options

    const docs = Object.values(this.#documents)
    const filtered = filter(docs, filters)
    const fuse = new Fuse(filtered, { keys: this.#keys })

    let results

    if (query) {
      results = fuse.search(query).map(result => result.item)
    } else {
      results = filtered
    }

    const start = page * this.#pageSize
    const sorted = order(results, sort)
    const records = [...sorted].splice(start, this.#pageSize)
    const facets = aggregate_facets(records, options.facets)

    return {
      query,
      page,
      sort,
      records,
      facets,
      filters,
      total: {
        records: results.length,
        pages: Math.ceil(results.length / this.#pageSize)
      }
    }
  }

  async submit(docs: T[]): Promise<void> {
    docs.forEach(doc => {
      this.#documents[doc.id] = doc
    })
  }

  async delete(id: string): Promise<void> {
    delete this.#documents[id]
  }

  async swap(): Promise<void> {
  }

  async clear(): Promise<void> {
    this.#documents = {}
  }
}

function order<T>(docs: T[], sort: Unsearch.SortField[]): T[] {
  return docs.sort((a, b) => {
    for (const { field, direction } of sort) {
      if (a[field as keyof(T)] < b[field as keyof(T)]) return direction === 'asc' ? -1 : 1
      if (a[field as keyof(T)] > b[field as keyof(T)]) return direction === 'asc' ? 1 : -1
    }

    return 0
  })
}

function filter<T>(docs: T[], filters: filters.Filter[]) {
  return docs.filter(doc => {
    return filters.every(filter => match(doc, filter))
  })
}

function match<T>(doc: T, filter: filters.Filter): boolean {
  // TODO: handle arrays `if (Array.isArray(doc[field.field])) { }`
  switch (filter.op) {
    case '=':
      return doc[filter.field as keyof(T)] == filter.value
    case '!=':
      return doc[filter.field as keyof(T)] !== filter.value
    case '>':
      return doc[filter.field as keyof(T)] > filter.value
    case '>=':
      return doc[filter.field as keyof(T)] >= filter.value
    case '<':
      return doc[filter.field as keyof(T)] < filter.value
    case '<=':
      return doc[filter.field as keyof(T)] <= filter.value
    case 'between':
      return doc[filter.field as keyof(T)] >= filter.values[0]
              && doc[filter.field as keyof(T)] <= filter.values[1]
    case 'not':
      return !match(doc, filter.condition)

    case 'and':
      return filter.conditions.every((condition: filters.Filter) => match(doc, condition))

    case 'or':
      return filter.conditions.some((condition: filters.Filter) => match(doc, condition))
  }
}

function aggregate_facets<T>(docs: T[], facets: string[]): Record<string, Unsearch.FacetStats> {
  const results: Record<string, Unsearch.FacetStats> = {}

  for (const doc of docs) {
    for (const facet of facets) {
      const value = doc[facet]

      if (typeof(value) == 'undefined') continue

      if (Array.isArray(value)) {
        increment_facet_array(results, facet, value)
      }
      else {
        increment_facet(results, facet, value)
      }
    }
  }

  return results
}

function increment_facet_array(results: Record<string, Unsearch.FacetStats>, facet: string, values: string[]) {
  values.forEach(value => {
    increment_facet(results, facet, value)
  })
}

function increment_facet(results: Record<string, Unsearch.FacetStats>, facet: string, value: string) {
  if (!results[facet]) results[facet] = {}

  if (!results[facet][value]) {
    results[facet][value] = 1
  } else {
    results[facet][value] += 1
  }
}
