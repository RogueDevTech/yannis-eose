import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyTextWhenReady } from './clipboard';

class FakeClipboardItem {
  constructor(public items: Record<string, Promise<Blob>>) {}
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copyTextWhenReady', () => {
  it('registers the clipboard write before the text has loaded (Safari user-gesture rule)', async () => {
    const write = vi.fn((items: FakeClipboardItem[]) =>
      items[0]!.items['text/plain']!.then(() => undefined),
    );
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    vi.stubGlobal('navigator', { clipboard: { write, writeText: vi.fn() } });

    const text = deferred<string>();
    const done = copyTextWhenReady(text.promise);
    // Synchronously, inside the "click": the write is already requested.
    expect(write).toHaveBeenCalledTimes(1);

    text.resolve('Order #123');
    await done;
    const blob = await write.mock.calls[0]![0][0]!.items['text/plain']!;
    expect(await blob.text()).toBe('Order #123');
  });

  it('falls back to writeText when promise-valued ClipboardItems are rejected', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    vi.stubGlobal('navigator', {
      clipboard: { write: vi.fn(() => Promise.reject(new Error('unsupported'))), writeText },
    });
    await copyTextWhenReady(Promise.resolve('hello'));
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it("surfaces the load's own error when the summary fetch fails", async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    vi.stubGlobal('navigator', {
      clipboard: {
        write: vi.fn((items: FakeClipboardItem[]) => items[0]!.items['text/plain']!.then(() => undefined)),
        writeText: vi.fn(),
      },
    });
    await expect(copyTextWhenReady(Promise.reject(new Error('Order not found')))).rejects.toThrow('Order not found');
  });

  it('reports a missing clipboard clearly', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyTextWhenReady(Promise.resolve('x'))).rejects.toThrow('Clipboard is not available');
  });
});
