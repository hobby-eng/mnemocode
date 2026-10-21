// TOOL-04's mechanically checked documentation rules: docstrings on public Python declarations,
// and comments/docstrings within 72 columns. Meaning and the rest of PEP 8 still need review.
// With no operands, checks every tracked or trackable Python script; operands support gate tests.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { trackedOrNewFiles } from "./git-top-level.mjs";

const CHECK = String.raw`
import ast
import io
import json
import sys
import tokenize

MAX_DOCUMENTATION_COLUMNS = 72


def _public_declarations(node, inside_function=False):
    for child in ast.iter_child_nodes(node):
        function = isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
        declaration = function or isinstance(child, ast.ClassDef)
        special = declaration and child.name.startswith("__") and child.name.endswith("__")
        public = declaration and (special or not child.name.startswith("_"))
        if public and not inside_function:
            yield child
        if isinstance(child, ast.ClassDef) and not public:
            continue
        yield from _public_declarations(child, inside_function or function)


for path, text in json.load(sys.stdin):
    try:
        tree = ast.parse(text, filename=path)
        compile(tree, path, "exec")
    except SyntaxError as error:
        print(f"{path}:{error.lineno} TOOL-04 invalid Python syntax")
        continue
    lines = text.split("\n")
    documented = [tree, *_public_declarations(tree)]
    for node in documented:
        doc = ast.get_docstring(node, clean=False)
        if doc is None:
            name = getattr(node, "name", "module")
            print(f"{path}:{getattr(node, 'lineno', 1)} TOOL-04 missing docstring: {name}")
    # Private and nested docstrings still follow the same line-length rule.
    definitions = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
    doc_lines = set()
    for node in ast.walk(tree):
        if isinstance(node, definitions) and ast.get_docstring(node, clean=False) is not None:
            first = node.body[0]
            doc_lines.update(range(first.lineno, first.end_lineno + 1))
    for token in tokenize.generate_tokens(io.StringIO(text).readline):
        if token.type == tokenize.COMMENT:
            doc_lines.add(token.start[0])
    for line in sorted(doc_lines):
        if len(lines[line - 1]) > MAX_DOCUMENTATION_COLUMNS:
            print(f"{path}:{line} TOOL-04 comment or docstring exceeds 72 columns")
`;

const operands = process.argv.slice(2);
const paths = operands.length > 0 ? operands : trackedOrNewFiles(process.cwd(), ["scripts/*.py"]);
const result = spawnSync("python3", ["-I", "-c", CHECK], {
  input: JSON.stringify(paths.map((path) => [path, readFileSync(path, "utf8")])),
  encoding: "utf8",
});
if (result.status !== 0) {
  console.error("Python documentation check needs Python 3.10 or later as python3.");
  process.exit(2);
}
if (result.stdout !== "") {
  process.stderr.write(result.stdout);
  process.exit(1);
}
console.log(`Python documentation follows the checked TOOL-04 rules in ${paths.length} files.`);
