/**
 * Host half of the data-mask bundle.
 *
 * The whole feature is browser-side: the masking engine runs in the Client half
 * and intercepts the paste before the composer ever sees the text, so the
 * sensitive value never leaves the page and never reaches the session log. This
 * half exists only so the package has an ordinary bundle entry (and so the
 * Loader has a stable row to enable, disable, and inspect).
 */

/**
 * Bundle entry point.
 * @param ctx - Host cordis context; unused, the Client half owns the feature.
 */
export function apply(ctx) {
  void ctx;
}
