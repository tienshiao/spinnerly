/**
 * Local ESLint rules for Spinnerly.
 *
 * These exist to encode invariants from docs/spin-the-wheel-design.md that
 * nothing else in the toolchain enforces.
 */

const FIREBASE_ADMIN = /^firebase-admin(\/|$)/

/**
 * The project's own Admin SDK wrapper. Route segments are supposed to import
 * this rather than `firebase-admin` directly, so matching only the raw package
 * would leave the rule blind to every module that follows the convention —
 * `app/w/[shareId]/opengraph-image.tsx` reaching Firestore for OG metadata is
 * the case the design doc actually plans for.
 *
 * Matched by path suffix so the alias (`@/lib/firebase/admin`) and any relative
 * spelling both count.
 */
const ADMIN_WRAPPER = /(^|\/)lib\/firebase\/admin(\.[cm]?[jt]sx?)?$/

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

/** Either the Admin SDK itself or this project's wrapper around it. */
function isFirebaseAdminSource(node) {
  const value = staticString(node)
  return (
    value !== null && (FIREBASE_ADMIN.test(value) || ADMIN_WRAPPER.test(value))
  )
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
 * section 3), by a direct firebase-admin import, or by an import of
 * lib/firebase/admin — the wrapper is the intended spelling, so recognising
 * only the raw package would exempt every module that does the right thing.
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

/**
 * The client SDK. `firebase-admin/*` is the server one and is not in scope.
 *
 * `@firebase/firestore` is the same code under its internal scoped name, which
 * resolves and works — so it is a live bypass, not a hypothetical one.
 */
const FIREBASE_CLIENT_FIRESTORE = /^@?firebase\/firestore(\/|$)/

/**
 * Everything in `firebase/firestore` that mutates, plus the field transforms
 * that only ever appear inside a mutation. The transforms are listed because
 * they are the tell: `arrayUnion` in a client module means a write is being
 * assembled even if the call that sends it is somewhere else in the file.
 */
const FIRESTORE_WRITES = new Set([
  'setDoc',
  'setDocs',
  'addDoc',
  'updateDoc',
  'deleteDoc',
  'writeBatch',
  'runTransaction',
  'arrayUnion',
  'arrayRemove',
  'deleteField',
  'increment',
  'serverTimestamp',
])

function isFirebaseClientFirestoreSource(node) {
  const value = staticString(node)
  return value !== null && FIREBASE_CLIENT_FIRESTORE.test(value)
}

/** The source argument of `import(...)` or `require(...)`, else null. */
function moduleSourceOf(node) {
  if (!node) return null
  // `await import('...')` — the await wraps the import expression.
  const inner = node.type === 'AwaitExpression' ? node.argument : node
  if (!inner) return null
  if (inner.type === 'ImportExpression') return inner.source
  if (
    inner.type === 'CallExpression' &&
    inner.callee.type === 'Identifier' &&
    inner.callee.name === 'require' &&
    inner.arguments.length > 0
  ) {
    return inner.arguments[0]
  }
  return null
}

/** The property name of a member expression, static forms only. */
function memberName(node) {
  if (!node.computed) {
    return node.property.type === 'Identifier' ? node.property.name : null
  }
  return staticString(node.property)
}

/**
 * Design doc section 3: the client is never given a write path. Every mutation
 * goes through a route handler using the Admin SDK, which authorizes against
 * the edit token; security rules deny client writes outright (section 5).
 *
 * So a client write can never succeed — the failure mode this rule prevents is
 * not a security hole but a silent one. `updateDoc` from the browser fails at
 * the rules layer, asynchronously, in a promise nobody awaited, and the UI just
 * never updates. Catching it at lint time turns a mystifying runtime symptom
 * into a message that names the endpoint to use instead.
 *
 * Scoped to `firebase/firestore` rather than to files marked `'use client'`,
 * because in this app the client SDK *is* the browser path: nothing on the
 * server imports it, and a write helper staged in a shared module is exactly as
 * wrong as one called from a component.
 */
const noClientFirestoreWrites = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Firestore write functions from the client SDK. The browser reads; the API writes.',
    },
    schema: [],
    messages: {
      write:
        '`{{name}}` writes to Firestore from the client SDK. The browser has no write path: security rules deny every client write, so this fails at runtime inside an unawaited promise and the UI simply stops updating. Call the route handler under /api instead — see docs/spin-the-wheel-design.md sections 3 and 6. Reads (getDoc, onSnapshot, collection, doc, query) are fine.',
      reExportAll:
        "`export * from '{{source}}'` re-exports the client SDK's write functions under a local name, which puts a write path one import away while hiding it from this rule. Re-export the reads you need by name instead — see docs/spin-the-wheel-design.md section 3.",
    },
  },
  create(context) {
    // Bindings that hold the whole module: `import * as fs`, `const fs =
    // await import(...)`. Resolved at Program:exit so that every node has a
    // parent and use-before-declaration in source order does not matter.
    const namespaceVariables = []

    function reportName(node, name) {
      context.report({ node, messageId: 'write', data: { name } })
    }

    /** `const { setDoc, addDoc: add } = <the module>` */
    function reportDestructured(pattern) {
      if (pattern.type !== 'ObjectPattern') return
      for (const property of pattern.properties) {
        if (property.type !== 'Property') continue
        const name = property.computed
          ? staticString(property.key)
          : property.key.type === 'Identifier'
            ? property.key.name
            : staticString(property.key)
        if (name && FIRESTORE_WRITES.has(name)) reportName(property, name)
      }
    }

    function collectNamespace(node) {
      for (const variable of context.sourceCode.getDeclaredVariables(node)) {
        namespaceVariables.push(variable)
      }
    }

    /** The name a specifier pulls out of the module, ignoring any local alias. */
    function importedName(node) {
      if (!node) return null
      return node.type === 'Identifier' ? node.name : staticString(node)
    }

    return {
      ImportDeclaration(node) {
        if (!isFirebaseClientFirestoreSource(node.source)) return
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier') {
            // `imported`, not `local`: an alias renames the binding, not the
            // thing being imported.
            const name = importedName(specifier.imported)
            if (name && FIRESTORE_WRITES.has(name)) {
              reportName(specifier, name)
            }
          } else {
            // Namespace or default import — the module arrives whole.
            collectNamespace(node)
          }
        }
      },

      // `export { setDoc } from 'firebase/firestore'` — a write path staged in
      // a local barrel. Consumers import it from here, so nothing downstream
      // ever mentions firebase/firestore and the rule would never see them.
      ExportNamedDeclaration(node) {
        if (!node.source || !isFirebaseClientFirestoreSource(node.source))
          return
        for (const specifier of node.specifiers) {
          const name = importedName(specifier.local)
          if (name && FIRESTORE_WRITES.has(name)) reportName(specifier, name)
        }
      },

      // `export * from 'firebase/firestore'` re-exports every write there is,
      // and names none of them.
      ExportAllDeclaration(node) {
        if (!node.source || !isFirebaseClientFirestoreSource(node.source))
          return
        context.report({
          node,
          messageId: 'reExportAll',
          data: { source: staticString(node.source) },
        })
      },

      VariableDeclarator(node) {
        const source = moduleSourceOf(node.init)
        if (!source || !isFirebaseClientFirestoreSource(source)) return
        if (node.id.type === 'ObjectPattern') {
          reportDestructured(node.id)
        } else if (node.id.type === 'Identifier') {
          collectNamespace(node)
        }
      },

      // `(await import('firebase/firestore')).setDoc(...)` — no binding at all.
      MemberExpression(node) {
        const source = moduleSourceOf(node.object)
        if (!source || !isFirebaseClientFirestoreSource(source)) return
        const name = memberName(node)
        if (name && FIRESTORE_WRITES.has(name)) reportName(node, name)
      },

      'Program:exit'() {
        // A worklist rather than a loop: `const g = fs` makes `g` a second
        // handle on the module, and `const h = g` a third. Following the chain
        // costs one queue and closes an otherwise trivial bypass. `seen` is
        // what keeps a self-referential assignment from spinning forever.
        const seen = new Set()
        const queue = [...namespaceVariables]

        while (queue.length > 0) {
          const variable = queue.pop()
          if (seen.has(variable)) continue
          seen.add(variable)

          for (const reference of variable.references) {
            const identifier = reference.identifier
            const parent = identifier.parent
            if (!parent) continue

            // fs.setDoc(...)
            if (
              parent.type === 'MemberExpression' &&
              parent.object === identifier
            ) {
              const name = memberName(parent)
              if (name && FIRESTORE_WRITES.has(name)) reportName(parent, name)
            }

            if (
              parent.type === 'VariableDeclarator' &&
              parent.init === identifier
            ) {
              // const { setDoc } = fs
              reportDestructured(parent.id)
              // const g = fs — g is the module too.
              if (parent.id.type === 'Identifier') {
                queue.push(...context.sourceCode.getDeclaredVariables(parent))
              }
            }
          }
        }
      },
    }
  },
}

const plugin = {
  rules: {
    'no-edge-runtime': noEdgeRuntime,
    'require-nodejs-runtime': requireNodejsRuntime,
    'no-client-firestore-writes': noClientFirestoreWrites,
  },
}

export default plugin
