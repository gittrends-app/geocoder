import { describe, expect, it } from 'vitest';
import { finiteNumber, record } from './provider.js';

describe('provider helpers', () => {
  it.each([
    [{ answer: 42 }, { answer: 42 }],
    [[], undefined],
    [null, undefined],
    ['text', undefined],
    [42, undefined]
  ])('record(%j) returns %j', (value, expected) => {
    expect(record(value)).toEqual(expected);
  });

  it.each([
    [42, 42],
    ['42.5', 42.5],
    ['not a number', undefined],
    [Number.NaN, undefined],
    [Number.POSITIVE_INFINITY, undefined],
    [true, undefined],
    [{ value: 42 }, undefined],
    [undefined, undefined]
  ])('finiteNumber(%j) returns %j', (value, expected) => {
    expect(finiteNumber(value)).toBe(expected);
  });
});