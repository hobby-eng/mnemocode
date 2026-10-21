// The declarations that the code rules read in the tokens of TypeScript (source-tokens.mjs): the
// doc comment above a token, the members of a class, an interface or an object type, the bodies
// that an export makes public, and where the body of a function or a method opens. Not a parser of
// TypeScript: each reads the shapes that the formatter writes, which verify-code-rules.mjs and
// typescript-rules.mjs check.

import { afterGroup, MEMBER_MODIFIERS } from "./source-tokens.mjs";

/** A name in JavaScript: a letter, `_` or `$`, then letters, digits, `_` and `$`. */
export const IDENTIFIER = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
/**
 * The words that may come before the name of a member: its modifiers, and the keywords that make
 * it a method or an accessor (`async`, `get`, `set`); each may also be a name itself.
 */
const MEMBER_PREFIXES = new Set([...MEMBER_MODIFIERS, "async", "get", "set"]);
/** The tokens after which a new member of a class, an interface or an object type starts. */
const MEMBER_ENDS = new Set([";", "{", "}"]);
/** The brackets that a member's parts nest in. */
const OPENING = new Set(["(", "[", "{"]);
const CLOSING = new Set([")", "]", "}"]);
/** The tokens after which a `{` opens an object type, not a body: a type goes on after them. */
const IN_TYPE = new Set([":", "|", "&", ",", "<", "(", "=>", "?", "keyof", "typeof"]);

/**
 * The `/** … *\/` comment that stands right above the token at `at`, after the token before it:
 * its text, or undefined where there is none.
 */
export function docCommentAbove(tokens, comments, at) {
  const { line } = tokens[at];
  const previous = tokens[at - 1]?.line ?? 0;
  const above = comments.filter((comment) => comment.last <= line && comment.first >= previous);
  const nearest = above.at(-1);
  return nearest !== undefined && nearest.text.startsWith("/**") && nearest.last >= line - 1
    ? nearest.text
    : undefined;
}

/**
 * The index of the token after the angle brackets that open at `at`: `at` itself when none open
 * there. The `>` of an arrow type, (x: T) => U, closes none.
 */
export function afterAngles(tokens, at) {
  if (tokens[at]?.key !== "<") return at;
  let depth = 0;
  for (let next = at; next < tokens.length; next += 1) {
    const key = tokens[next].key;
    if (key === "<") depth += 1;
    else if (key === ">" && tokens[next - 1].key !== "=" && --depth === 0) return next + 1;
  }
  return tokens.length;
}

/**
 * The index of the `{` that opens the body of the class or interface whose keyword is at `at`: the
 * first one outside the parentheses, brackets and type arguments of its heritage.
 */
function bodyOpening(tokens, at) {
  let depth = 0;
  for (let index = at + 1; index < tokens.length; index += 1) {
    const { key } = tokens[index];
    if (key === "{" && depth === 0) return index;
    if (key === "(" || key === "[" || key === "<") depth += 1;
    else if (key === ")" || key === "]" || key === ">") depth -= 1;
  }
  return undefined;
}

/**
 * The index of the `{` that opens the body of the function or method whose parameters open at
 * `params`, after its return type: the first `{` that follows no token after which a type goes on
 * (IN_TYPE). Undefined for a signature without a body, which ends at `;` first.
 */
export function functionBody(tokens, params) {
  let index = afterGroup(tokens, params);
  while (index < tokens.length) {
    const { key } = tokens[index];
    if (key === ";") return undefined;
    if (key === "{" && !IN_TYPE.has(tokens[index - 1].key)) return index;
    if (key === "<") index = afterAngles(tokens, index);
    else if (OPENING.has(key)) index = afterGroup(tokens, index);
    else index += 1;
  }
  return undefined;
}

/**
 * The member that starts at `at` in a body: its name, whether it is public, and where its
 * parameters open when it is a method, a constructor or an accessor. A modifier is read as one
 * only before another name; `[` names a computed member, unless it opens an index signature
 * ([key: string]) or the keys of a mapped type ([K in Keys]), which name no member.
 */
function memberAt(tokens, at) {
  // A static block has no name, and nothing outside the class can call it.
  if (tokens[at].key === "static" && tokens[at + 1]?.key === "{")
    return { name: "", public: false, params: undefined };
  let index = at;
  const modifiers = new Set();
  while (
    MEMBER_PREFIXES.has(tokens[index].key) &&
    /^[\w#"'[*]/u.test(tokens[index + 1]?.key ?? "")
  ) {
    modifiers.add(tokens[index].key);
    index += 1;
  }
  if (tokens[index].key === "*") index += 1;
  const first = tokens[index];
  const after = first.key === "[" ? afterGroup(tokens, index) : index + 1;
  const name = tokens
    .slice(index, after)
    .map((token) => token.key)
    .join("");
  const signature = first.key === "[" && [":", "in"].includes(tokens[index + 2]?.key);
  const hidden =
    modifiers.has("private") || modifiers.has("protected") || name.startsWith("#") || signature;
  const opening = afterAngles(tokens, tokens[after]?.key === "?" ? after + 1 : after);
  const params = tokens[opening]?.key === "(" ? opening : undefined;
  return { name, public: !hidden, params };
}

/**
 * The members of the body that opens at `open`, each with the index of its first token: a field,
 * a method, an accessor, a constructor. A member starts the body and after each `;` that ends
 * one, and on the line after a `}` that ends one, as the formatter writes them: on the line of a
 * `}` a type goes on ({ … }[]), and a line that goes on with a type or a value starts none. An
 * overload is marked as such: it has the same name as the member before it.
 */
export function membersOf(tokens, open) {
  const members = [];
  const close = afterGroup(tokens, open) - 1;
  let depth = 0;
  let previous = "{";
  let lastName;
  for (let index = open + 1; index < close; index += 1) {
    const { key, line } = tokens[index];
    const ended = previous === "}" ? line > tokens[index - 1].line : MEMBER_ENDS.has(previous);
    if (depth === 0 && ended && /^[\w#"'[*(]/u.test(key)) {
      const member = memberAt(tokens, index);
      members.push({ ...member, at: index, overload: member.name === lastName });
      lastName = member.name;
    }
    if (OPENING.has(key)) depth += 1;
    else if (CLOSING.has(key)) depth -= 1;
    if (depth === 0) previous = key;
  }
  return members;
}

/**
 * The `{` of each object type that the type from `from` is made of, up to its `;` or to `to`: the
 * type itself, or the arms of its unions and intersections, grouped in parentheses or not. A
 * literal that belongs to another part is left out: one in a member's type (as in an interface), in
 * a tuple, in angle brackets (type arguments and parameters), after the `extends` of a conditional
 * type (patterns, such as Extract<T, { kind: "few" }>), and in a function type's parameters or
 * result, which belong to its signature.
 */
function objectTypesOf(tokens, from, to) {
  const opens = [];
  let pattern = false;
  let index = from;
  while (index < to && tokens[index].key !== ";") {
    const { key } = tokens[index];
    let next = index + 1;
    if (key === "<") next = afterAngles(tokens, index);
    else if (OPENING.has(key)) next = afterGroup(tokens, index);
    // A function type's parameters: the rest of this part is the function's result.
    if (key === "(" && tokens[next]?.key === "=" && tokens[next + 1]?.key === ">") break;
    if (key === "(" && !pattern) opens.push(...objectTypesOf(tokens, index + 1, next - 1));
    if (key === "{" && !pattern) opens.push(index);
    // The type after `extends` runs to the `?` of its conditional type.
    if (key === "extends") pattern = true;
    else if (key === "?") pattern = false;
    index = next;
  }
  return opens;
}

/**
 * The `{` of each body whose members the export at `at` makes public, with whether it is a
 * class's: a class's or an interface's, or each object type of a type alias (objectTypesOf); none
 * for another export.
 */
export function exportedBodies(tokens, at) {
  const keyword = tokens
    .slice(at + 1, at + 4)
    .findIndex((next) => next.key === "class" || next.key === "interface");
  if (keyword !== -1) {
    const open = bodyOpening(tokens, at + 1 + keyword);
    const isClass = tokens[at + 1 + keyword].key === "class";
    return open === undefined ? [] : [{ open, isClass }];
  }
  // export type Name<…> = …, declared or not; export type { … } and export type * re-export.
  const type = tokens[at + 1]?.key === "declare" ? at + 2 : at + 1;
  if (tokens[type]?.key !== "type" || !IDENTIFIER.test(tokens[type + 1]?.key ?? "")) return [];
  const equals = afterAngles(tokens, type + 2);
  return tokens[equals]?.key === "="
    ? objectTypesOf(tokens, equals + 1, tokens.length).map((open) => ({ open, isClass: false }))
    : [];
}
