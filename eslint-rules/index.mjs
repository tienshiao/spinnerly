/**
 * Local ESLint rules for Spinnerly.
 *
 * These exist to encode invariants from docs/spin-the-wheel-design.md that
 * nothing else in the toolchain enforces.
 */

const FIREBASE_ADMIN = /^firebase-admin(\/|$)/

/**
 * Next.js only honours `export const runtime` in a route-segment module. In an
 * ordinary library module the export is inert, so requiring it there would be
 * cargo cult.
 */
const SEGMENT_BASENAMES = new Set([
  'route',
  'page',
  'layout',
  'default',
  'template',
  'opengraph-image',
  'twitter-image',
  'icon',
  'apple-icon',
])

function isRouteSegmentFile(filename) {
  const match = /(?:^|[/\\])app[/\\].*?([^/\\]+)\.[cm]?[jt]sx?$/.exec(filename)
  return match ? SEGMENT_BASENAMES.has(match[1]) : false
}

/** Every route under app/api touches Firestore through the Admin SDK. */
function isApiRoute(filename) {
  return /(?:^|[/\\])app[/\\]api[/\\]/.test(filename)
}

/**
 * Strip TypeScript expression wrappers. `export const runtime = 'edge' as const`
 * is the idiomatic spelling for Next route-segment config, and it parses as a
 * TSAsExpression wrapping the literal — so a naive `node.type === 'Literal'`
 * check misses the exact case it exists to catch.
 */
function unwrap(node) {
  let current = node
  while (
    current &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'TSNonNullExpression')
  ) {
    current = current.expression
  }
  return current
}

/** The string value of an expression, or null if it isn't a static string. */
function staticString(node) {
  const inner = unwrap(node)
  if (!inner) return null
  if (inner.type === 'Literal' && typeof inner.value === 'string') {
    return inner.value
  }
  if (
    inner.type === 'TemplateLiteral' &&
    inner.expressions.length === 0 &&
    inner.quasis.length === 1
  ) {
    return inner.quasis[0].value.cooked
  }
  return null
}

function isFirebaseAdminSource(node) {
  const value = staticString(node)
  return value !== null && FIREBASE_ADMIN.test(value)
}

/**
 * Shared traversal. Both rules need the same three facts about a module: what
 * `runtime` is declared as, whether that declaration is actually exported, and
 * whether firebase-admin is reachable from it.
 */
function collectModuleFacts(state) {
  return {
    // import ... from 'firebase-admin/...'
    ImportDeclaration(node) {
      if (isFirebaseAdminSource(node.source)) state.adminImport ??= node
    },
    // await import('firebase-admin/...')
    ImportExpression(node) {
      if (isFirebaseAdminSource(node.source)) state.adminImport ??= node
    },
    // require('firebase-admin/...')
    CallExpression(node) {
      if (
        node.callee.type === 'Identifier' &&
        node.callee.name === 'require' &&
        node.arguments.length > 0 &&
        isFirebaseAdminSource(node.arguments[0])
      ) {
        state.adminImport ??= node
      }
    },
    // const runtime = '...'  (exported inline or separately)
    VariableDeclarator(node) {
      if (node.id.type !== 'Identifier' || node.id.name !== 'runtime') return
      if (!node.init) return
      const value = staticString(node.init)
      if (value === null) return
      state.runtime = { value, node: node.init }
    },
    ExportNamedDeclaration(node) {
      if (node.declaration) {
        if (node.declaration.type !== 'VariableDeclaration') return
        for (const declarator of node.declaration.declarations) {
          if (
            declarator.id.type === 'Identifier' &&
            declarator.id.name === 'runtime'
          ) {
            state.exported = true
          }
        }
        return
      }
      // export { runtime } / export { runtime as default }
      for (const specifier of node.specifiers) {
        if (specifier.local?.name === 'runtime') state.exported = true
      }
    },
  }
}

/** The exported runtime value, or null when nothing is exported. */
function exportedRuntime(state) {
  return state.exported ? state.runtime : null
}

/**
 * The Firebase Admin SDK talks to Firestore over gRPC via native bindings and
 * raw sockets. It cannot run on the Edge Runtime — not with a shim, not with
 * `nodejs_compat`. See design doc section 3 ("Why not Cloudflare").
 *
 * Next.js 16 makes `nodejs` the default and deprecates `edge`, so the practical
 * risk is low. This rule keeps it at zero, and documents why for the next person
 * who wonders whether a route could be moved to the edge for latency.
 */
const noEdgeRuntime = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow the Edge Runtime. The Firebase Admin SDK cannot run on it.',
    },
    schema: [],
    messages: {
      edge: 'The Edge Runtime is not available in this project. The Firebase Admin SDK uses gRPC over native bindings and cannot run on edge — see docs/spin-the-wheel-design.md section 3. Reads bypass the server entirely, so there is no edge latency win to capture here anyway.',
    },
  },
  create(context) {
    const state = { runtime: null, exported: false, adminImport: null }
    return {
      ...collectModuleFacts(state),
      'Program:exit'() {
        const runtime = exportedRuntime(state)
        if (runtime && runtime.value === 'edge') {
          context.report({ node: runtime.node, messageId: 'edge' })
        }
      },
    }
  },
}

/**
 * Route-segment modules that reach Firestore must pin `runtime = 'nodejs'`.
 *
 * Scoped to route-segment files because that is the only place Next.js reads
 * the export; in a library module it does nothing. Triggered by anything under
 * app/api (every endpoint in this app writes to Firestore, per design doc
 * section 3) or by a direct firebase-admin import.
 *
 * Redundant under Next 16 defaults, and deliberately so: the export is a comment
 * the linter enforces. It states at the top of the file that this route is
 * pinned to Node, so a later refactor has to delete an explicit line rather than
 * silently inherit a changed default.
 */
const requireNodejsRuntime = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Require `export const runtime = 'nodejs'` in route segments that reach Firestore.",
    },
    schema: [],
    messages: {
      missing:
        "This route reaches Firestore, so it must declare `export const runtime = 'nodejs'`. The Admin SDK cannot run on the Edge Runtime — see docs/spin-the-wheel-design.md section 3.",
      wrongValue:
        "`runtime` must be 'nodejs' in a route that reaches Firestore, not '{{value}}'. See docs/spin-the-wheel-design.md section 3.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename()
    if (!isRouteSegmentFile(filename)) return {}

    const state = { runtime: null, exported: false, adminImport: null }
    return {
      ...collectModuleFacts(state),
      'Program:exit'(program) {
        if (!isApiRoute(filename) && !state.adminImport) return

        const runtime = exportedRuntime(state)
        if (!runtime) {
          context.report({
            node: state.adminImport ?? program,
            messageId: 'missing',
          })
        } else if (runtime.value !== 'nodejs') {
          context.report({
            node: runtime.node,
            messageId: 'wrongValue',
            data: { value: runtime.value },
          })
        }
      },
    }
  },
}

const plugin = {
  rules: {
    'no-edge-runtime': noEdgeRuntime,
    'require-nodejs-runtime': requireNodejsRuntime,
  },
}

export default plugin
