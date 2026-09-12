/**
 * Re-export of the sync contract.
 *
 * The definitions live under api/_shared so that the Vercel function can
 * import them without reaching outside its own directory — a cross-directory
 * import compiles locally but fails at runtime on the serverless builder,
 * which traces only what the function references from within api/.
 *
 * Keeping one copy, re-exported, means the device and the server can never
 * disagree about the wire format or about who wins a conflict.
 */
export * from '../../api/_shared/syncModel'
