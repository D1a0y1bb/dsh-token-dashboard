/**
 * Dictionary tests for the browser half.
 *
 * The browser half is a plain script for the client module loader, not a module
 * that can be imported, so these tests read the source and check the properties
 * that a type system cannot: both dictionaries carry exactly the same keys,
 * every key the section asks for exists, and no key is dead weight.
 *
 * The slot renderer throws when an entry declares a locale namespace that has no
 * registered dictionary, so a mismatch here is a broken Settings page, not a
 * cosmetic defect.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** Keys of one literal dictionary object in the source. */
function keysOf(name) {
  const match = source.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n    \\}`))
  assert.ok(match, `dictionary ${name} not found`)
  return [...match[1].matchAll(/^ {6}(\w+):/gm)].map(hit => hit[1])
}

/** Every key the section passes to `t()`. */
function usedKeys() {
  return [...new Set([...source.matchAll(/\bt\('(\w+)'/g)].map(hit => hit[1]))].sort()
}

test('English and Chinese dictionaries carry the same keys in the same order', () => {
  assert.deepEqual(keysOf('zh'), keysOf('en'))
})

test('the dictionaries are not empty', () => {
  assert.ok(keysOf('en').length > 30, `only ${keysOf('en').length} keys`)
})

test('every key the section asks for exists', () => {
  const known = new Set(keysOf('en'))
  const missing = usedKeys().filter(key => !known.has(key))
  assert.deepEqual(missing, [], `missing keys: ${missing.join(', ')}`)
})

test('no dictionary key is unused', () => {
  const used = new Set(usedKeys())
  const unused = keysOf('en').filter(key => !used.has(key))
  assert.deepEqual(unused, [], `unused keys: ${unused.join(', ')}`)
})

test('every message names its placeholders in both languages', () => {
  for (const name of ['en', 'zh']) {
    const match = source.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n    \\}`))
    for (const line of match[1].split('\n')) {
      const value = line.match(/^ {6}(\w+): '(.*)',$/)
      if (value === null) continue
      const [, key, text] = value
      const placeholders = [...text.matchAll(/\{(\w+)\}/g)].map(hit => hit[1]).sort()
      const expected = {
        readingProgress: ['done', 'total'],
        failedWith: ['message'],
        dayCount: ['n'],
        drillCount: ['count'],
        rateSample: ['share'],
        rateHint: ['calls', 'n', 'share'],
      }[key]
      assert.deepEqual(placeholders, expected ?? [], `${name}.${key}`)
      // A template must not be translated into a bare string or vice versa:
      // the slot kit replaces `{name}` only when the text still has it.
      if (expected !== undefined) assert.ok(text.includes('{'), `${name}.${key} lost its placeholder`)
    }
  }
})

test('the section declares the namespace it registers', () => {
  // A slot entry with `locale` and no matching register call throws at render.
  const declared = source.match(/locale: NS/)
  assert.ok(declared, 'slot entry must declare the dictionary namespace')
  assert.ok(/ctx\.locale\.register\(NS,/.test(source), 'the namespace must be registered')
  assert.ok(/const NS = 'tokenDashboard'/.test(source), 'the namespace name is fixed')
})

test('the label callback reads the dictionary, not a literal', () => {
  assert.ok(/label: \(\) => t\('nav'\)/.test(source), 'the nav label must be translated')
})
