import { describe, expect, it } from 'vitest';
import { classifyFile, classifyFiles, pickDropDestination } from './fileClassify';

describe('classifyFile', () => {
  it('classifies order extensions as order', () => {
    expect(classifyFile('order.csv')).toBe('order');
    expect(classifyFile('report.xlsx')).toBe('order');
    expect(classifyFile('report.xls')).toBe('order');
    expect(classifyFile('archive.zip')).toBe('order');
    expect(classifyFile('drawing.pdf')).toBe('order');
    expect(classifyFile('photo.png')).toBe('order');
    expect(classifyFile('photo.jpg')).toBe('order');
    expect(classifyFile('photo.jpeg')).toBe('order');
  });

  it('is case-insensitive and ignores dot-prefixed names', () => {
    expect(classifyFile('ORDER.CSV')).toBe('order');
    expect(classifyFile('DWG-PLAN.DWG')).toBe('m0');
  });

  it('classifies m0-only extensions as m0', () => {
    expect(classifyFile('plan.dwg')).toBe('m0');
    expect(classifyFile('plan.dxf')).toBe('m0');
    expect(classifyFile('doc.docx')).toBe('m0');
    expect(classifyFile('doc.doc')).toBe('m0');
    expect(classifyFile('slides.pptx')).toBe('m0');
    expect(classifyFile('pack.rar')).toBe('m0');
    expect(classifyFile('pack.7z')).toBe('m0');
  });

  it('classifies m1-only extensions as m1', () => {
    expect(classifyFile('scan.tiff')).toBe('m1');
    expect(classifyFile('model.step')).toBe('m1');
    expect(classifyFile('model.stp')).toBe('m1');
  });

  it('returns null for unknown or missing extensions', () => {
    expect(classifyFile('notes.txt')).toBeNull();
    expect(classifyFile('noextension')).toBeNull();
    expect(classifyFile('')).toBeNull();
  });
});

describe('classifyFiles', () => {
  it('groups files by class', () => {
    const files = [
      { name: 'order.csv' },
      { name: 'plan.dwg' },
      { name: 'scan.tiff' },
      { name: 'notes.txt' },
    ];
    expect(classifyFiles(files)).toEqual({
      order: [{ name: 'order.csv' }],
      m0: [{ name: 'plan.dwg' }],
      m1: [{ name: 'scan.tiff' }],
      unknown: [{ name: 'notes.txt' }],
    });
  });

  it('handles an empty list', () => {
    expect(classifyFiles([])).toEqual({ order: [], m0: [], m1: [], unknown: [] });
  });
});

describe('pickDropDestination', () => {
  it('prefers order-upload when order files exist', () => {
    expect(pickDropDestination([{ name: 'order.csv' }])).toBe('order-upload');
    expect(pickDropDestination([{ name: 'order.csv' }, { name: 'plan.dwg' }])).toBe('order-upload');
  });

  it('falls back to m0-import when only m0 files exist', () => {
    expect(pickDropDestination([{ name: 'plan.dwg' }])).toBe('m0-import');
    expect(pickDropDestination([{ name: 'plan.dxf' }, { name: 'notes.txt' }])).toBe('m0-import');
  });

  it('returns null for m1-only, unknown or empty drops', () => {
    expect(pickDropDestination([{ name: 'scan.tiff' }])).toBeNull();
    expect(pickDropDestination([{ name: 'notes.txt' }])).toBeNull();
    expect(pickDropDestination([])).toBeNull();
  });
});
