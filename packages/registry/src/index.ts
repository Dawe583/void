/**
 * The package boundary for the Reversibility Registry.
 *
 * The data still lives in api/_registry.ts and this file re-exports it. That
 * reads backwards and is deliberate, per decision 6b: api/tsconfig.json infers
 * its emit root from the common source directory of the program, so the moment
 * api/_registry.ts imports anything outside api/, every compiled function moves
 * from <out>/registry.js to <out>/api/registry.js and Vercel cannot resolve any
 * route. tsc exits 0 on that, which is why the direction is inverted here
 * instead: nothing under api/ points outwards.
 *
 * The physical move happens at WP-04a, when the evaluator lands and the package
 * has to be built and published anyway. It goes the other way then, with
 * api/_registry.ts reduced to `export * from "@void/registry";`, a bare
 * specifier resolved through node_modules, which is the only form that leaves
 * the flat emit untouched.
 */

export * from "../../../api/_registry.ts";
