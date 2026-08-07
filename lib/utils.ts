import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge resolves conflicts from a built-in table of Tailwind's own
 * scale values, so it does not recognise the keys this project adds in
 * theme.css. Left on the default config it silently fails open: `rounded-pill`
 * and `rounded-md` are not seen as the same property, both survive the merge,
 * and the winner is decided by stylesheet order — which is the component's
 * class, not the caller's. `<Button className="rounded-md">` stayed a pill and
 * `<DialogTitle className="text-lg">` was ignored, with no warning either time.
 *
 * Registering the custom keys restores the contract every `cn()` call site
 * assumes: the caller's className overrides the component's default.
 *
 * Colours need no entry — tailwind-merge treats unknown colour values
 * generically, so `bg-surface` already overrides `bg-accent-100`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // theme.css: --radius-pill and --radius-container, on top of sm/md/lg.
      rounded: [{ rounded: ['pill', 'container'] }],
      // theme.css: --text-h1 … --text-h6, the Organic heading ramp.
      'font-size': [{ text: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Base UI types `className` as `string | ((state) => string)`, but every
 * component here funnels it through `cn()`, and clsx drops functions without a
 * word — `clsx('base', fn)` is just `'base'`. A caller passing a state callback
 * would get no styling and no error.
 *
 * Narrowing the prop to a plain string turns that silent no-op into a compile
 * error. Nothing in this project needs the callback form; if something ever
 * does, the component has to resolve it against state itself rather than hand
 * it to `cn()`.
 */
export type StringClassName<T> = Omit<T, 'className'> & { className?: string }
