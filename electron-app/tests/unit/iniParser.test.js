import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parse } from '../../electron/iniParser.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('iniParser.parse', () => {
  it('parses a simple section with key=value', () => {
    const result = parse('[Section]\nkey=value')
    expect(result).toEqual({ Section: { key: 'value' } })
  })

  it('ignores comment lines starting with #', () => {
    const result = parse('# comment\n[Sec]\nk=v')
    expect(result).toEqual({ Sec: { k: 'v' } })
  })

  it('ignores comment lines starting with ;', () => {
    const result = parse('; comment\n[Sec]\nk=v')
    expect(result).toEqual({ Sec: { k: 'v' } })
  })

  it('ignores blank lines', () => {
    const result = parse('\n\n[Sec]\n\nk=v\n')
    expect(result).toEqual({ Sec: { k: 'v' } })
  })

  it('handles multiple sections', () => {
    const result = parse('[A]\nk=1\n[B]\nk=2')
    expect(result).toEqual({ A: { k: '1' }, B: { k: '2' } })
  })

  it('ignores keys before any section', () => {
    const result = parse('orphanKey=value\n[Sec]\nk=v')
    expect(result.Sec).toEqual({ k: 'v' })
    expect(result.orphanKey).toBeUndefined()
  })

  it('handles values with = in them', () => {
    const result = parse('[S]\npath=C:\\a=b')
    expect(result.S.path).toBe('C:\\a=b')
  })

  it('handles CRLF line endings', () => {
    const result = parse('[S]\r\nk=v\r\n')
    expect(result).toEqual({ S: { k: 'v' } })
  })

  it('returns empty object for empty file', () => {
    expect(parse('')).toEqual({})
  })

  it('handles section names with spaces', () => {
    const result = parse('[Advanced Output]\nkey=val')
    expect(result['Advanced Output']).toEqual({ key: 'val' })
  })

  it('trims whitespace from keys and values', () => {
    const result = parse('[S]\n  key  =  value  ')
    expect(result.S.key).toBe('value')
  })

  it('parses OBS SimpleOutput fixture file', () => {
    const fixturePath = join(__dirname, '../fixtures/obs_profiles/Default/basic.ini')
    const content = readFileSync(fixturePath, 'utf-8')
    const result = parse(content)
    expect(result.SimpleOutput).toBeDefined()
    expect(result.SimpleOutput.FilePath).toBe('C:\\Users\\TestUser\\Videos\\OBS')
    expect(result.Video.BaseCX).toBe('1920')
  })

  it('handles AdvOut section', () => {
    const result = parse('[AdvOut]\nRecFilePath=D:\\Videos')
    expect(result.AdvOut.RecFilePath).toBe('D:\\Videos')
  })

  it('duplicate key in same section uses last-write-wins', () => {
    const result = parse('[Sec]\nkey=first\nkey=second')
    expect(result.Sec.key).toBe('second')
  })
})
