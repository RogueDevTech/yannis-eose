/**
 * Copy text that is still loading (e.g. an order summary fetched from the API).
 *
 * Safari only allows a clipboard write during the click itself; awaiting a fetch
 * first and then calling `writeText` fails with NotAllowedError ("The request is
 * not allowed by the user agent..."). A ClipboardItem built from the PENDING
 * promise registers the write synchronously, so it still counts as the click.
 *
 * Call it inside the click handler BEFORE any `await`, passing the unawaited
 * promise. Browsers that reject promise-valued ClipboardItems fall back to
 * `writeText`, which they allow after an await. A failed load rethrows its error.
 */
export async function copyTextWhenReady(text: Promise<string>): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('Clipboard is not available in this browser.');
  }
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })),
        }),
      ]);
      return;
    } catch {
      // Fall through: writeText below, or the load's own error.
    }
  }
  await navigator.clipboard.writeText(await text);
}
