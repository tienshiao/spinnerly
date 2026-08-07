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

/**
 * The secrets collection, in both spellings that appear in this repo: the raw
 * string, and the `WHEEL_SECRETS` constant lib/wheels/store.ts exports so the
 * name lives in one place. Matching the identifier by name is a heuristic — the
 * rule does not resolve it to its value — but the alternative is that the
 * project's own preferred spelling is the one bypass the rule cannot see.
 */
const WHEEL_SECRETS_NAMES = new Set(['wheelSecrets', 'WHEEL_SECRETS'])

/** The field whose presence in a `where()` is the anti-pattern's signature. */
const EDIT_TOKEN_HASH = 'editTokenHash'

/**
 * Anything that turns a collection reference into a search or a bulk read.
 * `get` and `stream` are here because calling either straight on a collection
 * reference — with no `.doc()` in between — reads every secret in the database.
 */
const COLLECTION_QUERY_METHODS = new Set([
  'where',
  'orderBy',
  'limit',
  'limitToLast',
  'offset',
  'startAt',
  'startAfter',
  'endAt',
  'endBefore',
  'select',
  'count',
  'aggregate',
  'listDocuments',
  'get',
  'stream',
  'onSnapshot',
])

/** `collection(...)` / `collectionGroup(...)` naming the secrets collection. */
/**
 * Modular-SDK functions that take a collection reference and read across it.
 * `doc` is deliberately absent: `doc(collection(db, 'wheelSecrets'), shareId)`
 * is the correct modular spelling of a keyed lookup.
 */
const MODULAR_QUERY_WRAPPERS = new Set([
  'query',
  'getDocs',
  'onSnapshot',
  'getCountFromServer',
  'getAggregateFromServer',
])

/** The called name, whether the call is `x.foo()` or a bare `foo()`. */
function calleeName(node) {
  if (!node || node.type !== 'CallExpression') return null
  if (node.callee.type === 'MemberExpression') return memberName(node.callee)
  return node.callee.type === 'Identifier' ? node.callee.name : null
}

/**
 * A `where` filtering on `editTokenHash`, in either SDK style.
 *
 * Used to suppress the broader `query` report: such a call is already reported
 * as `byHash`, with the message that names the actual bug, and stacking a
 * second error on the same expression buries the more specific one.
 */
function isHashFilterCall(node) {
  return (
    calleeName(node) === 'where' &&
    staticString(node.arguments?.[0]) === EDIT_TOKEN_HASH
  )
}

/** Whether an argument names the secrets collection, as a literal or the constant. */
function namesWheelSecrets(argument) {
  if (!argument) return false
  const literal = staticString(argument)
  if (literal !== null) return WHEEL_SECRETS_NAMES.has(literal)
  return (
    argument.type === 'Identifier' && WHEEL_SECRETS_NAMES.has(argument.name)
  )
}

/**
 * Both argument positions are checked because the two SDK styles put the
 * collection name in different places: the namespaced Admin form is
 * `db.collection('wheelSecrets')`, the modular form is
 * `collection(db, 'wheelSecrets')` with the handle first. Only the Admin SDK
 * can read this collection at all — rules deny clients outright — but a rule
 * that is the sole mechanical enforcement of an invariant should not be the one
 * thing that recognises only half the ways to write it.
 */
function isWheelSecretsCollectionCall(node) {
  const name = calleeName(node)
  if (name !== 'collection' && name !== 'collectionGroup') return false
  return (
    namesWheelSecrets(node.arguments[0]) || namesWheelSecrets(node.arguments[1])
  )
}

/**
 * Design doc section 6: editor authorization must answer "is this THIS wheel's
 * token?", never "is this A valid token?". The way that invariant breaks is
 * always the same shape — a query across `wheelSecrets` filtering on
 * `editTokenHash` — and the doc calls out that it is easy to reintroduce by
 * accident when refactoring auth into shared middleware.
 *
 * The consequence is a confused deputy: a token that is valid for wheel A
 * authorises a write to wheel B, because nothing in the query ties the secret
 * to the wheel being written. It is invisible in review precisely because the
 * code reads as a perfectly ordinary lookup.
 *
 * The correct shape is `collection('wheelSecrets').doc(shareId)` — keyed by the
 * document ID, with `shareId` taken from the request path. That is why `.doc()`
 * ends the walk below without a report.
 *
 * This rule is TASK-7 acceptance criterion 7. Without it, "no code path queries
 * wheelSecrets by editTokenHash" is only ever a statement about the moment
 * someone last looked.
 */
const noWheelSecretQueries = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow querying the wheelSecrets collection. Look secrets up by document ID, keyed on the shareId from the request path.',
    },
    schema: [],
    messages: {
      query:
        '`.{{method}}()` on the wheelSecrets collection searches across secrets rather than fetching one by ID. That validates a token globally, so an editor of wheel A gains write access to wheel B — the confused-deputy bug in docs/spin-the-wheel-design.md section 6. Use `.doc(shareId)` with the shareId from the request path.',
      byHash:
        "Filtering on `editTokenHash` asks 'is this A valid token?' when the only safe question is 'is this THIS wheel's token?'. Fetch wheelSecrets/{shareId} by document ID and compare hashes — see docs/spin-the-wheel-design.md section 6 and lib/wheels/store.ts.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        // A `where` on `editTokenHash`, chained (`q.where(...)`) or bare
        // (`where(...)`, the modular form). Reported independently of the
        // collection walk below, because by the time a query is assembled
        // through an intermediate variable the receiver is out of view and this
        // argument is the only thing left that still names the mistake.
        if (
          calleeName(node) === 'where' &&
          staticString(node.arguments[0]) === EDIT_TOKEN_HASH
        ) {
          context.report({ node, messageId: 'byHash' })
          return
        }

        if (!isWheelSecretsCollectionCall(node)) return

        // The modular form nests instead of chaining — `query(collection(db,
        // 'wheelSecrets'), ...)` — so there is no member chain to walk and the
        // loop below would find nothing. `doc(collection(...), id)` is the
        // correct modular shape and is left alone, exactly as `.doc()` is.
        if (
          node.parent?.type === 'CallExpression' &&
          node.parent.arguments.includes(node)
        ) {
          const wrapper = calleeName(node.parent)
          if (
            wrapper &&
            MODULAR_QUERY_WRAPPERS.has(wrapper) &&
            !node.parent.arguments.some(isHashFilterCall)
          ) {
            context.report({
              node: node.parent,
              messageId: 'query',
              data: { method: wrapper },
            })
          }
          return
        }

        // Walk outward through the chained calls. `.doc()` is the correct
        // shape and ends the walk; a query method before it is the bug.
        let current = node
        while (
          current.parent?.type === 'MemberExpression' &&
          current.parent.object === current
        ) {
          const method = memberName(current.parent)
          if (method === 'doc') return

          const call = current.parent.parent
          if (method && COLLECTION_QUERY_METHODS.has(method)) {
            // `collection('wheelSecrets').where('editTokenHash', ...)` matches
            // both halves of this rule; the `byHash` branch above already
            // reported it with the better message.
            if (!isHashFilterCall(call)) {
              context.report({
                node: current.parent,
                messageId: 'query',
                data: { method },
              })
            }
            return
          }
          if (call?.type !== 'CallExpression') return
          current = call
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
    'no-wheel-secret-queries': noWheelSecretQueries,
  },
}

export default plugin
